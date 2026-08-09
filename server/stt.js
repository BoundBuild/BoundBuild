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
 *
 * Format safety: we sniff the file's actual container from its magic bytes
 * before sending it to Whisper. Phone browsers (especially iOS Safari) often
 * label recordings with the wrong MIME type or produce empty/corrupt files —
 * this catches that so Whisper never gets a mislabelled payload, and failures
 * log the file size + container so they're diagnosable.
 */

const fs = require('fs');

/**
 * Detect the real audio container from magic bytes.
 * Returns: 'webm' | 'mp4' | 'ogg' | 'wav' | 'mp3' | 'caf' | null
 */
function sniffAudioExt(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (n < 4) return null;
    const ascii = (a, b) => buf.toString('ascii', a, b);
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'; // EBML
    if (n >= 8 && ascii(4, 8) === 'ftyp') return 'mp4';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (n >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (ascii(0, 3) === 'ID3') return 'mp3';
    if (ascii(0, 4) === 'caff') return 'caf'; // iOS Core Audio Format — not supported by Whisper
    return null;
  } catch (e) {
    return null;
  }
}

async function transcribeAudio(filePath, filename) {
  // No STT configured → caller should fall back to browser-side transcription.
  if (!process.env.STT_PROVIDER || !process.env.OPENAI_API_KEY) {
    return { transcript: null, provider: 'browser' };
  }
  try {
    const size = fs.statSync(filePath).size;
    const container = sniffAudioExt(filePath);

    if (container === 'caf') {
      // iOS CAF container — Whisper can't read it. Tell the client to re-record
      // (the recorder now uses timeslice recording, which avoids CAF entirely).
      console.error(`Server-side STT: iOS CAF audio unsupported by Whisper (${size}B)`);
      return { transcript: null, provider: 'browser', error: 'iOS audio format unsupported — re-record the note' };
    }
    if (!container) {
      console.error(`Server-side STT: unrecognised audio container (${size}B) — sending with declared extension anyway`);
    }

    // Use the sniffed container for the filename we send to Whisper, so the
    // extension always matches the content.
    const safeName = String(filename || 'recording.webm').replace(/[^\w.\-]/g, '_');
    const base = safeName.replace(/\.[a-z0-9]+$/i, '') || 'recording';
    const uploadName = container ? `${base}.${container}` : safeName;

    const url = process.env.STT_URL || 'https://api.openai.com/v1/audio/transcriptions';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'audio/' + (container || 'webm') }), uploadName);
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    form.append('language', process.env.STT_LANGUAGE || 'en');
    form.append('response_format', 'json');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: form,
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      console.error(`Server-side STT failed (${size}B, container=${container || '?'}): ${text}`);
      throw new Error(`STT HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const text = String(data.text || data.transcript || '').trim();
    if (!text) throw new Error('STT returned an empty transcript');
    return { transcript: text, provider: String(process.env.STT_PROVIDER).toLowerCase(), model: process.env.STT_MODEL || 'whisper-1' };
  } catch (e) {
    console.error('Server-side STT failed, client will fall back to browser STT:', e.message);
    return { transcript: null, provider: 'browser', error: e.message };
  }
}

module.exports = { transcribeAudio, sniffAudioExt };
