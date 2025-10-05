// /api/email/claim.js
import crypto from "crypto";

const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";

function b64urlDecode(input) {
  const pad = (s) => s + "===".slice((s.length + 3) % 4);
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(pad(s), "base64");
}
function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function verifyJWT(token, secret) {
  const [h,p,s] = token.split(".");
  const data = `${h}.${p}`;
  const expected = b64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  if (Buffer.from(expected).length !== Buffer.from(s).length) throw new Error("Malformed");
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) throw new Error("Invalid signature");
  const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
  const now = Math.floor(Date.now()/1000), skew=300;
  if (payload.exp && payload.exp < now - skew) throw new Error("Token expired");
  return payload;
}
async function sendEmail({ apiKey, from, to, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json" },
    body: JSON.stringify({ from, to:[to], subject, html })
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(j?.message || "Resend failed");
  return j;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok:false, error:"No token" });

    const secret = process.env.TICKET_SIGNING_SECRET || "";
    if (!secret) return res.status(500).json({ ok:false, error:"Missing signing secret" });

    const payload = verifyJWT(token, secret);
    const email = payload?.buyer?.email || "";
    if (!email) return res.status(400).json({ ok:false, error:"Token has no email" });

    const claimBase = process.env.CLAIM_BASE_URL || "https://laudemdeitickets.github.io/choir-tickets/ticket.html";
    const claimUrl = `${claimBase}?paid=1&token=${encodeURIComponent(token)}`;

    const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
    const FROM_EMAIL = process.env.FROM_EMAIL || "";
    if (!RESEND_API_KEY || !FROM_EMAIL) return res.status(500).json({ ok:false, error:"Email not configured" });

    const subject = `Your tickets — ${payload?.event?.title || "Event"} (Order ${payload.orderId})`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;max-width:640px;margin:auto">
        <h2>Payment received 🎟️</h2>
        <p>Hi ${payload?.buyer?.firstName || ""}, your tickets are ready.</p>
        <p><a href="${claimUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:600">Open your tickets</a></p>
        <p style="font-size:13px;color:#475569">Order: <strong>${payload.orderId}</strong></p>
        <p style="font-size:12px;color:#64748b;margin-top:18px">If the button doesn’t work, copy this link:<br/><a href="${claimUrl}">${claimUrl}</a></p>
      </div>
    `;
    const out = await sendEmail({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to: email, subject, html });
    return res.status(200).json({ ok:true, id: out?.id });
  } catch (e) {
    return res.status(400).json({ ok:false, error: e?.message || "Bad request" });
  }
}
