/* ============================================================
   Interverse — client-side rate governor

   Groq's free tier counts tokens per MINUTE, input and output together,
   per organization. Exceeding it returns a 429 and the work is lost.

   Rather than fire requests and apologise afterwards, every AI call is
   paced through a rolling 60-second budget here. A request that doesn't
   fit waits for room instead of failing.

   Two separate buckets, because Groq meters each model independently:
     text   — the conversational model (llama-3.3-70b-versatile)
     vision — the multimodal model used for images and scanned pages

   So transcribing a scanned PDF never starves the interview itself.

   Estimates are corrected with the real usage the server reports back,
   so the bucket converges on the truth within a couple of calls.

   window.IVLimit.run(bucket, estimate, priority, fn)
   ============================================================ */
(function (global) {
  "use strict";

  var WINDOW_MS = 60000;
  // Starting guesses only — replaced by Groq's own x-ratelimit-limit-tokens on
  // the first successful call, so these just need to be conservative.
  var CAPS = { text: 8000, vision: 8000, small: 8000 };
  var SAFETY = 0.95;                            // real usage corrects the estimate, so we can run close

  var spent = { text: [], vision: [], small: [] };   // [{ at, tokens, id }]
  var queue = [];
  var running = false;
  var seq = 0;

  function prune(b) {
    var cut = Date.now() - WINDOW_MS;
    spent[b] = spent[b].filter(function (e) { return e.at > cut; });
  }

  function used(b) {
    prune(b);
    return spent[b].reduce(function (n, e) { return n + e.tokens; }, 0);
  }

  /* How long until `need` tokens free up in this bucket. */
  function waitFor(b, need) {
    var cap = Math.floor(CAPS[b] * SAFETY);
    if (need > cap) return 0;                   // bigger than the window allows; let it through and let the server trim
    var u = used(b);
    if (u + need <= cap) return 0;
    var freed = 0;
    var list = spent[b].slice().sort(function (x, y) { return x.at - y.at; });
    for (var i = 0; i < list.length; i++) {
      freed += list[i].tokens;
      if (u - freed + need <= cap) return Math.max(0, list[i].at + WINDOW_MS - Date.now()) + 250;
    }
    return WINDOW_MS;
  }

  function record(b, tokens) {
    var id = ++seq;
    spent[b].push({ at: Date.now(), tokens: tokens, id: id });
    return id;
  }

  /* Replace an estimate with what actually happened. */
  function correct(b, id, real) {
    for (var i = 0; i < spent[b].length; i++) {
      if (spent[b][i].id === id) { spent[b][i].tokens = real; return; }
    }
  }

  function pump() {
    if (running || !queue.length) return;
    // Highest priority first, then oldest — a conversational turn never
    // queues behind background analytics.
    queue.sort(function (a, b) { return (b.priority - a.priority) || (a.at - b.at); });
    var job = queue[0];
    var wait = waitFor(job.bucket, job.estimate);
    if (wait > 0) {
      if (job.onWait) { try { job.onWait(Math.ceil(wait / 1000)); } catch (e) {} }
      setTimeout(pump, Math.min(wait, 3000));
      return;
    }
    queue.shift();
    running = true;
    var id = record(job.bucket, job.estimate);
    Promise.resolve()
      .then(job.fn)
      .then(function (res) {
        var real = res && res.usage && Number(res.usage.total_tokens);
        if (real > 0) correct(job.bucket, id, real);
        // The server forwards Groq's own view of the bucket; trust it over ours.
        if (res && res.limit && Number(res.limit.limit_tokens) > 0)
          CAPS[job.bucket] = Number(res.limit.limit_tokens);
        if (res && res.limit && res.limit.remaining_tokens != null) {
          var remaining = Number(res.limit.remaining_tokens);
          var shouldHave = Math.max(0, CAPS[job.bucket] - remaining);
          var ours = used(job.bucket);
          if (shouldHave > ours) record(job.bucket, shouldHave - ours);   // we were under-counting
        }
        job.resolve(res);
      })
      .catch(function (e) {
        // A 429 means our accounting was wrong: assume the window is full and
        // hold everything until the server's retry-after has passed.
        if (e && e.retryAfter) {
          spent[job.bucket] = [{ at: Date.now() - WINDOW_MS + (e.retryAfter * 1000), tokens: CAPS[job.bucket], id: ++seq }];
        }
        job.reject(e);
      })
      .then(function () { running = false; setTimeout(pump, 60); });
  }

  function run(bucket, estimate, priority, fn, onWait) {
    if (!spent[bucket]) bucket = "text";
    return new Promise(function (resolve, reject) {
      queue.push({
        bucket: bucket, estimate: Math.max(200, estimate | 0), priority: priority || 0,
        fn: fn, resolve: resolve, reject: reject, at: Date.now(), onWait: onWait
      });
      pump();
    });
  }

  /* Vision models bill an image by area — roughly one token per 28x28 patch —
     and file size is a poor proxy, since JPEG compression varies by an order of
     magnitude with content. Both upload paths downscale to a known ceiling
     (1100px for photos, 1500px for rendered pages), so the worst case is about
     1500x1500/784 ≈ 2,900 tokens. Estimate near that and let the real usage
     reported by the server correct it after the first call — over-estimating
     costs a moment of pacing, under-estimating costs a 429. */
  function imageTokens() { return 2400; }

  function textTokens(s) { return Math.ceil(String(s == null ? "" : s).length / 3.6); }

  global.IVLimit = {
    run: run,
    imageTokens: imageTokens,
    textTokens: textTokens,
    status: function () {
      return { text: used("text"), vision: used("vision"), small: used("small"), caps: CAPS, queued: queue.length };
    }
  };
})(window);
