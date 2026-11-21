// Match center (Phase 4a, extended in Phases 7 and 9): the matches of the selected stage with scores and who won,
// a tournament summary, a Standings table, and a Teams view with each team's roster.
// It only reads the game data from script.js and draws; it never changes the game.
(function () {
  "use strict";

  let view = "matches";     // "matches", "standings", "teams" or "pickem"
  let filter = "all";       // "all", "upcoming" or "completed"
  const openTeams = {};     // teams whose roster is showing
  let standStage = "all";   // the Standings table covers "all" stages, or one stage number

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function shortTeam(t) { return t.replace("Team ", ""); }

  // A coloured badge with the team's initials (stands in for a logo).
  function tagText(team) {
    const words = shortTeam(team).trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 3).map(function (w) { return w[0]; }).join("").toUpperCase();
  }

  // Each team gets its own colour, spread around the colour wheel so neighbours look different.
  function tagHue(team) {
    const i = teamList().indexOf(team);
    return Math.round((Math.max(i, 0) * 137.5 + 190) % 360);
  }

  function badge(team) {
    if (typeof TEAM_LOGOS !== "undefined" && TEAM_LOGOS[team]) return teamLogoEl(team, 38);
    const b = el("span", "team-badge", tagText(team));
    const h = tagHue(team);
    b.style.background = "linear-gradient(135deg, hsl(" + h + " 75% 55%), hsl(" + ((h + 50) % 360) + " 70% 40%))";
    return b;
  }

  function teamKills(team, round) {
    let k = 0;
    players.forEach(function (p) {
      const s = round.stats[p.id];
      if (p.team === team && s) k += s.kills;
    });
    return k;
  }

  function teamHasStats(team, round) {
    return players.some(function (p) { return p.team === team && round.stats[p.id]; });
  }

  // A match counts as completed once either team has stats for that stage.
  function isPlayed(m, round) {
    return teamHasStats(m.teamA, round) || teamHasStats(m.teamB, round);
  }

  function hasScore(m) {
    return typeof m.scoreA === "number" && typeof m.scoreB === "number";
  }

  function teamList() {
    const out = [];
    players.forEach(function (p) { if (out.indexOf(p.team) === -1) out.push(p.team); });
    return out;
  }

  // Players of the given teams who have stats this stage, best fantasy points first.
  function performers(round, teams) {
    return players
      .filter(function (p) { return teams.indexOf(p.team) !== -1 && round.stats[p.id]; })
      .sort(function (a, b) { return rawPoints(b.id, currentRound) - rawPoints(a.id, currentRound); });
  }

  function perfRow(p, round) {
    const s = round.stats[p.id];
    const row = el("div", "perf role-" + p.role);
    row.dataset.pid = p.id;
    const main = el("div", "perf-main");
    const name = el("div", "perf-name", p.name);
    if (s.mvp) name.appendChild(el("span", "pf-mvp", "MVP"));
    main.appendChild(name);
    main.appendChild(el("div", "perf-meta",
      roleText(p) + " \u00b7 " + shortTeam(p.team) + " \u00b7 " + s.kills + "/" + s.assists + "/" + s.deaths));
    row.appendChild(main);
    row.appendChild(el("div", "perf-pts", rawPoints(p.id, currentRound).toFixed(1)));
    return row;
  }

  function seg(options, current, onPick) {
    const box = el("div", "seg");
    options.forEach(function (o) {
      const b = el("button", current === o[0] ? "active" : "", o[1]);
      b.type = "button";
      b.addEventListener("click", function () { onPick(o[0]); });
      box.appendChild(b);
    });
    return box;
  }

  function teamSide(team, round, won, played) {
    const side = el("div", "mc-team" + (played && won ? " won" : ""));
    side.appendChild(badge(team));
    side.appendChild(el("div", "mc-name", shortTeam(team)));
    if (played) {
      side.appendChild(el("div", "mc-sub", teamKills(team, round) + " kills"));
      if (won) side.appendChild(el("span", "mc-win", "WIN"));
    }
    return side;
  }

  // ---- Matches view -----------------------------------------------------------

  function summary(box) {
    let done = 0, upcoming = 0;
    rounds.forEach(function (r) {
      r.matches.forEach(function (m) { if (isPlayed(m, r)) done++; else upcoming++; });
    });
    const tiles = el("div", "mc-tiles");
    [["Completed", done], ["Upcoming", upcoming], ["Teams", teamList().length]].forEach(function (t) {
      const tile = el("div", "mc-tile");
      tile.appendChild(el("b", "", String(t[1])));
      tile.appendChild(el("span", "", t[0]));
      tiles.appendChild(tile);
    });
    box.appendChild(tiles);
  }

  function matchCard(m, round) {
    const played = isPlayed(m, round);
    const card = el("div", "mc-card");

    const top = el("div", "mc-top");
    const typeName = STAGE_TYPES[round.type] || "";
    top.appendChild(el("span", "muted", round.name + (typeName ? " \u00b7 " + typeName : "")));
    top.appendChild(el("span", "chip " + (played ? "status-open" : "status-practice"), played ? "Completed" : "Upcoming"));
    card.appendChild(top);

    const versus = el("div", "mc-versus");
    versus.appendChild(teamSide(m.teamA, round, m.winner === m.teamA, played));
    if (hasScore(m)) {
      const score = el("div", "mc-score");
      score.appendChild(el("span", m.scoreA > m.scoreB ? "lead" : "", String(m.scoreA)));
      score.appendChild(el("i", "", ":"));
      score.appendChild(el("span", m.scoreB > m.scoreA ? "lead" : "", String(m.scoreB)));
      versus.appendChild(score);
    } else {
      versus.appendChild(el("div", "mc-vs", "VS"));
    }
    versus.appendChild(teamSide(m.teamB, round, m.winner === m.teamB, played));
    card.appendChild(versus);

    if (Array.isArray(m.games) && m.games.length) {
      const modes = { hp: "Hardpoint", snd: "S&D", ctl: "Control", other: "Map" };
      const maps = el("div", "mc-maps");
      m.games.forEach(function (g, i) {
        maps.appendChild(el("span", "chip", (i + 1) + ". " + (modes[g.mode] || "Map") + (g.map ? " \u00b7 " + g.map : "") + (typeof g.scoreA === "number" && typeof g.scoreB === "number" ? " \u00b7 " + g.scoreA + "\u2013" + g.scoreB : "")));
      });
      card.appendChild(maps);
    }

    if (played) {
      const top3 = performers(round, [m.teamA, m.teamB]).slice(0, 3);
      if (top3.length) {
        card.appendChild(el("div", "mc-label", "Top performers"));
        top3.forEach(function (p) { card.appendChild(perfRow(p, round)); });
      }
    }
    return card;
  }

  function matchesView(box) {
    summary(box);
    box.appendChild(seg([["all", "All"], ["upcoming", "Upcoming"], ["completed", "Completed"]], filter, function (f) {
      filter = f;
      renderMatches();
    }));

    const round = rounds[currentRound];
    box.appendChild(el("h2", "", round.name));

    if (!round.matches.length) {
      box.appendChild(el("p", "empty", "No matches scheduled for this stage yet."));
      return;
    }
    const shown = round.matches.filter(function (m) {
      const played = isPlayed(m, round);
      return filter === "all" || (filter === "completed" ? played : !played);
    });
    if (!shown.length) box.appendChild(el("p", "empty", "Nothing here for this filter."));
    shown.forEach(function (m) { box.appendChild(matchCard(m, round)); });

    if (Object.keys(round.stats).length) {
      const leaders = performers(round, teamList()).slice(0, 5);
      if (leaders.length) {
        box.appendChild(el("h2", "", "Stage leaders"));
        const wrap = el("div", "mc-card");
        leaders.forEach(function (p, i) {
          const row = perfRow(p, round);
          row.insertBefore(el("div", "perf-rank", String(i + 1)), row.firstChild);
          wrap.appendChild(row);
        });
        box.appendChild(wrap);
      }
    }
  }

  // ---- Standings view -----------------------------------------------------------

  // Wins, losses and the map difference for every team, over all stages or one stage.
  function standingsRows() {
    const table = {};
    teamList().forEach(function (t) { table[t] = { team: t, p: 0, w: 0, l: 0, mw: 0, ml: 0 }; });
    rounds.forEach(function (r, i) {
      if (standStage !== "all" && Number(standStage) !== i) return;
      r.matches.forEach(function (m) {
        if (m.slot) return;   // playoff matches have their own Playoffs view
        if (!(isPlayed(m, r) || hasScore(m))) return;
        const a = table[m.teamA], b = table[m.teamB];
        if (!a || !b || m.teamA === m.teamB) return;
        a.p++;
        b.p++;
        const winner = hasScore(m) && m.scoreA !== m.scoreB ? (m.scoreA > m.scoreB ? m.teamA : m.teamB) : m.winner;
        if (winner === m.teamA) { a.w++; b.l++; } else { b.w++; a.l++; }
        if (hasScore(m)) {
          a.mw += m.scoreA; a.ml += m.scoreB;
          b.mw += m.scoreB; b.ml += m.scoreA;
        }
      });
    });
    return Object.keys(table).map(function (k) { return table[k]; }).sort(function (x, y) {
      return y.w - x.w || (y.mw - y.ml) - (x.mw - x.ml) || x.team.localeCompare(y.team);
    });
  }

  // Knockout tournaments: who is still in, and who went out in which stage.
  function bracketView(box) {
    box.appendChild(el("h2", "", "Bracket"));
    const out = {};      // team -> name of the stage they lost in
    const wins = {};
    teamList().forEach(function (t) { wins[t] = 0; });
    rounds.forEach(function (r) {
      r.matches.forEach(function (m) {
        if (!(isPlayed(m, r) || hasScore(m)) || m.teamA === m.teamB) return;
        const winner = hasScore(m) && m.scoreA !== m.scoreB ? (m.scoreA > m.scoreB ? m.teamA : m.teamB) : m.winner;
        const loser = winner === m.teamA ? m.teamB : m.teamA;
        if (wins[winner] !== undefined) wins[winner]++;
        if (!out[loser]) out[loser] = r.name;
      });
    });
    const teams = teamList();
    if (!teams.length) { box.appendChild(el("p", "empty", "No teams yet.")); return; }
    const alive = teams.filter(function (t) { return !out[t]; }).sort(function (a, b) { return wins[b] - wins[a] || a.localeCompare(b); });
    const gone = teams.filter(function (t) { return out[t]; });
    function group(title, list, note) {
      if (!list.length) return;
      box.appendChild(el("div", "mc-label", title));
      const wrap = el("div", "mc-card");
      list.forEach(function (t) {
        const row = el("div", "perf");
        row.appendChild(badge(t));
        const main = el("div", "perf-main");
        main.appendChild(el("div", "perf-name", shortTeam(t)));
        main.appendChild(el("div", "perf-meta", note(t)));
        row.appendChild(main);
        row.appendChild(el("div", "perf-pts", wins[t] + " W"));
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    }
    group("Still in", alive, function (t) { return wins[t] ? "Won " + wins[t] + " match" + (wins[t] === 1 ? "" : "es") : "Waiting to play"; });
    group("Knocked out", gone, function (t) { return "Out in " + out[t]; });
    box.appendChild(el("p", "muted", "A team goes out when it loses a match. Fix a result in the admin page if this looks wrong."));
  }

  function standingsView(box) {
    if (FORMAT === "bracket") { bracketView(box); return; }
    box.appendChild(el("h2", "", "Standings"));

    const sel = el("select", "stand-select");
    sel.setAttribute("aria-label", "Stage");
    const all = el("option", "", "All stages");
    all.value = "all";
    sel.appendChild(all);
    rounds.forEach(function (r, i) {
      const o = el("option", "", r.name);
      o.value = String(i);
      sel.appendChild(o);
    });
    sel.value = standStage;
    sel.addEventListener("change", function () { standStage = sel.value; renderMatches(); });
    box.appendChild(sel);

    const rows = standingsRows();
    if (!rows.some(function (r) { return r.p; })) {
      box.appendChild(el("p", "empty", "No completed matches yet."));
      return;
    }
    const wrap = el("div", "table-wrap");
    const table = el("table", "board standings");
    const head = el("tr");
    ["#", "Team", "P", "W", "L", "+/-"].forEach(function (h) { head.appendChild(el("th", "", h)); });
    table.appendChild(head);
    rows.forEach(function (r, i) {
      const tr = el("tr");
      tr.appendChild(el("td", i < 3 && r.p ? "rank rank-" + (i + 1) : "rank", String(i + 1)));
      const cell = el("td");
      const inner = el("div", "pc-inner");
      const b = badge(r.team);
      b.classList.add("sm");
      inner.appendChild(b);
      inner.appendChild(el("span", "pname", shortTeam(r.team)));
      cell.appendChild(inner);
      tr.appendChild(cell);
      const diff = r.mw - r.ml;
      [String(r.p), String(r.w), String(r.l), (diff > 0 ? "+" : "") + diff].forEach(function (t) {
        tr.appendChild(el("td", "num", t));
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    box.appendChild(el("p", "muted", "Teams are ranked by wins, then by map difference. A match counts once it has results or a score."));
  }

  // ---- Teams view -------------------------------------------------------------

  function teamsView(box) {
    const teams = teamList();
    box.appendChild(el("h2", "", "Registered teams"));
    if (!teams.length) { box.appendChild(el("p", "empty", "No teams yet.")); return; }

    teams.forEach(function (team) {
      const mine = players.filter(function (p) { return p.team === team; });
      const total = mine.reduce(function (s, p) { return s + rawTotal(p.id); }, 0);

      const card = el("div", "tm-card" + (openTeams[team] ? " open" : ""));
      const head = el("div", "tm-head");
      head.appendChild(badge(team));
      const info = el("div", "tm-info");
      info.appendChild(el("div", "tm-name", team));
      info.appendChild(el("div", "muted", mine.length + " player" + (mine.length === 1 ? "" : "s") + " \u00b7 " + total.toFixed(1) + " pts"));
      head.appendChild(info);
      head.appendChild(el("span", "tm-chev", openTeams[team] ? "\u2303" : "\u2304"));
      head.addEventListener("click", function () { openTeams[team] = !openTeams[team]; renderMatches(); });
      card.appendChild(head);

      if (openTeams[team]) {
        const roster = el("div", "tm-roster");
        mine.slice().sort(function (a, b) { return rawTotal(b.id) - rawTotal(a.id); }).forEach(function (p) {
          const row = el("div", "perf role-" + p.role);
          row.dataset.pid = p.id;
          const main = el("div", "perf-main");
          main.appendChild(el("div", "perf-name", p.name));
          main.appendChild(el("div", "perf-meta", roleText(p) + " \u00b7 price " + p.price.toFixed(1)));
          row.appendChild(main);
          row.appendChild(el("div", "perf-pts", rawTotal(p.id).toFixed(1)));
          roster.appendChild(row);
        });
        card.appendChild(roster);
      }
      box.appendChild(card);
    });
  }

  // ---- Playoffs (double elimination) ---------------------------------------------

  function slotBox(slot) {
    const st = slotState(slot);
    const box = el("div", "bk-slot bk-" + slot + (st.decided ? " done" : ""));
    box.appendChild(el("div", "bk-title", st.name));
    [[st.teamA, st.m && typeof st.m.scoreA === "number" ? st.m.scoreA : null], [st.teamB, st.m && typeof st.m.scoreB === "number" ? st.m.scoreB : null]].forEach(function (t) {
      const row = el("div", "bk-team" + (t[0] && st.winner === t[0] ? " win" : "") + (t[0] && st.loser === t[0] ? " lose" : "") + (t[0] ? "" : " tbd"));
      if (t[0]) { const b = badge(t[0]); b.classList.add("sm"); row.appendChild(b); }
      row.appendChild(el("span", "bk-name", t[0] ? shortTeam(t[0]) : "TBD"));
      row.appendChild(el("span", "bk-score", t[1] === null ? "" : String(t[1])));
      box.appendChild(row);
    });
    return box;
  }

  function playoffView(box) {
    box.appendChild(el("h2", "", "Playoffs"));
    box.appendChild(el("p", "muted", "Double elimination. Lose once and you drop to the lower bracket; lose twice and you are out. The upper bracket winner and the lower bracket winner meet in the Grand Final."));
    const scroll = el("div", "bk-scroll");
    const grid = el("div", "bk");
    BRACKET_ORDER.forEach(function (slot) { grid.appendChild(slotBox(slot)); });
    scroll.appendChild(grid);
    box.appendChild(scroll);
    const gf = slotState("gf");
    if (gf.decided) {
      box.appendChild(el("div", "champ-banner", "\ud83c\udfc6 Champion: " + shortTeam(gf.winner) + " \u00b7 Runner-up: " + shortTeam(gf.loser)));
    }
  }

  function renderMatches() {
    const box = document.getElementById("match-center");
    if (!box || typeof rounds === "undefined") return;
    try {
      box.innerHTML = "";
      const tabs = [["matches", "Matches"], ["standings", FORMAT === "bracket" ? "Bracket" : "Standings"]];
      if (typeof hasBracket === "function" && hasBracket()) tabs.push(["playoffs", "Playoffs"]);
      tabs.push(["teams", "Teams"], ["pickem", "Pick'Em"]);
      if (view === "playoffs" && tabs.every(function (t) { return t[0] !== "playoffs"; })) view = "matches";
      box.appendChild(seg(tabs, view, function (v) {
        view = v;
        renderMatches();
      }));
      if (view === "pickem" && window.PickEm) window.PickEm.render(box);
      else if (view === "playoffs") playoffView(box);
      else if (view === "teams") teamsView(box);
      else if (view === "standings") standingsView(box);
      else matchesView(box);
    } catch (e) {
      console.error("Match center:", e);
    }
  }
  window.renderMatches = renderMatches;

  // script.js calls renderHome() after every redraw; piggy-back on that so we redraw too.
  const previous = window.renderHome;
  window.renderHome = function () {
    if (typeof previous === "function") previous();
    renderMatches();
  };

  window.addEventListener("load", renderMatches);
})();