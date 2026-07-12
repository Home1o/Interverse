/* ============================================================
   INTERVERSE — frontend app (vanilla JS, zero build)
   ============================================================ */

/* ---------------- state ---------------- */
var token = localStorage.getItem("iv_token") || null;
var user = null;
try { user = JSON.parse(localStorage.getItem("iv_user") || "null"); } catch (e) {}

var MODES = {
  interview: { label: "Interview Drill", tag: "DRILL", color: "#136F63",
    blurb: "A sharp interviewer works through your material — resume, essays, a job description — with probing follow-ups." },
  confidence: { label: "Confidence Coach", tag: "COACH", color: "#8A4FFF",
    blurb: "Answer under pressure. After each answer you get a short note on hedging, filler words and assertiveness." },
  vocabulary: { label: "Vocabulary Builder", tag: "LEXICON", color: "#C2571B",
    blurb: "Conversational practice where every answer comes back with sharper words and phrases you could have used." }
};

var S = {
  screen: "setup",        // setup | session | grading | feedback | saved
  mode: "interview",
  content: "", role: "",
  voiceOn: true,
  convId: null,           // id of conversation being worked on / viewed
  turns: [],              // {who:'ai'|'me', text, tip?}
  history: [],            // raw API messages
  phase: "idle",          // idle | thinking | speaking | listening
  interim: "",
  typedMode: false,
  error: "",
  feedback: null,
  savedAt: null,
  micStatus: "unknown",
  convs: []               // sidebar list
};

var pendingOtpEmail = null;

/* ---------------- helpers ---------------- */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
function toast(msg) {
  var t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
}
function uuid() {
  return (crypto.randomUUID) ? crypto.randomUUID() :
    "xxxxxxxxyxxx".replace(/[xy]/g, function () { return Math.floor(Math.random()*16).toString(16); }) + Date.now();
}

