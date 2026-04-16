const { put, list } = require('@vercel/blob');

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
    const { blobs } = await list({ prefix: `requests/${id}.json` });
    if (!blobs.length) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Fetch existing request data
    const response = await fetch(blobs[0].url);
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

    // Save updated request (overwrite)
    await put(`requests/${id}.json`, JSON.stringify(request), {
      access: 'public',
      contentType: 'application/json'
    });

    return res.status(200).json({ request });

  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
