export async function sendEmail({ to, subject, html, text, attachments=[] }) {
  const from = process.env.FROM_EMAIL || "tickets@no-reply.local";
  const replyTo = process.env.REPLY_TO_EMAIL || undefined;

  // Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const body = { from, to, subject, html, text };
    if (replyTo) body.reply_to = replyTo;
    if (attachments.length) {
      body.attachments = attachments.map(a => ({
        filename: a.filename || "ticket.png",
        content: a.content, // base64 (no data: prefix)
        contentType: a.contentType || "image/png"
      }));
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      throw new Error(`Resend error ${r.status}: ${t}`);
    }
    return await r.json().catch(()=> ({ ok: true }));
  }

  // SendGrid fallback
  const sgKey = process.env.SENDGRID_API_KEY;
  if (sgKey) {
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
        content: a.content // base64
      }));
    }
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${sgKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      throw new Error(`SendGrid error ${r.status}: ${t}`);
    }
    return { ok: true };
  }

  throw new Error("No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.");
}