async function api(path, method, body) {
  var res = await fetch("/api" + path, {
    method: method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" },
      token ? { "Authorization": "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && token) { doLogout(true); throw new Error("Signed out — please sign in again"); }
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

/* ============================================================
   AUTH
   ============================================================ */
function showAuthTab(which) {
  $("tab-login").classList.toggle("sel", which === "login");
  $("tab-register").classList.toggle("sel", which === "register");
  $("pane-login").style.display = which === "login" ? "flex" : "none";
  $("pane-register").style.display = which === "register" ? "flex" : "none";
  $("pane-otp").style.display = "none";
  authMsg("");
}
function showOtpPane(email) {
  pendingOtpEmail = email;
  $("pane-login").style.display = "none";
  $("pane-register").style.display = "none";
  $("pane-otp").style.display = "flex";
  $("otp-email-label").textContent = email;
  $("otp-code").value = "";
  $("otp-code").focus();
}
function authMsg(msg, ok) {
  var el = $("auth-msg"); el.textContent = msg || "";
  el.className = "auth-msg" + (ok ? " ok" : "");
}

async function doRegister() {
  var email = $("rg-email").value.trim(), name = $("rg-name").value.trim(), pass = $("rg-pass").value;
  try {
    var r = await api("/auth/register", "POST", { email: email, name: name, password: pass });
    authMsg(r.message + (r.devOtp ? "  (dev code: " + r.devOtp + ")" : ""), true);
    showOtpPane(email);
    if (r.devOtp) authMsg("Dev mode — your code is " + r.devOtp, true);
  } catch (e) { authMsg(e.message); }
}
async function doLogin() {
  var email = $("li-email").value.trim(), pass = $("li-pass").value;
  try {
    var r = await api("/auth/login", "POST", { email: email, password: pass });
    if (r.needVerify) {
      showOtpPane(email);
      authMsg(r.message + (r.devOtp ? "  (dev code: " + r.devOtp + ")" : ""), true);
      return;
    }
    finishAuth(r);
  } catch (e) { authMsg(e.message); }
}
async function doVerifyOtp() {
  try {
    var r = await api("/auth/verify-otp", "POST", { email: pendingOtpEmail, code: $("otp-code").value.trim() });
    finishAuth(r);
    toast("Email verified — welcome to Interverse!");
  } catch (e) { authMsg(e.message); }
}
async function doResendOtp() {
  try {
    var r = await api("/auth/resend-otp", "POST", { email: pendingOtpEmail });
    authMsg(r.message + (r.devOtp ? "  (dev code: " + r.devOtp + ")" : ""), true);
  } catch (e) { authMsg(e.message); }
}
function finishAuth(r) {
  token = r.token; user = r.user;
  localStorage.setItem("iv_token", token);
  localStorage.setItem("iv_user", JSON.stringify(user));
  boot();
}
function doLogout(silent) {
  token = null; user = null;
  localStorage.removeItem("iv_token");
  localStorage.removeItem("iv_user");
  stopSpeaking(); listeningWanted = false;
  if (!silent) toast("Signed out");
  boot();
}

/* ============================================================
   SIDEBAR — saved conversations
   ============================================================ */
async function loadConversations() {
  try { S.convs = await api("/conversations"); } catch (e) { S.convs = []; }
  renderConvList();
}
function renderConvList() {
  var el = $("conv-list");
  if (!S.convs.length) {
    el.innerHTML = '<div class="conv-empty">No saved sessions yet. Run one and hit Save — it lands here.</div>';
    return;
  }
  el.innerHTML = S.convs.map(function (c) {
    var d = new Date((c.updated_at || "").replace(" ", "T") + "Z");
    var when = isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    var m = MODES[c.mode] || { tag: c.mode };
    return '<div class="conv-item' + (S.convId === c.id ? " sel" : "") + '" role="button" tabindex="0" ' +
      'onclick="openConversation(\'' + c.id + '\')" onkeydown="if(event.key===\'Enter\')openConversation(\'' + c.id + '\')">' +
      '<div class="conv-title">' + esc(c.title) + '</div>' +
      '<div class="conv-meta">' + esc(m.tag) + ' · ' + esc(when) + '</div>' +
      '<button class="conv-del" title="Delete" onclick="event.stopPropagation();deleteConversation(\'' + c.id + '\')">✕</button>' +
      '</div>';
  }).join("");
}
async function openConversation(id) {
  try {
    var c = await api("/conversations/" + id);
    stopSpeaking(); listeningWanted = false;
    S.convId = c.id;
    S.mode = c.mode;
    S.content = c.data.content || "";
    S.role = c.data.role || "";
    S.turns = c.data.turns || [];
    S.history = c.data.history || [];
    S.feedback = c.data.feedback || null;
    S.screen = "saved";
    S.phase = "idle"; S.error = "";
    closeSidebarMobile();
    render();
  } catch (e) { toast(e.message); }
}
async function deleteConversation(id) {
  if (!confirm("Delete this saved session? This can't be undone.")) return;
  try {
    await api("/conversations/" + id, "DELETE");
    if (S.convId === id) { S.convId = null; if (S.screen === "saved") { S.screen = "setup"; render(); } }
    loadConversations();
    toast("Deleted");
  } catch (e) { toast(e.message); }
}
async function saveConversation(silent) {
  if (!S.turns.length) { if (!silent) toast("Nothing to save yet"); return; }
  if (!S.convId) S.convId = uuid();
  var firstQ = (S.turns.find(function (t) { return t.who === "ai"; }) || {}).text || "";
  var title = (S.role || firstQ || MODES[S.mode].label).slice(0, 80);
  try {
    await api("/conversations/" + S.convId, "PUT", {
      title: title, mode: S.mode,
      data: {
        content: S.content, role: S.role,
        turns: S.turns, history: S.history, feedback: S.feedback,
        stats: { answers: myTurnCount(), fillers: fillerCount() }
      }
    });
    S.savedAt = Date.now();
    if (!silent) toast("Session saved ✓");
    loadConversations();
  } catch (e) { if (!silent) toast("Save failed: " + e.message); }
}
function toggleSidebar() { document.querySelector(".sidebar").classList.toggle("open"); }
function closeSidebarMobile() { document.querySelector(".sidebar").classList.remove("open"); }

/* ============================================================
   SPEECH — output (TTS) and input (recognition + mic permission)
   ============================================================ */
var synth = window.speechSynthesis || null;
var chosenVoice = null;
function pickVoice() {
  if (!synth) return;
  var vs = synth.getVoices();
  chosenVoice = vs.find(function (v) { return /en[-_](GB|IN)/i.test(v.lang) && /female|Google/i.test(v.name); }) ||
    vs.find(function (v) { return /^en/i.test(v.lang); }) || vs[0] || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

function speak(text, onEnd) {
  if (!synth || !S.voiceOn) { if (onEnd) onEnd(); return; }
  synth.cancel();
  var u = new SpeechSynthesisUtterance(text);
  if (chosenVoice) u.voice = chosenVoice;
  u.rate = 1.0;
  u.onend = function () { if (onEnd) onEnd(); };
  u.onerror = function () { if (onEnd) onEnd(); };
  synth.speak(u);
}
function stopSpeaking() { if (synth) synth.cancel(); }

var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var micSupported = !!SR;
var rec = null, listeningWanted = false, finalText = "", interimText = "";

// pre-read permission state
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: "microphone" }).then(function (st) {
    if (st.state === "granted") S.micStatus = "granted";
    else if (st.state === "denied") S.micStatus = "denied";
    st.onchange = function () {
      S.micStatus = st.state === "granted" ? "granted" : st.state === "denied" ? "denied" : "unknown";
      if (S.screen === "session" || S.screen === "setup") render();
    };
    if (S.screen === "setup") render();
  }).catch(function () {});
}

async function requestMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return micSupported;
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(function (t) { t.stop(); });
    S.micStatus = "granted"; S.error = "";
    render();
    return true;
  } catch (e) {
    S.micStatus = "denied";
    S.error = "Microphone access was denied. Allow it from the browser's site settings (icon near the address bar), or type your answers.";
    S.typedMode = true;
    render();
    return false;
  }
}

