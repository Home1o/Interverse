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

  // Groq's free tier allows 12,000 tokens per MINUTE for llama-3.3-70b-versatile,
  // counting input and output together. 60,000 characters is roughly 16,000 tokens
  // on its own, so the old cap made a single opening question impossible.
  var MAX = 24000;              // characters kept from a document
  var IMG_MAX_EDGE = 1100;      // longest side after downscaling, px
  var IMG_QUALITY = 0.75;       // keeps a typical photo near 150kb once base64'd
  var OCR_MAX_PAGES = 6;        // scanned pages rendered for transcription
  var OCR_PAGE_EDGE = 1500;     // scanned text needs more resolution than a photo
  var OCR_QUALITY = 0.8;

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
  /* Render one PDF page to a JPEG data URL. Scanned pages ARE images — the only
     way to get at their words is to look at them. */
  function renderPage(page) {
    var vp = page.getViewport({ scale: 1 });
    var scale = Math.min(2.5, OCR_PAGE_EDGE / Math.max(vp.width, vp.height));
    var v = page.getViewport({ scale: scale });
    var c = document.createElement("canvas");
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    return page.render({ canvasContext: ctx, viewport: v }).promise.then(function () {
      return c.toDataURL("image/jpeg", OCR_QUALITY);
    });
  }

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
        var text = parts.join("\n\n");
        // A scanned PDF has no text layer at all, and a badly-OCR'd one has a
        // token or two per page. Either way there is nothing to interview on,
        // so fall back to rendering the pages and reading them visually.
        var perPage = text.replace(/--- Page \d+ ---/g, "").trim().length / pages;
        if (perPage >= 60) return { text: text, kind: "pdf", slides: doc.numPages };

        var wanted = Math.min(doc.numPages, OCR_MAX_PAGES), shots = [], j = 0;
        function shoot() {
          if (j >= wanted) return Promise.resolve();
          var n = ++j;
          return doc.getPage(n).then(renderPage).then(function (url) {
            shots.push(url);
          }).then(shoot);
        }
        return shoot().then(function () {
          if (!shots.length) throw new Error("Couldn't read that PDF — try exporting it again, or paste the text in");
          return {
            text: "", kind: "pdf", slides: doc.numPages,
            images: shots, scanned: true,
            pagesRead: shots.length, pagesTotal: doc.numPages
          };
        });
      });
    });
  }

  /* ---------------- images ----------------
     Downscaled through a canvas before it ever reaches the model: a 4000px
     phone photo and a 1400px one read the same to a vision model, but the
     large one costs several times the tokens and can breach the 20MB
     request ceiling on its own. */
  function image(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, IMG_MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement("canvas");
          c.width = cw; c.height = ch;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);   // flatten transparency for JPEG
          ctx.drawImage(img, 0, 0, cw, ch);
          var data = c.toDataURL("image/jpeg", IMG_QUALITY);
          URL.revokeObjectURL(url);
          if (!/^data:image\/jpeg;base64,/.test(data)) throw new Error("bad canvas output");
          resolve({ text: "", kind: "image", slides: 0, image: data, width: cw, height: ch });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error("Couldn't read that image \u2014 try a PNG or JPG"));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("That image couldn't be opened \u2014 try a PNG, JPG or WEBP"));
      };
      img.src = url;
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
    } else if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif" || ext === "bmp") {
      run = image(file);
    } else if (ext === "txt" || ext === "md" || ext === "csv" || ext === "rtf") {
      run = file.text().then(function (t) { return { text: t, kind: ext, slides: 0 }; });
    } else {
      return Promise.reject(new Error("Unsupported file type — use PPTX, DOCX, PDF, TXT or an image"));
    }

    return run.then(function (r) {
      if (r.kind === "image") return r;        // an image carries no text to check
      if (r.images && r.images.length) return r; // scanned pages: text comes from OCR later
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
