/* ============================================================
   Interverse — continuous audio capture

   WHY THIS EXISTS

   The Web Speech API is not a recorder. It decides on its own when an
   "utterance" has ended — usually after a few seconds of quiet — and hands
   back control. Restarting it costs several hundred milliseconds during which
   the microphone is not captured at all, so whatever is said in that window is
   gone, with no error and nothing in the transcript to show for it.

   That is why answers were cut off mid-sentence, and it cannot be fixed from
   the client: a new recognition session can't begin until the old one ends.
   The gap is structural.

   MediaRecorder has no concept of an utterance. It captures from tap to tap,
   through any length of pause, and hands back one continuous clip. Web Speech
   keeps running for the live caption — watching words appear is what makes the
   session feel alive — but it is now cosmetic. When it stutters, the recording
   didn't, and the transcript that gets scored is still whole.

   The AnalyserNode tap is doing a second job: detecting the first moment real
   speech begins. That drives the think-clock, which previously depended on Web
   Speech firing a result — so on a browser where Web Speech never fires at all,
   the pause measurement still works.

   window.IVRec.start() / .stop() / .isRecording() / .peak()
   ============================================================ */
(function (global) {
  "use strict";

  // Opus at this rate is clear for speech and keeps a two-minute answer well
  // under the request body limit.
  var BITS = 28000;
  // Above this RMS, someone is talking rather than breathing near the mic.
  var SPEECH_RMS = 0.018;
  // Speech has to hold for this long to count, so a cough or a chair scrape
  // doesn't stop the think-clock.
  var SPEECH_HOLD_MS = 140;

  var stream = null;          // kept alive between answers: re-prompting per turn is jarring
  var recorder = null;
  var chunks = [];
  var audioCtx = null, analyser = null, meterTimer = null, buf = null;
  var loudSince = 0, peakSeen = 0, onSpeech = null, smoothed = 0, quietFrames = 0;

  function pickMime() {
    if (!global.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var options = [
      "audio/webm;codecs=opus",   // Chrome, Edge, Firefox
      "audio/webm",
      "audio/ogg;codecs=opus",    // older Firefox
      "audio/mp4",                // Safari
      "audio/mp4;codecs=mp4a.40.2"
    ];
    for (var i = 0; i < options.length; i++)
      if (MediaRecorder.isTypeSupported(options[i])) return options[i];
    return "";
  }

  function supported() {
    return !!(global.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async function getStream() {
    if (stream && stream.active) return stream;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Interviews get practised in noisy rooms and on laptop mics.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    return stream;
  }

  /* Watch the level so we know when speech actually starts, and so a clip that
     is nothing but silence can be rejected before it reaches Whisper — which
     invents stock phrases when handed nothing. */
  function startMeter(src) {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var node = audioCtx.createMediaStreamSource(src);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      node.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      loudSince = 0; peakSeen = 0; smoothed = 0; quietFrames = 0;

      meterTimer = setInterval(function () {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        var rms = Math.sqrt(sum / buf.length);
        if (rms > peakSeen) peakSeen = rms;

        // Real speech dips between syllables — a raw sample drops below the
        // threshold several times a second. Smoothing, plus a few frames of
        // tolerance, means the onset fires on the start of speaking rather
        // than needing an unbroken 140ms of level that speech never provides.
        smoothed = smoothed * 0.65 + rms * 0.35;

        if (smoothed >= SPEECH_RMS) {
          quietFrames = 0;
          if (!loudSince) loudSince = Date.now();
          else if (onSpeech && Date.now() - loudSince >= SPEECH_HOLD_MS) {
            var fn = onSpeech, began = loudSince;
            onSpeech = null;                      // fire once per answer
            // Report when speech BEGAN, not when the hold elapsed, or every
            // pause measurement reads a fifth of a second too long.
            try { fn(began); } catch (e) {}
          }
        } else if (++quietFrames > 4) {
          loudSince = 0;
        }
      }, 50);
    } catch (e) { /* metering is a bonus; recording still works without it */ }
  }

  function stopMeter() {
    if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
    analyser = null; buf = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
  }

  /* start({ onSpeechStart }) — resolves true once capture is running. */
  async function start(opts) {
    if (!supported()) return false;
    opts = opts || {};
    onSpeech = opts.onSpeechStart || null;
    try {
      var s = await getStream();
      var mime = pickMime();
      chunks = [];
      recorder = mime
        ? new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: BITS })
        : new MediaRecorder(s);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      // A timeslice means a browser tab suspension loses one second, not the
      // whole answer.
      recorder.start(1000);
      startMeter(s);
      return true;
    } catch (e) {
      console.warn("[rec] couldn't start:", e.message);
      recorder = null;
      return false;
    }
  }

  /* stop() — resolves { blob, mime, peak, ms } or null. */
  function stop() {
    return new Promise(function (resolve) {
      var r = recorder;
      recorder = null;
      var peak = peakSeen;
      stopMeter();
      if (!r || r.state === "inactive") { resolve(null); return; }

      var startedAt = Date.now();
      r.onstop = function () {
        var type = r.mimeType || "audio/webm";
        var blob = chunks.length ? new Blob(chunks, { type: type }) : null;
        chunks = [];
        resolve(blob && blob.size ? { blob: blob, mime: type, peak: peak, ms: Date.now() - startedAt } : null);
      };
      try { r.stop(); } catch (e) { resolve(null); }
      // If onstop never fires (it happens on some mobile browsers), don't hang
      // the answer forever — fall through to the Web Speech transcript.
      setTimeout(function () { resolve(null); }, 4000);
    });
  }

  /* Let go of the microphone at the end of a session so the tab's recording
     indicator switches off. */
  function release() {
    stopMeter();
    if (recorder) { try { recorder.stop(); } catch (e) {} recorder = null; }
    if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
    chunks = [];
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error("Couldn't read the recording")); };
      fr.readAsDataURL(blob);
    });
  }

  global.IVRec = {
    supported: supported,
    start: start,
    stop: stop,
    release: release,
    isRecording: function () { return !!recorder && recorder.state === "recording"; },
    peak: function () { return peakSeen; },
    blobToDataUrl: blobToDataUrl,
    SPEECH_RMS: SPEECH_RMS
  };
})(window);
