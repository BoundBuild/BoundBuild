/* BoundBuild — audio capture.
   v6 — PARALLEL capture (single-file fix, works with the existing app.js unchanged):
     • Starts MediaRecorder (webm) AND a Web Audio → WAV recorder SIMULTANEOUSLY
       on the same microphone stream.
     • On stop, it uses whichever produced real audio (prefers the webm; falls
       back to the WAV — which Whisper always accepts).
     • This eliminates the iOS bug where MediaRecorder silently produces an
       empty 0-byte blob: even if that happens, the parallel WAV capture has
       the audio, and the app never receives an empty file.
   No app.js changes required. */
'use strict';

const Recorder = (() => {
  let active = null;            // current capture session
  let recognition = null;
  let onLiveText = null;
  let finalTranscriptAccum = '';

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function mediaRecSupported() {
    return !!(window.MediaRecorder && micSupported());
  }
  function webaudioSupported() {
    return !!(micSupported() && (window.AudioContext || window.webkitAudioContext));
  }
  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /** iOS quirk: touching the AudioContext on user-gesture unlocks audio input. */
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        if (ctx.state === 'suspended') ctx.resume();
        setTimeout(() => { try { ctx.close(); } catch (e) { /* ignore */ } }, 800);
      }
    } catch (e) { /* ignore */ }
  }

  function pickMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const c of candidates) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (e) { /* ignore */ } }
    return null;
  }

  /**
   * opts: { onLive, onEnd }
   * onEnd({ blob, mime, bytes, transcript }) — always called with the result.
   */
  function start(opts = {}) {
    onLiveText = opts.onLive || null;
    const onEnd = opts.onEnd || (() => {});

    return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      unlockAudio();

      const rec = {
        stream,
        media: null, mediaChunks: [],
        audio: null, wavChunks: [],
        stopped: false,
        _onEnd: onEnd,
      };

      /* 1) MediaRecorder — preferred format (smaller uploads) */
      if (mediaRecSupported()) {
        try {
          const mime = pickMime();
          const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
          mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.mediaChunks.push(e.data); };
          mr.start(250); // timeslice — REQUIRED for iOS Safari
          rec.media = mr;
        } catch (e) { rec.media = null; }
      }

      /* 2) Web Audio → WAV — the reliability backbone (parallel capture) */
      if (webaudioSupported()) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = new AC();
          const source = ctx.createMediaStreamSource(stream);
          const proc = ctx.createScriptProcessor(4096, 1, 1);
          proc.onaudioprocess = (e) => {
            if (!active || active !== rec || rec.stopped) return;
            rec.wavChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
          };
          source.connect(proc); // NOT connected to destination — no echo/feedback
          rec.audio = { ctx, source, proc };
        } catch (e) { rec.audio = null; }
      }

      active = rec;
      startSpeech();
      return true;
    });
  }

  function stop() {
    const rec = active;
    if (!rec) return;
    active = null;
    rec.stopped = true;
    stopSpeech();

    /* Stop WebAudio capture immediately and freeze the WAV chunks. */
    if (rec.audio) {
      try { rec.audio.proc.disconnect(); rec.audio.source.disconnect(); rec.audio.ctx.close(); } catch (e) { /* ignore */ }
    }
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }

    /* Stop MediaRecorder (async onstop) — finish when it reports done. */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      deliver(rec, rec._onEnd || (() => {}));
    };
    if (rec.media) {
      rec.media.onstop = finish;
      try { rec.media.stop(); } catch (e) { finish(); }
    } else {
      finish();
    }
  }

  /* Capture the onEnd callback (stored on the session when started). */
  const onEndOf = (rec) => rec._onEnd || (() => {});

  function deliver(rec, onEnd) {    /* Prefer MediaRecorder audio if it captured real data. */
    if (rec.media && rec.mediaChunks.length) {
      const blob = new Blob(rec.mediaChunks, { type: (rec.media.mimeType) || 'audio/webm' });
      if (blob.size >= 1000) {
        onEnd({ blob, mime: blob.type, bytes: blob.size, transcript: takeFinalTranscript() });
        return;
      }
    }
    /* Otherwise use the Web Audio WAV capture (always valid for Whisper). */
    let total = 0;
    for (const c of rec.wavChunks) total += c.length;
    if (total > 0) {
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of rec.wavChunks) { merged.set(c, off); off += c.length; }
      const wav = encodeWavPCM(merged, 16000);
      const blob = new Blob([wav], { type: 'audio/wav' });
      onEnd({ blob, mime: 'audio/wav', bytes: wav.byteLength, transcript: takeFinalTranscript() });
      return;
    }
    /* Nothing captured at all — deliver an empty result (app shows the message). */
    onEnd({ blob: new Blob([], { type: 'audio/webm' }), mime: 'audio/webm', bytes: 0, transcript: takeFinalTranscript() });
  }

  function cancel() {
    const rec = active;
    if (!rec) return;
    active = null;
    rec.stopped = true;
    stopSpeech();
    if (rec.media) { try { rec.media.onstop = null; rec.media.stop(); } catch (e) { /* ignore */ } }
    if (rec.audio) { try { rec.audio.proc.disconnect(); rec.audio.source.disconnect(); rec.audio.ctx.close(); } catch (e) { /* ignore */ } }
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
  }

  /** Encode Float32 mono samples → 16-bit PCM WAV (44-byte header). */
  function encodeWavPCM(samples, sampleRate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buf);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wstr(36, 'data'); view.setUint32(40, samples.length * 2, true);
    let p = 44;
    for (let i = 0; i < samples.length; i++, p += 2) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  function startSpeech() {
    if (!speechSupported()) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'en-NZ';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscriptAccum += t + ' ';
        else interim += t;
      }
      const live = (finalTranscriptAccum + ' ' + interim).trim();
      if (onLiveText) onLiveText(live);
    };
    recognition.onerror = () => { /* speech may fail — manual entry still works */ };
    try { recognition.start(); } catch (e) { /* ignore */ }
  }
  function stopSpeech() {
    if (recognition) { try { recognition.stop(); } catch (e) { /* ignore */ } recognition = null; }
  }
  function takeFinalTranscript() {
    const t = finalTranscriptAccum;
    finalTranscriptAccum = '';
    return t;
  }

  return {
    micSupported, mediaRecSupported, webaudioSupported, speechSupported,
    start, stop, cancel,
    hasLiveTranscription: () => !!onLiveText,
  };
})();

/* Sample voice-note transcripts for demo / offline use */
const SAMPLE_NOTES = [
  "Um, yeah, we've hit rock in the Unit 3 excavation, about 600 mil down. Not shown on the geotech report at all. Excavator's stopped, we need the engineer to have a look. Could be a couple of days and a few grand for the rock hammer.",
  "Site instruction from the architect this morning — they want the ceiling bulkhead in the foyer dropped 200 mil to hide the new ducting. Framing's not started yet so it's cheap to do now, but it's not on the drawings. Flagging it so we can price it.",
  "Weather's stopped us again at the retail fitout — the roof membrane crew can't work in this rain, looks like two days lost. They were only meant to be here Tuesday and Wednesday.",
  "The client asked on site if we can swap the specified laminate benchtops for the stone look option in units 2 and 3. Supplier says it's the same price and one week longer on delivery. Need the variation confirmed before we order.",
  "Found contaminated soil in the corner of the carpark where the old fuel tank was. Council's been called, they want testing before we can move fill. Could be a week hold-up, and testing will cost extra.",
];
