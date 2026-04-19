/**
 * Auction Questionnaire — Transcript Cleanup
 *
 * POST /api/auction-clean
 *   Body: {
 *     transcript:   string (required — raw speech-to-text)
 *     questionId:   number (optional — 1..39, used as context)
 *     questionText: string (optional — question text in English, used as context)
 *   }
 *   Returns: { cleanedText, original }
 *
 * Respondents may speak in a mix of Malayalam, Tamil, English, and Hindi.
 * Web Speech API output is often messy with code-switching. This endpoint
 * asks Claude Haiku to produce a clean English version that preserves all
 * specific facts (names, numbers, percentages, place names, codes, etc.)
 * without adding anything that wasn't said.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Soft failure so frontend can fall back to raw transcript
    return res.status(200).json({ cleanedText: '', original: (req.body && req.body.transcript) || '', note: 'LLM not configured' });
  }

  try {
    const { transcript, questionId, questionText } = req.body || {};
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    // Truncate very long transcripts defensively
    const safeTranscript = transcript.slice(0, 8000);
    const contextLine = questionText
      ? `\nThe respondent was answering this question: "${String(questionText).slice(0, 600)}"`
      : (questionId ? `\nThe respondent was answering question ${questionId} of the Spicemore auction questionnaire.` : '');

    const prompt = `You are helping Spicemore (a cardamom spice trading and auction business in Kerala, India) understand spoken answers from their auction / depot / accounts / compliance staff.

The raw transcript below came from a browser speech-to-text system. The respondent likely spoke in a mix of Malayalam, Tamil, English, and/or Hindi. The transcript is often messy: words may be mis-transcribed phonetically, languages get mixed mid-sentence, English business terms (GST, TDS, Busy, RTGS, HSN, Spices Board, cardamom, Puttady, Vandanmedu, Bodinayakanur, Kumily, AGEB, auction, lot, consignor, etc.) may appear in native script or Romanised form.
${contextLine}

Produce a clean, clear English version of what the respondent said. Rules:
1. Preserve every specific fact: names, numbers, percentages, quantities (MT / kg), prices, rates, addresses, depot names, license numbers, software names, day-of-week, frequency, HSN/SAC codes, GST/TDS section numbers, buyer/consignor types.
2. Do NOT add information that was not said. If something is unclear, write "[unclear]" inline.
3. Keep the original meaning and order. Do not editorialise.
4. If the respondent rambled or repeated themselves, you may gently consolidate, but do not summarise aggressively.
5. Keep English business terms as-is (e.g., "Spices Board", "GSTIN", "Busy accounting").
6. Use short, plain English sentences. Bullet points are fine if the answer lists several items.
7. Do NOT translate proper nouns into English unnecessarily (place names, people names stay as pronounced).
8. Return ONLY the cleaned English text — no preamble, no "Here is the cleaned version:", no quotes around it.

Raw transcript:
${safeTranscript}

Cleaned English text:`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('Anthropic API error:', response.status, errBody.slice(0, 300));
      // Soft-fail so frontend still works with raw transcript
      return res.status(200).json({ cleanedText: '', original: transcript, note: 'LLM request failed' });
    }

    const data = await response.json();
    const cleaned = (data.content && data.content[0] && data.content[0].text || '').trim();
    return res.status(200).json({ cleanedText: cleaned, original: transcript });

  } catch (error) {
    console.error('auction-clean error:', error.message);
    return res.status(200).json({ cleanedText: '', original: (req.body && req.body.transcript) || '', note: 'error: ' + error.message });
  }
};
