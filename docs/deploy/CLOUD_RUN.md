# Deploying MMK to Firebase + Cloud Run (paid option)

> This is the paid, all-Google option. The free option is in [DEPLOY.md](../../DEPLOY.md). To use this one, copy `docs/deploy/firebase.cloudrun.json` to `firebase.json` at the repository root first.

This guide puts MMK online:

```
Browser ──► Firebase Hosting (React app, frontend/dist)
                 │  /api/**  (rewrite, same domain — no CORS needed)
                 ▼
            Cloud Run "mmk-api" (FastAPI + SWI-Prolog, backend/Dockerfile)
                 │  unix socket
                 ▼
            Cloud SQL for PostgreSQL (the same kind Firebase Data Connect creates)
```

Region used throughout: `asia-southeast1` (Singapore). Use another region if you prefer, but use the same one everywhere, including in `firebase.json`.

**Cost.** Cloud Run and Cloud SQL need the Firebase **Blaze** (pay-as-you-go) plan. Cloud Run has a free tier. Cloud SQL does not: a database created through Firebase SQL Connect is free for its first 3 months, then about US$9.37 a month while it runs (step 2). Stop or delete the instance when you are done testing (step 9).

---

## 0. Tools you need on your computer

| Tool | Install |
|------|---------|
| Google Cloud CLI (`gcloud`) | https://cloud.google.com/sdk/docs/install |
| Firebase CLI | `npm install -g firebase-tools` |
| Node.js 20+ | https://nodejs.org |

Then sign in:

```bash
gcloud auth login
firebase login
```

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Add project**. Write down the **project ID** (for example `mmk-diary-1234`).
2. In the project, open **Upgrade** and choose the **Blaze** plan. Set a budget alert while you are there.
3. On your computer:

```bash
export PROJECT_ID=mmk-diary-1234          # your project ID
export REGION=asia-southeast1
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com
cp .firebaserc.example .firebaserc        # then put your project ID inside it
```

## 2. Create the PostgreSQL database

**Recommended: create it through Firebase SQL Connect (formerly Data Connect).** A Cloud SQL instance created this way, with the default settings, gets a **3-month no-cost trial** on Blaze projects (one trial instance per project). An instance made directly with `gcloud sql instances create` is billed from day one.

1. In the Firebase console open **Databases & Storage → SQL Connect** and click **Get started**.
2. Choose region `asia-southeast1`, keep the **default instance settings** (changing them can end the trial), and name the instance `mmk-db`.
3. Then create MMK's own database and user in that instance:

```bash
gcloud sql databases create mmk --instance=mmk-db
gcloud sql users create mmk_app --instance=mmk-db --password='CHOOSE-A-STRONG-PASSWORD'
```

MMK only uses the PostgreSQL instance. It connects with SQLAlchemy, so you do not need to write a SQL Connect schema or use its generated SDKs.

Alternative without the trial:

```bash
gcloud sql instances create mmk-db --database-version=POSTGRES_16 \
  --tier=db-f1-micro --region=$REGION --edition=ENTERPRISE
```

After the trial, Cloud SQL starts at about US$9.37 a month.

MMK creates its own tables and the append-only triggers the first time the API starts. You do not run any SQL yourself.

## 3. Store the secrets

```bash
# The database address Cloud Run will use (through the Cloud SQL unix socket)
printf 'postgresql+psycopg://mmk_app:CHOOSE-A-STRONG-PASSWORD@/mmk?host=/cloudsql/%s:%s:mmk-db' $PROJECT_ID $REGION \
  | gcloud secrets create mmk-database-url --data-file=-

# A random signing key for login tokens
python3 -c "import secrets;print(secrets.token_urlsafe(48),end='')" | gcloud secrets create mmk-jwt-secret --data-file=-

# The SMTP password (see step 4)
printf 'YOUR-SMTP-PASSWORD' | gcloud secrets create mmk-smtp-password --data-file=-

# Let Cloud Run read them
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
for s in mmk-database-url mmk-jwt-secret mmk-smtp-password; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

## 4. Email (required)

Online, MMK sends real emails for: the sign-up verification code, the password-reset code, and the notices to beneficiaries after the death trigger. Without SMTP nobody can finish signing up.

The quickest option for testing is a Gmail account:

1. Turn on 2-Step Verification on that Google account.
2. Create an **App password** at https://myaccount.google.com/apppasswords.
3. Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, and the 16-letter app password as the secret `mmk-smtp-password` (step 3).

For real use, a transactional email service (Brevo, Mailgun, SendGrid, Amazon SES) is more reliable. Any of them works through the same `SMTP_*` settings.

## 5. Deploy the API to Cloud Run

Run this from the repository root. Cloud Build builds `backend/Dockerfile` (Python 3.12 + SWI-Prolog), so you do not need Docker on your computer.

```bash
gcloud run deploy mmk-api --source backend --region $REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances $PROJECT_ID:$REGION:mmk-db \
  --set-secrets DATABASE_URL=mmk-database-url:latest,JWT_SECRET=mmk-jwt-secret:latest,SMTP_PASSWORD=mmk-smtp-password:latest \
  --set-env-vars "APP_URL=https://$PROJECT_ID.web.app,CORS_ORIGINS=https://$PROJECT_ID.web.app,APP_TIMEZONE=Asia/Manila,SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USER=you@gmail.com,SMTP_FROM=MMK <you@gmail.com>,LLM_PROVIDER=offline,DEV_SHOW_VERIFICATION_CODE=false"
