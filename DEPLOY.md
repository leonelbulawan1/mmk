# Deploying MMK for free

> **Team:** [MEMBER 1 FULL NAME] (Front End) · [MEMBER 2 FULL NAME] (Back End) · [MEMBER 3 FULL NAME] (Q/A) · [MEMBER 4 FULL NAME] (UI/UX Designer) · [MEMBER 5 FULL NAME] (Documentator)

This setup costs nothing. No step needs a credit card except possibly Render: if Render asks for one, it is only for identity checks and the free plan is not charged.

```
Browser ──► mmk-web  (Render static site: the React app)       free, always on
   │
   └──────► mmk-api  (Render web service: FastAPI + SWI-Prolog)  free, sleeps when idle
                 ├──► Neon (PostgreSQL)                          free, no card
                 └──► Brevo (email API)                          free, 300 emails/day
```

| Service | What it does | Free limits that matter |
|---|---|---|
| **GitHub** | Holds the code; Render deploys from it | Private repositories are free |
| **Render** | Runs the API (Docker) and serves the website | API sleeps after 15 min without visitors; the next visit waits about 1 minute. 750 hours a month. Free services cannot use SMTP, which is why email goes through the Brevo API |
| **Neon** | PostgreSQL database | 0.5–1 GB per project, 100 compute hours a month; it pauses when idle and wakes on the next query. No expiry |
| **Brevo** | Sends verification, reset and death-notice emails | 300 emails a day |
| **cron-job.org** (optional) | Wakes the API a few times a day to process executor reports | Free |

This is enough for testing, a class demo, or a handful of real users. Everything you store stays until you delete it.

---

## 1. Put the code on GitHub

1. Create a **private** repository on https://github.com/new, for example `mmk`. Leave it empty (no README).
2. Unpack `mmk-source.tar.gz`, then in the `mmk` folder:

```bash
git remote add origin https://github.com/YOUR-USERNAME/mmk.git
git push -u origin main
```

## 2. Create the database (Neon)

1. Sign up at https://neon.com (no card needed) and create a project. Region: **AWS Asia Pacific 1 (Singapore)**, the same region as the API in `render.yaml` (`region: singapore`). If you pick another Neon region, change `region` in `render.yaml` to the nearest Render region.
2. On the project dashboard click **Connect** and copy the connection string. It looks like:
   `postgresql://neondb_owner:XXXX@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
3. Keep it for step 4. Paste it exactly as Neon shows it; MMK converts it for its database driver.

MMK creates its tables and the append-only triggers itself on first start.

## 3. Set up email (Brevo)

1. Sign up at https://www.brevo.com (free plan, no card).
2. **Senders, domains & dedicated IPs → Senders → Add a sender:** add the address emails should come from (your Gmail works) and confirm it from your inbox.
3. **SMTP & API → API keys → Generate a new API key.** Copy it (starts with `xkeysib-`).

## 4. Deploy on Render

1. Sign up at https://render.com with your GitHub account and allow it to see the `mmk` repository.
2. **New → Blueprint**, choose the `mmk` repository. Render reads `render.yaml` and shows two services, `mmk-api` and `mmk-web`, both on the free plan.
3. Fill in the values it asks for:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 2 |
| `BREVO_API_KEY` | the Brevo key from step 3 |
| `SMTP_FROM` | `MMK <the-sender-you-confirmed@gmail.com>` |
| `APP_URL` | `https://mmk-web.onrender.com` |
| `CORS_ORIGINS` | `https://mmk-web.onrender.com` |
| `VITE_API_BASE` | `https://mmk-api.onrender.com` |

4. Click **Apply**. The first API build takes several minutes (it installs SWI-Prolog).
5. **Check the addresses.** If those names were taken, Render adds a suffix, such as `mmk-web-ab12.onrender.com`. Open each service and compare its URL with what you typed. If one differs, fix it under **Environment** (`APP_URL`/`CORS_ORIGINS` on `mmk-api`, `VITE_API_BASE` on `mmk-web`) and choose **Manual Deploy → Deploy latest commit** for that service.

