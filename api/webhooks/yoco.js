// /api/webhooks/yoco.js
import crypto from "crypto";

// ---- Resend (send via API) ----
async function sendEmail({ apiKey, from, to, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || "Resend send failed");
  return j;
}

// ---- Helpers ----
async function readRaw(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
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
  const A = Buffer.from(a || "");
  const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function signJWT(payloadObj, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payloadObj));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const encSig = b64url(sig);
  return `${data}.${encSig}`;
}

export default async function handler(req, res) {
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Webhook-Id,Webhook-Timestamp,Webhook-Signature");
  if (req.method === "GET") return res.status(200).send("OK"); // health
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const id = req.headers["webhook-id"];
    const ts = req.headers["webhook-timestamp"];
    const sigHeader = req.headers["webhook-signature"];
    const rawBody = await readRaw(req);

    // Verify signature if secrets set
    const secretLive = process.env.YOCO_WEBHOOK_SECRET_LIVE || process.env.YOCO_WEBHOOK_SECRET || "";
    const secretTest = process.env.YOCO_WEBHOOK_SECRET_TEST || "";

    if ((secretLive || secretTest) && id && ts && sigHeader) {
      const MAX_SKEW_MS = 3 * 60 * 1000;
      const now = Date.now();
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(now - t) > MAX_SKEW_MS) {
        console.warn("[webhook] stale timestamp", { now, ts });
        return res.status(400).json({ received:false, error:"Stale or invalid timestamp" });
      }
      const signed = `${id}.${ts}.${rawBody}`;
      const provided = (sigHeader.split(" ")[0] || "").split(",")[1] || "";

      const expectedLive = secretLive ? computeSig(secretLive, signed) : "";
      const expectedTest = secretTest ? computeSig(secretTest, signed) : "";

      const ok =
        (expectedLive && safeEq(expectedLive, provided)) ||
        (expectedTest && safeEq(expectedTest, provided));

      if (!ok) {
        console.warn("[webhook] invalid signature");
        return res.status(403).json({ received:false, error:"Invalid signature" });
      }
    } else {
      console.warn("[webhook] signature headers or secrets missing; skipping verification");
    }

    // Parse event
    let event = {};
    try { event = JSON.parse(rawBody); }
    catch { return res.status(400).json({ received:false, error:"Invalid JSON" }); }

    const mode = event?.mode || "live";
    const type = event?.type || ""; // use if Yoco sends 'checkout.succeeded' etc.
    const data = event?.data || {};

    // Pull metadata you sent when creating the checkout
    const meta = data?.metadata || {};
    const orderId = meta?.orderId || data?.checkout?.id || data?.id || "order_unknown";
    const buyer = meta?.buyer || {};
    const email = buyer?.email || meta?.email || data?.customer?.email || "";
    const items = Array.isArray(meta?.items) ? meta.items : [];
    const eventInfo = {
      id: meta?.eventId || "event",
      title: meta?.eventTitle || "Event",
      venue: meta?.eventVenue || meta?.venue || "",
      address: meta?.eventAddress || meta?.address || "",
      startISO: meta?.eventStartISO || meta?.startISO || "",
    };

    // Only act on successful payments — adjust based on actual event type
    // If your payload has a clear "status === 'successful'" flag, check it too.
    // For now we'll proceed and you can tighten this if Yoco provides a specific type.
    if (!email) {
      console.warn("[webhook] no buyer email in metadata", { orderId });
      return res.status(200).json({ received:true, emailed:false, reason:"no-email" });
    }

    // Mint claim token (server-side) for the email
    const signSecret = process.env.TICKET_SIGNING_SECRET || "";
    let token = "";
    if (signSecret) {
      const now = Math.floor(Date.now()/1000);
      const exp = now + 60*60; // 60 min email link
      const payload = {
        sub: "ticket-claim",
        orderId,
        mode,
        items,
        event: eventInfo,
        buyer: { firstName: buyer.firstName||"", lastName: buyer.lastName||"", email },
        amountCents: Number(meta?.amountCents || 0),
        iat: now, exp
      };
      token = signJWT(payload, signSecret);
    } else {
      console.warn("[webhook] TICKET_SIGNING_SECRET missing; email will not include token");
    }

    const claimBase = process.env.CLAIM_BASE_URL || "https://laudemdeitickets.github.io/choir-tickets/ticket.html";
    const claimUrl = token ? `${claimBase}?paid=1&token=${encodeURIComponent(token)}` : `${claimBase}`;

    // Send via Resend
    const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
    const FROM_EMAIL = process.env.FROM_EMAIL || "";
    if (!RESEND_API_KEY || !FROM_EMAIL) {
      console.warn("[webhook] email not configured (missing RESEND_API_KEY or FROM_EMAIL)");
      return res.status(200).json({ received:true, emailed:false, reason:"email-not-configured" });
    }

    const subject = `Your tickets — ${eventInfo.title} (Order ${orderId})`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;max-width:640px;margin:auto">
        <h2 style="margin:0 0 8px 0">Payment received 🎟️</h2>
        <p style="margin:0 0 12px 0">Hi ${buyer.firstName || ""}, your tickets are ready.</p>
        <p style="margin:0 0 16px 0">
          <a href="${claimUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:600">
            Open your tickets
          </a>
        </p>
        <p style="font-size:13px;color:#475569;margin:8px 0">Order: <strong>${orderId}</strong></p>
        <p style="font-size:13px;color:#475569;margin:8px 0">${eventInfo.title}<br/>
           ${eventInfo.venue || ""}${eventInfo.venue && eventInfo.address ? " — " : ""}${eventInfo.address || ""}</p>
        <p style="font-size:12px;color:#64748b;margin-top:24px">If the button doesn’t work, copy this link:<br/>
          <a href="${claimUrl}">${claimUrl}</a></p>
      </div>
    `;

    const send = await sendEmail({
      apiKey: RESEND_API_KEY,
      from: FROM_EMAIL,    // must be a verified domain/sender in Resend
      to: email,
      subject,
      html
    });

    console.log("[webhook] email sent", { id: send?.id, to: email, orderId, mode });
    return res.status(200).json({ received:true, emailed:true, id: send?.id, orderId, mode });
  } catch (e) {
    console.error("[webhook] error", e?.message);
    return res.status(400).json({ received:false, error: e?.message || "Bad webhook" });
  }
}
