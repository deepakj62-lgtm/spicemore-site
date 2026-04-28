import { json, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'LLM not configured', detail: 'ANTHROPIC_API_KEY not set' }, { status: 501 });

  try {
    const { transcript, fileNames } = await request.json();
    if (!transcript || !transcript.trim()) return json({ error: 'No transcript provided' }, { status: 400 });

    const fileContext = fileNames && fileNames.length
      ? `\nThe user has uploaded these files: ${fileNames.join(', ')}` : '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are an assistant that converts raw voice transcripts into clear, structured English instructions for a software feature request system at Spice More Trading Company (a spice trading business in Kerala, India).

The transcript below was spoken in a mix of Malayalam, Tamil, Hindi, and/or English. It describes what changes or new functionality the speaker wants built.
${fileContext}

Convert this into clear, actionable English instructions. Preserve all specific details (file names, column names, business rules, conditions). Structure the output as numbered steps or bullet points where appropriate. If the speaker referenced any uploaded files, mention them by name.

Do NOT add information that wasn't in the transcript. If something is unclear, note it as "[needs clarification]".

Raw transcript:
${transcript}

Clean English instructions:`
        }]
      })
    });
    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic API error:', response.status, errBody);
      return json({ error: 'LLM request failed', status: response.status }, { status: 502 });
    }
    const data = await response.json();
    const instructions = data.content[0].text.trim();
    return json({ instructions });
  } catch (error) {
    console.error('Transcribe-clean error:', error.message);
    return json({ error: 'Failed to process transcript', detail: error.message }, { status: 500 });
  }
}
