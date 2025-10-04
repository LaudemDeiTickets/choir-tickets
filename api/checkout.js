// api/checkout.js
export default async function handler(req, res) {
  // --- CORS (allow your site origin) ---
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { amountCents, description, successUrl, cancelUrl, meta, mode } = req.body || {};

    // Choose key (optional TEST/LIVE split)
    const isTest = (mode || "").toString().toLowerCase() === "test";
    const key = isTest ? (process.env.YOCO_SECRET_TEST || process.env.YOCO_SECRET) : (process.env.YOCO_SECRET_LIVE || process.env.YOCO_SECRET);

    if (!key) return res.status(500).json({ ok:false, error:"Missing YOCO secret (YOCO_SECRET / YOCO_SECRET_LIVE / YOCO_SECRET_TEST)" });
    if (!Number.isInteger(amountCents) || amountCents < 100)
      return res.status(400).json({ ok:false, error:"amountCents must be integer cents >= 100 (R150 = 15000)" });
    if (!/^https:\/\//.test(successUrl||"") || !/^https:\/\//.test(cancelUrl||""))
      return res.status(400).json({ ok:false, error:"successUrl/cancelUrl must be HTTPS" });

    const r = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl,
        cancelUrl,
        description: description || "Order",
        metadata: { ...(meta || {}), mode: isTest ? "test" : "live" },
      }),
    });

    const p = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(400).json({ ok:false, error: p?.message || `Yoco ${r.status}` });

    res.status(200).json({ ok:true, checkoutId: p.id, redirectUrl: p.redirectUrl || p.url, mode: isTest ? "test" : "live" });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || "Server error" });
  }
}
