export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const checkoutId = body?.data?.checkout?.id || body?.data?.metadata?.checkoutId || body?.data?.id;
  // TODO: mark order with this checkoutId as 'paid' in your DB
  return Response.json({ received: true, checkoutId });
}
