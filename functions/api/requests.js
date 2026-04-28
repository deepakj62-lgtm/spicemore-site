import { listKeys, getJSON, putJSON, putObject, json, preflight, keyToUrl } from './_blob.js';
import { sendRequestConfirmation } from './_email.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;

  try {
    if (request.method === 'GET') {
      const items = await listKeys(bucket, 'requests/');
      const byRequest = {};
      for (const it of items) {
        if (!it.key.endsWith('.json')) continue;
        const filename = it.key.replace('requests/', '').replace('.json', '');
        const requestId = filename.replace(/-v\d+$/, '');
        if (!byRequest[requestId]) byRequest[requestId] = [];
        byRequest[requestId].push(it);
      }
      const requests = [];
      for (const [, versions] of Object.entries(byRequest)) {
        versions.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
        const data = await getJSON(bucket, versions[0].key);
        if (data) requests.push(data);
      }
      requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json({ requests });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

      const uploadedFiles = [];
      if (body.files && Array.isArray(body.files)) {
        for (const file of body.files) {
          if (file.data && file.name) {
            const buf = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
            const key = `files/${id}/${file.name}`;
            await putObject(bucket, key, buf, file.type || 'application/octet-stream');
            uploadedFiles.push({
              name: file.name, size: file.size, type: file.type,
              category: file.category, key, url: keyToUrl(key)
            });
          }
        }
      }

      const reqRec = {
        id, toolName: body.toolName || '', processDesc: body.processDesc || '',
        additionalNotes: body.additionalNotes || '', additionalOptions: body.additionalOptions || '',
        priority: body.priority || 'normal',
        requesterName: body.requesterName || '', requesterEmail: body.requesterEmail || '',
        files: uploadedFiles,
        status: 'submitted',
        statusHistory: [{ status: 'submitted', date: new Date().toISOString(), note: 'Request submitted' }],
        feedback: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await putJSON(bucket, `requests/${id}.json`, reqRec);
      await sendRequestConfirmation(env, reqRec);
      return json({ request: reqRec }, { status: 201 });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('API error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
