/**
 * BoundBuild MVP — server-side speech-to-text.
 *
 * Architecture (brief's preferred path):
 *   phone mic → BoundBuild server → STT API → transcript → structuring pipeline
 *
 * Robustness strategy (v2):
 *   Phone browsers — especially iOS Safari — often produce audio that Whisper
 *   rejects (wrong container, corrupt headers, empty files). So before calling
 *   the STT API we ALWAYS normalize the file to a clean 16 kHz mono WAV using a
 *   bundled static ffmpeg. WAV is in Whisper's supported formats, so this
 *   eliminates the entire class of "Invalid file format" errors. If ffmpeg
 *   cannot decode the file at all, we return a precise, user-visible error.
 *
 * Providers:
 *   - 'whisper': OpenAI-compatible /audio/transcriptions endpoint
 *     (works with OpenAI, Groq, local Whisper servers — set STT_URL).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let FFMPEG_PATH = null;
try { FFMPEG_PATH = require('ffmpeg-static'); } catch (e) { /* optional */ }

/**
 * Detect the real audio container from magic bytes.
 * Returns: 'webm' | 'mp4' | 'ogg' | 'wav' | 'mp3' | 'caf' | null
 * (used for diagnostics/logging only — conversion handles the actual decoding)
 */
function sniffAudioExt(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (n < 4) return null;
    const ascii = (a, b) => buf.toString('ascii', a, b);
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
    if (n >= 8 && ascii(4, 8) === 'ftyp') return 'mp4';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (n >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (ascii(0, 3) === 'ID3') return 'mp3';
    if (ascii(0, 4) === 'caff') return 'caf';
    return null;
  } catch (e) {
    return null;
  }
}

/** Convert any decodable audio to a clean 16 kHz mono WAV in the temp dir. */
async function convertToWav(filePath) {
  const out = path.join(os.tmpdir(), `bb-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  try {
    await execFileAsync(
      FFMPEG_PATH,
      ['-y', '-i', filePath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    throw e;
  }
  return out;
}

async function transcribeAudio(filePath, filename) {
  // No STT configured → caller should fall back to browser-side transcription.
  if (!process.env.STT_PROVIDER || !process.env.OPENAI_API_KEY) {
    return { transcript: null, provider: 'browser' };
  }
  let convertedPath = null;
  try {
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch (e) { /* ignore */ }
    const container = sniffAudioExt(filePath);

    if (size < 44) {
      console.error(`Server-side STT: audio file too small to be real audio (${size}B)`);
      return { transcript: null, provider: 'browser', error: 'Recording came out empty — try again' };
    }

    let payloadPath = filePath;
    let payloadName = String(filename || 'recording.webm').replace(/[^\w.\-]/g, '_') || 'recording.webm';
    if (FFMPEG_PATH) {
      try {
        const wav = await convertToWav(filePath);
        convertedPath = wav;
        payloadPath = wav;
        payloadName = 'recording.wav';
      } catch (e) {
        const detail = String((e && (e.stderr || e.message)) || '').slice(0, 200);
        console.error(`Server-side STT: ffmpeg could not decode audio (${size}B, container=${container || '?'}): ${detail}`);
        return {
          transcript: null, provider: 'browser',
          error: 'Audio could not be read — try recording again, or type the description',
        };
      }
    } else {
      console.error(`Server-side STT: ffmpeg not available — sending original file (${size}B, container=${container || '?'})`);
    }

    const url = process.env.STT_URL || 'https://api.openai.com/v1/audio/transcriptions';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(payloadPath)], { type: 'audio/wav' }), payloadName);
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
      console.error(`Server-side STT failed (${size}B, container=${container || '?'}, converted=${!!convertedPath}): ${text}`);
      throw new Error(`STT HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const text = String(data.text || data.transcript || '').trim();
    if (!text) throw new Error('STT returned an empty transcript');
    return { transcript: text, provider: String(process.env.STT_PROVIDER).toLowerCase(), model: process.env.STT_MODEL || 'whisper-1' };
  } catch (e) {
    console.error('Server-side STT failed, client will fall back to browser STT:', e.message);
    return { transcript: null, provider: 'browser', error: e.message };
  } finally {
    if (convertedPath) { try { fs.unlinkSync(convertedPath); } catch (_) { /* ignore */ } }
  }
}

module.exports = { transcribeAudio, sniffAudioExt };
