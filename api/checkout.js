export default async function handler(req, res) {
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { amountCents, description, successUrl, cancelUrl, meta, mode } = req.body || {};
    console.log("[checkout] incoming successUrl:", successUrl, "cancelUrl:", cancelUrl); // 👈

    const isTest = (mode || "").toString().toLowerCase() === "test";
    const key = isTest
      ? (process.env.YOCO_SECRET_TEST || process.env.YOCO_SECRET)
      : (process.env.YOCO_SECRET_LIVE || process.env.YOCO_SECRET);
    if (!key) return res.status(500).json({ ok:false, error:"Missing YOCO secret" });

    if (!Number.isInteger(amountCents) || amountCents < 100)
      return res.status(400).json({ ok:false, error:"amountCents must be integer cents >= 100" });
    if (!/^https:\/\//.test(successUrl||"") || !/^https:\/\//.test(cancelUrl||""))
      return res.status(400).json({ ok:false, error:"successUrl/cancelUrl must be HTTPS" });

    const r = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl,
        cancelUrl,
        description: description || "Order",
        metadata: { ...(meta || {}), mode: isTest ? "test" : "live" }
      })
    });
    const p = await r.json().catch(() => ({}));
    console.log("[checkout] yoco response successUrl:", p?.successUrl, "cancelUrl:", p?.cancelUrl, "redirectUrl:", p?.redirectUrl); // 👈

    if (!r.ok) return res.status(400).json({ ok:false, error: p?.message || `Yoco ${r.status}` });

    return res.status(200).json({
      ok: true,
      checkoutId: p.id,
      redirectUrl: p.redirectUrl || p.url,
      yocoSuccessUrl: p.successUrl || null,
      yocoCancelUrl:  p.cancelUrl  || null,
      mode: isTest ? "test" : "live"
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || "Server error" });
  }
}

