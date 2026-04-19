const { put, list } = require('@vercel/blob');

/**
 * Auction Questionnaire Response API
 *
 * POST /api/auction-response
 *   Body: {
 *     sessionId:    string (unique per respondent session; reused across multiple answers)
 *     respondent:   { name?, phone?, role?, depot? }
 *     questionId:   number (1-39)
 *     rawTranscript: string (what the browser captured)
 *     cleanedText:  string (optional, cleaned by LLM)
 *     typedNotes:   string (optional, additional typed info)
 *     lang:         string (ml-IN | ta-IN | en-IN | hi-IN)
 *     files:        [{ name, type, size, data (base64) }]
 *   }
 *
 * GET /api/auction-response
 *   Lists all responses (admin / Deepak use — intended to be called from a view page)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const body = req.body || {};

      const questionId = parseInt(body.questionId, 10);
      if (!questionId || questionId < 1 || questionId > 39) {
        return res.status(400).json({ error: 'Invalid questionId (must be 1-39)' });
      }

      const hasAnswer =
        (body.rawTranscript && body.rawTranscript.trim()) ||
        (body.cleanedText && body.cleanedText.trim()) ||
        (body.typedNotes && body.typedNotes.trim()) ||
        (Array.isArray(body.files) && body.files.length > 0);

      if (!hasAnswer) {
        return res.status(400).json({ error: 'Answer is empty — provide speech, text, or a file' });
      }

      const answerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const sessionId = (body.sessionId || 'anon').toString().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');

      // Upload any files to blob storage
      const uploadedFiles = [];
      if (Array.isArray(body.files)) {
        for (const file of body.files) {
          if (!file || !file.data || !file.name) continue;
          try {
            const buffer = Buffer.from(file.data, 'base64');
            const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
            const blob = await put(
              `auction-files/${sessionId}/q${questionId}/${answerId}-${safeName}`,
              buffer,
              {
                access: 'public',
                contentType: file.type || 'application/octet-stream',
                addRandomSuffix: false
              }
            );
            uploadedFiles.push({
              name: file.name,
              size: file.size || buffer.length,
              type: file.type || 'application/octet-stream',
              url: blob.url
            });
          } catch (fileErr) {
            console.error('File upload failed:', file.name, fileErr.message);
          }
        }
      }

      const record = {
        answerId,
        sessionId,
        questionId,
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
        userAgent:     (req.headers['user-agent'] || '').slice(0, 200),
        createdAt:     new Date().toISOString()
      };

      // Key format allows chronological listing and grouping by question
      const key = `auction-responses/q${String(questionId).padStart(2, '0')}/${Date.now()}-${answerId}.json`;

      await put(key, JSON.stringify(record), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 0
      });

      return res.status(201).json({ ok: true, answerId, questionId, filesStored: uploadedFiles.length });
    }

    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: 'auction-responses/' });
      const responses = [];
      for (const blob of blobs) {
        if (!blob.pathname.endsWith('.json')) continue;
        try {
          const resp = await fetch(blob.url);
          const data = await resp.json();
          responses.push(data);
        } catch {}
      }
      responses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const byQuestion = {};
      for (const r of responses) {
        (byQuestion[r.questionId] = byQuestion[r.questionId] || []).push(r);
      }

      return res.status(200).json({
        total: responses.length,
        byQuestion,
        responses
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('auction-response error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
