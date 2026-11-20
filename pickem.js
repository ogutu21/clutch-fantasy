// Pick'Em: predict who wins each match. It is separate from your squad: +3 for every correct pick and
// +5 for getting a whole stage right. Picks lock with the stage deadline. The organiser's "Publish" button
// scores everyone's picks (scorePickEm in script.js), the same way the squad leaderboard is scored.
// This file only draws the Pick'Em view inside the Matches tab (matches.js calls PickEm.render).
(function () {
  "use strict";

  const inPractice = TID === "demo";          // the practice tournament keeps picks on this device only
  const KEY = "clutch-picks-" + (TID || "demo");

  let picks = {};            // matchId -> the team you picked
  let user = null;
  let cloudPicksLoaded = false;
  let board = null;          // Pick'Em leaderboard rows, or null until loaded
  let boardError = "";
  let boardLoading = false;
  let saveNote = "";
  let saveTimer = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cloud() { return window.Cloud || null; }
  function shortTeam(t) { return String(t).replace("Team ", ""); }
  function redraw() { if (typeof window.renderMatches === "function") window.renderMatches(); }

  // ---- Saving and loading -------------------------------------------------

  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === "object") picks = saved;
    } catch (e) { /* no saved picks */ }
  }

  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) { /* storage unavailable */ }
  }

  async function loadFromCloud() {
    try {
      picks = (await cloud().loadPicks(TID)) || {};
      cloudPicksLoaded = true;
      saveNote = "";
    } catch (e) {
      saveNote = "Couldn't load your picks: " + (e.message || e);
    }
    redraw();
  }

  function scheduleSave() {
    saveLocal();
    if (inPractice || !user || !cloud() || !cloudPicksLoaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      cloud().savePicks(TID, { picks: picks, name: user.name })
        .then(function () { saveNote = "Saved."; redraw(); })
        .catch(function (e) { saveNote = "Couldn't save your picks: " + (e.message || e); redraw(); });
    }, 600);
  }

  async function loadBoard() {
    if (inPractice || !user || !cloud() || !cloud().topPickScores || boardLoading) return;
    boardLoading = true;
    try {
      board = await cloud().topPickScores(TID, 30);
      boardError = "";
    } catch (e) {
      boardError = "Couldn't load the Pick'Em leaderboard.";
    }
    boardLoading = false;
    redraw();
  }

  function init() {
    if (inPractice) { loadLocal(); return; }
    if (!cloud()) return;
    cloud().onAuth(function (u) {
      user = u;
      picks = {};
      cloudPicksLoaded = false;
      board = null;
      if (u && TID) loadFromCloud();
      else redraw();
    });
  }

  if (window.Cloud !== undefined) init();
  else window.addEventListener("cloud-ready", init);

  // ---- Drawing ---------------------------------------------------------------

  function pickRow(m, round, stageLocked) {
    const card = el("div", "pe-match");
    const decided = matchDecided(m, round);
    const winner = decided ? matchWinner(m) : null;
    const mine = picks[m.id];

    [m.teamA, m.teamB].forEach(function (team) {
      const b = el("button", "pe-team", shortTeam(team));
      b.type = "button";
      if (mine === team) b.classList.add("picked");
      if (winner === team) b.classList.add("won");
      b.disabled = stageLocked;
      b.addEventListener("click", function () {
        if (isLocked(rounds.indexOf(round))) return;
        if (picks[m.id] === team) delete picks[m.id]; else picks[m.id] = team;   // tap again to clear
        saveNote = "";
        scheduleSave();
        redraw();
      });
      card.appendChild(b);
    });

    let result = "";
    let cls = "pe-result";
    if (decided) {
      if (!mine) { result = "No pick"; }
      else if (mine === winner) { result = "+" + PICK_POINTS; cls += " good"; }
      else { result = "Missed"; cls += " bad"; }
    } else if (stageLocked) {
      result = mine ? "Locked in" : "No pick";
    }
    if (result) card.appendChild(el("span", cls, result));
    return card;
  }

  function board_(box) {
    box.appendChild(el("h3", "", "Pick'Em leaderboard"));
    if (inPractice) { box.appendChild(el("p", "muted", "The practice tournament has no leaderboard.")); return; }
    if (!user) return;
    if (board === null && !boardLoading && !boardError) loadBoard();
    if (boardError) { box.appendChild(el("p", "error", boardError)); return; }
    if (board === null) { box.appendChild(el("p", "muted", "Loading...")); return; }
    if (!board.length) { box.appendChild(el("p", "muted", "No scores yet. They appear after the organiser publishes results.")); return; }
    const wrap = el("div", "table-wrap");
    const table = el("table", "board");
    const head = el("tr");
    ["#", "Player", "Right", "Points"].forEach(function (h) { head.appendChild(el("th", "", h)); });
    table.appendChild(head);
    const st = rankPicks(board);
    st.rows.forEach(function (row, i) {
      const rank = st.ranks[i];
      const tr = el("tr");
      if (row.uid === user.uid) tr.className = "me";
      tr.appendChild(el("td", rank <= 3 ? "rank rank-" + rank : "rank", String(rank)));
      tr.appendChild(el("td", "", row.name));
      tr.appendChild(el("td", "", row.correct + "/" + row.played));
      tr.appendChild(el("td", "total", row.total.toFixed(1)));
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    const refresh = el("button", "outline", "Refresh");
    refresh.type = "button";
    refresh.addEventListener("click", function () { board = null; boardError = ""; loadBoard(); });
    box.appendChild(refresh);
  }

  function render(box) {
    if (inPractice) {
      // The practice data has no ids, so give its matches steady ones (picks stay attached after a reload).
      rounds.forEach(function (r, i) { r.matches.forEach(function (m, k) { if (!m.id) m.id = "demo-" + i + "-" + k; }); });
    }

    box.appendChild(el("h2", "", "Pick'Em"));
    box.appendChild(el("p", "muted", "Predict who wins each match. +" + PICK_POINTS + " for every correct pick, +" + PICK_PERFECT_BONUS +
      " for getting a whole stage right. Picks lock with the stage deadline. This is separate from your squad."));

    if (!inPractice && !user) {
      box.appendChild(el("p", "empty", "Sign in to make your picks."));
      return;
    }
    if (!inPractice && !cloudPicksLoaded && !saveNote) {
      box.appendChild(el("p", "muted", "Loading your picks..."));
      return;
    }

    const score = scorePickEm(picks);
    const tiles = el("div", "pe-score");
    tiles.appendChild(el("div", "pe-tile", "Points: " + score.total.toFixed(1)));
    tiles.appendChild(el("div", "pe-tile", "Correct: " + score.correct + "/" + score.played));
    box.appendChild(tiles);
    if (saveNote) box.appendChild(el("p", saveNote.indexOf("Couldn't") === 0 ? "error" : "muted", saveNote));

    let shown = 0;
    let skipped = 0;
    rounds.forEach(function (round, i) {
      const usable = round.matches.filter(function (m) { return m.id; });
      skipped += round.matches.length - usable.length;
      if (!usable.length) return;
      shown++;
      const locked = isLocked(i);
      box.appendChild(el("div", "mc-label", round.name + (locked ? " · locked" : "")));
      const card = el("div", "mc-card");
      usable.forEach(function (m) { card.appendChild(pickRow(m, round, locked)); });
      box.appendChild(card);
    });
    if (!shown) box.appendChild(el("p", "empty", "No matches to pick yet. They appear once the organiser adds and publishes them."));
    if (skipped) box.appendChild(el("p", "muted", skipped + " match" + (skipped === 1 ? "" : "es") + " will open for picks after the organiser's next publish."));

    board_(box);
  }

  window.PickEm = { render: render };
})();
