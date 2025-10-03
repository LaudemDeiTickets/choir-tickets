// /api/append-csv.js
// Append a row to a CSV file in a GitHub repo using the REST API (no Octokit dependency).
// POST body: { row: ["2025-10-11","order_ABC","Thandi","Ndlovu","thandi@example.com",20000] }

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

function csvEscape(val) {
  const s = String(val ?? '');
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

async function ghGetFile({ token, owner, repo, path, ref }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } });
  if (resp.status === 404) return { status: 404 };
  if (!resp.ok) throw new Error(`GitHub GET failed ${resp.status}: ${await resp.text()}`);
  return { status: resp.status, data: await resp.json() };
}

async function ghPutFile({ token, owner, repo, path, message, contentBase64, sha, branch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: contentBase64,
    branch,
  };
  if (sha) body.sha = sha;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`GitHub PUT failed ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

module.exports = async function handler(req, res) {
  const cors = corsHeaders();

  if (req.method === 'OPTIONS') {
    writeCors(res, cors);
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    writeCors(res, cors);
    return res.status(405).send('Method Not Allowed');
  }

  const {
    GH_TOKEN,
    GH_OWNER,
    GH_REPO,
    GH_CSV_PATH,
    GH_BRANCH = 'main',
  } = process.env;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO || !GH_CSV_PATH) {
    writeCors(res, cors);
    return res.status(500).send('Server misconfigured: missing GH_TOKEN, GH_OWNER, GH_REPO, or GH_CSV_PATH.');
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
  const row = body && body.row;
  if (!Array.isArray(row)) {
    writeCors(res, cors);
    return res.status(400).send('Invalid payload. Expected JSON: { "row": [ ... ] }');
  }

  try {
    // Get current file (or 404 if new)
    const file = await ghGetFile({ token: GH_TOKEN, owner: GH_OWNER, repo: GH_REPO, path: GH_CSV_PATH, ref: GH_BRANCH });

    let current = '';
    let sha = undefined;
    if (file.status !== 404) {
      current = Buffer.from(file.data.content || '', 'base64').toString('utf8');
      sha = file.data.sha;
    }

    // Ensure header
    if (!current.trim()) {
      current = 'timestamp,order_id,first_name,last_name,email,amount_cents\n';
    }

    const line = row.map(csvEscape).join(',') + '\n';
    const updated = current.endsWith('\n') ? current + line : current + '\n' + line;
    const contentBase64 = Buffer.from(updated, 'utf8').toString('base64');
    const message = `Append ${row[1] ? `order ${row[1]}` : 'row'} to ${GH_CSV_PATH}`;

    await ghPutFile({
      token: GH_TOKEN,
      owner: GH_OWNER,
      repo: GH_REPO,
      path: GH_CSV_PATH,
      message,
      contentBase64,
      sha,
      branch: GH_BRANCH,
    });

    writeCors(res, cors);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('append-csv error:', e);
    writeCors(res, cors);
    return res.status(500).send(`GitHub write error: ${e.message || 'unknown error'}`);
  }
};
