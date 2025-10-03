// /api/create-checkout.js
// Vercel serverless function that creates a Yoco hosted checkout session
// POST body: { amountInCents, firstName, lastName, email, items, orderId }

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeCors(res, headers) {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
}

module.exports = async function handler(req, res) {
  const cors = corsHeaders();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    writeCors(res, cors);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    writeCors(res, cors);
    return res.status(405).send('Method Not Allowed');
  }

  // Validate env
  const secret = process.env.YOCO_SECRET_TOKEN;
  if (!secret) {
    writeCors(res, cors);
    return res.status(500).send('Server misconfigured: YOCO_SECRET_TOKEN is missing.');
  }

  // Body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_e) { /* ignore */ }
  }

  const {
    amountInCents,
    firstName = '',
    lastName = '',
    email = '',
    items = [],
    orderId,
  } = body || {};

  if (!Number.isInteger(amountInCents) || amountInCents <= 0 || !orderId) {
    writeCors(res, cors);
    return res.status(400).send('Missing/invalid amountInCents or orderId');
  }

  const successUrl = process.env.SUCCESS_URL || 'https://laudemdeitickets.github.io/choir-tickets/checkout.html?paid=1';
  const cancelUrl  = process.env.CANCEL_URL  || 'https://laudemdeitickets.github.io/choir-tickets/checkout.html?paid=0';

  const metadata = {
    orderId,
    firstName,
    lastName,
    email,
    items: JSON.stringify(items.slice(0, 20)),
  };

  try {
    const yocoResp = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInCents,
        currency: 'ZAR',
        successUrl,
        cancelUrl,
        metadata,
      }),
    });

    const text = await yocoResp.text();
    if (!yocoResp.ok) {
      writeCors(res, cors);
      return res.status(yocoResp.status).send(`Yoco error: ${text}`);
    }

    let json;
    try { json = JSON.parse(text); } catch (e) {
      writeCors(res, cors);
      return res.status(502).send('Invalid JSON from Yoco');
    }

    if (!json.redirectUrl) {
      writeCors(res, cors);
      return res.status(502).send('Missing redirectUrl from Yoco');
    }

    writeCors(res, cors);
    return res.status(200).json({
      redirectUrl: json.redirectUrl,
      checkoutId: json.id || null,
    });
  } catch (err) {
    console.error('create-checkout error:', err);
    writeCors(res, cors);
    return res.status(500).send('Server error creating checkout');
  }
};
