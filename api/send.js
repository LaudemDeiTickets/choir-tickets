
import { sendEmail } from "./_lib/sendEmail.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");

    const to = (body.to || "").trim();
    if (!to) return res.status(400).json({ ok:false, error:"Missing 'to' email" });

    const subject = body.subject || "Your Ticket";
    const text = body.text || "Attached is your ticket.";
    const html = body.html || `<p>Attached is your ticket.</p>`;

    let attachments = [];
    if (body.imageDataUrl) {
      const [meta, b64] = String(body.imageDataUrl).split(",");
      const contentType = /image\/png/.test(meta) ? "image/png" : (/image\/(jpeg|jpg)/.test(meta) ? "image/jpeg" : "application/octet-stream");
      attachments.push({ filename: body.filename || "ticket.png", content: b64, contentType });
    }

    const resp = await sendEmail({ to, subject, html, text, attachments });
    return res.status(200).json({ ok:true, providerResponse: resp || null });
  } catch (e) {
    console.error("send api error:", e?.message);
    return res.status(500).json({ ok:false, error: e?.message || "Server error" });
  }
}