```

Check it:

```bash
curl "$(gcloud run services describe mmk-api --region $REGION --format='value(status.url)')/api/health"
# {"status":"ok","prolog":true,"llm_provider":"offline","reports_activated":0}
```

`"prolog": true` means SWI-Prolog is installed in the container and access decisions are made by the Prolog rules.

### Optional: a real AI model

`LLM_PROVIDER=offline` answers with the built-in extractive model (no cost, no key). To use Claude:

```bash
printf 'sk-ant-...' | gcloud secrets create mmk-llm-key --data-file=-
# give Cloud Run access to it the same way as in step 3, then:
gcloud run services update mmk-api --region $REGION \
  --update-secrets LLM_API_KEY=mmk-llm-key:latest \
  --update-env-vars LLM_PROVIDER=anthropic,LLM_MODEL=claude-sonnet-5-5
```

An OpenAI-compatible endpoint works too: `LLM_PROVIDER=openai`, plus `LLM_BASE_URL` and `LLM_MODEL`.

## 6. Deploy the website to Firebase Hosting

```bash
cd frontend
npm ci
npm run build          # writes frontend/dist
cd ..
firebase deploy --only hosting
```

Open `https://PROJECT_ID.web.app`. The rewrite in `firebase.json` sends every `/api/...` request to the `mmk-api` service, so the site and the API share one domain.

If you used a region other than `asia-southeast1`, change `region` in `firebase.json` first.

## 7. Check executor reports on a schedule

When an executor reports a death, MMK waits (default 14 days, `DEATH_REPORT_WAIT_MINUTES=20160`) and then activates the death trigger. Cloud Run stops idle containers, so a scheduler visits `/api/health`, which processes any reports whose wait is over:

```bash
API_URL=$(gcloud run services describe mmk-api --region $REGION --format='value(status.url)')
gcloud scheduler jobs create http mmk-due-reports --location $REGION \
  --schedule "*/10 * * * *" --uri "$API_URL/api/health" --http-method GET
```

Due reports are also processed whenever anyone signs in or uses the app.

To try the executor flow quickly while testing, shorten the wait, then set it back:

```bash
gcloud run services update mmk-api --region $REGION --update-env-vars DEATH_REPORT_WAIT_MINUTES=5
```

## 8. Try it

1. **Create an account** with an email you can open. Enter the 6-digit code from the email.
2. Write a few entries. Try the **Verbatim**, **Light Fix** and **Review** modes.
3. Add a beneficiary with a second email address you own. Copy the activation link and open it in a private window to set that beneficiary's password.
4. Write an access policy and check **Access Permissions**.
5. Make that beneficiary the **executor** (Settings) and report a death from the beneficiary account, or use the owner's own death trigger. After it fires, the beneficiary receives an email notice and can use **Ask** and **Letters**.
6. Test **Forgot password**: the reset code arrives by email.

### Optional: load the fictional demo data

The demo vault (Elena Ramos and three beneficiaries) is meant for local testing. Its passwords are public in the README, so only load it into a test database:

```bash
# in another terminal: https://cloud.google.com/sql/docs/postgres/sql-proxy
cloud-sql-proxy $PROJECT_ID:$REGION:mmk-db --port 5433

cd backend
pip install -r requirements.txt
DATABASE_URL='postgresql+psycopg://mmk_app:CHOOSE-A-STRONG-PASSWORD@127.0.0.1:5433/mmk' python -m app.seed
```

## 9. Updating and shutting down

- **New backend code:** run the `gcloud run deploy` command from step 5 again. Your settings are kept, so only `--source backend --region $REGION` is needed.
- **New frontend code:** `npm run build` in `frontend`, then `firebase deploy --only hosting`.
- **Logs:** `gcloud run services logs read mmk-api --region $REGION`
- **Stop paying for the database while not testing:** `gcloud sql instances patch mmk-db --activation-policy=NEVER` (start again with `ALWAYS`).
- **Remove everything:** delete the project in the Firebase console.

## Troubleshooting

| What you see | What to check |
|---|---|
| Sign-up says the code was sent, but no email arrives | Spam folder; `SMTP_*` values; Gmail needs an *app password*, not your normal password. Logs show the SMTP error. |
| `/api/...` returns the website's HTML instead of JSON | `serviceId` or `region` in `firebase.json` does not match the Cloud Run service. |
| API logs show `could not connect` / `No such file or directory: /cloudsql/...` | The `--add-cloudsql-instances` name, or the `host=/cloudsql/...` part of `mmk-database-url`, does not match `PROJECT:REGION:INSTANCE`. |
| `/api/health` shows `"prolog": false` | The service was not built from `backend/Dockerfile`. Deploy with `--source backend`. |
| Everyone was signed out after a deploy | `JWT_SECRET` was not set, so each container made its own key. Set the secret as in step 3. |
