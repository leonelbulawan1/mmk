// MMK Gmail sender. Paste this into a new Google Apps Script project (script.google.com)
// while signed in to the Gmail account that should send MMK's emails.
// Then: Project Settings > Script properties > add SECRET = (a long random password, the same as GMAIL_RELAY_SECRET).
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL into GMAIL_RELAY_URL.

function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var data = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || data.secret !== secret) return out({ ok: false, error: 'wrong secret' });
    if (!data.to || !data.subject) return out({ ok: false, error: 'missing to or subject' });
    GmailApp.sendEmail(data.to, data.subject, data.body || '', {
      name: data.name || 'MMK',
      htmlBody: data.html || undefined
    });
    return out({ ok: true, left_today: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

// Run this once from the editor to grant Gmail permission (it sends a test email to yourself).
function testSend() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), 'MMK test', 'The MMK Gmail sender works.');
}
