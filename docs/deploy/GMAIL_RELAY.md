# Send MMK email from your own Gmail (free)

Mail sent through Brevo with a `@gmail.com` sender often lands in Spam or is held by school mail servers,
because Gmail did not send it. With this setup Gmail itself sends every MMK email, from your Gmail address,
so it reaches Gmail, Yahoo, Outlook and school inboxes. Limit: 100 recipients a day (free Gmail).

1. Sign in to the Gmail account that should send MMK's emails and open <https://script.google.com>.
2. **New project**. Delete the sample code and paste all of `docs/deploy/gmail-relay.gs`. Save (name it "MMK mail").
3. Choose a long random password (for example 30 letters and numbers). Keep it private.
4. **Project Settings** (gear) → **Script properties** → **Add script property**: name `SECRET`, value = that password. Save.
5. Back in the editor, pick `testSend` in the function list and click **Run**. Allow the permissions
   (Advanced → Go to MMK mail → Allow). You should receive "MMK test".
6. **Deploy → New deployment** → type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy.
   Copy the **Web app URL** (ends in `/exec`).
7. In Render → **mmk-api** → **Environment** add:
   * `GMAIL_RELAY_URL` = the Web app URL
   * `GMAIL_RELAY_SECRET` = the same password as `SECRET`
   Save; Render redeploys. Brevo is no longer used while `GMAIL_RELAY_URL` is set.
8. Test: Beneficiaries → **Send invite again**. The email arrives from your Gmail address, and it also
   appears in that Gmail's **Sent** folder, which is the easiest way to check that it went out.

If you change the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.
