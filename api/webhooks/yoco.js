// /api/webhooks/yoco.js
// NOTE: This webhook NO LONGER sends emails automatically.
// It verifies the event and logs shape for debugging.
// You can re-enable emailing by setting ALLOW_WEBHOOK_EMAIL=true.
import crypto from "crypto";

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

    // Signature verify (supports TEST & LIVE)
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

    // Parse + log event shape
    let evt = {};
    try { evt = JSON.parse(rawBody); } catch { return res.status(400).json({ received:false, error:"invalid-json" }); }
    console.log("[webhook] top-level keys:", Object.keys(evt || {}));
    console.log("[webhook] data keys:", Object.keys((evt && evt.data) || {}));

    // (Optional) you can mark your order as paid here using evt.data
    // This file intentionally does NOT send email automatically.

    return res.status(200).json({ received:true, emailed:false, reason:"auto-email-disabled" });
  } catch (e) {
    console.error("[webhook] error", e?.message);
    return res.status(400).json({ received:false, error: e?.message || "bad-webhook" });
  }
}