async function startListening() {
  if (!micSupported) { S.typedMode = true; render(); return; }
  if (S.micStatus !== "granted") {
    var ok = await requestMic();
    if (!ok) return;
  }
  stopSpeaking();
  S.error = ""; finalText = ""; interimText = "";
  rec = new SR();
  rec.lang = "en-IN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = function (e) {
    interimText = "";
    for (var i = e.resultIndex; i < e.results.length; i++) {
      var r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interimText += r[0].transcript;
    }
    S.interim = finalText + interimText;
    var box = $("interim-box"); if (box) box.textContent = S.interim || "Listening…";
  };
  rec.onerror = function (e) {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      S.micStatus = "denied";
      S.error = "Microphone blocked. Allow mic access from the browser's site settings, or type your answer.";
      S.typedMode = true; listeningWanted = false; S.phase = "idle"; render();
    }
  };
  rec.onend = function () { if (listeningWanted) { try { rec.start(); } catch (e) {} } };
  listeningWanted = true;
  S.phase = "listening"; S.interim = "";
  render();
  try { rec.start(); } catch (e) {}
}
function stopListening(send) {
  listeningWanted = false;
  if (rec) { try { rec.stop(); } catch (e) {} }
  var text = (finalText + " " + interimText).trim();
  finalText = ""; interimText = ""; S.interim = "";
  if (send && text) submitAnswer(text);
  else { S.phase = "idle"; render(); }
}
function handleOrb() {
  if (S.phase === "listening") stopListening(true);
  else if (S.phase === "idle") startListening();
  else if (S.phase === "speaking") { stopSpeaking(); S.phase = "idle"; render(); }
}

