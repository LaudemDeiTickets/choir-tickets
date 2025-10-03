// pages/api/webhooks/yoco.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } }, // adjust if needed
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = req.body || {};

    // Extract an ID you can match in your DB.
    // Adjust if Yoco sends a different shape in your account:
    const checkoutId =
      body?.data?.checkout?.id ||
      body?.data?.metadata?.checkoutId ||
      body?.data?.id;

    // TODO: look up pending order by checkoutId and mark as 'paid'
    // await db.order.update({ where: { checkoutId }, data: { status: 'paid' } });

    return res.status(200).json({ received: true, checkoutId });
  } catch (e: any) {
    return res.status(400).json({ received: false, error: e?.message || "Bad webhook" });
  }
}
