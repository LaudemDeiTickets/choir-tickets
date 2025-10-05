export async function sendEmail({ to, subject, html, text }) {
  const from = process.env.FROM_EMAIL || "tickets@no-reply.local";
  const replyTo = process.env.REPLY_TO_EMAIL || undefined;

  // Try Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to, subject, html, text, reply_to: replyTo })
    });
    if (!r.ok) {
      const body = await r.text().catch(()=>"");
      throw new Error(`Resend error ${r.status}: ${body}`);
    }
    return await r.json().catch(()=>({ ok:true }));
  }

  // Fallback: SendGrid
  const sgKey = process.env.SENDGRID_API_KEY;
  if (sgKey) {
    const body = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: "text/html", value: html }]
    };
    if (replyTo) body.reply_to = { email: replyTo };

    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${sgKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      throw new Error(`SendGrid error ${r.status}: ${txt}`);
    }
    return { ok: true };
  }

  throw new Error("No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.");
}
