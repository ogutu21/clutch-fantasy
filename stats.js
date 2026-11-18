// Player stats (Phase 7): a table of every player's numbers across the tournament, inside the Market tab.
// Switch between Cards and Stats at the top of the Market. It follows the same search, team and role filters.
(function () {
  "use strict";

  const pane = document.querySelector('[data-pane="market"]');
  const list = document.getElementById("player-list");
  const tools = pane && pane.querySelector(".market-tools");
  if (!pane || !list || !tools) return;

  let mode = "cards";    // "cards" or "stats"
  let sortKey = "pts";

  const SORTS = {
    pts: ["Total points", function (t) { return t.pts; }],
    avg: ["Average per stage", function (t) { return t.avg; }],
    kills: ["Kills", function (t) { return t.k; }],
    kd: ["K/D", function (t) { return t.kd; }],
    mvp: ["MVPs", function (t) { return t.mvp; }],
    stages: ["Stages played", function (t) { return t.st; }],
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function totals(p) {
    let st = 0, k = 0, d = 0, a = 0, mvp = 0, pts = 0;
    rounds.forEach(function (r, i) {
      const s = r.stats[p.id];
      if (!s) return;
      st++;
      k += s.kills;
      d += s.deaths;
      a += s.assists;
      if (s.mvp) mvp++;
      pts += rawPoints(p.id, i);
    });
    return { st: st, k: k, d: d, a: a, mvp: mvp, pts: pts, avg: st ? pts / st : 0, kd: d ? k / d : k };
  }

  // ---- Controls ---------------------------------------------------------------

  const bar = el("div", "stats-bar");
  const seg = el("div", "seg");
  const buttons = {};
  [["cards", "Cards"], ["stats", "Stats"]].forEach(function (m) {
    const b = el("button", "", m[1]);
    b.type = "button";
    b.addEventListener("click", function () { setMode(m[0]); });
    buttons[m[0]] = b;
    seg.appendChild(b);
  });
  bar.appendChild(seg);

  const sortSel = el("select");
  sortSel.setAttribute("aria-label", "Sort stats by");
  Object.keys(SORTS).forEach(function (k) {
    const o = el("option", "", "Sort: " + SORTS[k][0]);
    o.value = k;
    sortSel.appendChild(o);
  });
  sortSel.addEventListener("change", function () { sortKey = sortSel.value; render(); });
  bar.appendChild(sortSel);
  tools.insertBefore(bar, tools.firstChild);

  const view = el("div", "stats-view");
  view.id = "stats-view";
  view.hidden = true;
  list.parentNode.insertBefore(view, list.nextSibling);

  function setMode(m) {
    mode = m;
    Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle("active", k === mode); });
    sortSel.style.display = mode === "stats" ? "" : "none";
    const priceSort = document.getElementById("market-sort");
    if (priceSort) priceSort.style.display = mode === "stats" ? "none" : "";
    list.hidden = mode === "stats";
    view.hidden = mode !== "stats";
    render();
  }

  // ---- The table ----------------------------------------------------------------

  function tile(label, value) {
    const t = el("div", "s-tile");
    t.appendChild(el("b", "", String(value)));
    t.appendChild(el("span", "", label));
    return t;
  }

  function row(r, rank) {
    const p = r.p, t = r.t;
    const d = el("div", "srow role-" + p.role);
    d.dataset.pid = p.id;

    d.appendChild(el("div", "rank-badge" + (rank <= 3 ? " r" + rank : ""), String(rank)));

    const main = el("div", "srow-main");
    main.appendChild(el("div", "srow-name", p.name));
    main.appendChild(el("div", "srow-sub", roleText(p) + " \u00b7 " + p.team));
    d.appendChild(main);

    const pts = el("div", "srow-pts");
    pts.appendChild(el("b", "", t.pts.toFixed(1)));
    pts.appendChild(el("span", "", t.st ? "avg " + t.avg.toFixed(1) : "no games"));
    d.appendChild(pts);

    const tiles = el("div", "srow-stats");
    tiles.appendChild(tile("Played", t.st));
    tiles.appendChild(tile("Kills", t.k));
    tiles.appendChild(tile("Deaths", t.d));
    tiles.appendChild(tile("Assists", t.a));
    tiles.appendChild(tile("K/D", t.kd.toFixed(2)));
    tiles.appendChild(tile("MVP", t.mvp));
    d.appendChild(tiles);
    return d;
  }

  function render() {
    if (mode !== "stats") return;
    view.innerHTML = "";
    const q = marketSearch.trim().toLowerCase();
    const rows = players.filter(function (p) {
      if (roleFilter !== "all" && p.role !== roleFilter) return false;
      if (marketTeam !== "all" && p.team !== marketTeam) return false;
      if (q && (p.name + " " + p.team).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(function (p) { return { p: p, t: totals(p) }; });

    const get = SORTS[sortKey][1];
    rows.sort(function (a, b) { return get(b.t) - get(a.t) || a.p.name.localeCompare(b.p.name); });

    if (!rows.length) {
      view.appendChild(el("p", "empty", "No players match your search."));
      return;
    }
    rows.forEach(function (r, i) { view.appendChild(row(r, i + 1)); });
  }

  // The market list is rebuilt on every search, filter and round change, so keep the table in step with it.
  new MutationObserver(render).observe(list, { childList: true });
  setMode("cards");
})();