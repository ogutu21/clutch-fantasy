// Tab navigation for the game page: Home / Squad / Market / Ranks.
// It only shows and hides sections, so the game logic in script.js is untouched.
(function () {
  const panes = document.querySelectorAll(".tab-pane");
  const buttons = document.querySelectorAll("#tabbar button");
  if (!panes.length || !buttons.length) return;

  const names = Array.from(buttons).map(function (b) { return b.dataset.tab; });
  const KEY = "clutch-tab";

  function show(name) {
    if (names.indexOf(name) === -1) name = "home";
    panes.forEach(function (p) { p.hidden = p.dataset.pane !== name; });
    buttons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    try { sessionStorage.setItem(KEY, name); } catch (e) {}
    window.scrollTo({ top: 0 });
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () { show(b.dataset.tab); });
  });

  // Mini budget bar in the Market tab mirrors the real numbers from script.js.
  function syncMini() {
    const b = document.getElementById("budget");
    const c = document.getElementById("count");
    if (b) document.getElementById("mini-budget").textContent = b.textContent;
    if (c) document.getElementById("mini-count").textContent = c.textContent;
  }
  ["budget", "count"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) new MutationObserver(syncMini).observe(el, { childList: true, characterData: true, subtree: true });
  });
  syncMini();

  let start = "home";
  try { start = sessionStorage.getItem(KEY) || "home"; } catch (e) {}
  show(start);
})();