// Home dashboard (Phase 2a): a summary at the top of the Home tab.
// It only reads the game state from script.js and draws; it never changes the game.
(function () {
  let me = null;       // signed-in player { uid, name }, or null
  let rank = null;     // { pos, of } from the leaderboard, or null
  let rankAt = 0;
  let rankBusy = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function isRealTournament() {
    return typeof TID !== "undefined" && TID && TID !== "demo";
  }

  // The first stage that is still open: { name, left (ms or null), at }, or null if all are locked.
  function nextDeadline() {
    for (let i = 0; i < rounds.length; i++) {
      if (!isLocked(i)) {
        const r = rounds[i];
        if (r.lockAt) return { name: r.name, left: Date.parse(r.lockAt) - Date.now(), at: r.lockAt };
        return { name: r.name, left: null, at: null };
      }
    }
    return null;
  }

  function loadRank() {
    if (!window.Cloud || !me || !isRealTournament()) { rank = null; return; }
    if (rankBusy || Date.now() - rankAt < 60000) return;
    rankBusy = true;
    window.Cloud.topScores(TID, 500).then(function (rows) {
      const st = rankStandings(rows);
      const i = st.rows.findIndex(function (r) { return r.uid === me.uid; });
      rank = i < 0 ? { pos: null, of: rows.length } : { pos: st.ranks[i], of: rows.length };
    }).catch(function () {
      rank = null;
    }).then(function () {
      rankBusy = false;
      rankAt = Date.now();
      renderHome();
    });
  }

  function tile(label, value, sub, main) {
    const t = el("div", "hero-tile" + (main ? " main" : ""));
    t.appendChild(el("div", "hero-label", label));
    t.appendChild(el("div", "hero-value", value));
    if (sub) t.appendChild(el("div", "hero-sub", sub));
    return t;
  }

  // What is missing from a squad: a list of short phrases, empty if it is ready.
  function squadProblems(sq) {
    const out = squadIssues(sq);
    if (budgetLeft() < 0) out.push("over budget");
    return out;
  }

  // A banner at the top of Home when the squad for the open stage isn't ready (or locked while not ready).
  function readinessBanner(sq) {
    const problems = squadProblems(sq);
    if (!problems.length) return null;
    const round = rounds[currentRound];
    const locked = isLocked(currentRound);
    const box = el("div", "dash-alert");
    let left = null;
    if (!locked && round.lockAt) left = Date.parse(round.lockAt) - Date.now();
    if (!locked && left !== null && left < 24 * 3600 * 1000) box.classList.add("urgent");
    const text = el("div", "dash-alert-text");
    text.appendChild(el("b", "", locked
      ? round.name + " is locked and your squad wasn't ready"
      : "Your squad for " + round.name + " isn't ready"));
    text.appendChild(el("div", "", problems.join(" \u00b7 ") + (locked
      ? ". It scores with the players you have."
      : (left !== null ? " \u00b7 locks in " + timeLeftText(Math.max(0, left)) : ""))));
    box.appendChild(text);
    if (!locked) {
      const go = el("button", "", sq.players.length < SQUAD_SIZE ? "Open the market" : "Fix your squad");
      go.type = "button";
      go.addEventListener("click", function () {
        const b = document.querySelector('#tabbar [data-tab="' + (sq.players.length < SQUAD_SIZE ? "market" : "squad") + '"]');
        if (b) b.click();
      });
      box.appendChild(go);
    }
    return box;
  }

  function draw(box) {
    box.innerHTML = "";
    const sq = currentSquad();

    // Greeting
    const greet = el("p", "dash-greet");
    if (me) {
      greet.appendChild(document.createTextNode("Welcome back, "));
      greet.appendChild(el("b", "", me.name));
    } else {
      greet.textContent = "Playing as a guest. Sign in to save your squad and join the leaderboard.";
    }
    box.appendChild(greet);

    const alertBox = readinessBanner(sq);
    if (alertBox) box.appendChild(alertBox);

    // Hero tiles
    let rankText = "-";
    let rankSub = "";
    if (!isRealTournament()) {
      rankSub = "Practice mode";
    } else if (!me) {
      rankSub = "Sign in to rank";
    } else if (rank && rank.pos) {
      rankText = "#" + rank.pos;
      rankSub = "of " + rank.of + " players";
    } else if (rank) {
      rankSub = "Not ranked yet";
    } else {
      rankSub = "Loading...";
    }
    const hero = el("div", "dash-hero");
    hero.appendChild(tile("Total points", totalPoints().toFixed(1), "All stages", true));
    hero.appendChild(tile("Rank", rankText, rankSub));
    hero.appendChild(tile("This round", roundTotal(currentRound).toFixed(1), rounds[currentRound].name));
    box.appendChild(hero);

    // Next deadline
    const dl = nextDeadline();
    const card = el("div", "dash-deadline");
    const left = el("div");
    left.appendChild(el("div", "hero-label", "Next deadline"));
    if (!dl) {
      left.appendChild(el("div", "dash-dl-value", "All stages locked"));
    } else if (dl.left === null) {
      left.appendChild(el("div", "dash-dl-value", dl.name + ": no deadline set"));
    } else {
      left.appendChild(el("div", "dash-dl-value", timeLeftText(Math.max(0, dl.left))));
      left.appendChild(el("div", "hero-sub", dl.name + " locks " + new Date(dl.at).toLocaleString()));
    }
    card.appendChild(left);
    box.appendChild(card);

    // Squad snapshot
    const head = el("div", "section-head");
    head.appendChild(el("h2", "", "Your squad"));
    head.appendChild(el("span", "muted", sq.players.length + "/6 · budget left " + budgetLeft().toFixed(1)));
    box.appendChild(head);

    if (!sq.players.length) {
      const empty = el("div", "dash-empty");
      empty.appendChild(el("p", "muted", "You haven't picked a squad for " + rounds[currentRound].name + " yet."));
      const go = el("button", "", "Open the market");
      go.type = "button";
      go.addEventListener("click", function () {
        const b = document.querySelector('#tabbar [data-tab="market"]');
        if (b) b.click();
      });
      empty.appendChild(go);
      box.appendChild(empty);
      return;
    }

    const list = el("div", "dash-squad");
    const order = startersOf(sq).concat(sq.sub ? [sq.sub] : []);
    order.forEach(function (id) {
      const p = players.find(function (x) { return x.id === id; });
      if (!p) return;
      const row = el("div", "mini-player role-" + p.role + (id === sq.sub ? " is-sub" : ""));
      const info = el("div", "mini-info");
      const name = el("div", "mini-name", p.name);
      const tag = id === sq.captain ? "C" : id === sq.vice ? "VC" : id === sq.sub ? "SUB" : "";
      if (tag) name.appendChild(el("span", "mini-tag", tag));
      info.appendChild(name);
      info.appendChild(el("div", "mini-meta", roleText(p) + " · " + p.team.replace("Team ", "")));
      row.appendChild(info);
      row.appendChild(el("div", "mini-pts", pointsInRound(id, currentRound).toFixed(1)));
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  function renderHome() {
    const box = document.getElementById("dashboard");
    if (!box || typeof rounds === "undefined" || typeof squads === "undefined") return;
    try {
      loadRank();
      draw(box);
    } catch (e) {
      console.error("Home dashboard:", e);
    }
  }
  window.renderHome = renderHome;

  // Leaving with a squad that isn't ready, before the stage locks: ask first.
  function leavingProblems() {
    if (!isRealTournament() || !me || isLocked(currentRound)) return null;
    const r = rounds[currentRound];
    if (!r.lockAt) return null;
    const p = squadProblems(currentSquad());
    return p.length ? p : null;
  }
  window.addEventListener("beforeunload", function (e) {
    if (!leavingProblems()) return;
    e.preventDefault();
    e.returnValue = "";   // the browser shows its own "leave site?" message
  });
  document.addEventListener("click", function (e) {
    const a = e.target.closest && e.target.closest("a.link");
    if (!a || a.target === "_blank") return;
    const p = leavingProblems();
    if (!p) return;
    const left = Date.parse(rounds[currentRound].lockAt) - Date.now();
    if (!confirm("Your squad for " + rounds[currentRound].name + " isn't ready (" + p.join(", ") + "). It locks in " + timeLeftText(Math.max(0, left)) + ".\n\nLeave anyway?")) {
      e.preventDefault();
    }
  });

  window.addEventListener("load", function () {
    if (window.Cloud) {
      window.Cloud.onAuth(function (u) {
        me = u;
        rank = null;
        rankAt = 0;
        renderHome();
      });
    }
    renderHome();
  });

  // Keep the countdown fresh.
  setInterval(renderHome, 30000);
})();