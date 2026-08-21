/* ============================================================
   INTERVERSE — frontend app (vanilla JS, zero build)
   ============================================================ */

/* ---------------- state ---------------- */
var token = localStorage.getItem("iv_token") || null;
var user = null;
try { user = JSON.parse(localStorage.getItem("iv_user") || "null"); } catch (e) {}

/* Personas are named for what they help you do, not for what they do to you:
   short, easy to say aloud, each signalling its skill. `persona` is the single
   source of truth — the prompts read it from here rather than hardcoding a name,
   so renaming a coach can never leave a stale name inside an instruction.
   `track` groups modes under the two tabs at the top of the setup screen. */
var MODES = {
  interview: { label: "Interview Practice", persona: "Ace", tag: "INTERVIEW", color: "#136F63", track: "interview",
    blurb: "Ace interviews you on your own material — resume, essays, a job description — with the follow-ups a real panel would ask." },
  hrbatch: { label: "HR Question Set", persona: "Ally", tag: "HR SET", color: "#8A4FFF", track: "interview",
    blurb: "Ally runs you through 5 or 10 HR questions tailored to your profile. See the whole list up front, then answer one by one." },
  vocabulary: { label: "Vocabulary Builder", persona: "Quill", tag: "WORDS", color: "#C2571B", track: "interview",
    blurb: "Quill talks with you and hands back every answer with sharper words and phrases you could have used." },
  extempore: { label: "Extempore Speaking", persona: "Spark", tag: "ON THE SPOT", color: "#1F5FA8", track: "extempore",
    blurb: "Spark gives you a topic and you speak on it for a minute or two, unprepared — then tells you how it landed." }
};

/* Fallback topics when nothing is uploaded and topic generation is unavailable.
   Deliberately open-ended: each can be argued either way, which is what makes a
   topic speakable for two minutes rather than answerable in one sentence. */
var TOPIC_BANK = {
  general: [
    "The best advice I ever ignored",
    "Something I changed my mind about",
    "A skill everyone should learn but most don't",
    "The most underrated quality in a person",
    "A rule worth breaking",
    "What I would do with a free year",
    "The hardest part of working with other people",
    "A tradition worth keeping and one worth ending",
    "Something small that improved my life",
    "When is quitting the right decision?"
  ],
  abstract: [
    "Distance", "Silence", "The colour blue", "A locked door", "Momentum",
    "The number seven", "An empty chair", "Speed", "Borders", "A second chance"
  ],
  opinion: [
    "Failure is a better teacher than success",
    "Social media has made us worse listeners",
    "Talent is overrated compared with consistency",
    "Cities are better places to grow up than towns",
    "Remote work costs more than it saves",
    "Exams measure the wrong things",
    "Ambition is not the same as purpose",
    "We romanticise being busy",
    "Reading fiction makes you better at your job",
    "Most decisions should be made faster"
  ]
};

function pickTopics(kind, n) {
  var pool = (TOPIC_BANK[kind] || TOPIC_BANK.general).slice();
  var out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

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
  scenario: "",           // who's interviewing you and how
  entry: "material",      // "material" = dive straight in | "background" = 4 warm-up exchanges first
  track: "interview",     // top-level tab: "interview" (3 modes) | "extempore"
  topicSrc: "generic",    // extempore: "material" = topics from what you uploaded | "generic" = from a bank
  topicKind: "general",   // extempore, generic topics: general | abstract | opinion
  spokeFrom: 0,           // timestamp the current answer started, for the speaking clock
  askedAt: 0,             // moment the interviewer's voice stopped — the think clock starts here
  thinkMs: null,          // this turn's pause, measured until the FIRST word is actually heard
  docName: "", docKind: "", docSlides: 0,   // uploaded material
  image: "", imageName: "",                 // uploaded image: data URL + filename
  profile: null,          // {category, level, target, about, resume}
  insights: null,
  batchSize: 5,           // HR practice: 5 or 10
  batch: null             // {questions:[...], idx:0} when in HR batch mode
};

var pendingOtpEmail = null;

/* ---------------- helpers ---------------- */
/* Groq's free tier gives llama-3.3-70b-versatile 12,000 tokens per MINUTE,
   input and output counted together, per organization. Analytics scoring fires
   alongside every conversational turn, so one exchange is really two requests.
   Everything long is budgeted before it goes in the prompt; the server trims
   again as a backstop. Middle-out, because the start of a document sets it up
   and the end usually concludes it. */
/* The fixed rules in the system prompt already cost ~2,300 tokens, so the
   variable parts get what's left. Measured, not guessed. */
var PROMPT_CHARS = {
  material: 3500,     // ~970 tokens
  resume: 1500,       // ~420
  transcript: 9000,   // end-of-session report: one request, nothing running beside it
  historyTurns: 10,   // most recent messages kept
  historyMsg: 1200,   // per message
  historyTotal: 3500  // ~970 tokens across the lot
};

function budget(str, maxChars) {
  var t = String(str == null ? "" : str);
  if (t.length <= maxChars) return t;
  var marker = "\n\n[\u2026 middle trimmed to fit the model's rate limit \u2026]\n\n";
  var keep = maxChars - marker.length;
  var head = Math.floor(keep * 0.7);
  return t.slice(0, head) + marker + t.slice(-(keep - head));
}

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
  if (!res.ok) {
    var err = new Error((data && data.error) || "Request failed");
    if (res.status === 429) err.retryAfter = (data && Number(data.retry_after)) || 20;
    throw err;
  }
  return data;
}

/* Every AI call goes through the rate governor, which paces requests against
   Groq's per-minute token budget instead of letting them 429. priority 2 is the
   live conversation, 1 is a foreground wait (transcription), 0 is background. */
function aiCall(body, priority, onWait) {
  var L = window.IVLimit;
  if (!L) return api("/chat", "POST", body);
  var imgs = body.images || [];
  var est = L.textTokens(body.system) +
    (body.messages || []).reduce(function (n, m) { return n + L.textTokens(m.content); }, 0) +
    imgs.reduce(function (n, u) { return n + L.imageTokens(u); }, 0) +
    (Number(body.max_tokens) || 1000);
  var bucket = imgs.length ? "vision" : body.tier === "small" ? "small" : "text";
  return L.run(bucket, est, priority == null ? 2 : priority,
    function () { return api("/chat", "POST", body); }, onWait);
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
  // These two were left visible: signing in with an unverified account while a
  // reset was half-finished stacked two panes on top of each other.
  $("pane-forgot").style.display = "none";
  $("pane-reset").style.display = "none";
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
    S.scenario = c.data.scenario || "";
    S.entry = c.data.entry || "material";
    S.image = c.data.image || ""; S.imageName = c.data.imageName || "";
    S.topicSrc = c.data.topicSrc || "generic"; S.topicKind = c.data.topicKind || "general";
    S.docName = c.data.docName || ""; S.docKind = c.data.docKind || ""; S.docSlides = c.data.docSlides || 0;
    S.role = c.data.role || "";
    S.turns = c.data.turns || [];
    S.history = c.data.history || [];
    S.feedback = c.data.feedback || null;
    if (window.IVAnalytics) IVAnalytics.hydrate(c.data.analytics);
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
        content: S.content, role: S.role, scenario: S.scenario, entry: S.entry,
        image: S.image, imageName: S.imageName,
        topicSrc: S.topicSrc, topicKind: S.topicKind,
        docName: S.docName, docKind: S.docKind, docSlides: S.docSlides,
        turns: S.turns, history: S.history, feedback: S.feedback,
        analytics: window.IVAnalytics ? IVAnalytics.serialize() : null,
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

/* ---- collapse (desktop) ---- */
function collapseSidebar() {
  document.getElementById("app-shell").classList.add("side-hidden");
  try { localStorage.setItem("iv_side", "hidden"); } catch (e) {}
}
function expandSidebar() {
  document.getElementById("app-shell").classList.remove("side-hidden");
  try { localStorage.setItem("iv_side", "shown"); } catch (e) {}
}
function restoreSidebar() {
  var v = "";
  try { v = localStorage.getItem("iv_side") || ""; } catch (e) {}
  if (v === "hidden") document.getElementById("app-shell").classList.add("side-hidden");
}

/* ---- feedback ---- */
var fbRating = "";
function toggleFeedback() {
  var p = $("fb-panel"), c = $("fb-caret");
  if (!p) return;
  var open = p.style.display !== "none";
  p.style.display = open ? "none" : "block";
  if (c) c.textContent = open ? "\u25be" : "\u25b4";
  if (!open) { var t = $("fb-text"); if (t) t.focus(); }
}
function setFbRating(r) {
  fbRating = fbRating === r ? "" : r;
  [].forEach.call(document.querySelectorAll(".fb-face"), function (b) {
    b.classList.toggle("sel", b.getAttribute("data-r") === fbRating);
  });
}
async function sendFeedback() {
  var t = $("fb-text"), st = $("fb-status"), btn = $("fb-send");
  if (!t) return;
  var msg = t.value.trim();
  if (msg.length < 3) { st.textContent = "Add a line or two first."; st.className = "fb-status warn"; return; }
  btn.disabled = true; st.textContent = "Sending\u2026"; st.className = "fb-status";
  try {
    await api("/feedback", "POST", { rating: fbRating, message: msg, page: S.screen });
    t.value = ""; fbRating = "";
    [].forEach.call(document.querySelectorAll(".fb-face"), function (b) { b.classList.remove("sel"); });
    st.textContent = "Thanks \u2014 that helps."; st.className = "fb-status ok";
    setTimeout(function () {
      var p = $("fb-panel"), c = $("fb-caret");
      if (p) p.style.display = "none";
      if (c) c.textContent = "\u25be";
      if (st) st.textContent = "";
    }, 1800);
  } catch (e) {
    st.textContent = e.message || "Couldn't send that.";
    st.className = "fb-status warn";
  }
  btn.disabled = false;
}
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
var rec = null, listeningWanted = false, finalText = "", interimText = "", restartTimer = null;

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
    if ((finalText + interimText).trim()) markSpeechStarted();
    S.interim = finalText + interimText;
    var box = $("interim-box"); if (box) box.textContent = S.interim || "Listening…";
  };
  rec.onerror = function (e) {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      S.micStatus = "denied";
      S.error = "Microphone blocked. Allow mic access from the browser's site settings, or type your answer.";
      S.typedMode = true; listeningWanted = false; S.phase = "idle"; render();
    }
    // no-speech / aborted / network: don't kill the session — onend will auto-restart
    // as long as the user hasn't tapped stop. Just note it quietly.
  };
  // The Web Speech API stops on its own after a pause or ~60s, even mid-thought.
  // Keep restarting until the user explicitly taps stop, so long answers aren't cut off.
  rec.onend = function () {
    if (!listeningWanted) return;
    restartTimer = setTimeout(function () {
      if (!listeningWanted) return;
      try { rec.start(); }
      catch (e) {
        // "already started" or transient: try once more shortly
        setTimeout(function () { if (listeningWanted) { try { rec.start(); } catch (e2) {} } }, 250);
      }
    }, 100);
  };
  listeningWanted = true;
  S.phase = "listening"; S.interim = "";
  if (window.IVAnalytics) IVAnalytics.startAnswer();
  startSpeakClock();
  render();
  try { rec.start(); } catch (e) {}
}
function stopListening(send) {
  listeningWanted = false;
  stopSpeakClock(); stopThinkClock();
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (rec) { try { rec.stop(); } catch (e) {} }
  var text = (finalText + " " + interimText).trim();
  finalText = ""; interimText = ""; S.interim = "";
  if (send && text) submitAnswer(text);
  else { S.phase = "idle"; render(); }
}
/* Two different clocks, both written straight into the DOM rather than through
   render(), which would tear down the live transcript every second.

   THINK CLOCK — runs from the moment the interviewer stops speaking until the
   candidate's first word is actually heard. Not until they tap the orb: tapping
   and then sitting in silence is exactly the hesitation worth measuring.

   SPEAK CLOCK — how long they then held the floor (extempore only). */
