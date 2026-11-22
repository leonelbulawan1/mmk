# MMK API (FastAPI + SWI-Prolog) for Google Cloud Run.
FROM python:3.12-slim

# SWI-Prolog runs the access rules (app/prolog/access_rules.pl).
RUN apt-get update \
 && apt-get install -y --no-install-recommends swi-prolog-nox \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run sets $PORT. Never show verification codes on a real server.
ENV PORT=8080 PYTHONUNBUFFERED=1 DEV_SHOW_VERIFICATION_CODE=false
RUN useradd --create-home mmk
USER mmk
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips="*"
