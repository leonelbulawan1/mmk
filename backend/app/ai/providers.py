"""Language-model providers with tool/function calling.

All providers share one neutral message format::

    {"role": "user", "content": str}
    {"role": "assistant", "content": str, "tool_calls": [{"id", "name", "args"}]}
    {"role": "tool", "tool_call_id": str, "name": str, "content": str(JSON)}

* ``AnthropicProvider`` - Anthropic Messages API (``tool_use`` blocks).
* ``OpenAIProvider``    - any OpenAI-compatible Chat Completions endpoint.
* ``OfflineProvider``   - a deterministic, extractive tool-using agent that needs no
  network or API key.  It follows the same tool protocol, so the whole pipeline
  (authorisation, tools, citations, leak guard) is exercised identically.
"""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..config import settings


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class LLMResponse:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLMError(RuntimeError):
    pass


class LLMProvider(ABC):
    name = "base"

    def __init__(self, model: str):
        self.model = model

    @abstractmethod
    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> LLMResponse: ...

    def describe(self) -> dict:
        return {"provider": self.name, "model": self.model}


# ---------------------------------------------------------------------------------------
class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str, api_key: str, base_url: str = ""):
        super().__init__(model)
        if not api_key:
            raise LLMError("LLM_API_KEY is required for the Anthropic provider")
        self._key = api_key
        self._url = (base_url or "https://api.anthropic.com").rstrip("/") + "/v1/messages"

    @staticmethod
    def _convert(messages: list[dict]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            if m["role"] == "user":
                out.append({"role": "user", "content": m["content"]})
            elif m["role"] == "assistant":
                blocks: list[dict] = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for tc in m.get("tool_calls", []):
                    blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["args"]})
                out.append({"role": "assistant", "content": blocks})
            elif m["role"] == "tool":
                block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
        return out

    def complete(self, system, messages, tools) -> LLMResponse:
        import httpx

        body = {"model": self.model, "max_tokens": 1024, "system": system, "messages": self._convert(messages),
                "tools": tools}
        try:
            r = httpx.post(self._url, json=body, timeout=60,
                           headers={"x-api-key": self._key, "anthropic-version": "2023-06-01"})
            r.raise_for_status()
        except Exception as exc:  # httpx.HTTPError and network failures
            raise LLMError(f"Anthropic request failed: {exc}") from exc
        data = r.json()
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        calls = [ToolCall(b["id"], b["name"], b.get("input") or {})
                 for b in data.get("content", []) if b.get("type") == "tool_use"]
        return LLMResponse(text, calls)


# ---------------------------------------------------------------------------------------
class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, model: str, api_key: str, base_url: str = ""):
        super().__init__(model)
        if not api_key:
            raise LLMError("LLM_API_KEY is required for the OpenAI-compatible provider")
        self._key = api_key
        self._url = (base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"

    @staticmethod
    def _convert(system: str, messages: list[dict]) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system}]
        for m in messages:
            if m["role"] == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.get("content") or None}
                if m.get("tool_calls"):
                    msg["tool_calls"] = [{"id": tc["id"], "type": "function",
                                          "function": {"name": tc["name"], "arguments": json.dumps(tc["args"])}}
                                         for tc in m["tool_calls"]]
                out.append(msg)
            elif m["role"] == "tool":
                out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
            else:
                out.append({"role": "user", "content": m["content"]})
        return out

    def complete(self, system, messages, tools) -> LLMResponse:
        import httpx

        body = {"model": self.model, "messages": self._convert(system, messages),
                "tools": [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                            "parameters": t["input_schema"]}} for t in tools]}
        try:
            r = httpx.post(self._url, json=body, timeout=60, headers={"Authorization": f"Bearer {self._key}"})
            r.raise_for_status()
        except Exception as exc:  # httpx.HTTPError and network failures
            raise LLMError(f"LLM request failed: {exc}") from exc
        msg = r.json()["choices"][0]["message"]
        calls = []
        for tc in msg.get("tool_calls") or []:
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append(ToolCall(tc["id"], tc["function"]["name"], args))
        return LLMResponse(msg.get("content") or "", calls)


# ---------------------------------------------------------------------------------------
NEUTRAL_ANSWER = "I'm not able to share anything about that from the diary."

_SENT = re.compile(r"(?<=[.!?])\s+")
_LETTER_Q = re.compile(r"\bletters?\b|\bsulat\b", re.I)
_ABOUT_ME_Q = re.compile(r"\b(?:about|mention(?:ed|s)?|of)\s+me\b|\btungkol\s+sa\s+akin\b|\bako\b", re.I)
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset("the a an of to and or in on at for with about did does do was were is are what when who how why "
                  "my your her his their she he they it me i you tell any anything know there".split())


