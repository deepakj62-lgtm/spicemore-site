import { json, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const apiKey = env.ANTHROPIC_API_KEY;
  let body = {};
  try { body = await request.json(); } catch {}

  if (!apiKey) {
    return json({ cleanedText: '', original: body.transcript || '', note: 'LLM not configured' });
  }

  try {
    const { transcript, questionId, questionText, lang } = body;
    if (!transcript || !transcript.trim()) {
      return json({ error: 'Transcript is required' }, { status: 400 });
    }
    const safeTranscript = transcript.slice(0, 8000);
    const contextLine = questionText
      ? `\nThe respondent was answering this question: "${String(questionText).slice(0, 600)}"`
      : (questionId ? `\nThe respondent was answering question ${questionId} of the Spicemore auction questionnaire.` : '');

    const langMap = {
      'ml-IN': { name: 'Malayalam',  script: 'Malayalam script (മലയാളം)' },
      'ta-IN': { name: 'Tamil',      script: 'Tamil script (தமிழ்)' },
      'hi-IN': { name: 'Hindi',      script: 'Devanagari script (हिन्दी)' },
      'en-IN': { name: 'English',    script: 'English (Latin script)' }
    };
    const langInfo = langMap[lang] || langMap['ml-IN'];

    const prompt = `You are helping Spicemore (a cardamom spice trading and auction business in Kerala, India) clean up spoken answers from their auction / depot / accounts / compliance staff.

The raw transcript below came from a browser speech-to-text system. The respondent spoke in ${langInfo.name}.${contextLine}

Your job: produce a CLEAN, READABLE version of what the respondent said, IN THE SAME LANGUAGE THEY SPOKE (${langInfo.name}, written in ${langInfo.script}).

CRITICAL RULES:
1. DO NOT TRANSLATE. Output must be in ${langInfo.name} only.
2. If the speech-to-text captured words in the wrong script, rewrite them in the proper ${langInfo.script}.
3. Preserve every specific fact exactly: names, numbers, percentages, quantities (MT / kg), prices, rates, addresses, depot names, license numbers, software names, day-of-week, frequency, HSN/SAC codes, GST/TDS section numbers, buyer/consignor types.
4. Keep English business terms as-is when commonly used in English (GST, TDS, GSTIN, Busy, RTGS, Spices Board, lot number).
5. Do NOT add information that was not said. If unclear, write "[unclear]" inline.
6. Keep the original meaning and order.
7. Use short, natural ${langInfo.name} sentences with proper punctuation.
8. Proper nouns stay as pronounced, written in ${langInfo.script}.
9. Return ONLY the cleaned ${langInfo.name} text — no preamble, no quotes.

Raw transcript:
${safeTranscript}

Cleaned ${langInfo.name} text:`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('Anthropic API error:', response.status, errBody.slice(0, 300));
      return json({ cleanedText: '', original: transcript, note: 'LLM request failed' });
    }
    const data = await response.json();
    const cleaned = (data.content && data.content[0] && data.content[0].text || '').trim();
    return json({ cleanedText: cleaned, original: transcript });
  } catch (error) {
    console.error('auction-clean error:', error.message);
    return json({ cleanedText: '', original: body.transcript || '', note: 'error: ' + error.message });
  }
}
