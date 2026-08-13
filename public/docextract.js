/* ============================================================
   Interverse — document text extraction (client side)

   .pptx  slides + speaker notes, in slide order
   .docx  body text with paragraph breaks
   .pdf   via pdf.js (already loaded for resumes)
   .txt / .md / .csv  read directly

   PPTX and DOCX are ZIP archives. Rather than pull in JSZip we read the
   central directory by hand and inflate with the browser's own
   DecompressionStream. No dependency, no build step.

   window.IVDoc.extract(file) -> Promise<{text, kind, slides, note}>
   ============================================================ */
(function (global) {
  "use strict";

  var MAX = 60000; // characters handed to the model

  /* ---------------- tiny ZIP reader ---------------- */
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  function findEOCD(d) {
    // 0x06054b50, scanning back over the max comment length
    var min = Math.max(0, d.length - 66000);
    for (var i = d.length - 22; i >= min; i--) {
      if (d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === 0x05 && d[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function entries(d) {
    var eocd = findEOCD(d);
    if (eocd < 0) throw new Error("not a valid Office file");
    var count = u16(d, eocd + 10);
    var off = u32(d, eocd + 16);
    var list = [], p = off;
    for (var i = 0; i < count && p + 46 <= d.length; i++) {
      if (u32(d, p) !== 0x02014b50) break;
      var nameLen = u16(d, p + 28), extraLen = u16(d, p + 30), cmtLen = u16(d, p + 32);
      list.push({
        name: new TextDecoder().decode(d.subarray(p + 46, p + 46 + nameLen)),
        method: u16(d, p + 10),
        csize: u32(d, p + 20),
        local: u32(d, p + 42)
      });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return list;
  }

  function rawBytes(d, e) {
    var p = e.local;
    if (u32(d, p) !== 0x04034b50) throw new Error("corrupt archive");
    var nameLen = u16(d, p + 26), extraLen = u16(d, p + 28);
    var start = p + 30 + nameLen + extraLen;
    return d.subarray(start, start + e.csize);
  }

  function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("This browser can't open Office files — use Chrome, or export to PDF"));
    }
    var ds = new DecompressionStream("deflate-raw");
    var s = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function readEntry(d, e) {
    var raw = rawBytes(d, e);
    if (e.method === 0) return Promise.resolve(new TextDecoder().decode(raw));
    return inflate(raw).then(function (out) { return new TextDecoder().decode(out); });
  }

  /* ---------------- XML -> text ---------------- */
  function tagText(xml, tag) {
    var re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "g"), m, out = [];
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  function unent(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
            .replace(/&amp;/g, "&");
  }
  function numOf(name) { var m = name.match(/(\d+)\.xml$/); return m ? +m[1] : 0; }

  /* ---------------- PPTX ---------------- */
  function pptx(d) {
    var all = entries(d);
    var slides = all.filter(function (e) { return /^ppt\/slides\/slide\d+\.xml$/.test(e.name); })
                    .sort(function (a, b) { return numOf(a.name) - numOf(b.name); });
    if (!slides.length) throw new Error("no slides found in that file");

    // notesSlideN.xml is numbered among notes files, NOT aligned to slide
    // numbers, so slide 3's notes can live in notesSlide2.xml. The real link
    // is in each slide's .rels file.
    var byName = {};
    all.forEach(function (e) { byName[e.name] = e; });
    var relsFor = {};
    slides.forEach(function (e) {
      var r = byName["ppt/slides/_rels/" + e.name.split("/").pop() + ".rels"];
      if (r) relsFor[e.name] = r;
    });

    var parts = [], n = 0;
    function step() {
      if (n >= slides.length) return Promise.resolve();
      var i = n++, e = slides[i];
      return readEntry(d, e).then(function (xml) {
        // <a:t> holds every run of visible text; </a:p> ends a paragraph
        var body = tagText(xml.replace(/<\/a:p>/g, "\n<\/a:p>"), "a:t").map(unent).join(" ");
        body = body.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
        var block = "--- Slide " + (i + 1) + " ---\n" + (body || "(no text on this slide)");
        var rel = relsFor[e.name];
        if (!rel) { parts.push(block); return; }
        return readEntry(d, rel).then(function (rx) {
          var m = rx.match(/Target="[^"]*notesSlides\/(notesSlide\d+\.xml)"/);
          var ne = m && byName["ppt/notesSlides/" + m[1]];
          if (!ne) { parts.push(block); return; }
          return readEntry(d, ne).then(function (nx) {
            var nt = tagText(nx, "a:t").map(unent).join(" ").replace(/\s+/g, " ").trim();
            // notes always carry the slide number as a placeholder run; drop it
            if (nt && !/^\d+$/.test(nt)) block += "\nSpeaker notes: " + nt;
            parts.push(block);
          });
        });
      }).then(step);
    }
    return step().then(function () {
      return { text: parts.join("\n\n"), kind: "pptx", slides: slides.length };
    });
  }

  /* ---------------- DOCX ---------------- */
  function docx(d) {
    var all = entries(d);
    var doc = all.filter(function (e) { return e.name === "word/document.xml"; })[0];
    if (!doc) throw new Error("no document body found");
    return readEntry(d, doc).then(function (xml) {
      xml = xml.replace(/<w:p[ >]/g, "\n<w:p ").replace(/<w:br\/?>/g, "\n").replace(/<w:tab\/?>/g, " ");
      var txt = xml.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, function (_, t) { return "\u0000" + t + "\u0000"; });
      var out = [], re = /\u0000([\s\S]*?)\u0000/g, m;
      // walk paragraph by paragraph so line breaks survive
      txt.split("\n").forEach(function (line) {
        var buf = "";
        re.lastIndex = 0;
        while ((m = re.exec(line))) buf += unent(m[1]);
        buf = buf.replace(/[ \t]+/g, " ").trim();
        if (buf) out.push(buf);
      });
      if (!out.length) throw new Error("no text found in that document");
      return { text: out.join("\n"), kind: "docx", slides: 0 };
    });
  }

  /* ---------------- PDF ---------------- */
  function pdf(buf) {
    if (!global.pdfjsLib) return Promise.reject(new Error("PDF reader didn't load — refresh and try again"));
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return pdfjsLib.getDocument({ data: buf }).promise.then(function (doc) {
      var pages = Math.min(doc.numPages, 40), parts = [], i = 0;
      function step() {
        if (i >= pages) return Promise.resolve();
        var n = ++i;
        return doc.getPage(n)
          .then(function (p) { return p.getTextContent(); })
          .then(function (tc) {
            var t = tc.items.map(function (it) { return it.str; }).join(" ").replace(/\s+/g, " ").trim();
            if (t) parts.push("--- Page " + n + " ---\n" + t);
          })
          .then(step);
      }
      return step().then(function () {
        return { text: parts.join("\n\n"), kind: "pdf", slides: doc.numPages };
      });
    });
  }

  /* ---------------- entry point ---------------- */
  function extract(file) {
    var name = (file && file.name) || "";
    var ext = (name.split(".").pop() || "").toLowerCase();

    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error("File is over 25MB — try exporting a smaller version"));

    var run;
    if (ext === "pptx" || ext === "docx") {
      run = file.arrayBuffer().then(function (b) {
        var d = new Uint8Array(b);
        return ext === "pptx" ? pptx(d) : docx(d);
      });
    } else if (ext === "pdf") {
      run = file.arrayBuffer().then(pdf);
    } else if (ext === "ppt" || ext === "doc") {
      return Promise.reject(new Error("Old ." + ext + " format isn't readable — save as ." + ext + "x or PDF"));
    } else if (ext === "txt" || ext === "md" || ext === "csv" || ext === "rtf") {
      run = file.text().then(function (t) { return { text: t, kind: ext, slides: 0 }; });
    } else {
      return Promise.reject(new Error("Unsupported file type — use PPTX, DOCX, PDF or TXT"));
    }

    return run.then(function (r) {
      var t = String(r.text || "").replace(/\u0000/g, "").trim();
      if (t.length < 40) {
        throw new Error(r.kind === "pdf"
          ? "Almost no text found — if it's a scanned PDF, paste the text in instead"
          : "Almost no text found in that file");
      }
      r.truncated = t.length > MAX;
      r.text = t.slice(0, MAX);
      return r;
    });
  }

  global.IVDoc = { extract: extract };
})(window);