/* ---------------- filler stats ---------------- */
var FILLERS = ["um","uh","umm","uhh","like","you know","basically","actually","kind of","sort of","i mean","so yeah"];
function countFillers(text) {
  var t = " " + text.toLowerCase().replace(/[^a-z' ]/g, " ") + " ", n = 0;
  FILLERS.forEach(function (f) {
    var re = new RegExp("\\b" + f.replace(/ /g, "\\s+") + "\\b", "g");
    n += (t.match(re) || []).length;
  });
  return n;
}
function fillerCount() {
  return S.turns.filter(function (t) { return t.who === "me"; })
    .reduce(function (a, t) { return a + countFillers(t.text); }, 0);
}
function myTurnCount() { return S.turns.filter(function (t) { return t.who === "me"; }).length; }

/* ============================================================
   AI CORE
   ============================================================ */
function systemPrompt() {
  var base = "You are a live spoken-voice practice partner. Your replies are SPOKEN ALOUD, so keep them natural, conversational, and under 80 words. Ask exactly ONE question at a time. Never use markdown, bullets, or headers in the spoken reply.\n\n" +
    "Candidate's context / material:\n" + (S.content || "(none provided — improvise sensible questions)") +
    (S.role ? "\nTarget role or goal: " + S.role : "") +
    '\n\nYou MUST respond with ONLY a JSON object, no code fences, no preamble:\n{"reply": "<what you say aloud>", "tip": "<optional short on-screen coaching note, or empty string>"}';
  if (S.mode === "interview")
    return base + "\n\nPersona: a rigorous but fair interviewer (think MBA admissions / senior hiring panel). Open with a brief one-line welcome then your first question grounded in the candidate's material. Probe answers with follow-ups: quantify, \"why you\", trade-offs, what-would-you-do-differently. Escalate difficulty gradually. Keep \"tip\" empty in this mode unless the answer badly dodged the question.";
  if (S.mode === "confidence")
    return base + "\n\nPersona: a direct confidence coach. Ask challenging behavioural questions. In \"tip\", after each candidate answer, give ONE precise note: hedging language spotted (\"I think maybe…\"), passive framing, apologising, or filler density — and the assertive rewrite of one weak sentence. Keep tips under 30 words.";
  return base + "\n\nPersona: a warm articulate conversation partner. Ask open questions that invite rich description. In \"tip\", after each candidate answer, suggest 2–3 stronger words or phrases they could have used, formatted like: weak → strong. Occasionally weave one upgraded word into your next question and briefly gloss it.";
}
function parseJsonLoose(text) {
  try {
    var clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
  } catch (e) { return null; }
}

async function aiTurn(userText) {
  S.phase = "thinking"; S.error = "";
  render();
  try {
    if (userText !== null) S.history.push({ role: "user", content: userText });
    if (!S.history.length) S.history.push({ role: "user", content: "Please begin the session with your opening question." });
    var r = await api("/chat", "POST", { system: systemPrompt(), messages: S.history, max_tokens: 1000 });
    var parsed = parseJsonLoose(r.text) || { reply: (r.text || "").slice(0, 400), tip: "" };
    S.history.push({ role: "assistant", content: r.text });
    S.turns.push({ who: "ai", text: parsed.reply, tip: (parsed.tip || "").trim() });
    if (S.voiceOn) {
      S.phase = "speaking"; render();
      speak(parsed.reply, function () { if (S.phase === "speaking") { S.phase = "idle"; render(); } });
    } else { S.phase = "idle"; render(); }
  } catch (e) {
    S.error = e.message || "Couldn't reach the interviewer. Try again.";
    S.phase = "idle"; render();
  }
}
function submitAnswer(text) {
  S.turns.push({ who: "me", text: text });
  aiTurn(text);
}

function goNewSession() {
  stopSpeaking(); listeningWanted = false;
  S.convId = null; S.turns = []; S.history = []; S.feedback = null;
  S.screen = "setup"; S.phase = "idle"; S.error = ""; S.savedAt = null;
  closeSidebarMobile();
  render(); renderConvList();
}
function startSession() {
  S.turns = []; S.history = []; S.feedback = null; S.savedAt = null;
  if (!S.convId) S.convId = uuid();
  S.screen = "session";
  if (micSupported && S.micStatus === "unknown") requestMic();
  aiTurn(null);
}
function resumeSaved() {
  S.screen = "session"; S.phase = "idle"; S.error = "";
  render();
}

async function endSession() {
  listeningWanted = false;
  if (rec) { try { rec.stop(); } catch (e) {} }
  stopSpeaking();
  if (!myTurnCount()) { S.screen = "setup"; render(); return; }
  S.screen = "grading"; render();
  var transcript = S.turns.map(function (t) {
    return (t.who === "ai" ? "INTERVIEWER: " : "CANDIDATE: ") + t.text;
  }).join("\n");
  var sys = 'You are an expert speaking coach. Analyze the interview transcript. Respond with ONLY JSON, no fences:\n' +
    '{"scores":{"clarity":0-10,"structure":0-10,"confidence":0-10,"vocabulary":0-10},\n' +
    '"headline":"<one candid sentence verdict>",\n' +
    '"strengths":["...","..."],\n' +
    '"improvements":["specific, actionable...","..."],\n' +
    '"power_phrases":[{"weak":"<what they said>","strong":"<sharper version>"}]}\n' +
    'Be specific — quote their actual words. 2-4 items per list.';
  try {
    var r = await api("/chat", "POST", {
      system: sys,
      messages: [{ role: "user", content: "Mode: " + MODES[S.mode].label + "\nFiller words counted: " + fillerCount() + "\n\nTranscript:\n" + transcript }],
      max_tokens: 1000
    });
    S.feedback = parseJsonLoose(r.text);
  } catch (e) { S.feedback = null; }
  S.screen = "feedback";
  render();
  saveConversation(true); // auto-save with feedback attached
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  var v = $("view");
  var head = { setup: "New session", session: "Live session", grading: "Reviewing the tape…",
    feedback: "Feedback", saved: "Saved session" }[S.screen] || "";
  $("head-title").textContent = head;
  $("head-eyebrow").textContent = S.screen === "saved" ? "FROM YOUR LIBRARY" : "PRACTICE ROOM";
  var onair = $("onair");
  if (S.screen === "session") {
    onair.style.display = "inline-flex";
    onair.classList.toggle("live", S.phase !== "idle");
    $("onair-text").textContent = "ON AIR · " + MODES[S.mode].tag;
  } else onair.style.display = "none";

  if (S.screen === "setup") v.innerHTML = setupHtml();
  else if (S.screen === "session") v.innerHTML = sessionHtml();
  else if (S.screen === "grading") v.innerHTML =
    '<div class="card" style="padding:40px;text-align:center">' +
    '<div class="display" style="font-size:22px;margin-bottom:8px">Reviewing the tape…</div>' +
    '<div style="color:var(--mut);font-size:14px">Scoring clarity, structure, confidence and vocabulary.</div></div>';
  else if (S.screen === "feedback") v.innerHTML = feedbackHtml(false);
  else if (S.screen === "saved") v.innerHTML = savedHtml();

  var feed = $("feed"); if (feed) feed.scrollTop = feed.scrollHeight;
  var ta = $("su-content"); if (ta) ta.value = S.content;
  var ri = $("su-role"); if (ri) ri.value = S.role;
}

function setupHtml() {
  var cards = Object.keys(MODES).map(function (k) {
    var m = MODES[k];
    return '<button class="modecard' + (S.mode === k ? " sel" : "") + '" onclick="S.mode=\'' + k + '\';render()">' +
      '<div class="tag" style="color:' + m.color + '">' + m.tag + '</div>' +
      '<div class="name">' + m.label + '</div><div class="blurb">' + m.blurb + '</div></button>';
  }).join("");
  var micBit = !micSupported
    ? '<span style="font-size:12.5px;color:var(--amber)">Voice input isn\'t supported in this browser — you can type answers. Chrome works best.</span>'
    : S.micStatus === "granted"
      ? '<span style="font-size:12.5px;color:var(--teal);font-weight:600">✓ Microphone ready</span>'
      : '<button class="btn btn-ghost" style="padding:8px 14px;font-size:13px" onclick="requestMic()">🎙 Enable microphone</button>' +
        (S.micStatus === "denied" ? '<span style="font-size:12.5px;color:var(--rec);max-width:320px"> Mic is blocked — allow it from the browser\'s site settings, then retry.</span>' : "");
  return '<div class="eyebrow" style="margin-bottom:10px">1 · CHOOSE YOUR MODE</div>' +
    '<div class="grid3">' + cards + '</div>' +
    '<div class="eyebrow" style="margin-bottom:10px">2 · FEED YOUR MATERIAL</div>' +
    '<div class="card" style="padding:18px;margin-bottom:24px">' +
    '<textarea id="su-content" class="input" rows="7" style="resize:vertical;margin-bottom:12px" ' +
    'placeholder="Paste anything the interviewer should work from — resume bullets, a job description, your MBA essays, a project story, a topic you want to speak about…" ' +
    'oninput="S.content=this.value"></textarea>' +
    '<input id="su-role" class="input" placeholder="Target role or goal (optional) — e.g. HBS admissions interview, consulting case fit, product manager role" ' +
    'oninput="S.role=this.value" /></div>' +
    '<div class="eyebrow" style="margin-bottom:10px">3 · GO LIVE</div>' +
    '<div class="card" style="padding:18px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between">' +
    '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--mut);cursor:pointer">' +
    '<input type="checkbox"' + (S.voiceOn ? " checked" : "") + ' onchange="S.voiceOn=this.checked"/> Speak questions aloud</label>' +
    micBit + '</div>' +
    '<button class="btn btn-primary" onclick="startSession()">Start session</button></div>';
}

function feedHtml() {
  var inner = "";
  if (!S.turns.length && S.phase === "thinking")
    inner = '<div style="color:var(--mut);font-size:13.5px">Preparing your first question…</div>';
  inner += S.turns.map(function (t) {
    var b = '<div class="bubble ' + (t.who === "ai" ? "ai" : "me") + '">' + esc(t.text) + '</div>';
    if (t.tip) b += '<div class="tipline">◈ ' + esc(t.tip) + '</div>';
    return b;
  }).join("");
  if (S.phase === "thinking" && S.turns.length)
    inner += '<div class="bubble ai" style="color:var(--mut)">…</div>';
  return '<div class="card"><div id="feed" class="feed">' + inner + '</div></div>';
}

function sessionHtml() {
  var orbIcon = S.phase === "listening" ? "◼" : S.phase === "thinking" ? "…" : S.phase === "speaking" ? "♪" : "🎙";
  var orbLabel = S.phase === "listening" ? "Tap to send your answer"
    : S.phase === "thinking" ? "Interviewer is thinking…"
    : S.phase === "speaking" ? "Speaking — tap to interrupt" : "Tap to speak";
  var h = '<div class="orb-zone">' +
    '<button class="orb ' + S.phase + '" onclick="handleOrb()"' + (S.phase === "thinking" ? " disabled" : "") +
    ' aria-label="' + orbLabel + '"><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>' +
    '<span>' + orbIcon + '</span></button>' +
    '<div class="orb-status">' + orbLabel + '</div>';
  if (S.phase === "listening")
    h += '<div id="interim-box" class="interim">' + (esc(S.interim) || '<span style="color:var(--mut)">Listening…</span>') + '</div>';
  if (S.error) {
    h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center">' +
      '<span class="err">' + esc(S.error) + '</span>' +
      (S.micStatus === "denied" ? '<button class="btn btn-ghost" style="padding:7px 13px;font-size:12.5px" onclick="requestMic()">Allow microphone</button>' : "") +
      '</div>';
  }
  h += '</div>';
  if ((S.typedMode || !micSupported) && S.phase !== "thinking") {
    h += '<div class="typed-row">' +
      '<input id="typed-input" class="input" placeholder="Type your answer…" ' +
      'onkeydown="if(event.key===\'Enter\'&&this.value.trim()){submitAnswer(this.value.trim());this.value=\'\'}"/>' +
      '<button class="btn btn-primary" onclick="var i=document.getElementById(\'typed-input\');if(i.value.trim()){submitAnswer(i.value.trim());i.value=\'\'}">Send</button></div>';
  }
  h += feedHtml();
  h += '<div class="sess-actions">' +
    '<div class="statbar"><span>ANSWERS ' + myTurnCount() + '</span><span>FILLER WORDS ' + fillerCount() + '</span>' +
    '<span>' + (S.voiceOn ? "VOICE ON" : "VOICE OFF") + '</span>' +
    (S.savedAt ? "<span>SAVED ✓</span>" : "") + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    (micSupported ? '<button class="btn btn-ghost" onclick="S.typedMode=!S.typedMode;render()">' + (S.typedMode ? "Hide typing" : "Type instead") + '</button>' : "") +
    '<button class="btn btn-ghost" onclick="S.voiceOn=!S.voiceOn;if(!S.voiceOn)stopSpeaking();render()">' + (S.voiceOn ? "Mute voice" : "Unmute voice") + '</button>' +
    '<button class="btn btn-ghost" onclick="saveConversation()">💾 Save</button>' +
    '<button class="btn btn-primary" onclick="endSession()">End & get feedback</button>' +
    '</div></div>';
  return h;
}

function feedbackHtml(readOnly) {
  var f = S.feedback;
  var h = "";
  if (f) {
    h += '<div class="card" style="padding:22px;margin-bottom:16px">' +
      '<div class="eyebrow" style="margin-bottom:8px">VERDICT</div>' +
      '<div class="display" style="font-size:21px;line-height:1.35">' + esc(f.headline || "") + '</div>' +
      '<div class="statbar" style="margin-top:12px"><span>ANSWERS ' + myTurnCount() + '</span><span>FILLER WORDS ' + fillerCount() + '</span></div></div>';
    var bars = ["clarity", "structure", "confidence", "vocabulary"].map(function (k) {
      var s = (f.scores && f.scores[k]) || 0;
      return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">' +
        '<span style="text-transform:capitalize">' + k + '</span><span style="color:var(--mut)">' + s + '/10</span></div>' +
        '<div class="scorebar"><div style="width:' + (s * 10) + '%"></div></div></div>';
    }).join("");
    h += '<div class="grid2"><div class="card" style="padding:20px"><div class="eyebrow" style="margin-bottom:14px">SCORES</div>' + bars + '</div>' +
      '<div class="card" style="padding:20px"><div class="eyebrow" style="margin-bottom:12px">WHAT WORKED</div>' +
      (f.strengths || []).map(function (s) { return '<div class="fb-item">— ' + esc(s) + '</div>'; }).join("") + '</div></div>';
    h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">FIX NEXT SESSION</div>' +
      (f.improvements || []).map(function (s) { return '<div class="fb-item">— ' + esc(s) + '</div>'; }).join("") + '</div>';
    if ((f.power_phrases || []).length)
      h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">SAY IT SHARPER</div>' +
        f.power_phrases.map(function (p) {
          return '<div class="fb-item"><span class="weak">' + esc(p.weak) + '</span>' +
            '<span style="margin:0 8px;color:var(--mut)">→</span><span class="strong">' + esc(p.strong) + '</span></div>';
        }).join("") + '</div>';
  } else {
    h += '<div class="card" style="padding:30px;margin-bottom:16px">Feedback couldn\'t be generated this time. Your transcript is saved — run another round.</div>';
  }
  if (!readOnly)
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="startSession()">Run it again</button>' +
      '<button class="btn btn-ghost" onclick="saveConversation()">💾 Save session</button>' +
      '<button class="btn btn-ghost" onclick="goNewSession()">Change setup</button></div>';
  return h;
}

function savedHtml() {
  var h = '<div class="statbar" style="margin-bottom:14px"><span>' + esc(MODES[S.mode].tag) + '</span>' +
    '<span>ANSWERS ' + myTurnCount() + '</span><span>FILLER WORDS ' + fillerCount() + '</span></div>';
  h += feedHtml();
  h += '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" onclick="resumeSaved()">▶ Continue this session</button>' +
    '<button class="btn btn-ghost" onclick="goNewSession()">New session</button>' +
    '<button class="btn btn-danger" onclick="deleteConversation(\'' + S.convId + '\')">Delete</button></div>';
  if (S.feedback) h += '<div style="margin-top:24px">' + feedbackHtml(true) + '</div>';
  return h;
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  if (token && user) {
    $("auth-screen").style.display = "none";
    $("app-shell").style.display = "flex";
    $("user-name").textContent = user.name;
    $("user-avatar").textContent = (user.name || "?").trim().charAt(0).toUpperCase();
    loadConversations();
    render();
  } else {
    $("app-shell").style.display = "none";
    $("auth-screen").style.display = "flex";
    showAuthTab("login");
  }
}
boot();
