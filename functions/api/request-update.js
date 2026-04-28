import { listKeys, getJSON, putJSON, putObject, deleteObject, json, preflight, keyToUrl } from './_blob.js';
import { sendStatusUpdate } from './_email.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const bucket = env.BLOB_BUCKET;

  try {
    const { id, status, note, feedback, feedbackType, feedbackFiles } = await request.json();
    if (!id) return json({ error: 'Request ID is required' }, { status: 400 });

    // Find all versions of this request blob
    const items = await listKeys(bucket, `requests/${id}`);
    const matching = items
      .filter(b => b.key.includes(id) && b.key.endsWith('.json'))
      .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    if (!matching.length) return json({ error: 'Request not found' }, { status: 404 });

    const latest = matching[0];
    const reqData = await getJSON(bucket, latest.key);
    if (!reqData) return json({ error: 'Request not found' }, { status: 404 });

    if (status) {
      const validStatuses = ['submitted', 'in_review', 'in_progress', 'ready_for_testing', 'live', 'on_hold'];
      if (!validStatuses.includes(status)) return json({ error: 'Invalid status' }, { status: 400 });
      reqData.status = status;
      reqData.statusHistory.push({
        status, date: new Date().toISOString(),
        note: note || `Status changed to ${status.replace(/_/g, ' ')}`
      });
    }

    if (feedback) {
      const feedbackEntry = {
        message: feedback, type: feedbackType || 'feedback',
        date: new Date().toISOString()
      };
      if (feedbackFiles && Array.isArray(feedbackFiles) && feedbackFiles.length > 0) {
        const uploaded = [];
        for (const file of feedbackFiles) {
          if (file.data && file.name) {
            const buf = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
            const key = `feedback-files/${id}/${Date.now()}-${file.name}`;
            await putObject(bucket, key, buf, file.type || 'application/octet-stream');
            uploaded.push({ name: file.name, size: file.size, type: file.type, key, url: keyToUrl(key) });
          }
        }
        if (uploaded.length) feedbackEntry.files = uploaded;
      }
      reqData.feedback.push(feedbackEntry);
    }

    reqData.updatedAt = new Date().toISOString();
    if (status) await sendStatusUpdate(env, reqData, status, note);

    const version = Date.now();
    await putJSON(bucket, `requests/${id}-v${version}.json`, reqData);
    for (const old of matching) {
      try { await deleteObject(bucket, old.key); } catch {}
    }

    return json({ request: reqData });
  } catch (error) {
    console.error('Update error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
