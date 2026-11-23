#!/usr/bin/env bash
# Start the MMK API for the end-to-end tests: a fresh SQLite database with the fictional demo
# data (python -m app.seed) and one extra owner the account-deletion test may erase.
set -euo pipefail
cd "$(dirname "$0")/../../backend"
DB_DIR="${E2E_DB_DIR:-$(mktemp -d)}"
export DATABASE_URL="sqlite:///$DB_DIR/e2e.db"
export EMAIL_MODE=sandbox
export JWT_SECRET="${JWT_SECRET:-e2e-only-secret-not-for-production-use}"
rm -f "$DB_DIR/e2e.db"
python -m app.seed --reset >/dev/null
python - <<'PY'
from app.db import SessionLocal
from app.models import User
from app.security_hashing import hash_password
db = SessionLocal()
db.add(User(role="owner", email="delete.me@example.com", display_name="Dana Delete",
            password_hash=hash_password("alaala2026"), email_verified_at="2026-01-01T00:00:00+00:00"))
db.commit()
PY
exec python -m uvicorn app.main:app --host 127.0.0.1 --port "${E2E_API_PORT:-8010}"
