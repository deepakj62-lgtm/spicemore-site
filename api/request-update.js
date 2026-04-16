const { put, list, del } = require('@vercel/blob');
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
    const { id, status, note, feedback, feedbackType, feedbackFiles } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    // Find all versions of this request blob
    const { blobs } = await list({ prefix: `requests/${id}` });
    const matchingBlobs = blobs
      .filter(b => b.pathname.includes(id) && b.pathname.endsWith('.json'))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    if (matchingBlobs.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Read the latest version
    const latestBlob = matchingBlobs[0];
    const response = await fetch(latestBlob.url);
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
      const feedbackEntry = {
        message: feedback,
        type: feedbackType || 'feedback',
        date: new Date().toISOString()
      };

      // Upload feedback files if any
      if (feedbackFiles && Array.isArray(feedbackFiles) && feedbackFiles.length > 0) {
        const uploadedFiles = [];
        for (const file of feedbackFiles) {
          if (file.data && file.name) {
            const buffer = Buffer.from(file.data, 'base64');
            const blob = await put(`feedback-files/${id}/${Date.now()}-${file.name}`, buffer, {
              access: 'public',
              contentType: file.type || 'application/octet-stream',
              addRandomSuffix: false
            });
            uploadedFiles.push({
              name: file.name,
              size: file.size,
              type: file.type,
              url: blob.url
            });
          }
        }
        if (uploadedFiles.length > 0) {
          feedbackEntry.files = uploadedFiles;
        }
      }

      request.feedback.push(feedbackEntry);
    }

    request.updatedAt = new Date().toISOString();

    // Send status update email (must await or Vercel kills the function)
    if (status) {
      await sendStatusUpdate(request, status, note);
    }

    // Write as a NEW versioned blob (new URL = no CDN staleness)
    const version = Date.now();
    await put(`requests/${id}-v${version}.json`, JSON.stringify(request), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0
    });

    // Clean up old versions (keep only the latest)
    for (const old of matchingBlobs) {
      try { await del(old.url); } catch (e) { /* ignore cleanup errors */ }
    }

    return res.status(200).json({ request });

  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
