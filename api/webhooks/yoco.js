// api/webhooks/yoco.js
import crypto from "crypto";

// Read raw body (Node.js stream)
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

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("OK");        // optional health probe
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // --- Verify signature if secrets are present ---
    const id = req.headers["webhook-id"];
    const ts = req.headers["webhook-timestamp"];
    const sigHeader = req.headers["webhook-signature"];
    const MAX_SKEW_MS = 3 * 60 * 1000;

    const secretLive = process.env.YOCO_WEBHOOK_SECRET_LIVE || process.env.YOCO_WEBHOOK_SECRET || "";
    const secretTest = process.env.YOCO_WEBHOOK_SECRET_TEST || "";

    const rawBody = await readRaw(req);
    let mode = "live"; // default unless payload says otherwise

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

    // Safe to parse JSON now
    let event = {};
    try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ received:false, error:"Invalid JSON" }); }

    mode = event?.mode || mode;

    // Your business fields (adjust as needed)
    const checkoutId =
      event?.data?.checkout?.id ||
      event?.data?.metadata?.checkoutId ||
      event?.data?.id;

    // TODO: update your DB: mark order with this checkoutId as 'paid'
    // if (mode === "test") { ... } else { ... }

    return res.status(200).json({ received:true, mode, checkoutId });
  } catch (e) {
    return res.status(400).json({ received:false, error: e?.message || "Bad webhook" });
  }
}

}
