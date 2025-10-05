// /api/checkout.js
import crypto from "crypto";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function signJWT(payloadObj, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payloadObj));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const encSig = b64url(sig);
  return `${data}.${encSig}`;
}

export default async function handler(req, res) {
  const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { amountCents, description, successUrl, cancelUrl, meta, mode } = req.body || {};
    console.log("[checkout] incoming successUrl:", successUrl, "cancelUrl:", cancelUrl);

    const isTest = (mode || "").toString().toLowerCase() === "test";
    const key = isTest
      ? (process.env.YOCO_SECRET_TEST || process.env.YOCO_SECRET)
      : (process.env.YOCO_SECRET_LIVE || process.env.YOCO_SECRET);
    if (!key) return res.status(500).json({ ok:false, error:"Missing YOCO secret" });

    if (!Number.isInteger(amountCents) || amountCents < 100)
      return res.status(400).json({ ok:false, error:"amountCents must be integer cents >= 100" });
    if (!/^https:\/\//.test(successUrl||"") || !/^https:\/\//.test(cancelUrl||""))
      return res.status(400).json({ ok:false, error:"successUrl/cancelUrl must be HTTPS" });

    // 🟩 Sign a richer claim token so ticket.html can render:
    const secret = process.env.TICKET_SIGNING_SECRET || "";
    let successUrlFinal = successUrl;
    let claimToken = null;

    try {
      if (secret) {
        const now = Math.floor(Date.now()/1000);
        const exp = now + 30*60; // 30 min
        const orderId = meta?.orderId || ("order_" + Math.random().toString(36).slice(2,10));

        // Keep only the fields needed to render:
        const safeItems = (meta?.items || []).map(i => ({
          code: i.code, name: i.name, qty: i.qty|0, priceCents: i.priceCents|0
        })).slice(0, 20); // cap

        const safeEvent = {
          id: meta?.eventId || "event",
          title: meta?.eventTitle || "Event",
          venue: meta?.eventVenue || (meta?.venue || ""),
          address: meta?.eventAddress || (meta?.address || ""),
          startISO: meta?.eventStartISO || meta?.startISO || "",
        };

        const safeBuyer = {
          firstName: meta?.buyer?.firstName || "",
          lastName:  meta?.buyer?.lastName  || "",
          email:     meta?.buyer?.email     || "",
          cell:      meta?.buyer?.cell      || ""
        };

        const payload = {
          sub: "ticket-claim",
          orderId,
          mode: isTest ? "test" : "live",
          items: safeItems,
          event: safeEvent,
          buyer: safeBuyer,
          amountCents,
          iat: now, exp
        };

        claimToken = signJWT(payload, secret);

        const url = new URL(successUrl);
        url.searchParams.set("token", claimToken);
        successUrlFinal = url.toString();
      } else {
        console.warn("[checkout] TICKET_SIGNING_SECRET missing; token not added.");
      }
    } catch (e) {
      console.warn("[checkout] token generation failed:", e?.message);
    }

    const r = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl: successUrlFinal,
        cancelUrl,
        description: description || "Order",
        metadata: { ...(meta || {}), mode: isTest ? "test" : "live" }
      })
    });
    const p = await r.json().catch(() => ({}));
    console.log("[checkout] yoco response successUrl:", p?.successUrl, "cancelUrl:", p?.cancelUrl, "redirectUrl:", p?.redirectUrl);

    if (!r.ok) return res.status(400).json({ ok:false, error: p?.message || `Yoco ${r.status}` });

    return res.status(200).json({
      ok: true,
      checkoutId: p.id,
      redirectUrl: p.redirectUrl || p.url,
      yocoSuccessUrl: p.successUrl || null,
      yocoCancelUrl:  p.cancelUrl  || null,
      claimToken: claimToken || null,
      mode: isTest ? "test" : "live"
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || "Server error" });
  }
}