Check the API: open `https://mmk-api.onrender.com/api/health`. You should see `"status":"ok"` and `"prolog":true`.

## 5. Try it

Open `https://mmk-web.onrender.com`. If the API was asleep, the first sign-in can take up to a minute.

1. **Create an account** with an email you can open and enter the 6-digit code. Check spam if it does not arrive.
2. Write entries in the three writing modes.
3. Add a beneficiary using a second email address you own; open the activation link in a private window and set a password.
4. Write an access policy and check **Access Permissions**.
5. Make the beneficiary the executor in **Settings**, then report the death from the beneficiary account (or use the owner's own death trigger). The beneficiary gets an email notice and can then use **Ask** and **Letters**.
6. Test **Forgot password**.

To see the executor flow without waiting 14 days, add `DEATH_REPORT_WAIT_MINUTES=5` to `mmk-api` under **Environment**. Remove it afterwards.

## 6. Optional: process executor reports while nobody visits

Reports whose waiting period is over, and letters whose opening date has arrived, are processed whenever someone uses the app. To process them even when nobody visits (so a letter's email goes out on its day), create a free job at https://cron-job.org:

- URL: `https://mmk-api.onrender.com/api/health`
- Schedule: every 3 hours (set the job's time zone to Asia/Manila)

Do not ping more often just to keep the API awake. Each ping also wakes the database, and frequent pings would use up Neon's free compute hours.

## 7. Optional: load the fictional demo data

The demo accounts' passwords are public in the README, so only do this on a test database. You need Python 3.12 on your computer:

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL='paste-the-Neon-connection-string' python -m app.seed
```

## 8. Updating

Push to GitHub (`git push`). Render rebuilds and redeploys both services automatically.

## Alternative: the website on Firebase Hosting (also free)

If you want the website on Firebase, use the free **Spark** plan for the website only. Keep the API on Render.

```bash
npm install -g firebase-tools && firebase login
cp .firebaserc.example .firebaserc            # put your Firebase project ID inside
cd frontend && npm ci
VITE_API_BASE=https://mmk-api.onrender.com npm run build
cd .. && firebase deploy --only hosting
```

Then set `APP_URL` and `CORS_ORIGINS` on `mmk-api` to `https://YOUR-PROJECT-ID.web.app`. (The paid all-Google setup, with the API on Cloud Run, is in [docs/deploy/CLOUD_RUN.md](docs/deploy/CLOUD_RUN.md).)

## Troubleshooting

| What you see | What to check |
|---|---|
| Sign-in shows a network error | `CORS_ORIGINS` on `mmk-api` must equal the website address exactly, starting with `https://`. `VITE_API_BASE` on `mmk-web` must be the API address. Redeploy `mmk-web` after changing `VITE_API_BASE`. |
| The first request is very slow | Normal on the free plan: the API was asleep. |
| No verification email | Spam folder; the sender in `SMTP_FROM` must be the one confirmed in Brevo; Brevo → **Transactional → Logs** shows each email. |
| API logs show a database connection error | Re-copy the Neon connection string into `DATABASE_URL`. |
| Everyone is signed out after a redeploy | `JWT_SECRET` was removed. The Blueprint generates it once; do not delete it. |


## Reviewers for reports of death

With `DEATH_REVIEW=admin` (the default), a report of an owner's passing waits until an MMK reviewer approves it.

1. The reviewer creates an account on the website (Create account) with their own email, and verifies it.
2. In Render → **mmk-api** → **Environment**, set `ADMIN_EMAILS` to that email (several: separate with commas). Save.
3. After the redeploy the reviewer sees **Review reports** in the menu.

Use someone who is not the diary owner (a teacher or a team member for the demo). For a quick demo you can set
`DEATH_REPORT_WAIT_MINUTES` to a few minutes.
