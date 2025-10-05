import { createCanvas, loadImage } from "@napi-rs/canvas";
import QRCode from "qrcode";

export async function renderTicketPng({ orgName, logoUrl, event, buyer, item }) {
  const W = 1000, H = 420;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Card style
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  roundRect(ctx, 20, 20, W-40, H-40, 22);
  ctx.stroke();

  // Logo
  if (logoUrl) {
    try {
      const img = await loadImage(logoUrl);
      const s = 80;
      ctx.save();
      roundRect(ctx, 48, 48, s, s, 14); ctx.clip();
      ctx.drawImage(img, 48, 48, s, s);
      ctx.restore();
      ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
      roundRect(ctx, 48, 48, s, s, 14); ctx.stroke();
    } catch {}
  }

  // Text helpers
  function text(x, y, str, size=24, color="#0f172a", weight="600") {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(str, x, y);
  }

  // Event texts
  const title = event?.title || "Event";
  const subtitle = event?.subtitle || "";
  const when = event?.startISO ? new Date(event.startISO).toLocaleString() : "";
  const venue = event?.venue || "";
  const address = event?.address || "";
  const price = (item?.priceCents != null) ? `R${Math.round(item.priceCents/100)}` : (item?.price || "");

  text(150, 80, orgName || "Tickets", 22, "#0f172a", "700");
  text(150, 115, title, 28, "#0f172a", "700");
  if (subtitle) text(150, 145, subtitle, 20, "#334155", "500");
  text(150, 180, [when, venue].filter(Boolean).join(" • "), 20, "#0f172a", "500");
  if (address) text(150, 208, address, 16, "#64748b", "400");
  const buyerLine = buyer?.firstName ? `${buyer.firstName} ${buyer.lastName || ""} • ${buyer.cell || ""}`.trim() : "";
  if (buyerLine) text(150, 238, `Buyer: ${buyerLine}`, 16, "#64748b", "400");

  // Divider (dashed)
  ctx.strokeStyle = "#cbd5e1"; ctx.setLineDash([8,8]);
  ctx.beginPath(); ctx.moveTo(40, 270); ctx.lineTo(W-40, 270); ctx.stroke();
  ctx.setLineDash([]);

  // Ticket meta
  text(48, 310, "Ticket ID", 14, "#64748b", "500");
  text(48, 335, item?.ticketId || "TKT-XXXXXX", 22, "#0f172a", "700");

  text(340, 310, "Type", 14, "#64748b", "500");
  text(340, 335, item?.name || "Admission", 20, "#0f172a", "600");

  text(640, 310, "Price", 14, "#64748b", "500");
  text(640, 335, price || "", 20, "#0f172a", "600");

  // QR code
  const payload = JSON.stringify({
    order: event?.orderId,
    ticket: item?.ticketId,
    event: event?.id,
    title, dateISO: event?.startISO,
    venue, address,
    buyer: buyerLine
  });
  const qrCanvas = createCanvas(180, 180);
  await QRCode.toCanvas(qrCanvas, payload, { width: 180, margin: 0 });
  ctx.drawImage(qrCanvas, W-40-180, 60);

  return canvas.toBuffer("image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
