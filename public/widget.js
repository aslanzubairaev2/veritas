/*
 * VERITAS-Assistent – Widget für eine bestehende Website.
 * Einbinden (vor </body>):
 *   <script src="https://IHRE-ADRESSE.vercel.app/widget.js" defer></script>
 * Optional: data-lang="ru" oder data-position="left"
 */
(function () {
  if (window.__veritasWidget) return;
  window.__veritasWidget = true;

  var script = document.currentScript;
  var origin = new URL(script.src).origin;
  var pos = (script.getAttribute("data-position") || "right") === "left" ? "left" : "right";
  var lang = script.getAttribute("data-lang");

  var css =
    ".vw-btn{position:fixed;bottom:20px;" + pos + ":20px;z-index:2147483000;width:64px;height:64px;border-radius:50%;border:0;" +
    "background:#0E5560;color:#fff;box-shadow:0 6px 20px rgba(14,85,96,.35);cursor:pointer;display:grid;place-items:center}" +
    ".vw-btn:focus-visible{outline:3px solid #F2B33D;outline-offset:3px}" +
    ".vw-dot{position:absolute;top:6px;right:6px;width:14px;height:14px;border-radius:50%;background:#F2B33D;border:2px solid #0E5560}" +
    ".vw-frame{position:fixed;bottom:96px;" + pos + ":20px;z-index:2147483000;width:400px;height:640px;max-height:calc(100vh - 120px);" +
    "border:0;border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#F1F5F3;display:none}" +
    "@media (max-width:520px){.vw-frame{inset:0;width:100%;height:100%;max-height:none;border-radius:0}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "vw-btn";
  btn.setAttribute("aria-label", "Assistent öffnen / Открыть помощника");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg><span class="vw-dot"></span>';

  var frame = null;
  var open = false;
  btn.onclick = function () {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "vw-frame";
      frame.title = "Assistent";
      frame.allow = "microphone; autoplay";
      frame.src = origin + "/embed" + (lang ? "?lang=" + encodeURIComponent(lang) : "");
      document.body.appendChild(frame);
    }
    open = !open;
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open
      ? '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg><span class="vw-dot"></span>';
  };
  document.body.appendChild(btn);
})();
