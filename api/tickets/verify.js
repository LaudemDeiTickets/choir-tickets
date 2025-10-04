// api/tickets/verify.js
import crypto from "crypto";

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(input) {
  input = (input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64").toString();
}
function sign(payload, secret) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64");
  return b64url(data) + "." + b64url(sig);
}
function verify(token, secret) {
  const [p, s] = (token || "").split(".");
  if (!p || !s) throw new Error("Malformed token");
  const data = b64urlDecode(p);
  const expected = b64url(crypto.createHmac("sha256", secret).update(data).digest("base64"));
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid signature");
  const payload = JSON.parse(data);
  const now = Date.now();
  if (payload.exp && now > payload.exp) throw new Error("Token expired");
  return payload;
}

export default async function handler(req, res) {
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  try {
    const token = (req.query.token || "").toString();
    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });
    const secret = process.env.TICKET_SIGNING_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "Missing TICKET_SIGNING_SECRET" });

    const payload = verify(token, secret);
    return res.status(200).json({ ok: true, payload });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || "Bad token" });
  }
}

// Optional: export sign for local tests
export const _test = { sign };