var speakTimer = null, thinkTimer = null;

function startThinkClock() {
  stopThinkClock();
  S.askedAt = Date.now();
  S.thinkMs = null;
  thinkTimer = setInterval(function () {
    var el = $("think-clock");
    if (!el || !S.askedAt) return;
    var secs = Math.floor((Date.now() - S.askedAt) / 1000);
    el.textContent = secs + "s";
    // A couple of seconds to gather yourself is composure; past ten it reads as
    // being caught out, which is the thing worth practising away.
    el.style.color = secs < 5 ? "var(--mut)" : secs < 10 ? "var(--amber)" : "var(--rec)";
  }, 1000);
}

function stopThinkClock() {
  if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
}

/* Called on the first word actually transcribed. Idempotent — the recogniser
   fires onresult many times per answer and only the first should count. */
function markSpeechStarted() {
  if (S.thinkMs !== null || !S.askedAt) return;
  S.thinkMs = Date.now() - S.askedAt;
  stopThinkClock();
  S.spokeFrom = Date.now();   // the speaking clock starts at the first real word too
}

function thinkText(ms) {
  if (ms == null) return "—";
  var s = ms / 1000;
  return (s < 10 ? s.toFixed(1) : Math.round(s)) + "s";
}

function speakClockText(secs) {
  var m = Math.floor(secs / 60), r = secs % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

function startSpeakClock() {
  stopSpeakClock();
  if (!S.spokeFrom) S.spokeFrom = Date.now();
  if (S.mode !== "extempore") return;
  speakTimer = setInterval(function () {
    var el = $("speak-clock");
    if (!el) return;
    var secs = Math.floor((Date.now() - S.spokeFrom) / 1000);
    el.textContent = speakClockText(secs);
    // 60s is a respectable extempore; 120s is the usual ceiling.
    el.style.color = secs < 60 ? "var(--mut)" : secs < 120 ? "var(--teal)" : "var(--amber)";
  }, 1000);
}

function stopSpeakClock() {
  if (speakTimer) { clearInterval(speakTimer); speakTimer = null; }
}

function handleOrb() {
  if (S.phase === "listening") stopListening(true);
  else if (S.phase === "idle") startListening();
  else if (S.phase === "speaking") { stopSpeaking(); S.phase = "idle"; startThinkClock(); render(); }
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
/* How long the candidate sat with each question before speaking. Only turns
   where the pause was actually measured count — typed answers and resumed
   sessions have no reading. */
function pauseStats() {
  var v = S.turns.filter(function (t) { return t.who === "me" && typeof t.thinkMs === "number"; })
                 .map(function (t) { return t.thinkMs; });
  if (!v.length) return null;
  var sum = v.reduce(function (a, n) { return a + n; }, 0);
  return { n: v.length, avg: sum / v.length, max: Math.max.apply(null, v), min: Math.min.apply(null, v) };
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

/* How this session opens. With material loaded the candidate chooses on the setup
   screen: dive straight into it, or 4 background exchanges first. With no material
   there is nothing to dive into, so the arc runs as before. */
var WARMUP_EXCHANGES = 4;

function entryPlan() {
  if (S.mode === "extempore") return "none";   // extempore opens with a topic, not a warm-up
  if (!(S.content || "").trim() && !S.image) return "none";
  return S.entry === "background" ? "background" : "material";
}

function entryBlock() {
  var plan = entryPlan();
  if (plan === "none") return "";
  var done = S.turns.filter(function (t) { return t.who === "ai"; }).length;
  if (plan === "material")
    return "== HOW THIS SESSION OPENS (HIGH PRIORITY) ==\n" +
      "The candidate asked to go STRAIGHT INTO THEIR MATERIAL. Your first question must be about TODAY'S SESSION MATERIAL below and must name something specific in it \u2014 a claim, a number, a slide, a line. Do NOT open with \u201ctell me about yourself\u201d and do NOT walk their education or career history unless the material itself is about that. For this session the material is the map: every question comes from it or from what they just said about it.\n\n";
  var left = Math.max(0, WARMUP_EXCHANGES - done);
  // left drives the "warm-up over" switch below
  return "== HOW THIS SESSION OPENS (HIGH PRIORITY) ==\n" +
    "The candidate asked for a SHORT BACKGROUND WARM-UP first: about " + WARMUP_EXCHANGES +
    " exchanges on who they are and what they're preparing for, then a permanent move into TODAY'S SESSION MATERIAL below.\n" +
    (left > 0
      ? "You are on warm-up exchange " + (done + 1) + " of " + WARMUP_EXCHANGES +
        ". Stay on their background \u2014 do not open the material yet.\n\n"
      : "The warm-up is OVER. Bridge into the material now (\u201cLet's turn to what you brought\u2026\u201d) and stay there: from here every question must name something specific in the material. Do NOT return to general background questions.\n\n");
}

function arcBlock() {
  if (S.mode === "extempore") return "";   // topics, not a life-story arc
  var plan = entryPlan();
  if (plan === "material") return "";   // the material is the map; the arc would fight it
  var p = S.profile || {};
  var arc = ARCS[p.category] || ARCS.fluency;
  var stage = S.turns.filter(function (t) { return t.who === "ai"; }).length;
  if (plan === "background")
    return "== WARM-UP MAP (the first " + WARMUP_EXCHANGES + " exchanges only) ==\n" + arc + "\n" +
      "Draw only on the EARLIEST stages of this map to get to know them, then hand over to their material as instructed above. This map does not govern the rest of the session. Never announce stages.\n\n";
  return "== SESSION ARC (follow this order) ==\n" + arc + "\n" +
    "HOW TO USE THIS ARC: it is a loose fallback map, NOT a script and NOT a checklist. If the candidate has stated what they want from this session (a specific test, topic, or skill), THAT is the session's purpose and it overrides every arc stage - serve their actual goal, not the map. Rehearse the thing they're preparing for. The live conversation ALWAYS outranks the arc. If the candidate's last answer opened a thread - they named a goal, an interest, a problem, a person, an event - you MUST follow that thread for at least 2-3 exchanges before any arc stage. Only reach for the next stage when the current thread is genuinely exhausted. Advance with a natural bridge, never announce stages. You have completed about " + stage + " exchange(s); the arc spans roughly 12-15.\n\n";
}

function profileBlock() {
  var p = S.profile || {};
  if (!p.category && !p.about && !p.resume) return "";
  var cat = CATEGORIES[p.category];
  var s = "== CANDIDATE PROFILE ==\n";
  if (cat) s += "Who they are: " + cat.label + (p.level ? " \u2014 " + p.level : "") + "\n";
  if (p.target) s += "Preparing for: " + p.target + "\n";
  if (p.about) s += "About them: " + p.about + "\n";
  if (p.resume) s += "RESUME (extracted text):\n" + budget(p.resume, PROMPT_CHARS.resume) + "\n";
  if (cat) s += "\nCALIBRATION: " + cat.cal + "\n";
  return s + "\n";
}

function scenarioBlock() {
  var sc = (S.scenario || "").trim();
  if (!sc) return "";
  return "== THE SCENARIO YOU ARE PLAYING (HIGHEST PRIORITY) ==\n" + sc + "\n" +
    "Adopt this situation completely. It overrides your default persona and question style:\n" +
    "- BE the person described. If they named an audience (senior leadership, a client, a panel), you ARE that audience, with that audience's concerns and patience.\n" +
    "- Ask what that person would actually ask. A management committee probes cost, risk, timelines, and who owns it — not textbook definitions.\n" +
    "- Match the register: a board member is brief and slightly impatient; a friendly mentor is warm; a stress panel interrupts.\n" +
    "- Stay in character every turn. Never narrate the roleplay or say you are pretending.\n\n";
}

function docBlock() {
  if (!S.docName) return "";
  var what = S.docKind === "pptx" ? "the deck they will present" :
             S.docKind === "docx" ? "the document they wrote" : "the file they uploaded";
  return "== ABOUT THE UPLOADED MATERIAL ==\n" +
    "The session material above is " + what + " (\"" + S.docName + "\"" +
    (S.docSlides ? ", " + S.docSlides + (S.docKind === "pptx" ? " slides" : " pages") : "") + ").\n" +
    (S.docKind === "pptx"
      ? "Slide markers and speaker notes are included. Question them ON this content: challenge a number on a specific slide, ask what a slide leaves out, ask why a slide is ordered where it is, ask what they would cut. Refer to slides naturally (\"on your costs slide\u2026\"), never as \"Slide 3 of the uploaded file\".\n"
      : "Question them on the actual claims in it. Quote a specific line back when you challenge it.\n") +
    "Never ask them to read it aloud or summarise the whole thing.\n\n";
}

function imageBlock() {
  if (!S.image) return "";
  return "== THE IMAGE THEY UPLOADED ==\n" +
    "The candidate attached an image (\"" + (S.imageName || "image") + "\") and it is included with this conversation \u2014 look at it directly. " +
    "Treat it as the material for this session: question them on what it actually shows. Challenge a number, a label, an axis, a claim, or something it leaves out. " +
    "Refer to what you can see naturally (\u201con the chart, that dip in Q3\u2026\u201d), never as \u201cthe uploaded image\u201d. Never ask them to describe it to you \u2014 you can see it.\n\n";
}

function systemPrompt() {
  var material = S.content ? budget(S.content, PROMPT_CHARS.material) : (S.image ? "(see the image below)" : "(none provided)");
  var goal = S.role ? S.role : "(not specified)";
  var openLine = entryPlan() === "material"
    ? "Then go straight in \u2014 your first question must name something specific from their material."
    : "Then hand over: ask them to introduce themselves (\u201cTo start, tell me a bit about yourself.\u201d).";
  var base =
"You are Interverse, a live spoken-voice practice partner. Your reply is SPOKEN ALOUD in a natural human conversation.\n\n" +
profileBlock() +
scenarioBlock() +
entryBlock() +
arcBlock() +
"== TODAY'S SESSION MATERIAL ==\n" + material + "\n\n" +
docBlock() +
imageBlock() +
"== TODAY'S SESSION GOAL ==\n" + goal + "\n\n" +
"== HOW TO CONVERSE (most important) ==\n" +
"1. REACT FIRST, ASK SECOND. Start every reply (except the very first) with one sentence genuinely engaging what they just said. VARY HOW: build on their idea, offer a quick take, gently challenge, or connect it to something earlier. The template \u201cYou mentioned/said \u2018X\u2019, that's interesting\u201d is BANNED after one use per session — do not quote their words back at them every turn. Never generic praise like 'great answer'.\n" +
"1y. OBEY DIRECT REQUESTS: when the candidate tells YOU what to do — 'ask me 5 questions about X', 'give me a harder one', 'let's switch to Y', 'quiz me on Z' — that is an instruction, not an answer to react to. Acknowledge briefly ('Sure, here's the first of five on supply chain—') and DO exactly what they asked. Their direction overrides your arc and your current thread.\n" +
"1z. SERVE THEIR ASK: if the candidate said what they need (e.g. 'help me practise for an impromptu English test'), every turn must move toward THAT. When a thread ends and you're unsure where to go next, do NOT jump to a generic or scripted topic - instead ASK them for direction: 'What kind of question would you like to practise?' or 'Shall I throw you an impromptu question to rehearse?'. Keep the session relevant to what they came for; never wander into topics they wouldn't face.\n" +
"1a. FOLLOW THEN PIVOT: dig into the candidate's last answer for 2-3 exchanges, then MOVE ON to a new topic or the next arc stage. Never spend more than 3 exchanges on one thread - once you've asked 'why' and 'what happened', you've gone deep enough; pivot with a natural bridge. Staying on one topic for 4+ exchanges is a failure. Balance: build on what they said, but keep the session moving across many topics.\n" +
"1d. NO REFORMULATION OPENERS: never open by restating their answer back as a summary ('You're looking to improve X, that's a great goal', 'You mentioned Y, that's interesting'). React with something that ADDS - a reaction, a connection, a light challenge - or skip the reaction entirely and just ask the curious question.\n" +
"1b. QUESTIONS ARE SHORT: one clause, under 20 words, exactly one thing asked. Never stack sub-questions or trailing context into one long question.\n" +
"1c. LISTEN AND REMEMBER: if the candidate says something doesn't exist, didn't happen, or they've already answered it — DROP that thread immediately and pivot to an adjacent topic. If they repeat themselves or correct you, own it briefly (\u201cGot it, my mistake\u201d) and move on; NEVER quote their correction back at them.\n" +
"2. THIS IS A DIALOGUE, NOT A QUIZ. Vary your rhythm: mostly follow-up questions that dig into their last answer, sometimes a brief observation or gentle challenge ('That sounds like it came at a cost — what was it?'), occasionally just 'take me deeper into that'. Never fire a brand-new unrelated question two turns in a row.\n" +
"3. STAY ON TOPIC: everything you say must connect to their profile, resume, session material, goal, or something the candidate said earlier. No trivia, no topic hopping.\n" +
"3a. PROFILE IS SILENT CALIBRATION: their class, degree, company, or category shapes your difficulty and topics SILENTLY. NEVER recite profile facts back at them (\u201c...which you're studying in Class 10th\u201d, \u201cas a B.Tech student\u201d, \u201clike you've been learning about\u201d). You may mention their level ONCE, in your intro, and never again unless they bring it up themselves.\n" +
"3b. BE CONCRETE, NEVER GENERIC: every question must name at least one SPECIFIC detail \u2014 a project, company, subject, number, or claim quoted from their profile/resume/material or their previous answer. \u201cTell me about a challenge you faced\u201d is BANNED; \u201cYour resume says you rebuilt the O2A allocation dashboard \u2014 what broke in the old one?\u201d is the standard. If you have no details yet, your question must extract one.\n" +
"4. Keep it human and spoken: under 70 words, contractions welcome, no markdown, no bullets, no lists, at most ONE question mark per reply.\n" +
"5. Never repeat a question already asked. Never answer for the candidate. Never lecture.\n" +
"5a. THE TIP IS ABOUT THE CANDIDATE ONLY. Every tip analyses THE CANDIDATE'S MOST RECENT ANSWER \u2014 never your own question, greeting, or wording. Before writing a tip, locate the candidate's last message; if a word does not appear in THAT message, it must not appear in the tip. On your very first turn the candidate has not spoken yet, so tip MUST be an empty string \u2014 no exceptions.\n" +
"5d. SPEECH-TO-TEXT NOISE: the candidate's words arrive via voice transcription and may contain mis-heard words, repeats, or broken fragments. Never coach or 'upgrade' an obvious transcription glitch; work with what they clearly meant and pick words they genuinely chose.\n" +
"5b. FACT CHECK: if the candidate states something factually wrong and you are CONFIDENT it's wrong (example: calling Hindi India's national language — India has no national language; Hindi is an official language), add a one-line correction in tip starting \u201cFact check:\u201d. Only when confident; never invent corrections.\n" +
"5c. TIP PRIORITIES: your tip follows your MODE's duty (vocabulary upgrades / assertive rewrites / structure notes / a stronger angle they could have taken). Grammar enters a tip ONLY for MAJOR errors \u2014 ones that change meaning or would clearly embarrass in a real interview (like \u201cwrong is happening\u201d \u2192 \u201csomething wrong is happening\u201d). Minor slips: ignore during the conversation \u2014 they are collected in the final report instead. Never praise an incorrect phrase, but never let small grammar policing crowd out real coaching.\n" +
coachingMemory() +
"6. OUTPUT: respond with ONLY this JSON object — no code fences, nothing before or after. Inside the JSON strings, when quoting the candidate's words use curly quotes \u201c \u201d, NEVER straight double quotes, so the JSON stays valid:\n" +
'{"reply": "<what you say aloud>", "tip": "<on-screen coaching note per your mode rules, or empty string>"}\n\n';

  if (S.mode === "interview")
    return base +
"== YOUR MODE: INTERVIEW DRILL ==\n" +
"Your name is " + MODES.interview.persona + ". You are a rigorous but human interviewer (MBA admissions / senior hiring panel) working through the candidate's own material.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself by name and preview the focus, e.g. \u201cHey, I'm " + MODES.interview.persona + ". Today I'll be interviewing you on <one-line summary of their material or goal — name the actual topic>.\u201d " + openLine + " Never repeat this introduction later.\n" +
"- Stay with each story for 2-3 exchanges before moving on: push for numbers, decisions, trade-offs, what they'd change.\n" +
"- Escalate over the session: factual → 'why you' → stress questions (failure, conflict, weakness), all tied to their material.\n" +
"- tip after each answer (max 20 words): one note on structure, specificity, or dodging — quote their words. Empty on your first turn.";

  if (S.mode === "hrbatch")
    return base +
"== YOUR MODE: HR QUESTION SET ==\n" +
"Your name is " + MODES.hrbatch.persona + ". You run the candidate through a fixed set of HR questions that were prepared for this session. The exact question to ask each turn is given to you in the [ASK NEXT] instruction on the latest message \u2014 ask THAT question, in your own natural voice, and nothing else.\n" +
"- FIRST TURN: one short line of welcome naming yourself, then ask question 1 exactly as provided. Do NOT list all the questions (the candidate already sees the list on screen).\n" +
"- Each later turn: give a brief, genuine one-line reaction to their previous answer, then ask the next provided question. Do not invent your own questions, do not go off-list, do not add extra follow-ups \u2014 stay on the prepared set so the practice stays predictable.\n" +
"- tip is MANDATORY every turn (max 30 words): one concrete coaching note on their previous answer \u2014 structure (did they use situation/action/result?), a vague claim needing a number, or a stronger way to phrase it. Empty on the very first turn.";

  if (S.mode === "extempore") {
    var hasMat = !!((S.content || "").trim() || S.image);
    var fromMaterial = hasMat && S.topicSrc === "material";
    // The judgement basis is the whole point of the mode: with material in hand
    // a speech is judged on whether it is FAITHFUL to it; without material there
    // is nothing to be faithful to, so it is judged on thinking.
    var basis = fromMaterial
      ? "== HOW YOU JUDGE (material given) ==\n" +
        "Their material is above. Topics come FROM it, and each speech is judged first on FIDELITY TO THAT MATERIAL:\n" +
        "  a) Accuracy — did they represent what the material actually says, or drift, invent, or contradict it?\n" +
        "  b) Use of specifics — did they reach for the material's own facts, numbers, names and examples, or stay at the level of generalities anyone could have said without reading it?\n" +
        "  c) Coverage — did they address the topic as set, or answer a nearby question they found easier?\n" +
        "  d) Beyond recall — did they add a judgement, implication or connection of their own, rather than reciting?\n" +
        "Then, secondarily, structure and delivery. If they state something the material contradicts, say so plainly — that is the most useful thing you can tell them.\n\n"
      : "== HOW YOU JUDGE (open topics) ==\n" +
        "Topics for this session are open ones, not drawn from any source document, so there is nothing to be faithful to" +
        (hasMat ? " (ignore the material above for judging — they chose open topics)" : "") +
        ". Judge the QUALITY OF THINKING they conveyed:\n" +
        "  a) Position — was there a clear line, or did the speech wander without committing to anything?\n" +
        "  b) Development — did each point follow from the last and build, or were they unconnected fragments?\n" +
        "  c) Evidence — did they ground claims in an example, a reason, or a story, or just assert?\n" +
        "  d) Shape — a recognisable opening, middle and close, and did they land it rather than trail off?\n" +
        "  e) Economy — did they reach the point, or circle it while filling time?\n" +
        "Never mark them down for facts you cannot verify; judge the reasoning, not the trivia.\n\n";

    var topicRule = fromMaterial
      ? "Every topic you set must come from THEIR MATERIAL and name something specific in it — a claim to defend, a decision to justify, a tension to resolve, a section to explain to a newcomer. Never set a topic the material doesn't support.\n"
      : "Set topics from the suggestions provided in the per-turn reminder, or invent ones of the same kind. A good extempore topic is open enough to argue either way and needs no specialist knowledge. Never set a topic that requires facts they may not have.\n";

    return base + basis +
"== YOUR MODE: EXTEMPORE ==\n" +
"Your name is " + MODES.extempore.persona + ". You run impromptu speaking practice. You set a topic, they speak on it unprepared for one to two minutes, and you judge what they said. You are a speaking coach, not an interviewer — you do not interrogate, you evaluate.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself briefly — \u201cHi, I'm " + MODES.extempore.persona + ". I'll give you a topic, you speak on it for a minute or two, and I'll tell you how it landed.\u201d Tell them to take a few seconds to think before they start. Then set the FIRST TOPIC, clearly and slowly, and STOP. tip is an empty string on this turn.\n" +
"- SETTING A TOPIC: announce it in one short line, exactly as they should hold it in their head (\u201cYour topic: <topic>.\u201d). Do not explain it, do not suggest angles, do not give them a structure to follow — the whole exercise is that they find their own. " + topicRule +
"- AFTER EACH SPEECH your spoken reply has exactly two parts, in this order and nothing else:\n" +
"    1) VERDICT (about 40 words): what actually worked and what didn't, judged on the basis above, quoting their own words for at least one point. Be specific and honest — \u201cyou opened with a claim and never returned to it\u201d, not \u201cgood effort\u201d. No score out of ten, no praise sandwich.\n" +
"    2) NEXT TOPIC: one line, a different kind of topic from the last so they aren't practising the same move twice.\n" +
"- Keep the whole spoken reply under 90 words even though it does two jobs. Never ask a follow-up question about their speech — this is not a conversation, and questions steal their next speaking turn.\n" +
"- If they clearly stopped after a few seconds or dried up, say so kindly, name the moment they lost the thread, and give them a fresh, easier topic rather than the same one.\n" +
"- If they ask for a different topic, a harder one, or a particular kind, give it immediately without comment.\n" +
"- tip (max 30 words) is the WRITTEN note beside your spoken verdict, and must not repeat it: give the single most useful structural fix for the NEXT speech — an opening line they could have used, a signpost they skipped, or the point they should have led with.\n";
  }

  return base +
"== YOUR MODE: VOCABULARY BUILDER ==\n" +
"Your name is " + MODES.vocabulary.persona + ". You are a warm, articulate conversation partner helping upgrade their word choice. Topics come from their material and invite rich description and opinion.\n" +
"- FIRST TURN ONLY (may run to 90 words): introduce yourself, e.g. \u201cHi, I'm " + MODES.vocabulary.persona + ". Today we'll have a conversation about <their material/goal in one line>, and I'll help you find sharper words as we go.\u201d " + openLine + " Never repeat this introduction later.\n" +
"- Genuinely converse: react to their ideas, agree or gently push back, then draw out more.\n" +
"- tip: EMPTY STRING on your first turn (they haven't spoken yet). On every later turn: 2-3 words or phrases copied verbatim FROM THE CANDIDATE'S LAST ANSWER, upgraded as: their word \u2192 stronger word (micro-gloss). Never upgrade words from your own questions, and never upgrade an obvious mis-transcription \u2014 if their answer has too few usable words, give one note on how they could phrase the idea more precisely instead.\n" +
"- Naturally reuse ONE upgraded word in your next spoken reply so they hear it in context.";
}

/* Per-turn reinforcement: smaller models drift from the system prompt as context
   grows. A compact reminder rides on the LAST user message at request time only —
   S.history itself stays clean. */
function turnReminder() {
  var aiTurns = S.turns.filter(function (t) { return t.who === "ai"; }).length;
  var qNum = aiTurns + 1;
  // Only nudge a pivot if the LAST 3 AI turns look like the same thread —
  // measured by heavy word overlap — not merely because the session is long.
  var ai = S.turns.filter(function (t) { return t.who === "ai"; }).slice(-3).map(function (t) {
    return (t.text || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 4; });
  });
  var stuckNudge = "";
  if (ai.length === 3) {
    var a = {}, shared = 0, total = 0;
    ai[0].concat(ai[1]).forEach(function (w) { a[w] = 1; });
    ai[2].forEach(function (w) { total++; if (a[w]) shared++; });
    if (total > 0 && shared / total > 0.35)
      stuckNudge = " You've stayed on ONE thread for 3 turns — wrap it up and either ask what I'd like to practise next, or move to a related area of my goal.";
  }
  // HR batch mode has its own strict flow — a short, focused reminder, no pivot logic.
  if (S.mode === "hrbatch") {
    var nextQ = S.batch && S.batch.questions ? S.batch.questions[S.batch.idx] : null;
    return "\n\n[Reminder — never mention this bracket: HR QUESTION PRACTICE. " +
      (nextQ ? "[ASK NEXT] Ask this exact question now, in your own natural voice: \u201c" + nextQ + "\u201d. " : "The set is complete — thank them warmly and tell them to end the session for their feedback. ") +
      "First give a one-line reaction to my previous answer (skip on question 1), then ask it. No extra questions, no going off-list. tip REQUIRED (unless first turn): one concrete note on my previous answer. Reply with ONLY the JSON {\"reply\",\"tip\"}.]";
  }
  // Extempore runs on its own rhythm — verdict then next topic — and needs fresh
  // topic suggestions each turn so the model doesn't circle the same three ideas.
  if (S.mode === "extempore") {
    var usedMat = !!((S.content || "").trim() || S.image) && S.topicSrc === "material";
    var spoken = "";
    for (var xi = S.turns.length - 1; xi >= 0; xi--) {
      if (S.turns[xi].who === "me") { spoken = S.turns[xi].text || ""; break; }
    }
    var already = S.turns.filter(function (t) { return t.who === "ai"; }).length;
    var suggestions = usedMat ? "" :
      " Fresh topic ideas you may use or adapt (never reuse one already set): " +
      pickTopics(S.topicKind, 4).map(function (t) { return "\u201c" + t + "\u201d"; }).join(", ") + ".";
    if (!already)
      return "\n\n[Reminder — never mention this bracket: EXTEMPORE. Introduce yourself in one or two lines, tell me to think for a few seconds, then set my FIRST topic and stop. " +
        (usedMat ? "The topic must come from my material and name something specific in it." : "Set an open topic I can argue either way.") + suggestions +
        " Do not explain the topic or suggest angles. tip MUST be an empty string. Reply with ONLY the JSON {\"reply\",\"tip\"}.]";
    return "\n\n[Reminder — never mention this bracket: EXTEMPORE, speech " + already + " just delivered. " +
      (spoken
        ? "MY SPEECH, verbatim, is the ONLY thing you judge: \u201c" + spoken.slice(0, 900) + "\u201d. "
        : "I did not manage to say anything usable \u2014 say so kindly and set an easier topic. ") +
      "Reply with TWO parts only: a ~40-word verdict on that speech judged on " +
      (usedMat
        ? "fidelity to my material (accuracy, use of its specifics, coverage of the topic set, and whether I added judgement of my own)"
        : "the quality of thinking (clear position, development, evidence, shape, economy)") +
      ", quoting my words at least once; then ONE new topic on a different kind of subject from the last." + suggestions +
      " No follow-up questions, no score out of ten, under 90 words total. tip REQUIRED: the single most useful structural fix for my next speech, not a repeat of the verdict. Reply with ONLY the JSON {\"reply\",\"tip\"}.]";
  }
  // Anchor the tip to the candidate's actual words: quote their last answer back
  // into the reminder, and force an empty tip when they haven't spoken yet.
  var myLast = "";
  for (var mi = S.turns.length - 1; mi >= 0; mi--) {
    if (S.turns[mi].who === "me") { myLast = S.turns[mi].text || ""; break; }
  }
  var tipAnchor = myLast
    ? " MY LAST ANSWER, verbatim, is the ONLY source for your tip: \u201c" + myLast.slice(0, 600) + "\u201d. Every word you quote in the tip must appear in that text \u2014 never words from your own question."
    : " I have not spoken yet, so the tip MUST be an empty string.";
  // Reinforce the opening choice every turn — small models drift back to the
  // generic life-story script within a few exchanges otherwise.
  var plan = entryPlan();
  var entryBit = "";
  if (plan === "material")
    entryBit = " THIS SESSION IS ABOUT MY MATERIAL: every question must name something specific in it (a claim, number, slide or line) or follow up on what I just said about it. Never drift into generic background questions.";
  else if (plan === "background")
    entryBit = aiTurns < WARMUP_EXCHANGES
      ? " We're in the background warm-up \u2014 " + (WARMUP_EXCHANGES - aiTurns) + " exchange(s) left before we move to my material. Don't open the material yet."
      : " The warm-up is OVER: bridge into my material if you haven't already, and from here every question must name something specific in it. Never go back to general background questions.";
  var modeBit = S.mode === "interview"
    ? "tip: one short note on my answer's structure or specificity, quoting my words."
    : "tip REQUIRED: 2-3 words I actually used, upgraded weak \u2192 strong.";
  return "\n\n[Reminder — never mention this bracket: " + MODES[S.mode].label.toUpperCase() +
    " mode, exchange " + qNum + " of ~14. TOP PRIORITY: if I just told you what to do (ask me X, quiz me on Y, harder question), DO that exactly — it's an instruction, not an answer. Otherwise serve what I asked for and build on what I JUST said — stay with a thread for 2-3 exchanges before moving on, and never pivot away while I'm giving you a live thread to explore. When a thread genuinely ends, if you're unsure where to go, ASK me what I'd like to practise rather than jumping to a scripted or generic topic. No reformulation openers. FIRST react in one sentence to something specific I said, THEN one question (or none). Never recite my class/degree back at me. Grammar in tip only if major." + entryBit + " " +
    modeBit + tipAnchor + " Reply with ONLY the JSON {\"reply\",\"tip\"}.]" + stuckNudge;
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
    // Only recent turns travel, and only up to a total size: old context costs
    // tokens the per-minute limit can't spare.
    var payload = S.history.slice(-PROMPT_CHARS.historyTurns).map(function (m) {
      return { role: m.role, content: budget(m.content, PROMPT_CHARS.historyMsg) };
    });
    var used = 0;
    for (var hi = payload.length - 1; hi >= 0; hi--) {
      used += payload[hi].content.length;
      if (used > PROMPT_CHARS.historyTotal) { payload = payload.slice(hi + 1); break; }
    }
    if (payload.length && payload[0].role !== "user")
      payload.unshift({ role: "user", content: "(earlier turns trimmed \u2014 continue the session)" });
    if (!payload.length)
      payload.push({ role: "user", content: "Please continue the session." });
    for (var i = payload.length - 1; i >= 0; i--) {
      if (payload[i].role === "user") { payload[i].content += turnReminder(); break; }
    }
    var req = { system: systemPrompt(), messages: payload, max_tokens: 500 };
    if (S.image) req.images = [S.image];
    var r = await aiCall(req, 2, function (secs) {
      if (secs > 2) toast("Pacing to stay inside the free tier \u2014 " + secs + "s\u2026");
    });
    var parsed = parseJsonLoose(r.text) || { reply: (r.text || "").slice(0, 400), tip: "" };
    // Safety net: a tip must be grounded in what the CANDIDATE said.
    // Drop it entirely on the first turn, and drop it if none of the quoted
    // "weak" words actually appear in their last answer (model drift guard).
    var tipText = (parsed.tip || "").trim();
    if (tipText) {
      var lastMine = "";
      for (var ti = S.turns.length - 1; ti >= 0; ti--) {
        if (S.turns[ti].who === "me") { lastMine = (S.turns[ti].text || "").toLowerCase(); break; }
      }
      if (!lastMine) {
        tipText = ""; // candidate hasn't spoken yet
      } else {
        // words on the left of each "→" should come from the candidate
        var leftSide = tipText.split(/[,;]/).map(function (seg) {
          return seg.split(/\u2192|->/)[0];
        }).join(" ").toLowerCase();
        var words = leftSide.replace(/[^a-z' ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 3; });
        if (words.length) {
          var hits = words.filter(function (w) { return lastMine.indexOf(w) !== -1; }).length;
          if (hits === 0) tipText = ""; // nothing quoted came from them — discard
        }
      }
    }
    S.history.push({ role: "assistant", content: r.text });
    S.turns.push({ who: "ai", text: parsed.reply, tip: tipText });
    // HR batch: the question just asked consumes one slot; advance the pointer.
    if (S.mode === "hrbatch" && S.batch) S.batch.idx++;
    if (S.voiceOn) {
      S.phase = "speaking"; render();
      speak(parsed.reply, function () {
        if (S.phase === "speaking") { S.phase = "idle"; startThinkClock(); render(); }
      });
    } else { S.phase = "idle"; startThinkClock(); render(); }
  } catch (e) {
    S.error = e.message || "Couldn't reach the interviewer. Try again.";
    S.phase = "idle"; render();
  }
}
function submitAnswer(text) {
  markSpeechStarted();           // typed answers: no earlier signal than this
  stopThinkClock();
  if (window.IVAnalytics) {
    var lastQ = "";
    for (var qi = S.turns.length - 1; qi >= 0; qi--) {
      if (S.turns[qi].who === "ai") { lastQ = S.turns[qi].text || ""; break; }
    }
    IVAnalytics.endAnswer(lastQ, text);
  }
  S.turns.push({ who: "me", text: text, thinkMs: S.thinkMs });
  S.askedAt = 0; S.thinkMs = null; S.spokeFrom = 0;
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
/* Scanned pages have no text layer, so the words have to be read off the pixels.
   Sent to the vision model two pages at a time: four pages of dense text in one
   call would blow both the output cap and the per-minute token limit. On a 429 we
   wait out the window Groq reports and try that batch once more. */
async function transcribePages(images, kind, onProgress) {
  var sys = "You transcribe scanned pages. Respond with ONLY a JSON object, no code fences: " +
    '{"text":"<the full text of the page(s), in reading order>"}. ' +
    "Transcribe every heading, label, date, number and bullet exactly as written. Preserve line breaks with \\n. " +
    "Where a page is a chart, diagram or table, write out its title, axis labels and the values it shows, then one line describing what it depicts. " +
    "Do not summarise, do not comment, do not add anything that is not on the page. If a page is blank, return an empty string for it.";
  var out = [];
  var label = kind === "pdf" ? "page" : "image";
  // One page per call: a rendered page is ~2,200 tokens on its own, so two of
  // them plus the transcription output overruns a single minute's budget.
  for (var i = 0; i < images.length; i++) {
    if (onProgress) onProgress(i + 1, images.length);
    var attempt = 0, done = false;
    while (!done) {
      try {
        var r = await aiCall({
          system: sys,
          images: [images[i]],
          max_tokens: 1600,
          messages: [{ role: "user", content: "Transcribe " + label + " " + (i + 1) + " of " + images.length + "." }]
        }, 1, function (secs) {
          if (onProgress && secs > 2) onProgress(i + 1, images.length, "pacing, " + secs + "s");
        });
        var j = parseJsonLoose(r.text);
        var t = j && typeof j.text === "string" ? j.text : String(r.text || "");
        if (t.trim()) out.push(t.trim());
        done = true;
      } catch (e) {
        if (e.retryAfter && attempt < 2) {
          attempt++;
          var secs = Math.ceil(e.retryAfter);
          if (onProgress) onProgress(i + 1, images.length, "rate limited, resuming in " + secs + "s");
          await new Promise(function (ok) { setTimeout(ok, (secs + 1) * 1000); });
        } else if (out.length) {
          done = true; i = images.length;   // keep what we got rather than losing it all
        } else {
          throw e;
        }
      }
    }
  }
  return out.join("\n\n");
}

async function handleResumeFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var status = $("pf-resume-status");
  status.textContent = "Reading " + file.name + "\u2026";
  try {
    if (!window.IVDoc) throw new Error("Reader didn't load \u2014 refresh and try again");
    var r = await IVDoc.extract(file);
    var text = "";
    if (r.scanned && r.images && r.images.length) {
      status.textContent = "No text layer in that PDF \u2014 reading the pages\u2026";
      text = await transcribePages(r.images, "pdf", function (n, total, note) {
        status.textContent = "Reading page " + n + " of " + total + (note ? " \u2014 " + note : "") + "\u2026";
      });
    } else if (r.kind === "image") {
      status.textContent = "Reading that image\u2026";
      text = await transcribePages([r.image], "image", function () {});
    } else {
      text = r.text || "";
    }
    text = text.replace(/\s+/g, " ").trim().slice(0, 20000);
    if (text.length < 50) throw new Error("Couldn't read any text off that file \u2014 paste the text into About instead");
    if (!S.profile) S.profile = {};
    S.profile.resume = text;
    status.textContent = "\u2713 " + file.name + " \u2014 " + text.length + " characters extracted. Save profile to keep it.";
  } catch (e) {
    status.textContent = "\u26a0 " + e.message;
  }
}
async function handleMaterialFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var st = $("su-doc-status");
  if (st) st.innerHTML = "Reading " + esc(file.name) + "\u2026";
  try {
    if (!window.IVDoc) throw new Error("Reader didn't load \u2014 refresh and try again");
    var r = await IVDoc.extract(file);
    if (r.scanned && r.images && r.images.length) {
      if (st) st.innerHTML = "No text layer in that PDF \u2014 reading the pages\u2026";
      var txt = await transcribePages(r.images, "pdf", function (n, total, note) {
        if (st) st.innerHTML = "Reading page " + n + " of " + total + (note ? " \u2014 " + esc(note) : "") + "\u2026";
      });
      if (!txt.trim()) throw new Error("Couldn't read any text off those pages \u2014 paste the text in instead");
      S.image = ""; S.imageName = "";
      S.content = budget(txt, 24000);
      S.docName = file.name; S.docKind = "pdf"; S.docSlides = r.pagesTotal || 0;
      input.value = "";
      render();
      toast("Read " + r.pagesRead + " scanned page" + (r.pagesRead === 1 ? "" : "s") +
        (r.pagesTotal > r.pagesRead ? " of " + r.pagesTotal : "") + " \u2713");
      return;
    }
    if (r.kind === "image") {
      S.image = r.image; S.imageName = file.name;
      S.content = ""; S.docName = file.name; S.docKind = "image"; S.docSlides = 0;
    } else {
      S.image = ""; S.imageName = "";
      S.content = r.text;
      S.docName = file.name; S.docKind = r.kind; S.docSlides = r.slides || 0;
    }
    input.value = "";
    render();
    if (r.truncated) toast("Long file \u2014 first " + Math.round(24000 / 1000) + ",000 characters loaded");
    else toast("Loaded " + file.name + " \u2713");
  } catch (e) {
    input.value = "";
    if (st) st.innerHTML = '<span style="color:var(--rec)">\u26a0 ' + esc(e.message) + "</span>";
  }
}

function clearMaterialFile() {
  S.content = ""; S.docName = ""; S.docKind = ""; S.docSlides = 0;
  S.image = ""; S.imageName = "";
  render();
}

function clearResume() {
  if (S.profile) S.profile.resume = "";
  $("pf-resume-status").textContent = "Resume removed. Save profile to confirm.";
}

/* A new session is a blank slate: the material goes too. Previously S.docName was
   cleared but S.content was not, so returning here left the old text sitting in the
   box with no "remove" button next to it. */
function goNewSession() {
  stopSpeaking(); listeningWanted = false;
  S.convId = null; S.turns = []; S.history = []; S.feedback = null; S.customTitle = null; S.batch = null;
  S.scenario = ""; S.entry = "material";
  S.track = "interview"; S.topicSrc = "generic"; S.topicKind = "general";
  S.content = ""; S.role = "";
  S.docName = ""; S.docKind = ""; S.docSlides = 0;
  S.image = ""; S.imageName = "";
  S.screen = "setup"; S.phase = "idle"; S.error = ""; S.savedAt = null;
  closeSidebarMobile();
  render(); renderConvList();
}

/* Going back to tweak the setup of the session you just ran — material stays put. */
function goSetup() {
  stopSpeaking(); listeningWanted = false;
  S.screen = "setup"; S.phase = "idle"; S.error = "";
  closeSidebarMobile();
  render();
}
function startSession() {
  S.turns = []; S.history = []; S.feedback = null; S.savedAt = null;
  if (window.IVAnalytics) IVAnalytics.reset();
  if (!S.convId) S.convId = uuid();
  if (!S.profile || !S.profile.category)
    toast("Interviewer's scope will be improved if you update your profile");
  S.insights = null;
  api("/insights").then(function (d) { S.insights = d; }).catch(function () {});
  // HR batch mode: generate the question list first, show it, then run it.
  if (S.mode === "hrbatch") { S.batch = null; S.screen = "batchprep"; render(); generateBatch(); return; }
  S.screen = "session";
  if (micSupported && S.micStatus === "unknown") requestMic();
  aiTurn(null);
}

/* ---- HR Batch Practice ---- */
async function generateBatch() {
  var p = S.profile || {};
  var cat = CATEGORIES[p.category] ? CATEGORIES[p.category].label : "a job candidate";
  var n = S.batchSize;
  var theme = (S.role || S.content || "").trim();
  var sys = "You generate HR interview questions. Respond with ONLY a JSON object, no code fences: {\"questions\":[\"...\", ...]}. " +
    "Produce exactly " + n + " HR interview questions tailored to this candidate. They must be answerable by this specific person, progress from easy to harder, and read like real spoken HR questions. No numbering inside the strings.";
  var usr = "Candidate: " + cat + (p.level ? " (" + p.level + ")" : "") + ".\n" +
    (p.target ? "Preparing for: " + p.target + ".\n" : "") +
    (p.about ? "About them: " + p.about + "\n" : "") +
    (p.resume ? "Resume excerpt: " + p.resume.slice(0, 1500) + "\n" : "") +
    (theme ? "Focus the set around this theme if sensible: " + theme + "\n" : "") +
    "Generate the " + n + " questions now.";
  try {
    var r = await aiCall({ system: sys, messages: [{ role: "user", content: usr }], max_tokens: 1200 }, 2);
    var parsed = parseJsonLoose(r.text);
    var qs = parsed && Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean).slice(0, n) : [];
    if (!qs.length) throw new Error("empty");
    S.batch = { questions: qs, idx: 0 };
  } catch (e) {
    // fallback generic set so the feature never dead-ends
    S.batch = { questions: [
      "Tell me about yourself.",
      "What are your greatest strengths?",
      "Describe a challenge you faced and how you handled it.",
      "Why are you interested in this opportunity?",
      "Where do you see yourself in five years?",
      "Tell me about a time you worked in a team.",
      "What is a weakness you're working on?",
      "Describe a goal you achieved and how.",
      "How do you handle pressure or tight deadlines?",
      "Do you have any questions for us?"
    ].slice(0, S.batchSize), idx: 0 };
    toast("Used a standard question set (generation was unavailable)");
  }
  if (S.screen === "batchprep") render();
}

function beginBatchSession() {
  if (!S.batch || !S.batch.questions.length) return;
  S.batch.idx = 0;
  S.turns = []; S.history = [];
  S.screen = "session";
  if (micSupported && S.micStatus === "unknown") requestMic();
  aiTurn(null); // interviewer asks question 1 (from turnReminder [ASK NEXT])
}

function batchPrepHtml() {
  var loading = !S.batch;
  var n = S.batchSize;
  var m = MODES.hrbatch;
  var list = loading
    ? '<div style="color:var(--mut);font-size:14px;padding:10px 0">Generating ' + n + ' questions tailored to your profile\u2026</div>'
    : '<ol style="margin:8px 0 0;padding-left:22px;line-height:1.7">' +
        S.batch.questions.map(function (q) { return '<li style="margin-bottom:6px">' + esc(q) + '</li>'; }).join("") + '</ol>';
  return '<div class="card" style="padding:22px;max-width:660px">' +
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">' +
    '<span style="width:32px;height:32px;border-radius:50%;background:' + m.color + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">' + m.persona.charAt(0) + '</span>' +
    '<b style="font-size:16px">Your ' + n + '-question HR set</b></div>' +
    '<div style="font-size:13px;color:var(--mut);margin-bottom:14px">Here\u2019s what you\u2019ll be asked. You\u2019ll answer them one at a time, by voice.</div>' +
    list +
    '<div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" onclick="beginBatchSession()"' + (loading ? " disabled" : "") + '>Start answering</button>' +
    (loading ? "" : '<button class="btn btn-ghost" onclick="generateBatch()">\u21bb Regenerate</button>') +
    '<button class="btn btn-ghost" onclick="goNewSession()">Cancel</button></div></div>';
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
  // Collect the word-upgrade tips shown live during the session, so the final
  // report includes them alongside a fresh full-transcript sweep.
  var liveTips = S.turns.filter(function (t) { return t.who === "ai" && t.tip; })
    .map(function (t) { return t.tip; });
  var lexBit = S.mode === "vocabulary"
    ? "\\n- THIS IS A VOCABULARY SESSION. power_phrases is the centrepiece: sweep the ENTIRE transcript and list 8-15 upgrades \\u2014 EVERY word or phrase the candidate used that could be sharpened. Include every weak verb, vague noun, filler, and casual phrasing you can find, plus any upgrades already suggested live during the session (listed below). Merge duplicates. This is an exhaustive vocabulary list, not a short sample."
    : "";
  var ps = pauseStats();
  var pauseLine = function () {
    return ps ? "\nPause before answering (interviewer stopped speaking \u2192 candidate's first word), across " +
      ps.n + " answers: average " + thinkText(ps.avg) + ", longest " + thinkText(ps.max) + ", shortest " + thinkText(ps.min) + "." : "";
  };
  var pauseBit = ps
    ? "\n- PAUSE BEFORE ANSWERING is measured above. Use it in the Composure subscore and mention it in strengths or improvements ONLY if it is notable: an average under about 2s can mean they are answering before they have thought (say so if their answers also ramble), and an average over about 6s, or a longest over about 12s, reads as being caught out. Between those, treat it as composed and do not remark on it. Never invent a number that is not given here."
    : "";
  var extBit = S.mode === "extempore"
    ? "\\n- THIS IS AN EXTEMPORE SESSION. The candidate spoke unprepared on topics set by the coach; the \\u201cinterviewer\\u201d lines are topics and verdicts, not questions. Judge each speech as a SPEECH: did it open with a position, develop it, use an example, and land a close, or did it wander and trail off? " +
      (((S.content || "").trim() || S.image) && S.topicSrc === "material"
        ? "Topics came from the candidate's own material, so weigh heavily whether they used its specifics accurately rather than speaking in generalities, and flag anything they said that the material contradicts."
        : "No material was provided, so judge the quality of thinking conveyed \\u2014 clear position, logical development, grounded claims, economy \\u2014 and never mark them down for facts you cannot verify.") +
      " In structure, weight \\u201cOpening & framing\\u201d and \\u201cCompleteness\\u201d most: an extempore that never states its point or never finishes is the central failure to name."
    : "";
  var liveBit = (S.mode === "vocabulary" && liveTips.length)
    ? "\\n\\nUPGRADES ALREADY SUGGESTED LIVE (fold these into power_phrases, de-duplicated):\\n" + liveTips.join("\\n")
    : "";
  var sys = 'You are an expert speaking coach. Analyze the interview transcript. Respond with ONLY JSON, no fences:\n' +
    '{"scores":{"clarity":0-10,"structure":0-10,"confidence":0-10,"vocabulary":0-10},\n' +
    '"subscores":{\n' +
    '  "clarity":[{"name":"Conciseness","score":0-10,"note":"<8-12 word reason>"},{"name":"Articulation","score":0-10,"note":"..."},{"name":"Logical flow","score":0-10,"note":"..."}],\n' +
    '  "structure":[{"name":"Opening & framing","score":0-10,"note":"..."},{"name":"Use of examples","score":0-10,"note":"..."},{"name":"Completeness","score":0-10,"note":"..."}],\n' +
    '  "confidence":[{"name":"Assertiveness","score":0-10,"note":"..."},{"name":"Filler & hedging","score":0-10,"note":"..."},{"name":"Composure","score":0-10,"note":"..."}],\n' +
    '  "vocabulary":[{"name":"Precision","score":0-10,"note":"..."},{"name":"Range","score":0-10,"note":"..."},{"name":"Professional tone","score":0-10,"note":"..."}]\n' +
    '},\n' +
    '"headline":"<one candid sentence verdict>",\n' +
    '"strengths":["...","..."],\n' +
    '"improvements":["specific, actionable...","..."],\n' +
    '"power_phrases":[{"weak":"<exact words the candidate said>","strong":"<sharper replacement>"}],\n' +
    '"grammar_notes":[{"said":"<exact incorrect phrase from CANDIDATE lines>","correct":"<corrected version>"}]}\n' +
    'Rules:\n' +
    '- strengths and improvements: 2-4 items each, specific to THIS transcript, quoting their actual words where possible.\n' +
    '- power_phrases: 4-6 items, MANDATORY. Each "weak" must be an EXACT word or short phrase copied from the CANDIDATE lines — weak verbs (did, got, helped), vague nouns (stuff, things, a lot), hedges (I think, maybe, kind of), filler. Each "strong" is the professional upgrade. Never invent quotes.\n' +
    '- grammar_notes: 2-6 items covering ALL noticeable grammar or phrasing errors the candidate made \u2014 quote the exact words, give the natural corrected version. Include minor slips here (this is where they belong, not in live tips). Empty array if their grammar was clean.\n' +
    '- Scores reflect the whole session honestly; do not inflate. Each top score should roughly equal the average of its three subscores. Every subscore note quotes or references something specific the candidate did.\n' +
    '- subscores: all four categories, exactly 3 sub-criteria each, as specified.' +
    lexBit + extBit + pauseBit + liveBit +
    feedbackContext();
  try {
    var r = await aiCall({
      system: sys,
      messages: [{ role: "user", content: "Mode: " + MODES[S.mode].label +
        "\nFiller words counted: " + fillerCount() + pauseLine() +
        "\n\nTranscript:\n" + budget(transcript, PROMPT_CHARS.transcript) }],
      max_tokens: 1000
    }, 2);
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
    feedback: "Feedback", saved: "Saved session", profile: "My profile", batchprep: "HR question set" }[S.screen] || "";
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
  else if (S.screen === "batchprep") v.innerHTML = batchPrepHtml();

  var feed = $("feed"); if (feed) feed.scrollTop = feed.scrollHeight;
  var ta = $("su-content"); if (ta) ta.value = S.content;
  var sc = $("su-scenario"); if (sc) sc.value = S.scenario;
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
    '<input type="file" id="pf-resume" accept=".pdf,.txt,.docx,.png,.jpg,.jpeg" onchange="handleResumeFile(this)" style="font-size:13px;margin-bottom:6px"/>' +
    '<div id="pf-resume-status" style="font-size:12.5px;color:var(--mut);margin-bottom:18px">' + resumeState + '</div>' +
    '<div style="display:flex;gap:10px">' +
    '<button class="btn btn-primary" onclick="saveProfile()">Save profile</button>' +
    '<button class="btn btn-ghost" onclick="S.screen=\'setup\';render()">Cancel</button></div></div>';
}

var SCENARIOS = [
  { t: "Senior leadership", v: "I'm presenting this to the management committee. Play a senior leader: short on time, focused on cost, risk, timelines and who owns it. Push me on the numbers and interrupt if I ramble." },
  { t: "Skeptical client", v: "Play a skeptical client evaluating this. Ask what it costs, what could go wrong, why you over a competitor, and press me when an answer sounds rehearsed." },
  { t: "Technical deep-dive", v: "Play a senior engineer on the hiring panel. Go deep on how it actually works, the trade-offs I chose, and what I'd do differently at ten times the scale." },
  { t: "Friendly mentor", v: "Play a supportive mentor. Ask open questions that help me find my own words, and tell me when an answer was vague rather than moving on." },
  { t: "Stress panel", v: "Play a tough interview panel. Interrupt, challenge my assumptions, ask follow-ups I can't prepare for, and stay polite but relentless." }
];

function pickScenario(i) {
  S.scenario = SCENARIOS[i].v;
  render();
}

function pickEntry(v) {
  S.entry = v;
  render();
}

/* The two tracks are different activities, so switching tab also switches the
   mode. Coming back to Interview restores whichever of the three you last used
   rather than always snapping to the first. */
var lastInterviewMode = "interview";

function pickTrack(t) {
  if (S.track === t) return;
  if (S.track === "interview") lastInterviewMode = S.mode;
  S.track = t;
  S.mode = t === "extempore" ? "extempore" : (lastInterviewMode || "interview");
  render();
}

function pickMode(k) {
  S.mode = k;
  if (MODES[k] && MODES[k].track === "interview") lastInterviewMode = k;
  render();
}

function pickTopicSrc(v) {
  if (v === "material" && !((S.content || "").trim() || S.image)) {
    toast("Upload or paste something first, or choose \u201cGive me a topic\u201d");
    return;
  }
  S.topicSrc = v;
  render();
}

/* Typing in the material box must not trigger a full re-render (it would eat the
   caret), so the entry chooser is always in the DOM and shown/hidden here. */
function onMaterialInput(el) {
  S.content = el.value;
  S.docName = "";
  var b = $("su-entry");
  if (b) b.style.display = (S.content.trim() || S.image) ? "block" : "none";
}

function entryHtml() {
  var on = !!(S.content || "").trim() || !!S.image;
  var opt = function (v, label, sub) {
    return '<button class="chip' + (S.entry === v ? " sel" : "") + '" style="padding:8px 16px;text-align:left" ' +
      'onclick="pickEntry(\'' + v + '\')" title="' + sub + '">' + label + '</button>';
  };
  return '<div id="su-entry" style="display:' + (on ? "block" : "none") + ';margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">' +
    '<div style="font-size:13.5px;color:var(--mut);margin-bottom:9px">Where should the interviewer start?</div>' +
    '<div class="chips" style="margin-bottom:0">' +
    opt("material", "Straight into this material", "First question comes from what you pasted or uploaded") +
    opt("background", "Background first, then this", "About 4 questions about you, then into the material") +
    '</div>' +
    '<div style="font-size:12px;color:var(--mut);margin-top:8px">' +
    (S.entry === "background"
      ? "Roughly " + WARMUP_EXCHANGES + " warm-up questions about you, then the interviewer moves into your material and stays there."
      : "The first question names something specific in your material \u2014 no \u201ctell me about yourself\u201d.") +
    '</div></div>';
}

function setupHtml() {
  var docStatus = S.docKind === "image"
    ? '\u2713 ' + esc(S.docName) + ' \u00b7 image \u2014 the interviewer will look at it <button class="btn-link" onclick="clearMaterialFile()">remove</button>'
    : S.docName
      ? '\u2713 ' + esc(S.docName) + (S.docSlides ? ' \u00b7 ' + S.docSlides + (S.docKind === "pptx" ? " slides" : " pages") : "") +
        ' \u00b7 ' + S.content.length + ' characters <button class="btn-link" onclick="clearMaterialFile()">remove</button>'
      : 'PPTX, DOCX, PDF, TXT or an image \u2014 slides and speaker notes are read.';
  var imgPreview = S.image
    ? '<img src="' + S.image + '" alt="uploaded image" style="max-width:100%;max-height:220px;border-radius:10px;border:1px solid var(--line);margin-bottom:12px;display:block"/>'
    : "";
  var presetChips = SCENARIOS.map(function (sc, i) {
    return '<button class="chip' + (S.scenario === sc.v ? " sel" : "") + '" onclick="pickScenario(' + i + ')">' + sc.t + '</button>';
  }).join("") + (S.scenario ? '<button class="chip clear" onclick="S.scenario=\'\';render()">clear</button>' : "");
  var track = MODES[S.mode] && MODES[S.mode].track ? MODES[S.mode].track : S.track;
  var tabs = '<div class="tracktabs">' +
    [["interview", "Interview", "Be questioned on your own material"],
     ["extempore", "Extempore", "Speak on a topic, unprepared"]].map(function (t) {
      return '<button class="tracktab' + (track === t[0] ? " sel" : "") + '" onclick="pickTrack(\'' + t[0] + '\')">' +
        '<span class="tt-name">' + t[1] + '</span><span class="tt-sub">' + t[2] + '</span></button>';
    }).join("") + '</div>';
  var cards = Object.keys(MODES).filter(function (k) { return MODES[k].track === track; }).map(function (k) {
    var m = MODES[k];
    return '<button class="modecard' + (S.mode === k ? " sel" : "") + '" onclick="pickMode(\'' + k + '\')">' +
      '<div class="tag" style="color:' + m.color + '">' + m.tag + '</div>' +
      '<div class="name">' + m.label + '</div><div class="blurb">' + m.blurb + '</div></button>';
  }).join("");
  var cardCount = Object.keys(MODES).filter(function (k) { return MODES[k].track === track; }).length;
  var micBit = !micSupported
    ? '<span style="font-size:12.5px;color:var(--amber)">Voice input isn\'t supported in this browser — you can type answers. Chrome works best.</span>'
    : S.micStatus === "granted"
      ? '<span style="font-size:12.5px;color:var(--teal);font-weight:600">✓ Microphone ready</span>'
      : '<button class="btn btn-ghost" style="padding:8px 14px;font-size:13px" onclick="requestMic()">🎙 Enable microphone</button>' +
        (S.micStatus === "denied" ? '<span style="font-size:12.5px;color:var(--rec);max-width:320px"> Mic is blocked — allow it from the browser\'s site settings, then retry.</span>' : "");
  var hasMat = !!((S.content || "").trim() || S.image);
  var topicBit = "";
  if (S.mode === "extempore") {
    var srcChip = function (v, label, sub, disabled) {
      return '<button class="chip' + (S.topicSrc === v ? " sel" : "") + '"' +
        (disabled ? ' disabled style="opacity:.45;cursor:not-allowed" title="Upload or paste something first"' : ' title="' + sub + '"') +
        ' onclick="pickTopicSrc(\'' + v + '\')">' + label + '</button>';
    };
    var kindChip = function (v, label) {
      return '<button class="chip' + (S.topicKind === v ? " sel" : "") + '" onclick="S.topicKind=\'' + v + '\';render()">' + label + '</button>';
    };
    topicBit = '<div class="card" style="padding:16px 18px;margin-bottom:24px">' +
      '<div style="font-size:13.5px;color:var(--mut);margin-bottom:9px">Where should your topics come from?</div>' +
      '<div class="chips" style="margin-bottom:0">' +
      srcChip("material", "From my material", "Topics drawn from what you upload or paste below", !hasMat) +
      srcChip("generic", "Give me a topic", "Start straight away \u2014 nothing to upload") +
      '</div>' +
      (S.topicSrc === "generic"
        ? '<div style="margin-top:12px"><div style="font-size:12.5px;color:var(--mut);margin-bottom:8px">What kind?</div>' +
          '<div class="chips" style="margin-bottom:0">' +
          kindChip("general", "Everyday prompts") + kindChip("opinion", "Take a side") + kindChip("abstract", "Abstract words") +
          '</div></div>'
        : "") +
      '<div style="font-size:12px;color:var(--mut);margin-top:12px">' +
      (S.topicSrc === "material"
        ? MODES.extempore.persona + " sets topics from your material and judges each speech on how faithfully you used it \u2014 accuracy, its specifics, and whether you added a view of your own."
        : MODES.extempore.persona + " sets an open topic and judges the thinking you convey \u2014 clear position, development, evidence, and whether you land it. Nothing to upload; you can start now.") +
      '</div></div>';
  }
  var batchBit = S.mode === "hrbatch"
    ? '<div class="card" style="padding:14px 18px;margin-bottom:24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<span style="font-size:13.5px;color:var(--mut)">How many questions?</span>' +
      '<button class="btn ' + (S.batchSize === 5 ? "btn-primary" : "btn-ghost") + '" style="padding:8px 20px" onclick="S.batchSize=5;render()">5</button>' +
      '<button class="btn ' + (S.batchSize === 10 ? "btn-primary" : "btn-ghost") + '" style="padding:8px 20px" onclick="S.batchSize=10;render()">10</button>' +
      '<span style="font-size:12.5px;color:var(--mut)">Tailored to your profile · shown before you start</span></div>'
    : "";
  var matHeading = S.mode === "extempore" && S.topicSrc === "generic"
    ? "2 · FEED YOUR MATERIAL (not needed for these topics)"
    : "2 · FEED YOUR MATERIAL (OPTIONAL)";
  return '<div class="eyebrow" style="margin-bottom:10px"><span class="num">1 ·</span> WHAT ARE YOU PRACTISING?</div>' +
    tabs +
    '<div class="grid3' + (cardCount === 1 ? " one" : "") + '">' + cards + '</div>' +
    batchBit + topicBit +
    '<div class="eyebrow" style="margin-bottom:10px"><span class="num">2 ·</span> ' + matHeading.replace(/^2 · /, "") + '</div>' +
    '<div class="card" style="padding:18px;margin-bottom:24px">' +
    '<div class="filerow">' +
    '<label class="btn btn-ghost filebtn">\ud83d\udcce Upload deck, document or image' +
    '<input type="file" accept=".pptx,.docx,.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif" onchange="handleMaterialFile(this)"/></label>' +
    '<span id="su-doc-status" class="filestat">' + docStatus + '</span></div>' +
    imgPreview +
    '<textarea id="su-content" class="input" rows="7" style="resize:vertical;margin-bottom:12px" ' +
    'placeholder="…or paste it here — resume bullets, a job description, your MBA essays, a project story, a topic you want to speak about…" ' +
    'oninput="onMaterialInput(this)"></textarea>' +
    '<input id="su-role" class="input" placeholder="Target role or goal (optional) — e.g. HBS admissions interview, consulting case fit, product manager role" ' +
    'oninput="S.role=this.value" />' +
    entryHtml() + '</div>' +
    '<div class="eyebrow" style="margin-bottom:10px"><span class="num">3 ·</span> SET THE SCENE <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div>' +
    '<div class="card" style="padding:18px;margin-bottom:24px">' +
    '<div class="chips">' + presetChips + '</div>' +
    '<textarea id="su-scenario" class="input" rows="3" style="resize:vertical" ' +
    'placeholder="Tell the interviewer who to be and what to ask. e.g. I\'m presenting this deck to the management committee — play a senior leader and push me on cost, risk and timelines." ' +
    'oninput="S.scenario=this.value"></textarea></div>' +
    '<div class="eyebrow" style="margin-bottom:10px"><span class="num">4 ·</span> GO LIVE</div>' +
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
  if (S.mode === "hrbatch" && S.batch) {
    var answered = Math.min(S.batch.idx, S.batch.questions.length);
    personaChip += '<div style="text-align:center;font-size:12px;color:var(--mut);margin-bottom:6px">Question ' +
      Math.min(answered, S.batch.questions.length) + ' of ' + S.batch.questions.length +
      (answered >= S.batch.questions.length ? ' \u2014 set complete, end for feedback' : '') + '</div>';
  }
  var orbIcon = S.phase === "listening" ? "◼" : S.phase === "thinking" ? "…" : S.phase === "speaking" ? "♪" : "🎙";
  var orbLabel = S.phase === "listening" ? "Tap to send your answer"
    : S.phase === "thinking" ? "Interviewer is thinking…"
    : S.phase === "speaking" ? "Speaking — tap to interrupt" : "Tap to speak";
  var h = '<div class="orb-zone">' + personaChip +
    '<button class="orb ' + S.phase + '" onclick="handleOrb()"' + (S.phase === "thinking" ? " disabled" : "") +
    ' aria-label="' + orbLabel + '"><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>' +
    '<span>' + orbIcon + '</span></button>' +
    '<div class="orb-status">' + orbLabel + '</div>';
  if (S.phase === "idle" && S.askedAt && S.thinkMs === null && S.turns.length)
    h += '<div style="text-align:center;font-size:12.5px;color:var(--mut);margin-bottom:4px">' +
      'Thinking <b id="think-clock" style="font-variant-numeric:tabular-nums">0s</b>' +
      '<span style="opacity:.7"> \u00b7 the clock stops at your first word</span></div>';
  if (S.phase === "listening") {
    if (S.thinkMs !== null)
      h += '<div style="text-align:center;font-size:12.5px;color:var(--mut);margin-bottom:4px">' +
        'Took <b style="font-variant-numeric:tabular-nums">' + thinkText(S.thinkMs) + '</b> to start' + '</div>';
    if (S.mode === "extempore")
      h += '<div style="text-align:center;font-size:12.5px;color:var(--mut);margin-bottom:4px">' +
        'Speaking <b id="speak-clock" style="font-variant-numeric:tabular-nums">0:00</b>' +
        '<span style="opacity:.7"> \u00b7 aim for 1\u20132 minutes</span></div>';
    h += '<div id="interim-box" class="interim">' + (esc(S.interim) || '<span style="color:var(--mut)">Listening…</span>') + '</div>';
  }
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
  if (window.IVAnalytics) h += IVAnalytics.liveHtml();
  h += '<div class="sess-actions">' +
    '<div class="statbar"><span>ANSWERS ' + myTurnCount() + '</span><span>FILLER WORDS ' + fillerCount() + '</span>' +
    (pauseStats() ? '<span>AVG PAUSE ' + thinkText(pauseStats().avg) + '</span>' : "") +
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
      '<div class="statbar" style="margin-top:12px"><span>ANSWERS ' + myTurnCount() + '</span><span>FILLER WORDS ' + fillerCount() + '</span>' +
      (pauseStats() ? '<span title="From the interviewer finishing to your first word">AVG PAUSE ' + thinkText(pauseStats().avg) +
        '</span><span>LONGEST PAUSE ' + thinkText(pauseStats().max) + '</span>' : "") +
      '</div></div>';
    var bars = ["clarity", "structure", "confidence", "vocabulary"].map(function (k) {
      var s = (f.scores && f.scores[k]) || 0;
      var subs = (f.subscores && f.subscores[k]) || [];
      var subHtml = subs.map(function (sub) {
        var ss = sub.score || 0;
        return '<div style="margin:6px 0 6px 12px">' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-bottom:3px">' +
          '<span>' + esc(sub.name) + '</span><span>' + ss + '/10</span></div>' +
          '<div class="scorebar" style="height:5px"><div style="width:' + (ss * 10) + '%;opacity:.65"></div></div>' +
          (sub.note ? '<div style="font-size:11.5px;color:var(--mut);margin-top:3px;line-height:1.4">' + esc(sub.note) + '</div>' : '') +
          '</div>';
      }).join("");
      return '<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:600;margin-bottom:5px">' +
        '<span style="text-transform:capitalize">' + k + '</span><span>' + s + '/10</span></div>' +
        '<div class="scorebar"><div style="width:' + (s * 10) + '%"></div></div>' + subHtml + '</div>';
    }).join("");
    h += '<div class="grid2"><div class="card" style="padding:20px"><div class="eyebrow" style="margin-bottom:14px">SCORES</div>' + bars + '</div>' +
      '<div class="card" style="padding:20px"><div class="eyebrow" style="margin-bottom:12px">WHAT WORKED</div>' +
      (f.strengths || []).map(function (s) { return '<div class="fb-item">— ' + esc(s) + '</div>'; }).join("") + '</div></div>';
    h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">FIX NEXT SESSION</div>' +
      (f.improvements || []).map(function (s) { return '<div class="fb-item">— ' + esc(s) + '</div>'; }).join("") + '</div>';
    if ((f.power_phrases || []).length) {
      var ppTitle = S.mode === "vocabulary"
        ? "EVERY WORD YOU COULD SHARPEN (" + f.power_phrases.length + ")"
        : "SAY IT SHARPER";
      h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">' + ppTitle + '</div>' +
        (S.mode === "vocabulary" ? '<div style="font-size:12px;color:var(--mut);margin:-4px 0 12px">Includes the suggestions from your session plus a full sweep of the transcript.</div>' : '') +
        f.power_phrases.map(function (p) {
          return '<div class="fb-item"><span class="weak">' + esc(p.weak) + '</span>' +
            '<span style="margin:0 8px;color:var(--mut)">→</span><span class="strong">' + esc(p.strong) + '</span></div>';
        }).join("") + '</div>';
    }
    if ((f.grammar_notes || []).length)
      h += '<div class="card" style="padding:20px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:12px">GRAMMAR &amp; PHRASING</div>' +
        f.grammar_notes.map(function (g) {
          return '<div class="fb-item"><span class="weak">' + esc(g.said) + '</span>' +
            '<span style="margin:0 8px;color:var(--mut)">→</span><span class="strong">' + esc(g.correct) + '</span></div>';
        }).join("") + '</div>';
  } else {
    h += '<div class="card" style="padding:30px;margin-bottom:16px">Feedback couldn\'t be generated this time. Your transcript is saved — run another round.</div>';
  }
  // Scored per answer during the session, so it survives a failed feedback call.
  if (window.IVAnalytics) h += IVAnalytics.reportHtml();
  if (!readOnly)
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="startSession()">Run it again</button>' +
      '<button class="btn btn-ghost" onclick="saveConversation()">💾 Save session</button>' +
      '<button class="btn btn-ghost" onclick="goSetup()">Change setup</button></div>';
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
function goHome() {
  $("auth-screen").style.display = "none";
  $("app-shell").style.display = "none";
  $("landing").style.display = "block";
  window.scrollTo(0, 0);
}

function goAuth(which) {
  $("landing").style.display = "none";
  $("app-shell").style.display = "none";
  $("auth-screen").style.display = "flex";
  showAuthTab(which === "register" ? "register" : "login");
  window.scrollTo(0, 0);
}

function boot() {
  // Answer analytics: reuses api() for the /chat proxy, render() to repaint
  // when a score settles a beat after the answer.
  // Analytics scoring runs beside every answer, so it gets the lowest priority:
  // it waits for token budget rather than competing with the next question.
  if (window.IVAnalytics)
    IVAnalytics.init({
      apiFn: function (path, method, body) {
        body.tier = "small";   // its own model, its own token bucket
        return aiCall(body, 0);
      },
      onUpdate: render
    });
  restoreSidebar();
  if (token && user) {
    $("landing").style.display = "none";
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
    $("auth-screen").style.display = "none";
    $("landing").style.display = "block";
    window.scrollTo(0, 0);
  }
}
boot();
