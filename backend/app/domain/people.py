"""People in the diary model: ``Owner`` and ``Beneficiary``.

Encapsulation: password hashes and the death-trigger state are private
attributes exposed only through read-only properties and intention-revealing
methods (``verify_password``, ``activate_death_trigger``).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone

from ..security_hashing import verify_password as _verify


class Person(ABC):
    def __init__(self, user_id: int | None, email: str, display_name: str, password_hash: str):
        self._id = user_id
        self._email = email.strip().lower()
        self._display_name = display_name.strip()
        self.__password_hash = password_hash  # name-mangled: not reachable as obj.password_hash

    @property
    def id(self) -> int | None:
        return self._id

    @property
    def email(self) -> str:
        return self._email

    @property
    def display_name(self) -> str:
        return self._display_name

    def verify_password(self, password: str) -> bool:
        return _verify(password, self.__password_hash)

    @property
    @abstractmethod
    def role(self) -> str: ...

    @abstractmethod
    def permissions(self) -> frozenset[str]:
        """Capabilities used by role-based access control (polymorphic)."""


class Owner(Person):
    def __init__(self, user_id, email, display_name, password_hash, death_triggered_at: datetime | None = None):
        super().__init__(user_id, email, display_name, password_hash)
        self._death_triggered_at = death_triggered_at

    @property
    def role(self) -> str:
        return "owner"

    @property
    def death_triggered_at(self) -> datetime | None:
        return self._death_triggered_at

    @property
    def is_deceased(self) -> bool:
        return self._death_triggered_at is not None

    def permissions(self) -> frozenset[str]:
        if self.is_deceased:
            # After the trigger the account becomes read-only.
            return frozenset({"entries:read", "vault:verify", "policy:read", "beneficiaries:read"})
        return frozenset(
            {"entries:read", "entries:write", "vault:verify", "policy:read", "policy:write",
             "beneficiaries:read", "beneficiaries:write", "death:trigger", "assistant:preview"}
        )

    def activate_death_trigger(self, when: datetime | None = None) -> datetime:
        if self._death_triggered_at is not None:
            raise PermissionError("Death trigger already activated")
        self._death_triggered_at = when or datetime.now(timezone.utc)
        return self._death_triggered_at


class Beneficiary(Person):
    def __init__(self, user_id, email, display_name, password_hash, owner_id: int, handle: str,
                 relationship: str = "", active: bool = True):
        super().__init__(user_id, email, display_name, password_hash)
        self._owner_id = owner_id
        self._handle = handle
        self._relationship = relationship
        self._active = active

    @property
    def role(self) -> str:
        return "beneficiary"

    @property
    def owner_id(self) -> int:
        return self._owner_id

    @property
    def handle(self) -> str:
        """Identifier used in policy programs and Prolog facts (lowercase atom)."""
        return self._handle

    @property
    def relationship(self) -> str:
        return self._relationship

    @property
    def active(self) -> bool:
        return self._active

    def permissions(self) -> frozenset[str]:
        if not self._active:
            return frozenset()
        return frozenset({"assistant:ask", "letters:read"})
