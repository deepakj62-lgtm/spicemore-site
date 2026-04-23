module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: 'Transcription not configured',
      detail: 'GROQ_API_KEY not set in environment'
    });
  }

  try {
    const { audioBase64, mimeType, lang } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({ transcript: '', note: 'No audio provided' });
    }

    const buf = Buffer.from(audioBase64, 'base64');
    const effectiveMime = mimeType || 'audio/webm';
    const ext = effectiveMime.includes('mp4') ? 'mp4'
              : effectiveMime.includes('ogg') ? 'ogg'
              : effectiveMime.includes('wav') ? 'wav'
              : effectiveMime.includes('mpeg') ? 'mp3'
              : 'webm';

    // Node 20 Vercel: FormData, Blob available globally
    const form = new FormData();
    const blob = new Blob([buf], { type: effectiveMime });
    form.append('file', blob, `audio.${ext}`);
    form.append('model', 'whisper-large-v3');
    if (lang && typeof lang === 'string' && lang.length <= 5) {
      form.append('language', lang);
    }
    form.append('response_format', 'json');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('Groq transcription error:', resp.status, errBody);
      return res.status(200).json({
        transcript: '',
        note: `Transcription service returned ${resp.status}`
      });
    }

    const data = await resp.json();
    return res.status(200).json({ transcript: (data.text || '').trim() });

  } catch (error) {
    console.error('transcribe-audio error:', error && error.message);
    return res.status(200).json({
      transcript: '',
      note: 'Transcription failed: ' + (error && error.message)
    });
  }
};
