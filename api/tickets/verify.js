import crypto from "crypto";

function b64urlDecode(input) {
  input = (input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64").toString();
}
function expectedSig(data, secret) {
  return Buffer.from(
    crypto.createHmac("sha256", secret).update(data).digest("base64")
  ).toString().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function verifyWithSecrets(token, secrets) {
  const [p, s] = (token || "").split(".");
  if (!p || !s) throw new Error("Malformed token");
  const data = b64urlDecode(p);
  for (const sec of secrets) {
    if (!sec) continue;
    const exp = expectedSig(data, sec);
    const a = Buffer.from(s);
    const b = Buffer.from(exp);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      const payload = JSON.parse(data);
      const now = Date.now();
      if (payload.exp && now > payload.exp) throw new Error("Token expired");
      return payload; // success with this secret
    }
  }
  throw new Error("Invalid signature");
}

export default async function handler(req, res) {
  try {
    const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    let token = "";
    if (req.method === "GET") token = (req.query?.token || "").toString();
    else if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      token = body.token || "";
    } else return res.status(405).json({ ok:false, error:"Method Not Allowed" });

    if (!token) return res.status(400).json({ ok:false, error:"Missing token" });

    // Support rotation: primary + legacy secret
    const primary = process.env.TICKET_SIGNING_SECRET;
    const legacy  = process.env.TICKET_SIGNING_SECRET_OLD; // optional
    if (!primary) return res.status(500).json({ ok:false, error:"Missing TICKET_SIGNING_SECRET" });

    const payload = verifyWithSecrets(token, [primary, legacy].filter(Boolean));
    return res.status(200).json({ ok:true, payload });
  } catch (e) {
    return res.status(400).json({ ok:false, error: e?.message || "Bad token" });
  }
}