class OfflineProvider(LLMProvider):
    """Deterministic extractive agent.  Uses only what the tools returned to it."""

    name = "offline"

    def __init__(self, model: str = "alaala-extractive-1"):
        super().__init__(model)

    def complete(self, system, messages, tools) -> LLMResponse:
        question = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        tool_msgs = [m for m in messages if m["role"] == "tool"]
        by_name = {m["name"]: json.loads(m["content"]) for m in tool_msgs}
        # Questions about the asker's letters, or about whether they are mentioned, have their own tools.
        if _LETTER_Q.search(question):
            if "my_letters" not in by_name:
                return LLMResponse("", [ToolCall("call_letters", "my_letters", {})])
            return LLMResponse(self._letters(by_name["my_letters"].get("letters", [])))
        if _ABOUT_ME_Q.search(question):
            if "entries_about_me" not in by_name:
                return LLMResponse("", [ToolCall("call_about_me", "entries_about_me", {})])
            return LLMResponse(self._about_me(by_name["entries_about_me"]))
        searched = [m for m in tool_msgs if m["name"] == "search_entries"]
        fetched = [m for m in tool_msgs if m["name"] == "get_entry"]
        if not searched:
            return LLMResponse("", [ToolCall("call_search", "search_entries", {"query": question})])
        if not fetched:
            results = json.loads(searched[-1]["content"]).get("results", [])
            if not results:
                return LLMResponse(NEUTRAL_ANSWER)
            return LLMResponse("", [ToolCall(f"call_get_{r['entry_id']}", "get_entry", {"entry_id": r["entry_id"]})
                                    for r in results[:3]])
        return LLMResponse(self._compose(question, [json.loads(m["content"]) for m in fetched]))

    @staticmethod
    def _letters(letters: list[dict]) -> str:
        if not letters:
            return NEUTRAL_ANSWER
        parts = []
        for lt in letters:
            if lt.get("status") == "released":
                parts.append(f"Here is the letter \"{lt['title']}\", written on {lt['date']}:\n\n{lt['text']} [{lt['date']}]")
            else:
                when = f" It opens on {lt['opens_on']}." if lt.get("opens_on") else " It will be released later."
                parts.append(f"There is a letter for you, \"{lt['title']}\", but it has not been released yet, so I "
                             f"can't show it.{when}")
        return "\n\n".join(parts)

    @staticmethod
    def _about_me(result: dict) -> str:
        n = int(result.get("count") or 0)
        if n == 0:
            return NEUTRAL_ANSWER  # never confirm or deny entries the person may not see
        dates = result.get("dates") or []
        listed = ", ".join(dates[:-1]) + f" and {dates[-1]}" if len(dates) > 1 else (dates[0] if dates else "")
        noun = "entry" if n == 1 else "entries"
        readable = int(result.get("readable") or 0)
        tail = ("Their contents are not shared with you." if readable == 0 else
                "You can ask about them to hear more." if readable == n else
                f"You may read {readable} of them; the contents of the others are not shared with you.")
        return f"Yes. The diary mentions you in {n} {noun}{f', dated {listed}' if listed else ''}. {tail}"

    @staticmethod
    def _best_sentences(text: str, terms: set[str], k: int = 2) -> str:
        from .tools import stems

        sentences = [s.strip() for s in _SENT.split(text) if s.strip()]
        scored = sorted(enumerate(sentences),
                        key=lambda p: (-len(terms & stems(_WORD.findall(p[1].lower()))), p[0]))
        chosen = sorted(scored[:k], key=lambda p: p[0])
        return " ".join(s for _, s in chosen)

    def _compose(self, question: str, views: list[dict]) -> str:
        from .tools import stems

        terms = stems(w for w in _WORD.findall(question.lower()) if w not in _STOP)
        parts: list[str] = []
        available = [v for v in views if v.get("available") is not False]

        def overlap(v: dict) -> int:
            blob = " ".join(str(v.get(k, "")) for k in ("title", "text", "summary")) + " " + " ".join(v.get("topics", []))
            return len(terms & stems(_WORD.findall(blob.lower())))

        relevant = [v for v in available if overlap(v) > 0] or available
        for v in relevant:
            if v.get("text"):
                parts.append(f"On {v['date']}, the diary says: \"{self._best_sentences(v['text'], terms)}\" [{v['date']}]")
            elif v.get("summary"):
                parts.append(f"An entry from {v['date']} is summarised as: {v['summary']} [{v['date']}]")
            elif v.get("access") == "existence":
                parts.append(f"There is an entry dated {v['date']}, but its contents are not shared with you.")
        if not parts:
            return NEUTRAL_ANSWER
        return "\n\n".join(parts)


def make_provider() -> LLMProvider:
    p = settings.llm_provider.lower()
    if p == "anthropic":
        return AnthropicProvider(settings.llm_model, settings.llm_api_key, settings.llm_base_url)
    if p == "openai":
        return OpenAIProvider(settings.llm_model, settings.llm_api_key, settings.llm_base_url)
    return OfflineProvider()
