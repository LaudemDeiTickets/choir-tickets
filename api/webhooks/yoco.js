// /api/webhooks/yoco.js
import crypto from "crypto";

// ---- Resend sender ----
async function sendEmail({ apiKey, from, to, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html })
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(j?.message || "Resend send failed");
  return j;
}

// ---- helpers ----
async function readRaw(req) {
  return await new Promise((resolve, reject) => {
    let data = ""; req.setEncoding("utf8");
    req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function computeSig(base64Secret, signedContent) {
  const raw = base64Secret.includes("_") ? base64Secret.split("_")[1] : base64Secret;
  const key = Buffer.from(raw, "base64");
  return crypto.createHmac("sha256", key).update(signedContent).digest("base64");
}
function safeEq(a, b) {
  const A = Buffer.from(a || ""); const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function signJWT(payloadObj, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payloadObj));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export default async function handler(req, res) {
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Webhook-Id,Webhook-Timestamp,Webhook-Signature");
  if (req.method === "GET") return res.status(200).send("OK");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const id = req.headers["webhook-id"];
    const ts = req.headers["webhook-timestamp"];
    const sigHeader = req.headers["webhook-signature"];
    const rawBody = await readRaw(req);

    // Verify signature (both TEST & LIVE supported)
    const secretLive = process.env.YOCO_WEBHOOK_SECRET_LIVE || process.env.YOCO_WEBHOOK_SECRET || "";
    const secretTest = process.env.YOCO_WEBHOOK_SECRET_TEST || "";
    if ((secretLive || secretTest) && id && ts && sigHeader) {
      const MAX_SKEW = 3 * 60 * 1000;
      const now = Date.now(); const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(now - t) > MAX_SKEW) {
        console.warn("[webhook] stale timestamp", { now, ts });
        return res.status(400).json({ received:false, error:"stale-timestamp" });
      }
      const signed = `${id}.${ts}.${rawBody}`;
      const provided = (sigHeader.split(" ")[0] || "").split(",")[1] || "";
      const expectedLive = secretLive ? computeSig(secretLive, signed) : "";
      const expectedTest = secretTest ? computeSig(secretTest, signed) : "";
      const ok = (expectedLive && safeEq(expectedLive, provided)) || (expectedTest && safeEq(expectedTest, provided));
      if (!ok) {
        console.warn("[webhook] invalid signature");
        return res.status(403).json({ received:false, error:"invalid-signature" });
      }
    } else {
      console.warn("[webhook] missing signature headers/secrets; skipping verification");
    }

    // Parse JSON
    let evt = {};
    try { evt = JSON.parse(rawBody); } catch {
      return res.status(400).json({ received:false, error:"invalid-json" });
    }

    // 🔎 Log the event shape so we can see real fields
    console.log("[webhook] top-level keys:", Object.keys(evt || {}));
    console.log("[webhook] data keys:", Object.keys((evt && evt.data) || {}));

    const mode = evt?.mode || "live";
    const data = evt?.data || {};

    // Try to find identifiers in multiple known places
    const orderId =
      data?.metadata?.orderId ||
      data?.orderId ||
      data?.checkout?.id ||
      data?.payment?.id ||
      evt?.id ||
      "order_unknown";

    // Try several places for buyer email
    const email =
      data?.metadata?.buyer?.email ||
      data?.buyer?.email ||
      data?.customer?.email ||
      data?.email ||
      "";

    // Items/event info (best-effort)
    const items = Array.isArray(data?.metadata?.items) ? data.metadata.items : [];
    const eventInfo = {
      id: data?.metadata?.eventId || "event",
      title: data?.metadata?.eventTitle || "Event",
      venue: data?.metadata?.eventVenue || data?.metadata?.venue || "",
      address: data?.metadata?.eventAddress || data?.metadata?.address || "",
      startISO: data?.metadata?.eventStartISO || data?.metadata?.startISO || "",
    };
    const buyer = {
      firstName: data?.metadata?.buyer?.firstName || "",
      lastName:  data?.metadata?.buyer?.lastName  || "",
      email
    };

    if (!email) {
      console.warn("[webhook] no buyer email in event", { orderId });
      return res.status(200).json({ received:true, emailed:false, reason:"no-email-in-event", orderId });
    }

    // Build claim token
    const signSecret = process.env.TICKET_SIGNING_SECRET || "";
    if (!signSecret) {
      console.warn("[webhook] missing TICKET_SIGNING_SECRET");
      return res.status(200).json({ received:true, emailed:false, reason:"no-signing-secret", orderId });
    }
    const now = Math.floor(Date.now()/1000), exp = now + 60*60; // 60 min
    const token = signJWT({
      sub: "ticket-claim",
      orderId, mode, items, event: eventInfo, buyer,
      amountCents: Number(data?.metadata?.amountCents || 0),
      iat: now, exp
    }, signSecret);

    const claimBase = process.env.CLAIM_BASE_URL || "https://laudemdeitickets.github.io/choir-tickets/ticket.html";
    const claimUrl = `${claimBase}?paid=1&token=${encodeURIComponent(token)}`;

    // Send email via Resend
    const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
    const FROM_EMAIL = process.env.FROM_EMAIL || "";
    if (!RESEND_API_KEY || !FROM_EMAIL) {
      console.warn("[webhook] email not configured");
      return res.status(200).json({ received:true, emailed:false, reason:"email-not-configured", orderId });
    }
    const subject = `Your tickets — ${eventInfo.title} (Order ${orderId})`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;max-width:640px;margin:auto">
        <h2>Payment received 🎟️</h2>
        <p>Hi ${buyer.firstName || ""}, your tickets are ready.</p>
        <p><a href="${claimUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:600">Open your tickets</a></p>
        <p style="font-size:13px;color:#475569">Order: <strong>${orderId}</strong></p>
        <p style="font-size:12px;color:#64748b;margin-top:18px">If the button doesn’t work, copy this link:<br/><a href="${claimUrl}">${claimUrl}</a></p>
      </div>
    `;
    const resp = await sendEmail({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to: email, subject, html });
    console.log("[webhook] email sent", { id: resp?.id, to: email, orderId, mode });

    return res.status(200).json({ received:true, emailed:true, id: resp?.id, orderId, mode });
  } catch (e) {
    console.error("[webhook] error", e?.message);
    return res.status(400).json({ received:false, error: e?.message || "bad-webhook" });
  }
}
