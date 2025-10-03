// app/api/webhooks/yoco/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// If Yoco provides a signature header, verify here.
// Example placeholder: const sig = req.headers.get("x-yoco-signature");

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // Typical IDs you may see; adjust to Yoco’s final schema if needed
    const checkoutId =
      body?.data?.checkout?.id ||
      body?.data?.metadata?.checkoutId ||
      body?.data?.id;

    // TODO: look up your pending order by checkoutId in your DB and mark it 'paid'
    // await db.order.update({ where: { checkoutId }, data: { status: "paid" } });

    return Response.json({ received: true, checkoutId });
  } catch (e: any) {
    return new Response(JSON.stringify({ received: false, error: e?.message || "Bad webhook" }), { status: 400 });
  }
}

export function GET() {
  return new Response("OK");
}
