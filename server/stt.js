/**
 * BoundBuild MVP — server-side speech-to-text.
 *
 * Architecture (brief's preferred path):
 *   phone mic → BoundBuild server → STT API → transcript → structuring pipeline
 *
 * v1 shipped with browser-side transcription (Web Speech API). This module adds
 * the server path: when STT is configured, the audio file uploaded from the
 * phone is transcribed here and the client falls back to browser transcription
 * only when the server has no STT configured or it errors.
 *
 * Providers:
 *   - 'whisper': OpenAI-compatible /audio/transcriptions endpoint
 *     (works with OpenAI, Groq, local Whisper servers — set STT_URL).
 */

const fs = require('fs');

async function transcribeAudio(filePath, filename) {
  // No STT configured → caller should fall back to browser-side transcription.
  if (!process.env.STT_PROVIDER || !process.env.OPENAI_API_KEY) {
    return { transcript: null, provider: 'browser' };
  }
  try {
    const url = process.env.STT_URL || 'https://api.openai.com/v1/audio/transcriptions';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'audio/webm' }), filename || 'recording.webm');
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    form.append('language', process.env.STT_LANGUAGE || 'en');
    form.append('response_format', 'json');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: form,
    });
    if (!res.ok) throw new Error(`STT HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = String(data.text || data.transcript || '').trim();
    if (!text) throw new Error('STT returned an empty transcript');
    return { transcript: text, provider: String(process.env.STT_PROVIDER).toLowerCase(), model: process.env.STT_MODEL || 'whisper-1' };
  } catch (e) {
    console.error('Server-side STT failed, client will fall back to browser STT:', e.message);
    return { transcript: null, provider: 'browser', error: e.message };
  }
}

module.exports = { transcribeAudio };
