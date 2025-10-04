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
function verifyToken(token, secret) {
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
  try {
    const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    // Accept token via query (?token=) or POST { token }
    let token = "";
    if (req.method === "GET") {
      token = (req.query?.token || "").toString();
    } else if (req.method === "POST") {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        token = body.token || "";
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid JSON body" });
      }
    } else {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

    const secret = process.env.TICKET_SIGNING_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "Missing TICKET_SIGNING_SECRET" });

    // TEMP DEBUG (remove later)
    console.log("verify token len:", token.length, "head:", token.slice(0, 16));

    const payload = verifyToken(token, secret);
    return res.status(200).json({ ok: true, payload });
  } catch (e) {
    console.error("verify error:", e?.message);
    return res.status(400).json({ ok: false, error: e?.message || "Bad token" });
  }
}
