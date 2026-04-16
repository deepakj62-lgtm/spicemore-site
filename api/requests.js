const { put, list } = require('@vercel/blob');
const { sendRequestConfirmation } = require('./_email');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // List all request blobs (may include versioned blobs like id-v123.json)
      const { blobs } = await list({ prefix: 'requests/' });

      // Group blobs by request ID (extract ID before -v or .json)
      const blobsByRequest = {};
      for (const blob of blobs) {
        if (!blob.pathname.endsWith('.json')) continue;
        // Extract request ID: "requests/abc123.json" or "requests/abc123-v1234567.json"
        const filename = blob.pathname.replace('requests/', '').replace('.json', '');
        const requestId = filename.replace(/-v\d+$/, '');
        if (!blobsByRequest[requestId]) blobsByRequest[requestId] = [];
        blobsByRequest[requestId].push(blob);
      }

      const requests = [];
      for (const [requestId, versions] of Object.entries(blobsByRequest)) {
        // Sort by uploadedAt descending, take latest
        versions.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const latest = versions[0];
        try {
          const response = await fetch(latest.url);
          const data = await response.json();
          requests.push(data);
        } catch (e) {
          // Skip corrupted entries
        }
      }

      // Sort by date, newest first
      requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ requests });

    } else if (req.method === 'POST') {
      const body = req.body;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

      // Upload files to blob storage
      const uploadedFiles = [];
      if (body.files && Array.isArray(body.files)) {
        for (const file of body.files) {
          if (file.data && file.name) {
            const buffer = Buffer.from(file.data, 'base64');
            const blob = await put(`files/${id}/${file.name}`, buffer, {
              access: 'public',
              contentType: file.type || 'application/octet-stream',
              addRandomSuffix: false
            });
            uploadedFiles.push({
              name: file.name,
              size: file.size,
              type: file.type,
              category: file.category, // 'input', 'output', or 'supporting'
              url: blob.url
            });
          }
        }
      }

      const request = {
        id,
        toolName: body.toolName || '',
        processDesc: body.processDesc || '',
        additionalNotes: body.additionalNotes || '',
        additionalOptions: body.additionalOptions || '',
        priority: body.priority || 'normal',
        requesterName: body.requesterName || '',
        requesterEmail: body.requesterEmail || '',
        files: uploadedFiles,
        status: 'submitted',
        statusHistory: [
          { status: 'submitted', date: new Date().toISOString(), note: 'Request submitted' }
        ],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save request metadata (no CDN cache)
      await put(`requests/${id}.json`, JSON.stringify(request), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 0
      });

      // Send confirmation email before responding
      await sendRequestConfirmation(request);

      return res.status(201).json({ request });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
