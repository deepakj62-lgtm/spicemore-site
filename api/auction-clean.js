/**
 * Auction Questionnaire — Transcript Cleanup
 *
 * POST /api/auction-clean
 *   Body: {
 *     transcript:   string (required — raw speech-to-text)
 *     questionId:   number (optional — 1..39, used as context)
 *     questionText: string (optional — question text in English, used as context)
 *     lang:         string (optional — BCP-47 tag: ml-IN | ta-IN | en-IN | hi-IN)
 *   }
 *   Returns: { cleanedText, original }
 *
 * Cleans up raw Web Speech transcripts. Critically, the cleaned output stays
 * in the SAME language the respondent spoke. No translation. So a Malayalam
 * answer is cleaned into readable Malayalam (native script), Tamil into Tamil,
 * Hindi into Hindi, English stays English. Claude Haiku preserves all specific
 * facts (names, numbers, percentages, places, codes) without adding anything
 * that wasn't said.
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
    const { transcript, questionId, questionText, lang } = req.body || {};
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    // Truncate very long transcripts defensively
    const safeTranscript = transcript.slice(0, 8000);
    const contextLine = questionText
      ? `\nThe respondent was answering this question: "${String(questionText).slice(0, 600)}"`
      : (questionId ? `\nThe respondent was answering question ${questionId} of the Spicemore auction questionnaire.` : '');

    // Language the respondent actually spoke — drives the OUTPUT language.
    // We do NOT translate. Malayalam in → Malayalam out, Tamil in → Tamil out, etc.
    const langMap = {
      'ml-IN': { name: 'Malayalam',  script: 'Malayalam script (മലയാളം)', demonym: 'Malayalam' },
      'ta-IN': { name: 'Tamil',      script: 'Tamil script (தமிழ்)',      demonym: 'Tamil' },
      'hi-IN': { name: 'Hindi',      script: 'Devanagari script (हिन्दी)', demonym: 'Hindi' },
      'en-IN': { name: 'English',    script: 'English (Latin script)',     demonym: 'English' }
    };
    const langInfo = langMap[lang] || langMap['ml-IN'];

    const prompt = `You are helping Spicemore (a cardamom spice trading and auction business in Kerala, India) clean up spoken answers from their auction / depot / accounts / compliance staff.

The raw transcript below came from a browser speech-to-text system. The respondent spoke in ${langInfo.name}. The transcript is often messy: words may be mis-transcribed phonetically, punctuation is missing, and English business terms (GST, TDS, Busy, RTGS, HSN, Spices Board, cardamom, Puttady, Vandanmedu, Bodinayakanur, Kumily, AGEB, auction, lot, consignor, etc.) may appear mixed in.
${contextLine}

Your job: produce a CLEAN, READABLE version of what the respondent said, IN THE SAME LANGUAGE THEY SPOKE (${langInfo.name}, written in ${langInfo.script}).

CRITICAL RULES:
1. DO NOT TRANSLATE. Output must be in ${langInfo.name} only. A Malayalam answer must stay in Malayalam. A Tamil answer must stay in Tamil. Do not render the answer in English.
2. If the speech-to-text captured words in the wrong script (e.g. Malayalam words typed in Roman letters), rewrite them in the proper ${langInfo.script}.
3. Preserve every specific fact exactly: names, numbers, percentages, quantities (MT / kg), prices, rates, addresses, depot names, license numbers, software names, day-of-week, frequency, HSN/SAC codes, GST/TDS section numbers, buyer/consignor types.
4. Keep English business terms as-is when they are commonly used in English by the staff (e.g. "GST", "TDS", "GSTIN", "Busy", "RTGS", "Spices Board", "lot number"). These don't need to be translated to ${langInfo.name}.
5. Do NOT add information that was not said. If something is unclear, write "[unclear]" inline.
6. Keep the original meaning and order. Do not editorialise or summarise aggressively. You may gently consolidate repetition.
7. Use short, natural ${langInfo.name} sentences with proper punctuation. Bullet points are fine if the answer lists several items.
8. Proper nouns (people, places) stay as pronounced, written in ${langInfo.script}.
9. Return ONLY the cleaned ${langInfo.name} text — no preamble, no "Here is the cleaned version:", no English translation, no quotes around it.

Raw transcript:
${safeTranscript}

Cleaned ${langInfo.name} text:`;

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
