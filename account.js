// Account and scoring history (Phase 4b): a profile card on the Home tab for signed-in players.
// Tap it to see your rank, your best stage and your points stage by stage.
// It only reads the game state from script.js; signing out goes through Cloud.logOut().
(function () {
  const dlg = document.getElementById("account-dialog");
  if (!dlg) return;
  const body = document.getElementById("account-body");
  let me = null;   // signed-in player { uid, name }, or null

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function isRealTournament() {
    return typeof TID !== "undefined" && TID && TID !== "demo";
  }

  function stageNet(r) { return roundTotal(r) - hitIn(r); }
  function hasResults(r) { return Object.keys(rounds[r].stats).length > 0; }

  function tile(label, value, sub) {
    const t = el("div", "pf-tile");
    const v = el("b", "", value);
    t.appendChild(v);
    t.appendChild(el("span", "", label));
    if (sub) t.appendChild(el("span", "ac-tile-sub", sub));
    return { node: t, value: v };
  }

  function build() {
    body.innerHTML = "";

    // Header
    const head = el("div", "ac-head");
    head.appendChild(Avatars.userEl(me.name, me.uid, true));
    const titles = el("div");
    titles.appendChild(el("div", "ac-name", Avatars.nameOf(me.uid) || me.name));
    titles.appendChild(el("div", "ac-sub", tournamentInfo ? tournamentInfo.name : "Practice tournament"));
    if (window.Cloud && window.Cloud.setUsername) {
      const un = el("button", "outline ac-change", Avatars.nameOf(me.uid) ? "Change username" : "Set username");
      un.type = "button";
      un.addEventListener("click", function () {
        const input = window.prompt("Choose a username (3 to 20 letters, numbers or underscores). It is shown on the leaderboard.", Avatars.nameOf(me.uid) || "");
        if (input === null) return;
        const bad = window.Cloud.checkUsername(input);
        if (bad) { alert(bad); return; }
        window.Cloud.setUsername(input.trim()).then(function (name) {
          me.name = name;
          Avatars.setMyName(me.uid, name);
          window.dispatchEvent(new CustomEvent("username-changed", { detail: name }));
          build();
          if (typeof window.renderHome === "function") window.renderHome();
        }).catch(function (e) { alert((e && e.message) || "Couldn't save that username."); });
      });
      titles.appendChild(un);
    }
    if (isRealTournament() && window.Cloud && window.Cloud.saveProfile) {
      const change = el("button", "outline ac-change", "Change picture");
      change.type = "button";
      change.addEventListener("click", function () {
        Avatars.pick("Your picture", Avatars.profileOf(me.uid), function (look) {
          Avatars.saveMyPicture(me.uid, look).catch(function (e) { alert("Couldn't save your picture: " + (e.message || e)); });
        });
      });
      titles.appendChild(change);
    }
    head.appendChild(titles);
    body.appendChild(head);

    // Summary tiles
    const played = [];
    rounds.forEach(function (_, i) { if (hasResults(i)) played.push(i); });
    let bestIdx = -1;
    played.forEach(function (i) { if (bestIdx < 0 || stageNet(i) > stageNet(bestIdx)) bestIdx = i; });

    const tiles = el("div", "pf-tiles");
    tiles.appendChild(tile("Total points", totalPoints().toFixed(1)).node);
    const rankTile = tile("Rank", "-", isRealTournament() ? "" : "Practice");
    tiles.appendChild(rankTile.node);
    tiles.appendChild(tile("Best stage", bestIdx >= 0 ? stageNet(bestIdx).toFixed(1) : "-", bestIdx >= 0 ? rounds[bestIdx].name : "").node);
    tiles.appendChild(tile("Squad value", (STARTING_BUDGET - budgetLeft()).toFixed(1)).node);
    body.appendChild(tiles);

    // Scoring history
    body.appendChild(el("h3", "", "Scoring history"));
    const wrap = el("div", "table-wrap");
    const table = el("table", "pstats history");
    const hr = el("tr");
    ["Stage", "Captain", "Chip", "Hit", "Pts"].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    table.appendChild(hr);
    let total = 0;
    rounds.forEach(function (r, i) {
      const sq = squads[i];
      const cap = sq.captain !== null && playerById(sq.captain) ? playerById(sq.captain).name : "-";
      const chip = sq.chip ? CHIPS.find(function (c) { return c.id === sq.chip; }).name : "-";
      const tr = el("tr");
      if (!hasResults(i)) tr.className = "dnp";
      const pts = hasResults(i) ? stageNet(i) : null;
      if (pts !== null) total += pts;
      [r.name, cap, chip, hitIn(i) ? "-" + hitIn(i) : "-", pts === null ? "-" : pts.toFixed(1)].forEach(function (text, k) {
        tr.appendChild(el("td", k === 4 ? "pts" : "", text));
      });
      table.appendChild(tr);
    });
    const foot = el("tr", "total");
    ["Total", "", "", "", total.toFixed(1)].forEach(function (text, k) {
      foot.appendChild(el("td", k === 4 ? "pts" : "", text));
    });
    table.appendChild(foot);
    wrap.appendChild(table);
    body.appendChild(wrap);

    // Leagues
    if (isRealTournament() && window.Cloud) {
      body.appendChild(el("h3", "", "My leagues"));
      const box = el("div", "ac-leagues", "Loading...");
      body.appendChild(box);
      window.Cloud.myLeagues(TID).then(function (list) {
        box.textContent = "";
        if (!list.length) { box.textContent = "You're not in any league for this tournament yet."; return; }
        list.forEach(function (lg) { box.appendChild(el("span", "chip", lg.name + " (" + lg.count + ")")); });
      }).catch(function () { box.textContent = "Couldn't load your leagues."; });

      window.Cloud.topScores(TID, 500).then(function (rows) {
        const i = rows.findIndex(function (r) { return r.uid === me.uid; });
        if (i < 0) { rankTile.value.textContent = "-"; return; }
        let pos = i;
        while (pos > 0 && rows[pos - 1].total === rows[i].total) pos--;
        rankTile.value.textContent = "#" + (pos + 1);
        rankTile.node.appendChild(el("span", "ac-tile-sub", "of " + rows.length));
      }).catch(function () { /* leave the dash */ });
    }
  }

  function open() {
    if (!me) return;
    build();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function close() {
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
  }

  document.getElementById("account-close").addEventListener("click", close);
  document.getElementById("account-ranks").addEventListener("click", function () {
    close();
    const b = document.querySelector('#tabbar [data-tab="ranks"]');
    if (b) b.click();
  });
  document.getElementById("account-signout").addEventListener("click", function () {
    close();
    if (window.Cloud) window.Cloud.logOut();
  });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });

  // Replace the plain greeting on the Home tab with a tappable profile card.
  function decorate() {
    const greet = document.querySelector("#dashboard .dash-greet");
    if (!greet || !me) return;
    const card = el("div", "ac-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.appendChild(Avatars.userEl(Avatars.nameOf(me.uid) || me.name, me.uid, false));
    const text = el("div", "ac-card-text");
    const cn = el("div", "ac-card-name", Avatars.nameOf(me.uid) || me.name);
    cn.setAttribute("data-uname", me.uid);
    text.appendChild(cn);
    text.appendChild(el("div", "ac-card-sub", "View profile and scoring history"));
    card.appendChild(text);
    card.appendChild(el("span", "ac-chev", "\u203A"));
    card.addEventListener("click", open);
    card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") open(); });
    greet.replaceWith(card);
  }

  // script.js calls renderHome() after every redraw; piggy-back on that so we decorate after the dashboard is drawn.
  const previous = window.renderHome;
  window.renderHome = function () {
    if (typeof previous === "function") previous();
    decorate();
  };

  window.addEventListener("load", function () {
    if (window.Cloud) {
      window.Cloud.onAuth(function (u) {
        me = u;
        if (typeof window.renderHome === "function") window.renderHome();
      });
    }
  });
})();