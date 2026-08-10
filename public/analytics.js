/* ============================================================
   Interverse — Answer Analytics
   Zero dependencies. No server changes. Reuses the /chat proxy.

   Fits the app's render model: everything returns an HTML string,
   because render() rebuilds #view.innerHTML on every turn.

   API (window.IVAnalytics):
     init({ apiFn, onUpdate })   apiFn = the app's api(); onUpdate = render
     reset()                     new session
     startAnswer()               mic opens
     endAnswer(question, text)   answer finalised -> scores it in the background
     liveHtml()                  panel for sessionHtml()
     reportHtml()                full graph for feedbackHtml()
     summary() / serialize() / hydrate(obj)
   ============================================================ */
(function (global) {
  "use strict";

  var LANES = [
    { key: "context",  label: "Context",  color: "#A8B2BC" },
    { key: "problem",  label: "Problem",  color: "#B97A16" },
    { key: "solution", label: "Solution", color: "#136F63" },
    { key: "tangent",  label: "Tangent",  color: "#D6453D" }
  ];
  var LANE_INDEX = { context: 0, problem: 1, solution: 2, tangent: 3, meta: 3 };
  var DRIFT_COLOR = "#D6453D";

  var answers = [];
  var answerStart = 0;
  var apiFn = null;
  var onUpdate = function () {};

  /* ---------- styles, injected once ---------- */
  function injectStyles() {
    if (document.getElementById("iv-an-css")) return;
    var s = document.createElement("style");
    s.id = "iv-an-css";
    s.textContent = [
      ".iv-an{margin-top:14px}",
      ".iv-an-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}",
      ".iv-an-scroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:2px}",
      ".iv-an-key{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--mut,#66707D)}",
      ".iv-an-key i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px;font-style:normal}",
      ".iv-an-stats{display:flex;gap:20px;flex-wrap:wrap;margin-top:12px}",
      ".iv-an-stat b{display:block;font-size:19px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}",
      ".iv-an-stat span{display:block;font-size:11px;color:var(--mut,#66707D);margin-top:1px}",
      ".iv-an-row{padding:12px 0;border-top:1px solid var(--line,#D9DEE6)}",
      ".iv-an-row:first-of-type{border-top:none;padding-top:2px}",
      ".iv-an-rowtop{display:flex;align-items:baseline;justify-content:space-between;gap:14px}",
      ".iv-an-q{font-size:13.5px;line-height:1.4}",
      ".iv-an-q b{font-weight:600;margin-right:5px}",
      ".iv-an-d{display:flex;align-items:center;gap:7px;flex:none;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:#D6453D}",
      ".iv-an-d u{text-decoration:none;display:block;width:56px;height:5px;border-radius:3px;background:var(--mist,#ECEFF3);overflow:hidden}",
      ".iv-an-d u>i{display:block;height:100%;border-radius:3px;background:#D6453D}",
      ".iv-an-quote{font-size:12.5px;line-height:1.5;color:var(--ink,#1F2A37);margin-top:6px;padding-left:11px;border-left:2px solid #D6453D;opacity:.85}",
      ".iv-an-note{font-size:12.5px;color:var(--mut,#66707D);line-height:1.5}"
    ].join("");
    document.head.appendChild(s);
  }

  /* ---------- helpers ---------- */
  function clamp(n, lo, hi) { n = Number(n); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function avg(list, key) {
    var v = list.filter(function (a) { return typeof a[key] === "number"; });
    return v.length ? Math.round(v.reduce(function (s, a) { return s + a[key]; }, 0) / v.length) : null;
  }
  function scored() { return answers.filter(function (a) { return !a.failed; }); }

  /* Same guard the live tips use: a quote is only shown if the candidate
     actually said it. Models paraphrase under pressure. */
  function norm(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function verifyQuote(q, source) {
    var nq = norm(q);
    if (!nq || nq.split(" ").length < 3) return "";
    return norm(source).indexOf(nq) === -1 ? "" : String(q).trim();
  }

  /* Instant local pass so a block appears the moment the answer ends.
     The model result replaces it a second or two later. */
  var HEDGES = /\b(maybe|probably|i think|i guess|sort of|kind of|somewhat|perhaps|possibly|not sure|might be|i feel like)\b/gi;
  var FILLER = /\b(um|uh|you know|basically|actually|literally|i mean)\b/gi;
  var VAGUE  = /\b(it|this|that|they|those|these|thing|things|stuff)\b/gi;

  function heuristics(text) {
    var words = (text.match(/\S+/g) || []).length || 1;
    var sents = text.split(/[.!?]+\s/).filter(function (s) { return s.trim().length > 3; }).length || 1;
    var p = function (re) { return ((text.match(re) || []).length * 100) / words; };
    var nums = (text.match(/\b\d[\d.,%]*\b/g) || []).length;
    return {
      confidence:  Math.round(clamp(82 - p(HEDGES) * 9 - p(FILLER) * 5, 5, 95)),
      clarity:     Math.round(clamp(80 - p(VAGUE) * 3.2 - Math.max(0, words / sents - 26) * 1.4, 5, 95)),
      specificity: Math.round(clamp(28 + nums * 9, 5, 95))
    };
  }

  /* ---------- scoring call ---------- */
  var SYSTEM = [
    "You score one interview answer. Reply with ONE JSON object and nothing else. No prose, no code fences.",
    "",
    '{"segments":[{"role":"context|problem|solution|tangent","share":0-100,"quote":"verbatim words"}],',
    '"drift":0-100,"drift_note":"short reason","clarity":0-100,"confidence":0-100,"specificity":0-100,',
    '"structure":0-100,"optimism":0-100,"coverage":0-100,"answered":true|false,',
    '"missing":["short phrase"]}',
    "",
    "- segments: split the answer in speaking order, shares summing to 100, max 6.",
    "- quote: 4-12 words copied EXACTLY from the answer, marking where that segment starts.",
    "  Never paraphrase and never invent words that are not in the answer.",
    "- drift_note: 3-8 words naming what pulled them off, e.g. \"retold the team history\"",
    '  or "repeated the setup from Q1". Empty string if the answer stayed on question.',
    "  context = background/setup. problem = the actual difficulty. solution = what they did or propose.",
    "  tangent = anything off the question asked, including repeating a point already made.",
    "- drift: how far the answer wandered from the question. 0 = locked on.",
    "- clarity: unambiguous pronouns, claim before support, no contradictions.",
    "- confidence: commitment in the language. Hedging and self-correction lower it.",
    "- specificity: named tools, numbers with units, concrete instances. Jargon alone does not count.",
    "- structure: signposting, and whether announced lists were finished.",
    "- optimism: on setbacks, temporary and specific causes plus agency. Score 50 if no setback came up.",
    "- coverage: how completely the question was actually addressed.",
    "- answered: false if they deflected, changed the subject, or said they did not know.",
    '- missing: up to 3 short phrases naming what a strong answer had that this one lacked, e.g.',
    '  "no outcome or result", "no metric", "their own role unclear". Empty array if nothing is missing.'
  ].join("\n");

  function parseLoose(text) {
    try {
      var c = String(text || "").replace(/```json|```/g, "").trim();
      return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
    } catch (e) { return null; }
  }

  function analyze(rec) {
    if (!apiFn) { rec.provisional = false; rec.failed = true; return; }
    apiFn("/chat", "POST", {
      system: SYSTEM,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: "QUESTION:\n" + (rec.q || "(open conversation)") +
                 "\n\nANSWER (" + Math.round(rec.seconds) + "s spoken):\n" + rec.a
      }]
    }).then(function (r) {
      var j = parseLoose(r && r.text);
      if (!j) throw new Error("unparseable");
      var segs = Array.isArray(j.segments) && j.segments.length ? j.segments : [{ role: "context", share: 100 }];
      var total = segs.reduce(function (s, x) { return s + (Number(x.share) || 0); }, 0) || 100;
      rec.segments = segs.slice(0, 6).map(function (x) {
        var role = String(x.role || "context").toLowerCase();
        if (!(role in LANE_INDEX)) role = "context";
        return {
          role: role,
          seconds: rec.seconds * ((Number(x.share) || 0) / total),
          quote: verifyQuote(x.quote, rec.a)
        };
      });
      rec.driftNote = String(j.drift_note || "").trim().slice(0, 80);
      ["drift", "clarity", "confidence", "specificity", "structure", "optimism", "coverage"]
        .forEach(function (k) { if (j[k] != null) rec[k] = clamp(j[k], 0, 100); });
      rec.answered = j.answered !== false;
      rec.missing = (Array.isArray(j.missing) ? j.missing : []).slice(0, 3).map(String);
      rec.provisional = false;
    }).catch(function (e) {
      // Never disturb the session. Keep heuristic scores, mark unscored.
      console.warn("[iv-analytics]", e && e.message);
      rec.provisional = false;
      rec.failed = true;
    }).then(function () {
      // Don't yank a re-render out from under someone mid-typing.
      var a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
      try { onUpdate(); } catch (e) {}
    });
  }

  /* ---------- swimlane ---------- */
  function swimlane(opts) {
    opts = opts || {};
    var labelW = 64, rowH = opts.rowH || 22, gap = 6, pad = 6, driftH = 28;
    var colMin = opts.colMin || 44, colMax = opts.colMax || 130;

    var maxSec = Math.max.apply(null, answers.map(function (r) { return r.seconds || 1; }).concat([20]));
    var cols = answers.map(function (r) {
      return clamp(colMin + (colMax - colMin) * ((r.seconds || 1) / maxSec), colMin, colMax);
    });
    var W = labelW + cols.reduce(function (s, w) { return s + w + gap; }, 0) + 14;
    if (W < labelW + 160) W = labelW + 160;
    var lanesH = LANES.length * (rowH + gap) - gap;
    var H = pad + lanesH + 14 + driftH + 14;

    var o = ['<svg width="' + Math.round(W) + '" height="' + Math.round(H) + '" viewBox="0 0 ' +
      Math.round(W) + ' ' + Math.round(H) + '" role="img" aria-label="Where each answer went, by lane">'];

    LANES.forEach(function (ln, i) {
      var y = pad + i * (rowH + gap);
      o.push('<rect x="' + labelW + '" y="' + y + '" width="' + (W - labelW - 10) + '" height="' + rowH +
        '" rx="4" fill="#F5F7FA"/>');
      o.push('<text x="' + (labelW - 8) + '" y="' + (y + rowH / 2) + '" text-anchor="end" dominant-baseline="central" font-size="11" fill="#66707D">' + ln.label + "</text>");
    });

    var x = labelW + 4;
    answers.forEach(function (r, qi) {
      var colW = cols[qi];
      var segs = (r.segments && r.segments.length) ? r.segments : [{ role: "context", seconds: r.seconds || 1 }];
      var tot = segs.reduce(function (s, g) { return s + (g.seconds || 0); }, 0) || 1;
      var sx = x;
      segs.forEach(function (g) {
        var w = Math.max(3, (colW - 2) * ((g.seconds || 0) / tot));
        var li = LANE_INDEX[g.role] != null ? LANE_INDEX[g.role] : 0;
        o.push('<rect x="' + sx.toFixed(1) + '" y="' + (pad + li * (rowH + gap) + 3) + '" width="' + w.toFixed(1) +
          '" height="' + (rowH - 6) + '" rx="3" fill="' + LANES[li].color +
          '" opacity="' + (r.provisional ? 0.32 : r.failed ? 0.5 : 0.95) + '"/>');
        sx += w;
      });
      o.push('<text x="' + (x + colW / 2).toFixed(1) + '" y="' + (pad + lanesH + 11) +
        '" text-anchor="middle" font-size="10" fill="' + (r.answered === false ? DRIFT_COLOR : "#66707D") + '">Q' +
        (qi + 1) + (r.answered === false ? "\u00b7skip" : "") + "</text>");
      x += colW + gap;
    });

    var dTop = pad + lanesH + 18, dBot = dTop + driftH;
    o.push('<line x1="' + labelW + '" y1="' + dBot + '" x2="' + (W - 10) + '" y2="' + dBot + '" stroke="#D9DEE6" stroke-width="1" stroke-dasharray="3 3"/>');
    o.push('<text x="' + (labelW - 8) + '" y="' + (dTop + driftH / 2) + '" text-anchor="end" dominant-baseline="central" font-size="11" fill="#66707D">Drift</text>');

    var pts = [], px = labelW + 4;
    answers.forEach(function (r, i) {
      pts.push([px + cols[i] / 2, dBot - (clamp(typeof r.drift === "number" ? r.drift : 20, 0, 100) / 100) * driftH]);
      px += cols[i] + gap;
    });
    if (pts.length === 1) o.push('<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="3" fill="' + DRIFT_COLOR + '"/>');
    else if (pts.length > 1) o.push('<polyline fill="none" stroke="' + DRIFT_COLOR + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="' +
      pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>');

    o.push("</svg>");
    return o.join("");
  }

  function legend() {
    return '<div class="iv-an-key">' + LANES.map(function (l) {
      return '<span><i style="background:' + l.color + '"></i>' + l.label + "</span>";
    }).join("") + '<span><i style="background:' + DRIFT_COLOR + '"></i>Drift from the question</span></div>';
  }

  /* ---------- public HTML ---------- */
  function liveHtml() {
    injectStyles();
    if (!answers.length) return "";
    var s = scored();
    var answered = answers.filter(function (a) { return a.answered !== false; }).length;
    var cl = avg(s, "clarity"), dr = avg(s, "drift");
    return '<div class="iv-an card" style="padding:16px 18px">' +
      '<div class="iv-an-h"><span class="eyebrow">ANSWER MAP</span>' +
      '<span class="iv-an-note">updates after each answer</span></div>' +
      '<div class="iv-an-scroll">' + swimlane({ colMin: 42, colMax: 100, rowH: 20 }) + "</div>" +
      legend() +
      '<div class="iv-an-stats">' +
        '<div class="iv-an-stat"><b>' + answered + "/" + answers.length + "</b><span>answered</span></div>" +
        '<div class="iv-an-stat"><b>' + (cl == null ? "\u2013" : cl) + "</b><span>clarity</span></div>" +
        '<div class="iv-an-stat"><b>' + (dr == null ? "\u2013" : dr) + "</b><span>drift</span></div>" +
      "</div></div>";
  }

  function reportHtml() {
    injectStyles();
    if (!answers.length) return "";
    var answered = answers.filter(function (a) { return a.answered !== false; }).length;

    var head = '<div class="card" style="padding:20px;margin-bottom:16px">' +
      '<div class="iv-an-h"><span class="eyebrow">WHERE YOU WENT, QUESTION BY QUESTION</span>' +
      '<span class="iv-an-note">' + answered + " of " + answers.length + " answered</span></div>" +
      '<div class="iv-an-scroll">' + swimlane({ colMin: 52, colMax: 140, rowH: 24 }) + "</div>" +
      legend() + "</div>";

    // A question is worth calling out if it wandered or contained a tangent.
    var flagged = [], clean = [];
    answers.forEach(function (a, i) {
      var tans = (a.segments || []).filter(function (g) { return g.role === "tangent"; });
      var tanSecs = tans.reduce(function (t, g) { return t + (g.seconds || 0); }, 0);
      var d = typeof a.drift === "number" ? a.drift : 0;
      if (a.failed) { clean.push(i + 1); return; }
      if (d >= 35 || tanSecs > 0) flagged.push({ n: i + 1, a: a, d: d, tans: tans, tanSecs: tanSecs });
      else clean.push(i + 1);
    });

    var driftRows = flagged.map(function (f) {
      var q = f.a.q ? esc(f.a.q.length > 88 ? f.a.q.slice(0, 88) + "\u2026" : f.a.q) : "Open conversation";
      var h = '<div class="iv-an-row">' +
        '<div class="iv-an-rowtop"><span class="iv-an-q"><b>Q' + f.n + '</b> ' + q + "</span>" +
        '<span class="iv-an-d"><u><i style="width:' + Math.round(f.d) + '%"></i></u>' + Math.round(f.d) + "</span></div>";
      if (f.tanSecs > 0)
        h += '<div class="iv-an-note" style="margin-top:4px">' + Math.round(f.tanSecs) +
          "s off the question" + (f.a.driftNote ? " \u2014 " + esc(f.a.driftNote) : "") + "</div>";
      else if (f.a.driftNote)
        h += '<div class="iv-an-note" style="margin-top:4px">' + esc(f.a.driftNote) + "</div>";
      f.tans.forEach(function (g) {
        if (g.quote) h += '<div class="iv-an-quote">\u201c' + esc(g.quote) + "\u201d</div>";
      });
      return h + "</div>";
    }).join("");

    var body = flagged.length
      ? driftRows + (clean.length
          ? '<div class="iv-an-note" style="margin-top:12px">Q' + clean.join(", Q") +
            " stayed on the question.</div>"
          : "")
      : '<div class="iv-an-note">You stayed on the question in every answer. Nothing wandered.</div>';

    return head +
      '<div class="card" style="padding:20px;margin-bottom:16px">' +
        '<div class="eyebrow" style="margin-bottom:14px">WHERE YOU DRIFTED</div>' + body +
      "</div>";
  }

  /* ---------- API ---------- */
  var API = {
    init: function (o) {
      o = o || {};
      if (o.apiFn) apiFn = o.apiFn;
      if (o.onUpdate) onUpdate = o.onUpdate;
      injectStyles();
      return API;
    },
    reset: function () { answers = []; answerStart = 0; return API; },
    startAnswer: function () { answerStart = Date.now(); },
    endAnswer: function (question, text) {
      text = String(text || "").trim();
      if (text.split(/\s+/).length < 4) return null;   // ignore "yes", "ok", stray noise
      var secs = answerStart ? (Date.now() - answerStart) / 1000
                             : Math.max(4, text.split(/\s+/).length / 2.4);
      answerStart = 0;
      var h = heuristics(text);
      var rec = {
        q: String(question || ""), a: text, seconds: clamp(secs, 2, 900),
        provisional: true, failed: false,
        segments: [{ role: "context", seconds: secs }],
        drift: 20, clarity: h.clarity, confidence: h.confidence, specificity: h.specificity,
        structure: 50, optimism: 50, coverage: 50, answered: true, missing: []
      };
      answers.push(rec);
      analyze(rec);
      return rec;
    },
    liveHtml: liveHtml,
    reportHtml: reportHtml,
    count: function () { return answers.length; },
    summary: function () {
      var s = scored();
      return {
        asked: answers.length,
        answered: answers.filter(function (a) { return a.answered !== false; }).length,
        clarity: avg(s, "clarity"), confidence: avg(s, "confidence"), specificity: avg(s, "specificity"),
        structure: avg(s, "structure"), optimism: avg(s, "optimism"), coverage: avg(s, "coverage"),
        drift: avg(s, "drift")
      };
    },
    serialize: function () { return { v: 1, answers: answers }; },
    hydrate: function (obj) {
      answers = (obj && Array.isArray(obj.answers)) ? obj.answers : [];
      return API;
    },
    /* element-based helpers, used only by the standalone preview page */
    mountLive: function (el) { if (el) el.innerHTML = liveHtml(); return API; },
    renderReport: function (el) { if (el) el.innerHTML = reportHtml(); return API; }
  };

  global.IVAnalytics = API;
})(window);
