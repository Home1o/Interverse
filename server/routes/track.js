/* ============================================================
   Interverse — visit tracking

   Two questions this answers:
     1. How many times has this person been here?
     2. What screen were they on when they left?

   The second one is the reason to bother. Pre-launch, the single most useful
   fact is where people stop — landing without signing up, signing up without
   finishing OTP, reaching setup and never starting a session. The exit screen
   is that answer, and nothing else in the app records it.

   ON NOT USING beforeunload
   The obvious hook is `beforeunload`, and it is the wrong one: mobile Safari
   and Chrome routinely kill a backgrounded tab without ever firing it, so
   phone visits — most of the audience — would silently never report an exit.
   `visibilitychange -> hidden` fires reliably on every platform, including when
   someone switches apps. sendBeacon then survives the page going away, which a
   normal fetch does not.

   WHAT IS SENT
   A random visitor id, the breadcrumb of screens reached, seconds on site,
   mobile or desktop, and the referring site. Never answer text, never anything
   typed into the app, never an IP or full user agent.
   ============================================================ */
(function (global) {
  "use strict";

  var VISITOR_KEY = "iv_vid";       // stable across visits, this browser only
  var MAX_HOPS = 30;

  function rid() {
    try {
      if (global.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    } catch (e) {}
    return String(Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  }

  function visitorId() {
    try {
      var v = localStorage.getItem(VISITOR_KEY);
      if (!v) { v = rid(); localStorage.setItem(VISITOR_KEY, v); }
      return v;
    } catch (e) {
      return "nostore";             // private browsing: still counts, just not across visits
    }
  }

  var visitor = visitorId();
  var visitId = rid();              // one per page load
  var startedAt = Date.now();
  var hops = [];
  var current = "";
  var userId = null;
  var lastSentAt = 0;
  var dirty = false;

  function referrerHost() {
    try {
      if (!document.referrer) return "";
      var h = new URL(document.referrer).hostname;
      return h === location.hostname ? "" : h;   // internal navigation isn't a referrer
    } catch (e) { return ""; }
  }
  var referrer = referrerHost();

  function payload() {
    return JSON.stringify({
      id: visitId,
      visitor: visitor,
      userId: userId,
      screen: current || "landing",
      path: hops.join(">"),
      screens: hops.length || 1,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      device: Math.min(screen.width, screen.height) < 700 ? "mobile" : "desktop",
      referrer: referrer
    });
  }

  /* `final` is set when the page is going away — sendBeacon is the only
     transport the browser guarantees to finish in that moment. */
  function send(final) {
    var body = payload();
    try {
      if (final && navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "text/plain" }));
        dirty = false;
        return;
      }
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true
      }).catch(function () {});
      dirty = false;
      lastSentAt = Date.now();
    } catch (e) {}
  }

  /* Called on every screen change. Writes are throttled so a burst of renders
     doesn't become a burst of rows; the exit beacon always carries the truth. */
  function screenChange(name) {
    if (!name || name === current) return;
    current = name;
    if (hops[hops.length - 1] !== name) hops.push(name);
    if (hops.length > MAX_HOPS) hops = hops.slice(-MAX_HOPS);
    dirty = true;
    if (Date.now() - lastSentAt > 8000) send(false);
  }

  function identify(id) {
    if (!Number.isInteger(id) || id <= 0 || userId === id) return;
    userId = id;
    send(false);                    // tie this visit to the account immediately
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") send(true);
    else if (dirty) send(false);
  });
  // Belt and braces for desktop browsers that close without hiding first.
  global.addEventListener("pagehide", function () { send(true); });

  global.IVTrack = {
    screen: screenChange,
    identify: identify,
    visitorId: function () { return visitor; },
    flush: function () { send(false); }
  };

  // Record the arrival even if the person leaves before anything else happens —
  // that visit is the one you most need to see. screenChange sends on its own;
  // sending again here would double every first beacon.
  screenChange("landing");
})(window);
