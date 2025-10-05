export function buildTicketEmail({ orgName, event, claimUrl }) {
  const title = event?.title || "Your Tickets";
  const when = event?.startISO ? new Date(event.startISO).toLocaleString() : "";
  const venue = [event?.venue, event?.address].filter(Boolean).join(" â€” ");
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a">
    <h2 style="margin:0 0 8px 0">${orgName}: ${title}</h2>
    <p style="margin:0 0 8px 0">${when}${venue ? " â€¢ " + venue : ""}</p>
    <p style="margin:16px 0">Thanks for your purchase. Click the button below to view and download your tickets.</p>
    <p>
      <a href="${claimUrl}" style="display:inline-block;background:#0369a1;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">
        View Tickets
      </a>
    </p>
    <p style="margin-top:24px;font-size:12px;color:#475569">If the button doesn't work, copy and paste this link:</p>
    <p style="font-size:12px;word-break:break-all;"><a href="${claimUrl}">${claimUrl}</a></p>
  </div>`;
  const text = `${orgName}: ${title}
${when}${venue ? " â€¢ " + venue : ""}
View your tickets: ${claimUrl}
`;
  return { html, text, subject: `${orgName} â€” Your Tickets: ${title}` };
}
