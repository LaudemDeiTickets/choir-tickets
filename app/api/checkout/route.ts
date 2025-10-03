export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { amountCents, description, successUrl, cancelUrl, meta } = await req.json();

  if (!process.env.YOCO_SECRET)
    return new Response(JSON.stringify({ ok:false, error:"Missing YOCO_SECRET" }), { status:500 });

  if (!Number.isInteger(amountCents) || amountCents < 100)
    return new Response(JSON.stringify({ ok:false, error:"amountCents must be integer cents >= 100" }), { status:400 });

  const r = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.YOCO_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amountCents, currency: "ZAR",
      successUrl, cancelUrl,
      description: description || "Order", metadata: meta || {}
    })
  });

  const p = await r.json().catch(() => ({}));
  if (!r.ok) return new Response(JSON.stringify({ ok:false, error: p?.message || `Yoco ${r.status}` }), { status:400 });

  return Response.json({ ok:true, checkoutId: p.id, redirectUrl: p.redirectUrl || p.url });
}

// CORS (if calling from Wix or another origin)
const ORIGIN = process.env.CORS_ORIGIN ?? "*";
export function OPTIONS(){ return new Response(null, { status:204, headers: corsHeaders() }); }
function corsHeaders(){
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}
