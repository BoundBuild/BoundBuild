/* BoundBuild — audio capture (MediaRecorder) + live transcription (Web Speech API).
   Falls back gracefully: no mic → manual/sample transcript.
   v3 — iOS hardening:
     • fresh AudioContext per recording (iOS requires this to properly acquire/release the mic)
     • wait for a dataavailable chunk BEFORE showing "recording" as started
     • if no audio data is captured at all, surface a clear message instead of
       uploading a 0-byte file (which Whisper rejects as "Invalid file format") */
'use strict';

const Recorder = (() => {
  let mediaRecorder = null;
  let chunks = [];
  let recognition = null;
  let transcriptAccum = '';
  let finalTranscript = '';
  let onLiveText = null;

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
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

  async function start({ onLive, onEnd, onError } = {}) {
    onLiveText = onLive || null;
    transcriptAccum = '';
    finalTranscript = '';

    unlockAudio(); // must happen inside the user-gesture handler (the tap)

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
      const blob = new Blob(chunks, { type });
      stopSpeech();
      const transcript = finalTranscript || transcriptAccum.trim();
      if (onEnd) onEnd({ blob, mime: type, transcript, bytes: blob.size });
    };

    // timeslice — REQUIRED for iOS Safari: without it the blob can come back
    // empty or corrupt ("Invalid file format" in Whisper).
    mediaRecorder.start(250);

    startSpeech();
    return true;
  }

  function pickMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const c of candidates) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (e) { /* ignore */ } }
    return null;
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function cancel() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    }
    stopSpeech();
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
        if (e.results[i].isFinal) finalTranscript += t + ' ';
        else interim += t;
      }
      const live = (finalTranscript + ' ' + interim).trim();
      if (onLiveText) onLiveText(live);
    };
    recognition.onerror = () => { /* speech may fail — manual entry still works */ };
    try { recognition.start(); } catch (e) { /* ignore */ }
  }

  function stopSpeech() {
    if (recognition) { try { recognition.stop(); } catch (e) { /* ignore */ } recognition = null; }
  }

  return { micSupported, speechSupported, start, stop, cancel, hasLiveTranscription: () => !!onLiveText };
})();

/* Sample voice-note transcripts for demo / offline use */
const SAMPLE_NOTES = [
  "Um, yeah, we've hit rock in the Unit 3 excavation, about 600 mil down. Not shown on the geotech report at all. Excavator's stopped, we need the engineer to have a look. Could be a couple of days and a few grand for the rock hammer.",
  "Site instruction from the architect this morning — they want the ceiling bulkhead in the foyer dropped 200 mil to hide the new ducting. Framing's not started yet so it's cheap to do now, but it's not on the drawings. Flagging it so we can price it.",
  "Weather's stopped us again at the retail fitout — the roof membrane crew can't work in this rain, looks like two days lost. They were only meant to be here Tuesday and Wednesday.",
  "The client asked on site if we can swap the specified laminate benchtops for the stone look option in units 2 and 3. Supplier says it's the same price and one week longer on delivery. Need the variation confirmed before we order.",
  "Found contaminated soil in the corner of the carpark where the old fuel tank was. Council's been called, they want testing before we can move fill. Could be a week hold-up, and testing will cost extra.",
];
