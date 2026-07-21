/* ============================================================
   INTERVERSE — frontend app (vanilla JS, zero build)
   ============================================================ */

/* ---------------- state ---------------- */
var token = localStorage.getItem("iv_token") || null;
var user = null;
try { user = JSON.parse(localStorage.getItem("iv_user") || "null"); } catch (e) {}

var MODES = {
  interview: { label: "Interview Drill", persona: "Drill", tag: "DRILL", color: "#136F63",
    blurb: "Drill, a sharp interviewer, works through your material — resume, essays, a job description — with probing follow-ups." },
  confidence: { label: "Confidence Coach", persona: "Cole", tag: "COLE", color: "#8A4FFF",
    blurb: "Cole puts you under pressure. After each answer you get a short note on hedging, filler words and assertiveness." },
  vocabulary: { label: "Vocabulary Builder", persona: "Lexicon", tag: "LEXICON", color: "#C2571B",
    blurb: "Lexicon converses with you and returns every answer with sharper words and phrases you could have used." }
};

var ARCS = {
  school: "1) Warm-up: who they are, how school is going. 2) Subjects & interests: favourite subject and why. 3) School work: a project, debate, competition or activity they did. 4) Beyond class: hobbies, reading, sports, responsibilities at home. 5) Looking ahead: what they want to study or become, and why.",
  college: "1) Warm-up: tell me about yourself. 2) Background: school years, what led them to this degree. 3) Academics: coursework, subjects they are strong in, why this branch. 4) Projects & internships: dig into one deeply - their role, decisions, outcome. 5) Positions of responsibility, clubs, teamwork. 6) Career: which role they are targeting and why they fit.",
  mba: "1) Warm-up: walk me through your background. 2) Early life & education: formative influences, undergrad choice. 3) Career journey: roles, progression, biggest professional win with numbers. 4) Leadership & impact: leading people, conflict, failure and what changed. 5) Why MBA, why now, why this school. 6) Post-MBA vision.",
  job: "1) Warm-up: walk me through your background. 2) Education & early career: how they got here. 3) Current role: scope, ownership, day-to-day. 4) Deep dive: their most significant project - decisions, trade-offs, quantified impact. 5) Challenges: conflict, failure, pressure. 6) Fit: why this role, what they bring.",
  fluency: "1) Warm-up: who they are, what occupies them these days. 2) Background: where they are from, formative experiences. 3) Interests: a passion explored in depth. 4) Opinions: a view they hold and the reasoning behind it. 5) Forward look: goals and aspirations."
};

