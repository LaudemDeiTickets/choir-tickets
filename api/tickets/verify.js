// /api/tickets/verify.js
import crypto from "crypto";

const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(input) {
  const pad = (s) => s + "===".slice((s.length + 3) % 4);
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(pad(s), "base64");
}
function timingSafeEq(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function verifyJWT(token, secret) {
  if (!token || typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Malformed token");
  }
  const [h, p, s] = token.split(".");
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const expected = b64urlEncode(sig);
  if (!timingSafeEq(Buffer.from(s), Buffer.from(expected))) throw new Error("Invalid signature");

  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(h).toString("utf8"));
    payload = JSON.parse(b64urlDecode(p).toString("utf8"));
  } catch {
    throw new Error("Invalid payload");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Unsupported token");
  }

  const now = Math.floor(Date.now()/1000), skew = 300;
  if (typeof payload.iat === "number" && payload.iat > now + skew) throw new Error("Token not yet valid");
  if (typeof payload.exp === "number" && payload.exp < now - skew) throw new Error("Token expired");

  return payload;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const secret = process.env.TICKET_SIGNING_SECRET || "";
    if (!secret) return res.status(500).json({ ok:false, error:"Missing TICKET_SIGNING_SECRET" });

    let token = "";
    if (req.method === "GET") token = (req.query?.token || req.query?.t || "").toString();
    else if (req.method === "POST") token = (req.body?.token || "").toString();
    else return res.status(405).send("Method Not Allowed");

    if (!token) return res.status(400).json({ ok:false, error:"No token" });

    const payload = verifyJWT(token, secret);

    // (Optional) also check DB/webhook that orderId is paid.
    // For now we just return the payload so the client can render tickets.
    return res.status(200).json({
      ok: true,
      orderId: payload.orderId,
      email: payload?.buyer?.email || "",
      mode: payload.mode || "live",
      items: payload.items || [],
      event: payload.event || {},
      buyer: payload.buyer || {},
      amountCents: payload.amountCents || 0,
      iat: payload.iat, exp: payload.exp
    });
  } catch (e) {
    return res.status(400).json({ ok:false, error: e?.message || "Could not verify token" });
  }
}
