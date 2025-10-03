// app/api/checkout/route.ts
export const runtime = "nodejs";       // ensure Node runtime (not Edge)
export const dynamic = "force-dynamic";

type ReqBody = {
  amountCents: number;                 // e.g. 15000 for R150
  description?: string;                // e.g. "Gala — Standard x1"
  successUrl: string;                  // e.g. https://your-domain.com/payment-success
  cancelUrl: string;                   // e.g. https://your-domain.com/payment-cancelled
  meta?: Record<string, any>;          // echoed back in webhooks
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;

    if (!process.env.YOCO_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Missing YOCO_SECRET" }), { status: 500 });
    }
    if (!body?.amountCents || body.amountCents < 100 || !Number.isInteger(body.amountCents)) {
      return new Response(JSON.stringify({ ok: false, error: "amountCents must be integer cents >= 100" }), { status: 400 });
    }
    if (!body.successUrl || !body.cancelUrl) {
      return new Response(JSON.stringify({ ok: false, error: "successUrl and cancelUrl are required" }), { status: 400 });
    }

    const res = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.YOCO_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: body.amountCents,
        currency: "ZAR",
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        description: body.description || "Order",
        metadata: body.meta || {},
      }),
    });

    const payload = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: payload?.message || "Yoco error" }), { status: 400 });
    }

    return Response.json({
      ok: true,
      checkoutId: payload.id,
      redirectUrl: payload.redirectUrl || payload.url,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Server error" }), { status: 500 });
  }
}

// Optional: reject non-POST
export function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
