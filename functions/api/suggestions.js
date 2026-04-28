// Employee suggestions — text, voice transcript, attachments, links.
import { listKeys, getJSON, putJSON, putObject, json, preflight, keyToUrl } from './_blob.js';

function extractLinks(s) {
  const re = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  return (s.match(re) || []).slice(0, 20);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;

  try {
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

      const attachments = [];
      const incoming = Array.isArray(b.attachments) ? b.attachments.slice(0, 10) : [];
      for (const [i, f] of incoming.entries()) {
        if (!f || !f.data_base64) continue;
        const safeName = (f.name || `file-${i}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        try {
          const buf = Uint8Array.from(atob(f.data_base64), c => c.charCodeAt(0));
          const key = `suggestions/${id}/${safeName}`;
          await putObject(bucket, key, buf, f.type || 'application/octet-stream');
          attachments.push({ name: safeName, type: f.type || '', size: buf.length, key, url: keyToUrl(key) });
        } catch (e) {
          attachments.push({ name: safeName, error: e.message });
        }
      }

      const explicit = Array.isArray(b.links) ? b.links.filter(u => typeof u === 'string').slice(0, 20) : [];
      const fromText = extractLinks((b.text || '') + ' ' + (b.transcript || ''));
      const links = Array.from(new Set([...explicit, ...fromText])).slice(0, 20);

      const entry = {
        id, createdAt: new Date().toISOString(),
        from_page: b.from_page || '', language: b.language || 'en-IN',
        submitter: b.submitter || '',
        text: (b.text || '').slice(0, 8000),
        transcript: (b.transcript || '').slice(0, 8000),
        tags: Array.isArray(b.tags) ? b.tags.slice(0, 20) : [],
        attachments, links, status: 'new', notes: ''
      };
      await putJSON(bucket, `suggestions/${id}.json`, entry);
      return json({ ok: true, id, entry }, { status: 201 });
    }

    if (request.method === 'PATCH') {
      const b = await request.json().catch(() => ({}));
      const id = b.id;
      if (!id) return json({ error: 'Missing id' }, { status: 400 });
      const cur = await getJSON(bucket, `suggestions/${id}.json`);
      if (!cur) return json({ error: 'Not found' }, { status: 404 });
      const updated = { ...cur, status: b.status || cur.status, notes: b.notes ?? cur.notes, updatedAt: new Date().toISOString() };
      await putJSON(bucket, `suggestions/${id}.json`, updated);
      return json({ ok: true, entry: updated });
    }

    // GET
    const items = await listKeys(bucket, 'suggestions/');
    const entries = [];
    for (const it of items) {
      if (!it.key.endsWith('.json')) continue;
      const rel = it.key.replace(/^suggestions\//, '');
      if (rel.includes('/')) continue;
      const e = await getJSON(bucket, it.key);
      if (e) entries.push(e);
    }
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({ entries });
  } catch (err) {
    console.error('suggestions error:', err);
    return json({ error: err.message }, { status: 500 });
  }
}
