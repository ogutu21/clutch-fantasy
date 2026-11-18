// Player profile (Phase 3a): tap a player card to see their stats stage by stage.
// It only reads the game data from script.js; adding or removing goes through togglePlayer().
(function () {
  const dlg = document.getElementById("player-dialog");
  if (!dlg) return;
  const body = document.getElementById("player-body");
  const actionBtn = document.getElementById("player-action");
  const closeBtn = document.getElementById("player-close");
  let openId = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function opponentOf(team, round) {
    for (const m of round.matches) {
      if (m.teamA === team) return m.teamB;
      if (m.teamB === team) return m.teamA;
    }
    return null;
  }

  function tile(label, value) {
    const t = el("div", "pf-tile");
    t.appendChild(el("b", "", value));
    t.appendChild(el("span", "", label));
    return t;
  }

  function fmt(n) { return n.toFixed(1); }

  function build(p) {
    body.innerHTML = "";

    // Header
    const head = el("div", "pf-head role-" + p.role);
    const titles = el("div");
    titles.appendChild(el("div", "pf-name", p.name));
    titles.appendChild(el("div", "pf-sub", roleText(p) + " · " + p.team));
    head.appendChild(titles);
    head.appendChild(el("div", "pf-price", p.price.toFixed(1)));
    body.appendChild(head);

    // Totals across the stages this player played
    let played = 0, kills = 0, assists = 0, deaths = 0, mvps = 0, wins = 0, total = 0;
    rounds.forEach(function (r, i) {
      const s = r.stats[p.id];
      if (!s) return;
      played++;
      kills += s.kills;
      assists += s.assists;
      deaths += s.deaths;
      if (s.mvp) mvps++;
      if (teamWonInRound(p.team, r)) wins++;
      total += rawPoints(p.id, i);
    });

    const tiles = el("div", "pf-tiles");
    tiles.appendChild(tile("Total pts", fmt(total)));
    tiles.appendChild(tile("Avg / stage", played ? fmt(total / played) : "-"));
    tiles.appendChild(tile("K/D", deaths ? (kills / deaths).toFixed(2) : (played ? String(kills) : "-")));
    tiles.appendChild(tile("MVPs", String(mvps)));
    body.appendChild(tiles);

    // Stage by stage
    const wrap = el("div", "table-wrap");
    const table = el("table", "pstats");
    const hr = el("tr");
    ["Stage", "vs", "K", "A", "D", "Pts"].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    table.appendChild(hr);
    rounds.forEach(function (r, i) {
      const s = r.stats[p.id];
      const tr = el("tr");
      const opp = opponentOf(p.team, r);
      const oppText = opp ? opp.replace("Team ", "") : "-";
      if (!s) {
        tr.className = "dnp";
        [r.name, oppText, "-", "-", "-", "-"].forEach(function (t) { tr.appendChild(el("td", "", t)); });
      } else {
        const won = teamWonInRound(p.team, r);
        const stage = el("td", "", r.name);
        if (opp) stage.appendChild(el("span", won ? "pf-w" : "pf-l", won ? "W" : "L"));
        if (s.mvp) stage.appendChild(el("span", "pf-mvp", "MVP"));
        tr.appendChild(stage);
        [oppText, String(s.kills), String(s.assists), String(s.deaths), fmt(rawPoints(p.id, i))].forEach(function (t, k) {
          tr.appendChild(el("td", k === 4 ? "pts" : "", t));
        });
      }
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    body.appendChild(wrap);
    if (!played) body.appendChild(el("p", "muted", "No stats yet. They appear once the organiser enters results."));

    updateAction(p);
  }

  function updateAction(p) {
    const sq = currentSquad();
    const picked = sq.players.includes(p.id);
    const reason = blockReason(p, sq);
    actionBtn.textContent = reason || (picked ? "Remove from squad" : "Add to squad");
    actionBtn.disabled = !!reason;
    actionBtn.classList.toggle("remove", picked && !reason);
  }

  function open(id) {
    const p = playerById(id);
    if (!p) return;
    openId = id;
    build(p);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function close() {
    openId = null;
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
  }

  actionBtn.addEventListener("click", function () {
    if (openId === null) return;
    togglePlayer(openId);
    close();
  });
  closeBtn.addEventListener("click", close);
  dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });   // click on the backdrop

  // Any card with a data-pid opens that player's profile (buttons keep their own job).
  document.addEventListener("click", function (e) {
    if (e.target.closest("button, dialog")) return;
    const card = e.target.closest("[data-pid]");
    if (!card) return;
    open(Number(card.dataset.pid));
  });

  window.openPlayerProfile = open;
})();