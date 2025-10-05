export function buildTicketEmail({ orgName, event, claimUrl, withAttachment=false }) {
  const title = event?.title || "Your Tickets";
  const when = event?.startISO ? new Date(event.startISO).toLocaleString() : "";
  const venue = [event?.venue, event?.address].filter(Boolean).join(" — ");
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a">
    <h2 style="margin:0 0 8px 0">${orgName}: ${title}</h2>
    <p style="margin:0 0 8px 0">${when}${venue ? " • " + venue : ""}</p>
    <p style="margin:16px 0">Thanks for your purchase. Click the button below to view all your tickets.</p>
    <p>
      <a href="${claimUrl}" style="display:inline-block;background:#0369a1;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">
        View Tickets
      </a>
    </p>
    ${withAttachment ? '<p style="margin-top:16px;color:#475569">We\'ve attached a PNG of your ticket as well.</p>' : ''}
    <p style="margin-top:24px;font-size:12px;color:#475569">If the button doesn\'t work, copy and paste this link:</p>
    <p style="font-size:12px;word-break:break-all;"><a href="${claimUrl}">${claimUrl}</a></p>
  </div>`;
  const text = `${orgName}: ${title}
${when}${venue ? " • " + venue : ""}
View your tickets: ${claimUrl}
${withAttachment ? "\nA PNG of your ticket is attached." : ""}
`;
  return { html, text, subject: `${orgName} — Your Tickets: ${title}` };
}
