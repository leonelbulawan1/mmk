"""The Vault: an owner's append-only, hash-chained store of entries and revisions."""
from __future__ import annotations

from datetime import datetime, timezone

from ..processing.hashchain import GENESIS, ChainRecord, ChainReport, link_hash, verify_chain
from .entries import Entry, Revision


class VaultSealedError(PermissionError):
    pass


class Vault:
    def __init__(self, owner_id: int, entries: tuple[Entry, ...] = (), sealed: bool = False):
        self._owner_id = owner_id
        self._entries: dict[int, Entry] = {}
        self._order: list[Entry] = []
        self._sealed = sealed
        for e in entries:
            self._order.append(e)
            if e.id is not None:
                self._entries[e.id] = e

    # ---- read-only views -----------------------------------------------------
    @property
    def owner_id(self) -> int:
        return self._owner_id

    @property
    def sealed(self) -> bool:
        return self._sealed

    @property
    def entries(self) -> tuple[Entry, ...]:
        """Entries in order, without deleted ones (their records still count in the chain)."""
        return tuple(e for e in self._order if not e.deleted)

    @property
    def deleted_seqs(self) -> frozenset[int]:
        """Chain positions of deleted entries, so lists of records can leave out their titles."""
        return frozenset(e.seq for e in self._order if e.deleted)

    def get(self, entry_id: int) -> Entry | None:
        e = self._entries.get(entry_id)
        return None if e is None or e.deleted else e

    def _records(self) -> list[tuple[int, str, dict, str, str]]:
        recs = []
        for e in self._order:
            recs.append((e.seq, f"entry:{e.id}", e.hash_payload(), e.prev_hash, e.hash))
            for r in e.revisions:
                recs.append((r.seq, f"revision:{r.id}", r.hash_payload(e.seq), r.prev_hash, r.hash))
        return sorted(recs, key=lambda x: x[0])

    @property
    def head(self) -> str:
        recs = self._records()
        return recs[-1][4] if recs else GENESIS

    @property
    def next_seq(self) -> int:
        recs = self._records()
        return recs[-1][0] + 1 if recs else 1

    # ---- append-only mutation -----------------------------------------------
    def seal(self) -> None:
        self._sealed = True

    def append_entry(self, entry: Entry) -> Entry:
        if self._sealed:
            raise VaultSealedError("The vault is sealed; no new entries can be written")
        if entry.owner_id != self._owner_id:
            raise PermissionError("Entry belongs to a different owner")
        if entry.seq != self.next_seq:
            raise ValueError(f"Entry seq must be {self.next_seq}")
        prev = self.head
        sealed = entry.sealed(prev, link_hash(prev, entry.hash_payload()))
        self._order.append(sealed)
        if sealed.id is not None:
            self._entries[sealed.id] = sealed
        return sealed

    def register_id(self, entry: Entry, entry_id: int) -> Entry:
        """Attach a persistence id to a just-appended entry (id is not part of the hash)."""
        clone = object.__new__(type(entry))
        clone.__dict__.update(entry.__dict__)
        clone._id = entry_id
        self._order[self._order.index(entry)] = clone
        self._entries[entry_id] = clone
        return clone

    def append_revision(self, entry_id: int, text: str, source: str, created_at: datetime | None = None) -> Revision:
        if self._sealed:
            raise VaultSealedError("The vault is sealed")
        entry = self._entries.get(entry_id)
        if entry is None or entry.deleted:
            raise KeyError(entry_id)
        if text == entry.current_text:
            raise ValueError("Revision is identical to the current text")
        rev = Revision(id=None, entry_id=entry_id, seq=self.next_seq, text=text, source=source,
                       created_at=created_at or datetime.now(timezone.utc))
        prev = self.head
        rev = Revision(**{**rev.__dict__, "prev_hash": prev, "hash": link_hash(prev, rev.hash_payload(entry.seq))})
        updated = entry.with_revision(rev)
        self._order[self._order.index(entry)] = updated
        self._entries[entry_id] = updated
        return rev

    def delete_entry(self, entry_id: int) -> Revision:
        """Hide an entry for good by appending a deletion marker; nothing already written is changed."""
        return self.append_revision(entry_id, "", "deleted")

    # ---- integrity --------------------------------------------------------------
    def chain_records(self) -> tuple[ChainRecord, ...]:
        return tuple(ChainRecord(seq, ref, payload, prev, h) for seq, ref, payload, prev, h in self._records())

    def verify(self) -> ChainReport:
        return verify_chain(self.chain_records())
