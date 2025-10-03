// pages/api/checkout.ts
import type { NextApiRequest, NextApiResponse } from "next";

const ALLOW_ORIGIN = process.env.CORS_ORIGIN ?? "*"; // set to your Wix/site origin in Vercel for production

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { amountCents, description, successUrl, cancelUrl, meta } = req.body || {};

    // Basic validation
    if (!process.env.YOCO_SECRET) {
      return res.status(500).json({ ok: false, error: "Missing YOCO_SECRET env on server" });
    }
    if (!Number.isInteger(amountCents) || amountCents < 100) {
      return res.status(400).json({ ok: false, error: "amountCents must be integer cents >= 100 (e.g., R150 = 15000)" });
    }
    if (
      typeof successUrl !== "string" ||
      typeof cancelUrl !== "string" ||
      !/^https:\/\//.test(successUrl) ||
      !/^https:\/\//.test(cancelUrl)
    ) {
      return res.status(400).json({ ok: false, error: "successUrl and cancelUrl must be HTTPS URLs" });
    }

    // Call Yoco: create a hosted checkout
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

    const p = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(400).json({ ok: false, error: p?.message || `Yoco ${r.status}` });
    }

    return res.status(200).json({
      ok: true,
      checkoutId: p.id,
      redirectUrl: p.redirectUrl || p.url, // Yoco may return either
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
