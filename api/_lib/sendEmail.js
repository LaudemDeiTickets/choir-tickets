
export async function sendEmail({ to, subject, html, text, attachments=[] }) {
  const from = process.env.FROM_EMAIL || "tickets@no-reply.local";
  const replyTo = process.env.REPLY_TO_EMAIL || undefined;

  const resend = process.env.RESEND_API_KEY;
  if (resend) {
    const body = { from, to, subject, html, text };
    if (attachments.length) {
      body.attachments = attachments.map(a => ({
        filename: a.filename || "ticket.png",
        content: a.content,
        contentType: a.contentType || "image/png"
      }));
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  const sg = process.env.SENDGRID_API_KEY;
  if (sg) {
    const body = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: "text/html", value: html }]
    };
    if (replyTo) body.reply_to = { email: replyTo };
    if (attachments.length) {
      body.attachments = attachments.map(a => ({
        filename: a.filename || "ticket.png",
        type: a.contentType || "image/png",
        content: a.content
      }));
    }
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${sg}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`SendGrid error ${r.status}: ${await r.text()}`);
    return { ok: true };
  }

  throw new Error("No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.");
}
