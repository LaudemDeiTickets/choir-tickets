// pages/api/webhooks/yoco.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = req.body || {};
    const checkoutId =
      body?.data?.checkout?.id ||
      body?.data?.metadata?.checkoutId ||
      body?.data?.id;

    // TODO: update your DB order by checkoutId → status='paid'
    // await db.order.update({ where: { checkoutId }, data: { status: "paid" } });

    res.status(200).json({ received: true, checkoutId });
  } catch (e: any) {
    res.status(400).json({ received: false, error: e?.message || "Bad webhook" });
  }
}
