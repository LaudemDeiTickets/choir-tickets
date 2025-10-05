import crypto from "node:crypto";
import { sendEmail } from "../_lib/sendEmail.js";
import { buildTicketEmail } from "../_lib/ticketEmailTemplate.js";
import { renderTicketPng } from "../_lib/renderTicketPng.js";

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
function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("OK");
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const id = req.headers["webhook-id"];
    const ts = req.headers["webhook-timestamp"];
    const sigHeader = req.headers["webhook-signature"];
    const MAX_SKEW_MS = 3 * 60 * 1000;

    const secretLive = process.env.YOCO_WEBHOOK_SECRET_LIVE || process.env.YOCO_WEBHOOK_SECRET || "";
    const secretTest = process.env.YOCO_WEBHOOK_SECRET_TEST || "";

    const rawBody = await readRaw(req);
    let mode = "live";

    if ((secretLive || secretTest) && id && ts && sigHeader) {
      const now = Date.now();
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(now - t) > MAX_SKEW_MS) {
        return res.status(400).json({ received:false, error:"Stale or invalid timestamp" });
      }
      const signed = `${id}.${ts}.${rawBody}`;
      const provided = (sigHeader.split(" ")[0] || "").split(",")[1] || "";

      const expectedLive = secretLive ? computeSig(secretLive, signed) : "";
      const expectedTest = secretTest ? computeSig(secretTest, signed) : "";

      const ok = (expectedLive && safeEq(expectedLive, provided)) || (expectedTest && safeEq(expectedTest, provided));
      if (!ok) return res.status(403).json({ received:false, error:"Invalid signature" });
    }

    // Parse event
    let event = {};
    try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ received:false, error:"Invalid JSON" }); }
    mode = event?.mode || mode;

    // Metadata from checkout
    const md = event?.data?.metadata || {};
    const orderId = md?.orderId || event?.data?.id || ("order_" + Date.now());
    const buyer = md?.buyer || {};
    const itemsRaw = Array.isArray(md?.items) ? md.items : [];
    const evInfo = {
      id: md?.eventId || "event",
      title: md?.title || "Event",
      subtitle: md?.subtitle || "",
      startISO: md?.startISO,
      venue: md?.venue,
      address: md?.address,
      orderId
    };

    // Build signed item list
    const now = Date.now();
    const signedItems = [];
    for (const it of itemsRaw) {
      const qty = Number(it.qty || 0);
      for (let i = 0; i < qty; i++) {
        const tkt = "TKT-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
        signedItems.push({ code: it.code, name: it.name, priceCents: it.priceCents, ticketId: tkt });
      }
    }

    // Token payload
    const payload = {
      iss: "laudemdei.tickets",
      iat: now,
      exp: now + 1000 * 60 * 60 * 24 * 7,
      mode,
      orderId,
      buyer,
      event: evInfo,
      items: signedItems
    };

    const signingSecret = process.env.TICKET_SIGNING_SECRET;
    if (!signingSecret) {
      console.warn("Missing TICKET_SIGNING_SECRET; cannot issue claim token");
      return res.status(200).json({ received: true, mode, orderId, issued: false });
    }

    const data = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", signingSecret).update(data).digest("base64");
    const token = b64url(data) + "." + b64url(sig);

    const baseCheckout = process.env.CLAIM_BASE_URL || "https://laudemdeitickets.github.io/choir-tickets/checkout.html";
    const claimUrl = `${baseCheckout}?paid=1&token=${encodeURIComponent(token)}`;

    const orgName = process.env.ORG_NAME || "Laudem Dei Chamber Choir";
    const logoUrl = process.env.LOGO_URL || "https://laudemdeitickets.github.io/choir-tickets/logo.jpeg";

    // Optional PNG attachment (first ticket)
    let attachments = [];
    if (process.env.ATTACH_PNG === "1" && signedItems.length) {
      try {
        const png = await renderTicketPng({
          orgName, logoUrl,
          event: evInfo,
          buyer,
          item: signedItems[0]
        });
        const base64 = Buffer.from(png).toString("base64");
        attachments.push({ filename: `${signedItems[0].ticketId}.png`, content: base64, contentType: "image/png" });
      } catch (e) {
        console.error("render png error:", e?.message);
      }
    }

    // Email the buyer
    let emailStatus = "skipped";
    if (buyer?.email) {
      try {
        const { html, text, subject } = buildTicketEmail({
          orgName, event: evInfo, claimUrl, withAttachment: attachments.length > 0
        });
        await sendEmail({ to: buyer.email, subject, html, text, attachments });
        emailStatus = "sent";
      } catch (e) {
        console.error("email error:", e?.message);
        emailStatus = "failed";
      }
    }

    return res.status(200).json({ received: true, mode, orderId, issued: true, claimUrl, token, emailStatus, attached: attachments.length });
  } catch (e) {
    return res.status(400).json({ received:false, error: e?.message || "Bad webhook" });
  }
}
