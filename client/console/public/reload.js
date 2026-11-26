// Kept out of index.html so the Content-Security-Policy of /admin (vercel.json) needs no inline scripts.
// A page loaded before a deploy names scripts the new deploy no longer has: load the page again (once a half-minute).
window.__hgbReload = function () {
  try { var last = Number(sessionStorage.getItem("hgb-reloaded") || 0); if (Date.now() - last < 30000) return; sessionStorage.setItem("hgb-reloaded", String(Date.now())); } catch (e) { }
  location.reload();
};
window.addEventListener("error", function (e) { var t = e.target; if (t && t.tagName === "SCRIPT" && /\/assets\//.test(t.src || "")) window.__hgbReload(); }, true);
