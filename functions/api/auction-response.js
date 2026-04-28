import { putObject, putJSON, getJSON, listKeys, json, preflight, keyToUrl } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;

  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const questionId = parseInt(body.questionId, 10);
      if (!questionId || questionId < 1 || questionId > 39) {
        return json({ error: 'Invalid questionId (must be 1-39)' }, { status: 400 });
      }
      const hasAnswer =
        (body.rawTranscript && body.rawTranscript.trim()) ||
        (body.cleanedText && body.cleanedText.trim()) ||
        (body.typedNotes && body.typedNotes.trim()) ||
        (Array.isArray(body.files) && body.files.length > 0);
      if (!hasAnswer) return json({ error: 'Answer is empty — provide speech, text, or a file' }, { status: 400 });

      const answerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const sessionId = (body.sessionId || 'anon').toString().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');

      const uploadedFiles = [];
      if (Array.isArray(body.files)) {
        for (const file of body.files) {
          if (!file || !file.data || !file.name) continue;
          try {
            const buffer = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
            const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
            const key = `auction-files/${sessionId}/q${questionId}/${answerId}-${safeName}`;
            await putObject(bucket, key, buffer, file.type || 'application/octet-stream');
            uploadedFiles.push({
              name: file.name, size: file.size || buffer.length,
              type: file.type || 'application/octet-stream',
              key, url: keyToUrl(key)
            });
          } catch (fileErr) {
            console.error('File upload failed:', file.name, fileErr.message);
          }
        }
      }

      const ua = request.headers.get('user-agent') || '';
      const record = {
        answerId, sessionId, questionId,
        respondent: {
          name:  (body.respondent && body.respondent.name)  || '',
          phone: (body.respondent && body.respondent.phone) || '',
          role:  (body.respondent && body.respondent.role)  || '',
          depot: (body.respondent && body.respondent.depot) || ''
        },
        rawTranscript: body.rawTranscript || '',
        cleanedText:   body.cleanedText   || '',
        typedNotes:    body.typedNotes    || '',
        lang:          body.lang          || '',
        files:         uploadedFiles,
        userAgent:     ua.slice(0, 200),
        createdAt:     new Date().toISOString()
      };
      const key = `auction-responses/q${String(questionId).padStart(2, '0')}/${Date.now()}-${answerId}.json`;
      await putJSON(bucket, key, record);
      return json({ ok: true, answerId, questionId, filesStored: uploadedFiles.length }, { status: 201 });
    }

    if (request.method === 'GET') {
      const items = await listKeys(bucket, 'auction-responses/');
      const responses = [];
      for (const it of items) {
        if (!it.key.endsWith('.json')) continue;
        const data = await getJSON(bucket, it.key);
        if (data) responses.push(data);
      }
      responses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const byQuestion = {};
      for (const r of responses) (byQuestion[r.questionId] = byQuestion[r.questionId] || []).push(r);
      return json({ total: responses.length, byQuestion, responses });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('auction-response error:', error);
    return json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
