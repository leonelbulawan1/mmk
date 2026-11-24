"""First and last name fields shared by sign-up, settings and beneficiaries."""
from fastapi import HTTPException
from pydantic import BaseModel, Field

from .models import User, first_name_of, full_name, last_name_of


class NameIn(BaseModel):
    """First and last name; ``display_name`` (the full name in one field) is still accepted."""
    first_name: str | None = Field(default=None, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    display_name: str | None = Field(default=None, max_length=120)

    def has_name(self) -> bool:
        return any((v or "").strip() for v in (self.first_name, self.last_name, self.display_name))

    def apply_to(self, u: User, required: bool = True) -> None:
        first, last = (self.first_name or "").strip(), (self.last_name or "").strip()
        if first or last:
            if not first:
                raise HTTPException(422, "Enter a first name.")
            u.first_name, u.last_name, u.display_name = first, last, full_name(first, last)[:120]
        elif (self.display_name or "").strip():
            u.display_name, u.first_name, u.last_name = self.display_name.strip(), None, None
        elif required:
            raise HTTPException(422, "Enter a first name.")


def name_out(u: User) -> dict:
    return {"display_name": u.display_name, "first_name": first_name_of(u), "last_name": last_name_of(u)}
