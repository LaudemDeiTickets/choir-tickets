// pages/api/checkout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { amountCents, description, successUrl, cancelUrl, meta } = req.body || {};

    if (!process.env.YOCO_SECRET) return res.status(500).json({ ok: false, error: "Missing YOCO_SECRET" });
    if (!amountCents || !Number.isInteger(amountCents) || amountCents < 100)
      return res.status(400).json({ ok: false, error: "amountCents must be integer cents >= 100" });
    if (!successUrl || !cancelUrl)
      return res.status(400).json({ ok: false, error: "successUrl and cancelUrl are required" });

    const r = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.YOCO_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl,
        cancelUrl,
        description: description || "Order",
        metadata: meta || {},
      }),
    });

    const payload = await r.json();
    if (!r.ok) return res.status(400).json({ ok: false, error: payload?.message || "Yoco error" });

    res.status(200).json({ ok: true, checkoutId: payload.id, redirectUrl: payload.redirectUrl || payload.url });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
