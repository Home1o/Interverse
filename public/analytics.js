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
      ".iv-an-bar{display:flex;align-items:center;gap:10px;margin:8px 0}",
      ".iv-an-bar em{font-style:normal;font-size:12.5px;color:var(--mut,#66707D);width:88px;flex:none}",
      ".iv-an-bar u{text-decoration:none;flex:1;height:6px;border-radius:4px;background:var(--mist,#ECEFF3);overflow:hidden;display:block}",
      ".iv-an-bar u>i{display:block;height:100%;border-radius:4px;background:var(--teal,#136F63)}",
      ".iv-an-bar b{font-size:12.5px;font-weight:600;width:28px;text-align:right;font-variant-numeric:tabular-nums}",
      ".iv-an-gap{font-size:13px;padding:6px 0 6px 15px;position:relative;line-height:1.45}",
      ".iv-an-gap:before{content:'';position:absolute;left:0;top:12px;width:5px;height:5px;border-radius:50%;background:var(--mut,#66707D)}",
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
    '{"segments":[{"role":"context|problem|solution|tangent","share":0-100}],',
    '"drift":0-100,"clarity":0-100,"confidence":0-100,"specificity":0-100,',
    '"structure":0-100,"optimism":0-100,"coverage":0-100,"answered":true|false,',
    '"missing":["short phrase"]}',
    "",
    "- segments: split the answer in speaking order, shares summing to 100, max 6.",
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
        return { role: role, seconds: rec.seconds * ((Number(x.share) || 0) / total) };
      });
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
    var s = scored();
    var answered = answers.filter(function (a) { return a.answered !== false; }).length;
    var worst = null;
    answers.forEach(function (a, i) {
      if (typeof a.drift === "number" && (!worst || a.drift > worst.d)) worst = { d: a.drift, i: i + 1 };
    });

    var rows = [["Clarity", "clarity"], ["Confidence", "confidence"], ["Specificity", "specificity"],
                ["Structure", "structure"], ["Optimism", "optimism"], ["Coverage", "coverage"]];
    var bars = rows.map(function (r) {
      var v = avg(s, r[1]);
      return '<div class="iv-an-bar"><em>' + r[0] + '</em><u><i style="width:' + (v == null ? 0 : v) +
        '%"></i></u><b>' + (v == null ? "\u2013" : v) + "</b></div>";
    }).join("");

    var tally = {};
    answers.forEach(function (a) {
      (a.missing || []).forEach(function (m) {
        var k = String(m).trim().toLowerCase();
        if (!k) return;
        if (!tally[k]) tally[k] = { label: String(m).trim(), n: 0 };
        tally[k].n++;
      });
    });
    var gaps = Object.keys(tally).map(function (k) { return tally[k]; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
    var gapHtml = gaps.length
      ? gaps.map(function (g) {
          return '<div class="iv-an-gap">' + esc(g.label.charAt(0).toUpperCase() + g.label.slice(1)) +
            (g.n > 1 ? ' <b style="font-weight:600">\u00d7' + g.n + "</b>" : "") + "</div>";
        }).join("")
      : '<div class="iv-an-note">Nothing was consistently missing across your answers.</div>';

    return '<div class="card" style="padding:20px;margin-bottom:16px">' +
        '<div class="iv-an-h"><span class="eyebrow">WHERE YOU WENT, QUESTION BY QUESTION</span>' +
        '<span class="iv-an-note">' + answered + " of " + answers.length + " answered</span></div>" +
        '<div class="iv-an-scroll">' + swimlane({ colMin: 52, colMax: 140, rowH: 24 }) + "</div>" +
        legend() +
        (worst && worst.d >= 55 ? '<div class="iv-an-note" style="margin-top:10px">Q' + worst.i +
          " drifted furthest from what was asked \u2014 worth replaying.</div>" : "") +
      "</div>" +
      '<div class="grid2"><div class="card" style="padding:20px">' +
        '<div class="eyebrow" style="margin-bottom:14px">HOW YOU CAME ACROSS</div>' + bars + "</div>" +
        '<div class="card" style="padding:20px">' +
        '<div class="eyebrow" style="margin-bottom:12px">WHAT WAS MISSING</div>' + gapHtml + "</div></div>";
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
