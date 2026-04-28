import { json, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return json({ error: 'Transcription not configured', detail: 'GROQ_API_KEY not set' }, { status: 501 });

  try {
    const { audioBase64, mimeType, lang } = await request.json().catch(() => ({}));
    if (!audioBase64) return json({ transcript: '', note: 'No audio provided' }, { status: 400 });

    const buf = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const effectiveMime = mimeType || 'audio/webm';
    const ext = effectiveMime.includes('mp4') ? 'mp4'
              : effectiveMime.includes('ogg') ? 'ogg'
              : effectiveMime.includes('wav') ? 'wav'
              : effectiveMime.includes('mpeg') ? 'mp3'
              : 'webm';

    const form = new FormData();
    const blob = new Blob([buf], { type: effectiveMime });
    form.append('file', blob, `audio.${ext}`);
    form.append('model', 'whisper-large-v3');
    if (lang && typeof lang === 'string' && lang.length <= 5) form.append('language', lang);
    form.append('response_format', 'json');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('Groq transcription error:', resp.status, errBody);
      return json({ transcript: '', note: `Transcription service returned ${resp.status}` });
    }
    const data = await resp.json();
    return json({ transcript: (data.text || '').trim() });
  } catch (error) {
    console.error('transcribe-audio error:', error && error.message);
    return json({ transcript: '', note: 'Transcription failed: ' + (error && error.message) });
  }
}
