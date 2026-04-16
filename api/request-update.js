const { put, list } = require('@vercel/blob');
const { sendStatusUpdate } = require('./_email');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id, status, note, feedback } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    // Find the existing request blob
    const { blobs } = await list({ prefix: `requests/${id}` });
    const requestBlob = blobs.find(b => b.pathname.includes(id));
    if (!requestBlob) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Fetch existing request data (bypass CDN cache to avoid stale reads)
    const fetchUrl = requestBlob.url + (requestBlob.url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const response = await fetch(fetchUrl, { cache: 'no-store' });
    const request = await response.json();

    // Update status if provided
    if (status) {
      const validStatuses = ['submitted', 'in_review', 'in_progress', 'ready_for_testing', 'live', 'on_hold'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      request.status = status;
      request.statusHistory.push({
        status,
        date: new Date().toISOString(),
        note: note || `Status changed to ${status.replace(/_/g, ' ')}`
      });
    }

    // Add feedback if provided
    if (feedback) {
      request.feedback.push({
        message: feedback,
        date: new Date().toISOString()
      });
    }

    request.updatedAt = new Date().toISOString();

    // Send status update email (must await or Vercel kills the function)
    if (status) {
      await sendStatusUpdate(request, status, note);
    }

    // Save updated request (overwrite, no CDN cache so subsequent reads are fresh)
    await put(`requests/${id}.json`, JSON.stringify(request), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0
    });

    return res.status(200).json({ request });

  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