var CATEGORIES = {
  school: { label: "School student (Class 8\u201312)",
    cal: "The candidate is a SCHOOL STUDENT. Keep questions age-appropriate and encouraging: studies, favourite subjects, school projects, competitions, hobbies, aspirations. Simple vocabulary, zero corporate jargon, gentle difficulty. Build their comfort speaking." },
  college: { label: "College student \u2014 placements/internships",
    cal: "The candidate is a COLLEGE STUDENT preparing for campus placements or internships. Mix HR classics (tell me about yourself, strengths, teamwork) with digs into their projects, internships, and coursework. Moderate difficulty; teach them to structure answers." },
  mba: { label: "MBA admissions (HBS, IIMs, ISB...)",
    cal: "The candidate is preparing for MBA ADMISSIONS interviews. Focus on leadership stories, career vision, why-MBA/why-this-school, failure and growth, impact with numbers. Adcom-style rigor." },
  job: { label: "Working professional \u2014 job interviews",
    cal: "The candidate is an EXPERIENCED PROFESSIONAL preparing for job interviews. Deep-dive their work experience: scope, decisions, trade-offs, quantified impact, role fit. Senior-panel rigor; challenge vague claims." },
  fluency: { label: "General fluency & public speaking",
    cal: "The candidate wants GENERAL SPEAKING FLUENCY and confidence. Have rich conversations on their interests and opinions; invite storytelling and structured argument. Friendly but substantive." }
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
  convs: [],              // sidebar list
  profile: null,          // {category, level, target, about, resume}
  insights: null
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
  var res;
  try {
    res = await fetch("/api" + path, {
      method: method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" },
        token ? { "Authorization": "Bearer " + token } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (netErr) {
    throw new Error("Can't reach the server — it may be waking up (free hosting sleeps when idle). Wait ~30 seconds and try again.");
  }
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
  $("pane-forgot").style.display = "none";
  $("pane-reset").style.display = "none";
  authMsg("");
}
function showForgot() {
  $("pane-login").style.display = "none";
  $("pane-register").style.display = "none";
  $("pane-otp").style.display = "none";
  $("pane-reset").style.display = "none";
  $("pane-forgot").style.display = "flex";
  $("fp-email").value = $("li-email").value.trim();
  authMsg("");
}
var forgotEmail = null;
async function doForgotStart() {
  var email = ($("fp-email").value || forgotEmail || "").trim();
  if (!email) { authMsg("Enter your email first"); return; }
  try {
    var r = await api("/auth/forgot-password", "POST", { email: email });
    forgotEmail = email;
    $("pane-forgot").style.display = "none";
    $("pane-reset").style.display = "flex";
    $("reset-email-label").textContent = email;
    $("rp-code").value = ""; $("rp-pass").value = "";
    $("rp-code").focus();
    authMsg(r.message + (r.devOtp ? "  (dev code: " + r.devOtp + ")" : ""), true);
  } catch (e) { authMsg(e.message); }
}
async function doResetPassword() {
  try {
    var r = await api("/auth/reset-password", "POST", {
      email: forgotEmail, code: $("rp-code").value.trim(), newPassword: $("rp-pass").value
    });
    forgotEmail = null;
    finishAuth(r);
    toast("Password reset — you're signed in ✓");
  } catch (e) { authMsg(e.message); }
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
    S.customTitle = c.title || null;
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
  var title = (S.customTitle || S.role || firstQ || MODES[S.mode].label).slice(0, 80);
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
async function renameConversation(id) {
  try {
    var c = await api("/conversations/" + id);
    var t = prompt("Rename this session:", c.title || "");
    if (t === null) return;
    t = t.trim();
    if (!t) { toast("Name can't be empty"); return; }
    await api("/conversations/" + id, "PUT", { title: t.slice(0, 80), mode: c.mode, data: c.data });
    if (S.convId === id) S.customTitle = t.slice(0, 80);
    loadConversations();
    toast("Renamed \u2713");
  } catch (e) { toast(e.message); }
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
/* Build the personal coaching memory block from past-session insights. */
function coachingMemory() {
  var ins = S.insights && S.insights.personal;
  if (!ins || (!ins.improvements.length && !ins.weak_phrases.length)) return "";
  var s = "\n== COACHING MEMORY (from this candidate's past sessions — use naturally, never recite as a list) ==\n";
  if (ins.improvements.length)
    s += "Known improvement areas: " + ins.improvements.slice(0, 4).join("; ") + "\n";
  if (ins.weak_phrases.length)
    s += "Phrases they've overused before: " + ins.weak_phrases.slice(0, 6).join(", ") + "\n";
  s += "Watch for these. If they repeat an old habit, gently note it in tip. If they've clearly improved on one, acknowledge it once in your spoken reply — people love having progress noticed.\n\n";
  return s;
}

function arcBlock() {
  var p = S.profile || {};
  var arc = ARCS[p.category] || ARCS.fluency;
  var stage = S.turns.filter(function (t) { return t.who === "ai"; }).length;
  return "== SESSION ARC (follow this order) ==\n" + arc + "\n" +
    "HOW TO USE THIS ARC: it is a loose map for the whole session, NOT a script and NOT a checklist. The live conversation ALWAYS outranks it. If the candidate's last answer opened a thread - they named a goal, an interest, a problem, a person, an event - you MUST follow that thread for at least 2-3 exchanges before any arc stage. Only reach for the next stage when the current thread is genuinely exhausted. Advance with a natural bridge, never announce stages. You have completed about " + stage + " exchange(s); the arc spans roughly 12-15.\n\n";
}

function profileBlock() {
  var p = S.profile || {};
  if (!p.category && !p.about && !p.resume) return "";
  var cat = CATEGORIES[p.category];
  var s = "== CANDIDATE PROFILE ==\n";
  if (cat) s += "Who they are: " + cat.label + (p.level ? " \u2014 " + p.level : "") + "\n";
  if (p.target) s += "Preparing for: " + p.target + "\n";
  if (p.about) s += "About them: " + p.about + "\n";
  if (p.resume) s += "RESUME (extracted text):\n" + p.resume.slice(0, 5000) + "\n";
  if (cat) s += "\nCALIBRATION: " + cat.cal + "\n";
  return s + "\n";
}

function systemPrompt() {
  var material = S.content ? S.content : "(none provided)";
  var goal = S.role ? S.role : "(not specified)";
  var base =
"You are Interverse, a live spoken-voice practice partner. Your reply is SPOKEN ALOUD in a natural human conversation.\n\n" +
profileBlock() +
arcBlock() +
"== TODAY'S SESSION MATERIAL ==\n" + material + "\n\n" +
"== TODAY'S SESSION GOAL ==\n" + goal + "\n\n" +
"== HOW TO CONVERSE (most important) ==\n" +
"1. REACT FIRST, ASK SECOND. Start every reply (except the very first) with one sentence genuinely engaging what they just said. VARY HOW: build on their idea, offer a quick take, gently challenge, or connect it to something earlier. The template \u201cYou mentioned/said \u2018X\u2019, that's interesting\u201d is BANNED after one use per session — do not quote their words back at them every turn. Never generic praise like 'great answer'.\n" +
"1a. FOLLOW THE THREAD: your question must arise from the candidate's LAST answer at least 3 turns out of every 4. If they mention a goal, a subject, a problem or a plan, get curious about THAT - ask which one, why, what happened, how it felt. Jumping to an unrelated topic while a fresh thread is open is the single worst thing you can do.\n" +
"1d. NO REFORMULATION OPENERS: never open by restating their answer back as a summary ('You're looking to improve X, that's a great goal', 'You mentioned Y, that's interesting'). React with something that ADDS - a reaction, a connection, a light challenge - or skip the reaction entirely and just ask the curious question.\n" +
"1b. QUESTIONS ARE SHORT: one clause, under 20 words, exactly one thing asked. Never stack sub-questions or trailing context into one long question.\n" +
"1c. LISTEN AND REMEMBER: if the candidate says something doesn't exist, didn't happen, or they've already answered it — DROP that thread immediately and pivot to an adjacent topic. If they repeat themselves or correct you, own it briefly (\u201cGot it, my mistake\u201d) and move on; NEVER quote their correction back at them.\n" +
"2. THIS IS A DIALOGUE, NOT A QUIZ. Vary your rhythm: mostly follow-up questions that dig into their last answer, sometimes a brief observation or gentle challenge ('That sounds like it came at a cost — what was it?'), occasionally just 'take me deeper into that'. Never fire a brand-new unrelated question two turns in a row.\n" +
"3. STAY ON TOPIC: everything you say must connect to their profile, resume, session material, goal, or something the candidate said earlier. No trivia, no topic hopping.\n" +
"3a. PROFILE IS SILENT CALIBRATION: their class, degree, company, or category shapes your difficulty and topics SILENTLY. NEVER recite profile facts back at them (\u201c...which you're studying in Class 10th\u201d, \u201cas a B.Tech student\u201d, \u201clike you've been learning about\u201d). You may mention their level ONCE, in your intro, and never again unless they bring it up themselves.\n" +
"3b. BE CONCRETE, NEVER GENERIC: every question must name at least one SPECIFIC detail \u2014 a project, company, subject, number, or claim quoted from their profile/resume/material or their previous answer. \u201cTell me about a challenge you faced\u201d is BANNED; \u201cYour resume says you rebuilt the O2A allocation dashboard \u2014 what broke in the old one?\u201d is the standard. If you have no details yet, your question must extract one.\n" +
"4. Keep it human and spoken: under 70 words, contractions welcome, no markdown, no bullets, no lists, at most ONE question mark per reply.\n" +
"5. Never repeat a question already asked. Never answer for the candidate. Never lecture.\n" +
"5b. FACT CHECK: if the candidate states something factually wrong and you are CONFIDENT it's wrong (example: calling Hindi India's national language — India has no national language; Hindi is an official language), add a one-line correction in tip starting \u201cFact check:\u201d. Only when confident; never invent corrections.\n" +
"5c. TIP PRIORITIES: your tip follows your MODE's duty (vocabulary upgrades / assertive rewrites / structure notes / a stronger angle they could have taken). Grammar enters a tip ONLY for MAJOR errors \u2014 ones that change meaning or would clearly embarrass in a real interview (like \u201cwrong is happening\u201d \u2192 \u201csomething wrong is happening\u201d). Minor slips: ignore during the conversation \u2014 they are collected in the final report instead. Never praise an incorrect phrase, but never let small grammar policing crowd out real coaching.\n" +
coachingMemory() +
"6. OUTPUT: respond with ONLY this JSON object — no code fences, nothing before or after. Inside the JSON strings, when quoting the candidate's words use curly quotes \u201c \u201d, NEVER straight double quotes, so the JSON stays valid:\n" +
'{"reply": "<what you say aloud>", "tip": "<on-screen coaching note per your mode rules, or empty string>"}\n\n';

  if (S.mode === "interview")
    return base +
"== YOUR MODE: INTERVIEW DRILL ==\n" +
"Your name is Drill. You are a rigorous but human interviewer (MBA admissions / senior hiring panel) working through the candidate's own material.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself by name and preview the focus, e.g. \u201cHey, I'm Drill. Today I'll be interviewing you on <one-line summary of their material or goal — name the actual topic>.\u201d Then hand over: ask them to introduce themselves (\u201cTo start, tell me a bit about yourself.\u201d). Never repeat this introduction later.\n" +
"- Stay with each story for 2-3 exchanges before moving on: push for numbers, decisions, trade-offs, what they'd change.\n" +
"- Escalate over the session: factual → 'why you' → stress questions (failure, conflict, weakness), all tied to their material.\n" +
"- tip after each answer (max 20 words): one note on structure, specificity, or dodging — quote their words. Empty on your first turn.";

  if (S.mode === "confidence")
    return base +
"== YOUR MODE: CONFIDENCE COACH ==\n" +
"Your name is Cole. You train assertive, decisive delivery through conversation. Topics come from their material; your written tips analyze HOW they speak.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself, e.g. \u201cHey, I'm Cole, your confidence coach. Today we'll talk about <their material/goal in one line> — and I'll be watching how assertively you say it.\u201d Then open by asking them to introduce themselves. Never repeat this introduction later.\n" +
"- Converse about ownership, pressure, conflict from their material — react to their content genuinely, then push one level harder.\n" +
"- tip is MANDATORY every turn, max 30 words: QUOTE one weak fragment (hedging, passive voice, apologising, filler) and give the assertive rewrite, formatted \u201ctheir words\u201d \u2192 \u201cstronger version\u201d. If delivery was genuinely strong, name the strongest sentence and why.\n" +
"- Spoken reply never discusses delivery — that lives only in tip.";

  return base +
"== YOUR MODE: VOCABULARY BUILDER ==\n" +
"Your name is Lexicon. You are a warm, articulate conversation partner helping upgrade their word choice. Topics come from their material and invite rich description and opinion.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself, e.g. \u201cHi, I'm Lexicon. Today we'll have a conversation about <their material/goal in one line>, and I'll help you find sharper words as we go.\u201d Then open by asking them to introduce themselves. Never repeat this introduction later.\n" +
"- Genuinely converse: react to their ideas, agree or gently push back, then draw out more.\n" +
"- tip is MANDATORY every turn: 2-3 words or phrases THEY ACTUALLY USED, upgraded as: their word \u2192 stronger word (micro-gloss). Only quote words present in their answer.\n" +
"- Naturally reuse ONE upgraded word in your next spoken reply so they hear it in context.";
}

/* Per-turn reinforcement: smaller models drift from the system prompt as context
   grows. A compact reminder rides on the LAST user message at request time only —
   S.history itself stays clean. */
function turnReminder() {
  var qNum = S.turns.filter(function (t) { return t.who === "ai"; }).length + 1;
  var modeBit = S.mode === "interview"
    ? "tip: one short note on my answer's structure or specificity, quoting my words."
    : S.mode === "confidence"
      ? "tip REQUIRED: quote one weak fragment of mine and rewrite it assertively."
      : "tip REQUIRED: 2-3 words I actually used, upgraded weak \u2192 strong.";
  return "\n\n[Reminder — never mention this bracket: " + MODES[S.mode].label.toUpperCase() +
    " mode, exchange " + qNum + " of ~14. Build on what I JUST said - follow that thread before any new topic; the arc waits. No reformulation openers. FIRST react in one sentence to something specific I just said, THEN continue — one question max, or none. Stay on my material/goal. Converse, don't interrogate; name a concrete detail from my answers or resume \u2014 but never recite my class/degree/category back at me. Grammar in tip only if the error is major. " +
    modeBit + " Reply with ONLY the JSON {\"reply\",\"tip\"}.]";
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
    // clone history; the reinforcement reminder rides only on the outgoing copy
    var payload = S.history.map(function (m) { return { role: m.role, content: m.content }; });
    for (var i = payload.length - 1; i >= 0; i--) {
      if (payload[i].role === "user") { payload[i].content += turnReminder(); break; }
    }
    var r = await api("/chat", "POST", { system: systemPrompt(), messages: payload, max_tokens: 1000 });
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

function goProfile() {
  S.screen = "profile";
  closeSidebarMobile();
  render();
}
async function saveProfile() {
  var p = {
    category: $("pf-category").value,
    level: $("pf-level").value.trim(),
    target: $("pf-target").value.trim(),
    about: $("pf-about").value.trim(),
    resume: (S.profile && S.profile.resume) || ""
  };
  try {
    var r = await api("/profile", "PUT", p);
    S.profile = r.profile;
    toast("Profile saved \u2713");
    S.screen = "setup"; render();
  } catch (e) { toast(e.message); }
}
async function handleResumeFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var status = $("pf-resume-status");
  status.textContent = "Reading " + file.name + "\u2026";
  try {
    var text = "";
    if (/\.pdf$/i.test(file.name)) {
      if (!window.pdfjsLib) throw new Error("PDF reader didn't load \u2014 refresh and try again");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      var buf = await file.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      var parts = [];
      for (var i = 1; i <= Math.min(pdf.numPages, 10); i++) {
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        parts.push(tc.items.map(function (it) { return it.str; }).join(" "));
      }
      text = parts.join("\n");
    } else {
      text = await file.text();
    }
    text = text.replace(/\s+/g, " ").trim().slice(0, 60000);
    if (text.length < 50) throw new Error("Couldn't extract text \u2014 if it's a scanned PDF, paste the text into About instead");
    if (!S.profile) S.profile = {};
    S.profile.resume = text;
    status.textContent = "\u2713 " + file.name + " \u2014 " + text.length + " characters extracted. Save profile to keep it.";
  } catch (e) {
    status.textContent = "\u26a0 " + e.message;
  }
}
function clearResume() {
  if (S.profile) S.profile.resume = "";
  $("pf-resume-status").textContent = "Resume removed. Save profile to confirm.";
}

function goNewSession() {
  stopSpeaking(); listeningWanted = false;
  S.convId = null; S.turns = []; S.history = []; S.feedback = null; S.customTitle = null;
  S.screen = "setup"; S.phase = "idle"; S.error = ""; S.savedAt = null;
  closeSidebarMobile();
  render(); renderConvList();
}
function startSession() {
  S.turns = []; S.history = []; S.feedback = null; S.savedAt = null;
  if (!S.convId) S.convId = uuid();
  S.screen = "session";
  if (micSupported && S.micStatus === "unknown") requestMic();
  if (!S.profile || !S.profile.category)
    toast("Interviewer's scope will be improved if you update your profile");
  // load coaching memory in the background; first question doesn't wait for it
  S.insights = null;
  api("/insights").then(function (d) { S.insights = d; }).catch(function () {});
  aiTurn(null);
}
function resumeSaved() {
  S.screen = "session"; S.phase = "idle"; S.error = "";
  render();
}

/* Extra context for the feedback grader: past scores (progress tracking) and
   anonymized community patterns ("usually people prefer to say X instead of Y"). */
function feedbackContext() {
  var s = "";
  var ins = S.insights;
  if (ins && ins.personal && ins.personal.scores && ins.personal.scores.length) {
    s += "\n\nPAST SESSION SCORES for this candidate (most recent first): " +
      JSON.stringify(ins.personal.scores.slice(0, 3)) +
      "\nCompare honestly: if a dimension clearly improved or slipped versus past sessions, mention it in the headline or improvements.";
  }
  if (ins && ins.community && ins.community.common_upgrades && ins.community.common_upgrades.length) {
    s += "\n\nCOMMUNITY PATTERNS (anonymized across all Interverse users — phrase upgrades that keep recurring):\n" +
      ins.community.common_upgrades.slice(0, 8).map(function (c) {
        return '- "' + c.weak + '" -> "' + c.strong + '"';
      }).join("\n") +
      '\nWhen one of these patterns appears in THIS transcript, you may frame the suggestion as: "usually people prefer to say <strong> instead of <weak>". Only use patterns that actually occur in the transcript.';
  }
  return s;
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
    '"power_phrases":[{"weak":"<exact words the candidate said>","strong":"<sharper replacement>"}],\n' +
    '"grammar_notes":[{"said":"<exact incorrect phrase from CANDIDATE lines>","correct":"<corrected version>"}]}\n' +
    'Rules:\n' +
    '- strengths and improvements: 2-4 items each, specific to THIS transcript, quoting their actual words where possible.\n' +
    '- power_phrases: 4-6 items, MANDATORY. Each "weak" must be an EXACT word or short phrase copied from the CANDIDATE lines — weak verbs (did, got, helped), vague nouns (stuff, things, a lot), hedges (I think, maybe, kind of), filler. Each "strong" is the professional upgrade. Never invent quotes.\n' +
    '- grammar_notes: 2-6 items covering ALL noticeable grammar or phrasing errors the candidate made \u2014 quote the exact words, give the natural corrected version. Include minor slips here (this is where they belong, not in live tips). Empty array if their grammar was clean.\n' +
    '- Scores reflect the whole session honestly; do not inflate.' +
    feedbackContext();
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
  else if (S.screen === "profile") v.innerHTML = profileHtml();

  var feed = $("feed"); if (feed) feed.scrollTop = feed.scrollHeight;
  var ta = $("su-content"); if (ta) ta.value = S.content;
  var ri = $("su-role"); if (ri) ri.value = S.role;
}

function profileHtml() {
  var p = S.profile || {};
  var opts = Object.keys(CATEGORIES).map(function (k) {
    return '<option value="' + k + '"' + (p.category === k ? " selected" : "") + '>' + CATEGORIES[k].label + '</option>';
  }).join("");
  var resumeState = p.resume
    ? '\u2713 Resume on file (' + p.resume.length + ' characters) <button class="btn-link" onclick="clearResume()">remove</button>'
    : 'No resume uploaded yet.';
  return '<div class="card" style="padding:22px;max-width:640px">' +
    '<div class="eyebrow" style="margin-bottom:14px">WHO ARE YOU PRACTISING AS?</div>' +
    '<label style="font-size:13px;color:var(--mut)">I am a\u2026</label>' +
    '<select id="pf-category" class="input" style="margin:6px 0 14px">' +
    '<option value="">\u2014 choose your profile \u2014</option>' + opts + '</select>' +
    '<input id="pf-level" class="input" style="margin-bottom:14px" placeholder="Level / class / experience \u2014 e.g. Class 10, B.Tech 3rd year, 5 years in supply chain" value="' + esc(p.level || "") + '"/>' +
    '<input id="pf-target" class="input" style="margin-bottom:14px" placeholder="Target \u2014 e.g. NTSE interview, TCS placement, ISB admission, Product Manager at a startup" value="' + esc(p.target || "") + '"/>' +
    '<textarea id="pf-about" class="input" rows="4" style="resize:vertical;margin-bottom:14px" placeholder="About you \u2014 achievements, projects, interests the interviewer should know">' + esc(p.about || "") + '</textarea>' +
    '<div class="eyebrow" style="margin-bottom:8px">RESUME (optional)</div>' +
    '<input type="file" id="pf-resume" accept=".pdf,.txt" onchange="handleResumeFile(this)" style="font-size:13px;margin-bottom:6px"/>' +
    '<div id="pf-resume-status" style="font-size:12.5px;color:var(--mut);margin-bottom:18px">' + resumeState + '</div>' +
    '<div style="display:flex;gap:10px">' +
    '<button class="btn btn-primary" onclick="saveProfile()">Save profile</button>' +
    '<button class="btn btn-ghost" onclick="S.screen=\'setup\';render()">Cancel</button></div></div>';
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
    var aiStyle = t.who === "ai" ? ' style="border-left:3px solid ' + (MODES[S.mode] ? MODES[S.mode].color : "#136F63") + '"' : '';
    var b = '<div class="bubble ' + (t.who === "ai" ? "ai" : "me") + '"' + aiStyle + '>' + esc(t.text) + '</div>';
    if (t.tip) b += '<div class="tipline">◈ ' + esc(t.tip) + '</div>';
    return b;
  }).join("");
  if (S.phase === "thinking" && S.turns.length)
    inner += '<div class="bubble ai" style="color:var(--mut)">…</div>';
  return '<div class="card"><div id="feed" class="feed">' + inner + '</div></div>';
}

function sessionHtml() {
  var m = MODES[S.mode];
  var personaChip = '<div style="display:flex;align-items:center;gap:9px;justify-content:center;margin-bottom:2px">' +
    '<span style="width:34px;height:34px;border-radius:50%;background:' + m.color + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">' + m.persona.charAt(0) + '</span>' +
    '<span><b style="font-size:14.5px">' + m.persona + '</b> <span style="color:var(--mut);font-size:12px">\u00b7 ' + m.label + '</span></span></div>';
  var orbIcon = S.phase === "listening" ? "◼" : S.phase === "thinking" ? "…" : S.phase === "speaking" ? "♪" : "🎙";
  var orbLabel = S.phase === "listening" ? "Tap to send your answer"
    : S.phase === "thinking" ? "Interviewer is thinking…"
    : S.phase === "speaking" ? "Speaking — tap to interrupt" : "Tap to speak";
  var h = '<div class="orb-zone">' + personaChip +
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
    if ((f.grammar_notes || []).length)
      h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">GRAMMAR &amp; PHRASING</div>' +
        f.grammar_notes.map(function (g) {
          return '<div class="fb-item"><span class="weak">' + esc(g.said) + '</span>' +
            '<span style="margin:0 8px;color:var(--mut)">→</span><span class="strong">' + esc(g.correct) + '</span></div>';
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
    '<button class="btn btn-ghost" onclick="renameConversation(\'' + S.convId + '\')">\u270e Rename</button>' +
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
    api("/profile").then(function (p) {
      S.profile = p || {};
      if (!S.profile.category && S.screen === "setup") {
        S.screen = "profile";
        toast("Set up your profile so the interviewer knows who you are");
      }
      render();
    }).catch(function () { S.profile = {}; });
    render();
  } else {
    $("app-shell").style.display = "none";
    $("auth-screen").style.display = "flex";
    showAuthTab("login");
  }
}
boot();
