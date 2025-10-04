// api/webhooks/yoco.js
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("OK"); // optional probe
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = req.body || {};
    const checkoutId =
      body?.data?.checkout?.id ||
      body?.data?.metadata?.checkoutId ||
      body?.data?.id;

    // TODO: mark order with checkoutId as 'paid' in your DB
    return res.status(200).json({ received: true, checkoutId });
  } catch (e) {
    return res.status(400).json({ received: false, error: e?.message || "Bad webhook" });
  }
}
