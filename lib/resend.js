// Resend email module. If RESEND_API_KEY is not set, runs in dry-run mode:
// logs the email to console and returns { dryRun: true }.

import { Resend } from 'resend';

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.RESEND_API_KEY) return null;
  client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export async function sendGreeting({ to, subject, body_text }) {
  const r = getClient();
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;
  const cc = process.env.EMAIL_CC ? process.env.EMAIL_CC.split(',').map((s) => s.trim()) : undefined;

  if (!r) {
    console.log('\n[Resend DRY-RUN] No RESEND_API_KEY set. Would have sent:');
    console.log(`  From: ${from}`);
    console.log(`  To:   ${to}`);
    if (cc) console.log(`  Cc:   ${cc.join(', ')}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  ---\n${body_text}\n  ---\n`);
    return { dryRun: true };
  }

  const html = body_text
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const res = await r.emails.send({
    from,
    to: [to],
    cc,
    replyTo,
    subject,
    text: body_text,
    html,
  });
  if (res.error) throw new Error(`Resend error: ${res.error.message}`);
  return { id: res.data?.id, dryRun: false };
}
