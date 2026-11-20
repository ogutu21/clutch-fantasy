// The organiser's page: create tournaments, add stages as they happen, enter match stats,
// publish, and recalculate each tournament's leaderboard.
// It edits the same `players` and `rounds` lists the game uses, then saves them to Firestore.
(function () {
  "use strict";

  // The placeholder players from data.js: new tournaments start with a copy, which you then edit.
  const TEMPLATE_PLAYERS = JSON.parse(JSON.stringify(players));

  let tid = null;                 // the tournament being edited
  let meta = { name: "", status: "open" };
  let settings = { budget: 48 };
  let selectedRound = 0;
  let dirty = false;
  let busy = false;
  let priceAtLoad = {};           // each player's price when the tournament was loaded or last published

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function note(text, isError) {
    const n = $("admin-note");
    n.textContent = text || "";
    n.className = isError ? "error" : "";
    const bn = $("admin-bar-note");
    if (bn) {
      bn.textContent = text || "";
      bn.className = "admin-bar-note" + (isError ? " error" : "");
    }
  }

  // The bar at the bottom is always visible: it shows whether there is anything to publish.
  function updateBar() {
    const bar = $("admin-bar");
    if (!bar) return;
    bar.style.display = tid ? "flex" : "none";
    bar.classList.toggle("dirty", dirty);
    $("admin-bar-status").textContent = dirty ? "Unpublished changes" : "All changes published";
  }

  function markDirty() {
    dirty = true;
    updateBar();
    note("Press Publish & update when you're done.");
  }

  function setBusy(on) {
    busy = on;
    ["btn-publish-all", "admin-bar-publish", "btn-publish", "btn-recalc", "btn-delete"].forEach(function (id) {
      const b = $(id);
      if (b) b.disabled = on;
    });
  }

  // Change a team's name everywhere in this tournament: players, matches, winners and the logo.
  function renameTeam(oldName, value) {
    const name = String(value || "").trim();
    if (!name || name === oldName) { renderPlayers(); return; }
    if (teamNames().indexOf(name) !== -1) {
      note("There is already a team called \"" + name + "\".", true);
      renderPlayers();
      return;
    }
    players.forEach(function (p) { if (p.team === oldName) p.team = name; });
    rounds.forEach(function (r) {
      r.matches.forEach(function (m) {
        if (m.teamA === oldName) m.teamA = name;
        if (m.teamB === oldName) m.teamB = name;
        if (m.winner === oldName) m.winner = name;
      });
    });
    if (TEAM_LOGOS[oldName]) { TEAM_LOGOS[name] = TEAM_LOGOS[oldName]; delete TEAM_LOGOS[oldName]; }
    markDirty();
    renderPlayers();
    renderRound();
    note("Renamed \"" + oldName + "\" to \"" + name + "\". Press Publish to save it.");
  }

  function teamNames() {
    const set = [];
    players.forEach(function (p) { if (p.team && !set.includes(p.team)) set.push(p.team); });
    return set;
  }

  function numberInput(value, step, onChange) {
    const i = el("input");
    i.type = "number";
    i.step = step;
    i.value = value;
    i.inputMode = step === "1" ? "numeric" : "decimal";
    if (step === "1") i.min = "0";
    i.addEventListener("focus", function () { i.select(); });
    i.addEventListener("change", function () {
      const v = parseFloat(i.value);
      onChange(isNaN(v) ? 0 : v);
      markDirty();
      if (typeof refreshStatPoints === "function") refreshStatPoints();
    });
    return i;
  }

  // The points shown next to each player depend on the scoring numbers, so redraw them when those change.
  function refreshStatPoints() {
    if (tid && rounds[selectedRound] && $("admin-round").children.length) {
      document.querySelectorAll("#admin-round .spts").forEach(function (n) {
        const row = n.closest(".stat-row");
        if (row && row.dataset.pid) {
          const p = playerById(Number(row.dataset.pid));
          if (p) n.textContent = statPoints(p, rounds[selectedRound]);
        }
      });
    }
  }

  // An optional number on a match (a score or the maps played), left empty until you know it.
  function scoreInput(m, key) {
    const i = el("input", "score-in");
    i.type = "number";
    i.min = "0";
    i.step = "1";
    i.inputMode = "numeric";
    i.value = typeof m[key] === "number" ? m[key] : "";
    i.addEventListener("focus", function () { i.select(); });
    i.addEventListener("change", function () {
      const v = parseInt(i.value, 10);
      if (isNaN(v) || v < 0) { delete m[key]; i.value = ""; } else { m[key] = v; i.value = v; }
      markDirty();
      renderRound();
    });
    return i;
  }

  // ---- Choosing and creating tournaments --------------------------------

  async function refreshList(selectId) {
    const list = await window.Cloud.listTournaments();
    const sel = $("t-select");
    sel.innerHTML = "";
    const first = el("option", "", list.length ? "Choose a tournament..." : "No tournaments yet");
    first.value = "";
    sel.appendChild(first);
    list.forEach(function (t) {
      const o = el("option", "", t.name + (t.status === "ended" ? " (ended)" : ""));
      o.value = t.id;
      if (t.id === selectId) o.selected = true;
      sel.appendChild(o);
    });
  }

  async function selectTournament(id) {
    if (dirty && !confirm("You have unpublished changes that will be lost. Switch anyway?")) {
      $("t-select").value = tid || "";
      return;
    }
    if (!id) { tid = null; $("t-panel").style.display = "none"; updateBar(); return; }
    try {
      const t = await window.Cloud.loadTournament(id);
      if (!t || !applyTournament(t.data)) { note("Couldn't load that tournament.", true); return; }
      tid = id;
      meta = { name: t.name, status: t.status };
      settings = Object.assign({ budget: 48 }, t.data.settings || {});
      selectedRound = 0;
      dirty = false;
      priceAtLoad = {};
      players.forEach(function (p) { priceAtLoad[p.id] = p.price; });
      note("");
      showPanel();
      updateBar();
    } catch (e) {
      note("Couldn't load the tournament: " + (e.message || e), true);
    }
  }

  // New stages are called "Matchweek 3" in a league and "Round 3" in a bracket.
  function stageWord(format) { return format === "bracket" ? "Round" : "Matchweek"; }

  async function createTournament() {
    const name = $("t-new-name").value.trim();
    if (!name) { note("Give the tournament a name.", true); return; }
    const format = $("t-new-format").value === "bracket" ? "bracket" : "league";
    const data = {
      players: JSON.parse(JSON.stringify(TEMPLATE_PLAYERS)),
      rounds: [{ name: stageWord(format) + " 1", type: format === "bracket" ? "knockout" : "group", locked: false, matches: [], stats: {} }],
      settings: { budget: 48, format: format },
    };
    try {
      const id = await window.Cloud.createTournament(name, data);
      $("t-new-name").value = "";
      await refreshList(id);
      await selectTournament(id);
      note("Tournament created with placeholder players. Edit the players, then press Publish.");
    } catch (e) {
      note("Couldn't create the tournament: " + (e.message || e), true);
    }
  }

  function showPanel() {
    $("t-panel").style.display = "block";
    $("t-name").value = meta.name;
    $("t-status").value = meta.status;
    $("t-budget").value = settings.budget;
    $("t-maps").value = settings.standardMaps || 0;
    $("t-format").value = FORMAT;
    renderSettings();
    $("t-link").href = "index.html?t=" + encodeURIComponent(tid);
    renderRoundTabs();
    renderRound();
    renderPlayers();
  }

  // ---- Lineup rules and scoring numbers --------------------------------------

  const SCORING_FIELDS = [
    ["kill", "Kill"], ["sndKillBonus", "S&D kill bonus"], ["assist", "Assist"], ["death", "Death (lost)"],
    ["hillPer30s", "Hill: per 30 s"], ["bomb", "Bomb plant / defuse"], ["mapWin", "Each map won (team)"], ["win", "Team win"], ["mvp", "MVP"],
  ];
  const TEAM_SLOT_FIELDS = [["teamWin", "Team slot: match win"], ["teamMap", "Team slot: per map won"]];

  function renderSettings() {
    const box = $("t-extra");
    box.innerHTML = "";

    box.appendChild(el("h3", "", "Lineup rules (the starting five)"));
    box.appendChild(el("p", "muted", "The fewest and most players of each role a starting five may have. The sub can be any role."));
    const lineup = el("div", "admin-row");
    ROLES.forEach(function (r) {
      lineup.appendChild(el("label", "", ROLE_LABEL[r] + " min"));
      lineup.appendChild(numberInput(LINEUP.min[r], "1", function (v) { LINEUP.min[r] = Math.min(STARTERS, v); }));
      lineup.appendChild(el("label", "", "max"));
      lineup.appendChild(numberInput(LINEUP.max[r], "1", function (v) { LINEUP.max[r] = Math.min(STARTERS, v); }));
    });
    box.appendChild(lineup);
    const check = ROLES.reduce(function (n, r) { return n + LINEUP.max[r]; }, 0);
    const mins = ROLES.reduce(function (n, r) { return n + LINEUP.min[r]; }, 0);
    if (check < STARTERS || mins > STARTERS) {
      box.appendChild(el("p", "error", "These rules can't make a starting five of " + STARTERS + ". Raise a max or lower a min."));
    }

    box.appendChild(el("h3", "", "Points"));
    box.appendChild(el("p", "muted", "Kills made in Search & Destroy earn the normal kill points plus the S&D bonus. Time on the hill is typed in seconds."));
    const sc = el("div", "admin-row");
    SCORING_FIELDS.forEach(function (f) {
      sc.appendChild(el("label", "", f[1]));
      const i = numberInput(SCORING[f[0]], "0.5", function (v) { SCORING[f[0]] = v; });
      i.removeAttribute("min");
      sc.appendChild(i);
    });
    box.appendChild(sc);

    box.appendChild(el("h3", "", "Team slot (optional)"));
    box.appendChild(el("p", "muted", "Players also back one whole team each stage and earn points when it wins. Off by default."));
    const ts = el("div", "admin-row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = TEAM_SLOT;
    cb.addEventListener("change", function () { TEAM_SLOT = cb.checked; markDirty(); });
    const cbl = el("label", "", "Use the Team slot");
    cbl.appendChild(cb);
    ts.appendChild(cbl);
    TEAM_SLOT_FIELDS.forEach(function (f) {
      ts.appendChild(el("label", "", f[1]));
      const i = numberInput(SCORING[f[0]], "0.5", function (v) { SCORING[f[0]] = v; });
      i.removeAttribute("min");
      ts.appendChild(i);
    });
    box.appendChild(ts);
    const reset = el("button", "outline", "Reset points to the defaults");
    reset.type = "button";
    reset.addEventListener("click", function () {
      SCORING = Object.assign({}, DEFAULT_SCORING);
      markDirty();
      renderSettings();
      renderRound();
    });
    box.appendChild(reset);
  }

  // ---- Players ----------------------------------------------------------

  function nextPlayerId() {
    let max = 0;
    players.forEach(function (p) { max = Math.max(max, p.id); });
    rounds.forEach(function (r) { Object.keys(r.stats).forEach(function (k) { max = Math.max(max, Number(k) || 0); }); });
    return max + 1;
  }

  // ---- Price changes after a stage ------------------------------------------

  const PRICE_MIN = 3, PRICE_MAX = 15;

  // The best fifth of the players who played go up 1.0, the next fifth 0.5, the middle fifth stay,
  // then down 0.5, and the bottom fifth down 1.0. Prices stay between 3.0 and 15.0.
  function priceProposals(r) {
    const round = rounds[r];
    const played = players.filter(function (p) { return round.stats[p.id]; }).map(function (p) {
      return { p: p, pts: rawPoints(p.id, r) };
    }).sort(function (a, b) { return b.pts - a.pts; });
    if (played.length < 5) return null;
    return played.map(function (x, i) {
      const q = i / played.length;
      const d = q < 0.2 ? 1 : q < 0.4 ? 0.5 : q < 0.6 ? 0 : q < 0.8 ? -0.5 : -1;
      const to = Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round((x.p.price + d) * 2) / 2));
      return { p: x.p, pts: x.pts, from: x.p.price, to: to };
    });
  }

  function openPriceUpdate() {
    const round = rounds[selectedRound];
    const plan = priceProposals(selectedRound);
    let dlg = $("price-dialog");
    if (!dlg) {
      dlg = el("dialog");
      dlg.id = "price-dialog";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = "";
    dlg.appendChild(el("h3", "", "Update prices"));
    const close = function () { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); };

    if (!plan) {
      dlg.appendChild(el("p", "muted", "Enter results for at least 5 players in " + round.name + " first. Prices are worked out from how each player scored in the stage that is open."));
      const actions = el("div", "dialog-actions");
      const ok = el("button", "", "OK");
      ok.type = "button";
      ok.addEventListener("click", close);
      actions.appendChild(ok);
      dlg.appendChild(actions);
    } else {
      dlg.appendChild(el("p", "muted", "Based on how each player scored in " + round.name + ": the best fifth go up 1.0, the next fifth up 0.5, the middle fifth stay, then down 0.5, and the bottom fifth down 1.0 (between " + PRICE_MIN.toFixed(1) + " and " + PRICE_MAX.toFixed(1) + "). Players who didn't play stay the same."));
      const wrap = el("div", "table-wrap");
      const table = el("table", "pstats");
      const hr = el("tr");
      ["Player", "Pts", "Price"].forEach(function (h) { hr.appendChild(el("th", "", h)); });
      table.appendChild(hr);
      let changes = 0;
      plan.forEach(function (x) {
        const tr = el("tr");
        tr.appendChild(el("td", "", x.p.name));
        tr.appendChild(el("td", "", x.pts.toFixed(1)));
        const change = x.to - x.from;
        if (change) changes++;
        tr.appendChild(el("td", change > 0 ? "pc-up" : change < 0 ? "pc-down" : "", x.from.toFixed(1) + " \u2192 " + x.to.toFixed(1)));
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      dlg.appendChild(wrap);
      dlg.appendChild(el("p", "muted", "Players already in a squad count at their new price. Apply this between stages, after the stage locks, so nobody is caught out mid-stage."));
      const actions = el("div", "dialog-actions");
      const apply = el("button", "", "Apply " + changes + " change" + (changes === 1 ? "" : "s"));
      apply.type = "button";
      apply.disabled = changes === 0;
      apply.addEventListener("click", function () {
        plan.forEach(function (x) { x.p.price = x.to; });
        markDirty();
        renderPlayers();
        close();
      });
      const cancel = el("button", "outline", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", close);
      actions.appendChild(apply);
      actions.appendChild(cancel);
      dlg.appendChild(actions);
    }
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  }

  function renderPlayers() {
    const box = $("admin-players");
    box.innerHTML = "";

    const priceTools = el("div", "admin-actions");
    const upd = el("button", "", "Update prices from the open stage");
    upd.addEventListener("click", openPriceUpdate);
    priceTools.appendChild(upd);
    box.appendChild(priceTools);

    const list = el("datalist");
    list.id = "team-list";
    teamNames().forEach(function (t) { const o = el("option"); o.value = t; list.appendChild(o); });
    box.appendChild(list);

    const table = el("table", "admin");
    const head = el("tr");
    ["ID", "Look", "Name", "Team", "Role", "Price", ""].forEach(function (h) { head.appendChild(el("th", "", h)); });
    table.appendChild(head);

    players.forEach(function (p, idx) {
      const tr = el("tr");
      tr.appendChild(el("td", "", String(p.id)));

      const lookTd = el("td");
      const lookBtn = el("button", "av-btn");
      lookBtn.type = "button";
      lookBtn.title = "Choose a picture";
      lookBtn.appendChild(playerAvatarEl(p, 34));
      lookBtn.addEventListener("click", function () {
        Avatars.pick("Picture for " + p.name, p.avatar || "", function (look) {
          if (look) p.avatar = look; else delete p.avatar;
          markDirty();
          renderPlayers();
        });
      });
      lookTd.appendChild(lookBtn);
      tr.appendChild(lookTd);

      const name = el("input");
      name.value = p.name;
      name.addEventListener("change", function () {
        if (!name.value.trim()) { name.value = p.name; return; }
        p.name = name.value.trim();
        markDirty();
        renderRound();
      });
      const nameTd = el("td"); nameTd.appendChild(name); tr.appendChild(nameTd);

      const team = el("input");
      team.value = p.team;
      team.setAttribute("list", "team-list");
      team.addEventListener("change", function () {
        if (!team.value.trim()) { team.value = p.team; return; }
        p.team = team.value.trim();
        markDirty();
        renderRound();
      });
      const teamTd = el("td"); teamTd.appendChild(team); tr.appendChild(teamTd);

      const role = el("select");
      ROLES.forEach(function (r) {
        const o = el("option", "", ROLE_LABEL[r]);
        o.value = r;
        if (p.role === r) o.selected = true;
        role.appendChild(o);
      });
      role.addEventListener("change", function () { p.role = role.value; if (p.role2 === p.role) delete p.role2; markDirty(); renderPlayers(); });
      const role2 = el("select");
      role2.title = "Second role (optional)";
      const none2 = el("option", "", "+ 2nd role: none");
      none2.value = "";
      role2.appendChild(none2);
      ROLES.forEach(function (r) {
        const o = el("option", "", "+ " + ROLE_LABEL[r]);
        o.value = r;
        if (p.role2 === r) o.selected = true;
        role2.appendChild(o);
      });
      role2.addEventListener("change", function () {
        if (role2.value && role2.value !== p.role) p.role2 = role2.value; else { delete p.role2; role2.value = ""; }
        markDirty();
      });
      const roleTd = el("td"); roleTd.appendChild(role); roleTd.appendChild(role2); tr.appendChild(roleTd);

      const priceTd = el("td");
      priceTd.appendChild(numberInput(p.price, "0.5", function (v) { p.price = v; }));
      tr.appendChild(priceTd);

      const rmTd = el("td");
      const rm = el("button", "", "Remove");
      rm.addEventListener("click", function () {
        if (!confirm("Remove " + p.name + "? Anyone who picked them loses them from their squad, and their stats are deleted.")) return;
        rounds.forEach(function (r) { delete r.stats[p.id]; });
        players.splice(idx, 1);
        markDirty();
        renderPlayers();
        renderRound();
      });
      rmTd.appendChild(rm);
      tr.appendChild(rmTd);

      table.appendChild(tr);
    });
    box.appendChild(table);

    box.appendChild(el("h3", "", "Teams"));
    box.appendChild(el("p", "muted", "Rename a team or pick its logo (a character, or the team's own logo). Renaming updates its players, matches and logo here. Do it before players start picking: squads that already chose the old name as their Team slot lose that pick, and Pick'Em predictions for it stop matching."));
    teamNames().forEach(function (t) {
      const row = el("div", "admin-row team-row");
      const b = el("button", "av-btn logo-btn");
      b.type = "button";
      b.title = "Choose a logo for " + t;
      b.appendChild(teamLogoEl(t, 40));
      b.addEventListener("click", function () {
        Avatars.pick("Logo for " + t, TEAM_LOGOS[t] || "", function (look) {
          if (look) TEAM_LOGOS[t] = look; else delete TEAM_LOGOS[t];
          markDirty();
          renderPlayers();
        });
      });
      row.appendChild(b);
      const nameIn = el("input");
      nameIn.value = t;
      nameIn.maxLength = 40;
      nameIn.setAttribute("aria-label", "Name of team " + t);
      nameIn.addEventListener("change", function () { renameTeam(t, nameIn.value); });
      row.appendChild(nameIn);
      const n = players.filter(function (p) { return p.team === t; }).length;
      row.appendChild(el("span", "muted", n + " player" + (n === 1 ? "" : "s")));
      box.appendChild(row);
    });

    const add = el("button", "", "Add player");
    add.addEventListener("click", function () {
      players.push({ id: nextPlayerId(), name: "New player", team: teamNames()[0] || "Team", role: "smg", price: 7.0 });
      markDirty();
      renderPlayers();
      renderRound();
    });
    box.appendChild(add);
  }

  // ---- Stages, matches and stats ----------------------------------------

  // ---- Squads not ready ------------------------------------------------------

  function fillReadinessStages() {
    const sel = $("rd-stage");
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = "";
    rounds.forEach(function (r, i) {
      const o = el("option", "", r.name + (isLocked(i) ? " (locked)" : ""));
      o.value = String(i);
      sel.appendChild(o);
    });
    let pick = rounds.findIndex(function (_, i) { return !isLocked(i); });
    if (keep !== "" && keep !== undefined && rounds[Number(keep)]) pick = Number(keep);
    sel.value = String(pick < 0 ? 0 : pick);
  }

  async function checkReadiness() {
    const out = $("rd-out"), noteEl = $("rd-note");
    out.innerHTML = "";
    $("rd-copy").style.display = "none";
    const r = Number($("rd-stage").value);
    noteEl.textContent = "Loading...";
    try {
      const all = await window.Cloud.allSquads(tid);
      let names = {};
      try { names = (await window.Cloud.loadProfiles(all.map(function (s) { return s.uid; }))) || {}; } catch (e) { /* usernames are optional */ }
      const notReady = [];
      let ready = 0;
      all.forEach(function (s) {
        let saved = null;
        try { saved = JSON.parse(s.json); } catch (e) { /* counted as not ready below */ }
        const sq = saved && saved[r] ? saved[r] : null;
        const issues = sq ? squadIssues(sq) : ["no squad picked"];
        const nm = (names[s.uid] && names[s.uid].username) || s.name || s.uid;
        if (issues.length) notReady.push({ name: nm, issues: issues }); else ready++;
      });
      noteEl.textContent = ready + " of " + all.length + " saved squads are ready for " + rounds[r].name + ".";
      if (!notReady.length) { out.appendChild(el("p", "muted", "Everyone who has saved a squad is ready.")); return; }
      const table = el("table", "admin");
      const head = el("tr");
      ["Player", "What is missing"].forEach(function (h) { head.appendChild(el("th", "", h)); });
      table.appendChild(head);
      notReady.forEach(function (x) {
        const tr = el("tr");
        tr.appendChild(el("td", "", x.name));
        tr.appendChild(el("td", "", x.issues.join(" \u00b7 ")));
        table.appendChild(tr);
      });
      out.appendChild(table);
      const copy = $("rd-copy");
      copy.style.display = "";
      copy.onclick = function () {
        const text = notReady.map(function (x) { return x.name; }).join(", ");
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { noteEl.textContent = "Copied " + notReady.length + " names."; });
        else window.prompt("Copy these names:", text);
      };
    } catch (e) {
      noteEl.textContent = "Couldn't load squads: " + (e.message || e);
    }
  }

  function renderRoundTabs() {
    fillReadinessStages();
    const box = $("admin-rounds");
    box.innerHTML = "";
    rounds.forEach(function (r, i) {
      const b = el("button", "", r.name + (r.type && STAGE_TYPES[r.type] ? " (" + STAGE_TYPES[r.type] + ")" : "") + (Object.keys(r.stats).length ? " \u2713" : ""));
      b.title = Object.keys(r.stats).length ? "Results entered" : "No results yet";
      if (i === selectedRound) b.classList.add("active");
      b.addEventListener("click", function () { selectedRound = i; renderRoundTabs(); renderRound(); });
      box.appendChild(b);
    });
    const add = el("button", "", "+ Add stage");
    add.addEventListener("click", function () {
      rounds.push({ name: stageWord(FORMAT) + " " + (rounds.length + 1), type: FORMAT === "bracket" ? "knockout" : "group", locked: false, matches: [], stats: {} });
      selectedRound = rounds.length - 1;
      markDirty();
      renderRoundTabs();
      renderRound();
    });
    box.appendChild(add);
  }

  // "2026-11-08T18:00:00+03:00" <-> the value a datetime-local box wants
  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderRound() {
    const round = rounds[selectedRound];
    const box = $("admin-round");
    box.innerHTML = "";

    // Name, deadline, manual lock, remove
    const top = el("div", "admin-row");
    top.appendChild(el("label", "", "Stage name"));
    const stageName = el("input");
    stageName.value = round.name;
    stageName.maxLength = 30;
    stageName.addEventListener("change", function () {
      if (!stageName.value.trim()) { stageName.value = round.name; return; }
      round.name = stageName.value.trim();
      markDirty();
      renderRoundTabs();
    });
    top.appendChild(stageName);

    top.appendChild(el("label", "", "Deadline (your time)"));
    const when = el("input");
    when.type = "datetime-local";
    when.value = toLocalInput(round.lockAt);
    when.addEventListener("change", function () {
      round.lockAt = when.value ? new Date(when.value).toISOString() : undefined;
      markDirty();
    });
    top.appendChild(when);

    const lockLabel = el("label", "check");
    const lock = el("input");
    lock.type = "checkbox";
    lock.checked = !!round.locked;
    lock.addEventListener("change", function () { round.locked = lock.checked; markDirty(); });
    lockLabel.appendChild(lock);
    lockLabel.appendChild(document.createTextNode(" Lock now"));
    top.appendChild(lockLabel);
    box.appendChild(top);

    const opts = el("div", "admin-row");
    opts.appendChild(el("label", "", "Stage type"));
    const typeSel = el("select");
    const none = el("option", "", "(not set)");
    none.value = "";
    typeSel.appendChild(none);
    Object.keys(STAGE_TYPES).forEach(function (k) {
      const o = el("option", "", STAGE_TYPES[k]);
      o.value = k;
      typeSel.appendChild(o);
    });
    typeSel.value = round.type || "";
    typeSel.addEventListener("change", function () {
      if (typeSel.value) round.type = typeSel.value; else delete round.type;
      markDirty();
      renderRoundTabs();
    });
    opts.appendChild(typeSel);

    opts.appendChild(el("label", "", "Free transfers"));
    const ft = el("input");
    ft.type = "number"; ft.min = "0"; ft.step = "1"; ft.inputMode = "numeric";
    ft.placeholder = String(FREE_TRANSFERS);
    ft.value = typeof round.freeTransfers === "number" ? round.freeTransfers : "";
    ft.title = "Leave empty for the usual " + FREE_TRANSFERS;
    ft.addEventListener("change", function () {
      const v = parseInt(ft.value, 10);
      if (isNaN(v) || v < 0) { delete round.freeTransfers; ft.value = ""; } else round.freeTransfers = v;
      markDirty();
    });
    opts.appendChild(ft);

    opts.appendChild(el("label", "", "Budget bonus"));
    const bb = el("input");
    bb.type = "number"; bb.min = "0"; bb.step = "0.5"; bb.inputMode = "decimal";
    bb.placeholder = "0";
    bb.value = typeof round.budgetBonus === "number" ? round.budgetBonus : "";
    bb.title = "Extra money added to every squad when it moves on to this stage";
    bb.addEventListener("change", function () {
      const v = parseFloat(bb.value);
      if (isNaN(v) || v <= 0) { delete round.budgetBonus; bb.value = ""; } else round.budgetBonus = v;
      markDirty();
    });
    opts.appendChild(bb);
    box.appendChild(opts);

    if (selectedRound === rounds.length - 1 && rounds.length > 1) {
      const rmStage = el("button", "", "Remove this stage");
      rmStage.addEventListener("click", function () {
        if (!confirm("Remove " + round.name + " and all its stats? Players' squads for it are dropped.")) return;
        rounds.pop();
        selectedRound = rounds.length - 1;
        markDirty();
        renderRoundTabs();
        renderRound();      });
      box.appendChild(rmStage);
    }

    // Matches
    box.appendChild(el("h3", "", "Matches"));
    const teams = teamNames();
    round.matches.forEach(function (m, idx) {
      const row = el("div", "admin-row");
      const pick = function (current, onPick) {
        const s = el("select");
        teams.forEach(function (t) {
          const o = el("option", "", t);
          o.value = t;
          if (t === current) o.selected = true;
          s.appendChild(o);
        });
        s.addEventListener("change", function () { onPick(s.value); markDirty(); renderRound(); });
        return s;
      };
      row.appendChild(pick(m.teamA, function (v) { m.teamA = v; }));
      row.appendChild(el("span", "muted", "vs"));
      row.appendChild(pick(m.teamB, function (v) { m.teamB = v; }));
      row.appendChild(el("span", "muted", "winner"));
      const w = el("select");
      [m.teamA, m.teamB].forEach(function (t) {
        const o = el("option", "", t);
        o.value = t;
        if (t === m.winner) o.selected = true;
        w.appendChild(o);
      });
      if (m.winner !== m.teamA && m.winner !== m.teamB) { m.winner = m.teamA; }
      w.value = m.winner;
      w.addEventListener("change", function () { m.winner = w.value; markDirty(); renderRound(); });
      row.appendChild(w);
      row.appendChild(el("span", "muted", "score"));
      row.appendChild(scoreInput(m, "scoreA"));
      row.appendChild(el("span", "muted", ":"));
      row.appendChild(scoreInput(m, "scoreB"));
      row.appendChild(el("span", "muted", "maps"));
      const mapsBox = scoreInput(m, "maps");
      mapsBox.title = "How many maps were played. Leave empty to use the two scores added up.";
      row.appendChild(mapsBox);
      const rm = el("button", "", "Remove");
      rm.addEventListener("click", function () { round.matches.splice(idx, 1); markDirty(); renderRound(); });
      row.appendChild(rm);
      box.appendChild(row);
      box.appendChild(gamesRow(m));
    });
    const addMatch = el("button", "", "Add match");
    addMatch.addEventListener("click", function () {
      const a = teams[0], b = teams[1] || teams[0];
      round.matches.push({ id: newMatchId(), teamA: a, teamB: b, winner: a });
      markDirty();
      renderRound();
    });
    box.appendChild(addMatch);

    renderStatsEntry(box, round);
  }

  // The maps of one match and the mode of each (so scoring can tell Search & Destroy from Hardpoint).
  // Map pools from the 2026 ruleset (a tournament can still type another map name).
  const MAP_POOL = {
    hp: ["Summit", "Hacienda", "Combine", "Takeoff", "Arsenal"],
    snd: ["Tunisia", "Firing Range", "Coastal", "Slums", "Meltdown"],
    ctl: ["Raid", "Standoff", "Crossroads Strike"],
    other: [],
  };
  const MODES = { hp: "Hardpoint", snd: "Search & Destroy", ctl: "Control", other: "Other" };

  function gamesRow(m) {
    const row = el("div", "admin-row games-row");
    row.appendChild(el("span", "muted", "Maps played:"));
    (m.games || []).forEach(function (g, i) {
      const sel = el("select");
      Object.keys(MODES).forEach(function (k) {
        const o = el("option", "", (i + 1) + ". " + MODES[k]);
        o.value = k;
        sel.appendChild(o);
      });
      sel.value = g.mode || "other";
      sel.addEventListener("change", function () { g.mode = sel.value; markDirty(); });
      row.appendChild(sel);
      const mapSel = el("select");
      mapSel.title = "Map";
      function fillMaps() {
        mapSel.innerHTML = "";
        const none = el("option", "", "map?");
        none.value = "";
        mapSel.appendChild(none);
        (MAP_POOL[g.mode] || []).forEach(function (n) { const o = el("option", "", n); o.value = n; mapSel.appendChild(o); });
        mapSel.value = g.map && (MAP_POOL[g.mode] || []).indexOf(g.map) !== -1 ? g.map : "";
      }
      fillMaps();
      sel.addEventListener("change", function () { delete g.map; fillMaps(); });
      mapSel.addEventListener("change", function () { if (mapSel.value) g.map = mapSel.value; else delete g.map; markDirty(); });
      row.appendChild(mapSel);
      const lim = SCORE_LIMITS[g.mode];
      const sa = el("input", "score-in"), sb = el("input", "score-in");
      [[sa, "scoreA", m.teamA], [sb, "scoreB", m.teamB]].forEach(function (x) {
        const i = x[0];
        i.type = "number"; i.min = "0"; i.step = "1"; i.inputMode = "numeric";
        i.title = "Score of " + x[2] + " on this map" + (lim ? " (max " + lim.max + ")" : "");
        i.value = typeof g[x[1]] === "number" ? g[x[1]] : "";
        i.addEventListener("focus", function () { i.select(); });
        i.addEventListener("change", function () {
          const v = parseInt(i.value, 10);
          if (isNaN(v) || v < 0) delete g[x[1]]; else g[x[1]] = v;
          // When every map has a score, the series score follows from them.
          const s = seriesFromGames(m);
          if (s) { m.scoreA = s.a; m.scoreB = s.b; }
          markDirty();
          renderRound();
        });
      });
      row.appendChild(sa);
      row.appendChild(el("span", "muted", ":"));
      row.appendChild(sb);
      const problem = gameScoreProblem(g);
      if (problem) row.appendChild(el("span", "error", " " + problem));
      const x = el("button", "", "\u00d7");
      x.type = "button";
      x.title = "Remove this map";
      x.addEventListener("click", function () {
        m.games.splice(i, 1);
        if (!m.games.length) delete m.games;
        markDirty();
        renderRound();
      });
      row.appendChild(x);
    });
    const add = el("button", "", "+ Map");
    add.type = "button";
    add.addEventListener("click", function () {
      if (!Array.isArray(m.games)) m.games = [];
      // The 2026 ruleset's map order for a best-of-5: Hardpoint, Search & Destroy, Control, Hardpoint, Search & Destroy.
      const ORDER = ["hp", "snd", "ctl", "hp", "snd"];
      m.games.push({ mode: ORDER[m.games.length % ORDER.length] });
      markDirty();
      renderRound();
    });
    row.appendChild(add);
    if (m.games && m.games.length) row.appendChild(el("span", "muted", "The number of maps comes from this list. Type each map's score: once all maps have one, the series score is filled in for you."));
    return row;
  }

  // ---- Entering player stats, team by team --------------------------------

  function statPoints(p, round) {
    const s = round.stats[p.id];
    return s ? calcPoints(s, teamWonInRound(p.team, round), seriesScale(p.team, round), mapsWonBy(p.team, round)).toFixed(1) : "-";
  }

  function statNum(label, value, onChange, afterChange) {
    const wrap = el("label", "num");
    wrap.appendChild(el("span", "", label));
    wrap.appendChild(numberInput(value, "1", function (v) { onChange(v); afterChange(); }));
    return wrap;
  }

  function playerStatRow(p, round) {
    const s = round.stats[p.id];
    const row = el("div", "stat-row" + (s ? " on" : ""));
    row.dataset.pid = p.id;

    const who = el("label", "who");
    const played = el("input");
    played.type = "checkbox";
    played.checked = !!s;
    played.addEventListener("change", function () {
      if (played.checked) round.stats[p.id] = { kills: 0, deaths: 0, assists: 0, mvp: false };
      else delete round.stats[p.id];
      markDirty();
      renderRound();
      renderRoundTabs();
    });
    who.appendChild(played);
    who.appendChild(el("span", "sname", p.name));
    who.appendChild(el("span", "role-tag role-" + p.role, ROLE_LABEL[p.role] || p.role));
    row.appendChild(who);

    if (s) {
      const pts = el("div", "spts", statPoints(p, round));
      const refresh = function () { pts.textContent = statPoints(p, round); };
      const nums = el("div", "nums");
      nums.appendChild(statNum("K", s.kills, function (v) { s.kills = v; }, refresh));
      nums.appendChild(statNum("D", s.deaths, function (v) { s.deaths = v; }, refresh));
      nums.appendChild(statNum("A", s.assists, function (v) { s.assists = v; }, refresh));
      nums.appendChild(statNum("S&D K", s.sndKills || 0, function (v) { s.sndKills = v; if (!v) delete s.sndKills; }, refresh));
      nums.appendChild(statNum("Hill s", s.hillTime || 0, function (v) { s.hillTime = v; if (!v) delete s.hillTime; }, refresh));
      nums.appendChild(statNum("Plants", s.plants || 0, function (v) { s.plants = v; if (!v) delete s.plants; }, refresh));
      nums.appendChild(statNum("Defuses", s.defuses || 0, function (v) { s.defuses = v; if (!v) delete s.defuses; }, refresh));

      const mvpLabel = el("label", "num mvp");
      mvpLabel.appendChild(el("span", "", "MVP"));
      const mvp = el("input");
      mvp.type = "checkbox";
      mvp.checked = !!s.mvp;
      mvp.addEventListener("change", function () { s.mvp = mvp.checked; markDirty(); refresh(); });
      mvpLabel.appendChild(mvp);
      nums.appendChild(mvpLabel);

      row.appendChild(nums);
      row.appendChild(pts);
    }
    return row;
  }

  function teamBlock(round, team, match) {
    const block = el("div", "stat-team");
    const head = el("div", "stat-team-head");
    const title = el("div");
    title.appendChild(el("b", "", team));
    if (match) {
      const opp = match.teamA === team ? match.teamB : match.teamA;
      title.appendChild(el("span", "muted", " vs " + opp + " \u00b7 " + (match.winner === team ? "won" : "lost")));
    } else {
      title.appendChild(el("span", "muted", " \u00b7 no match this stage"));
    }
    head.appendChild(title);

    const btns = el("div", "stat-team-btns");
    const all = el("button", "", "All played");
    all.addEventListener("click", function () {
      players.forEach(function (p) {
        if (p.team === team && !round.stats[p.id]) round.stats[p.id] = { kills: 0, deaths: 0, assists: 0, mvp: false };
      });
      markDirty();
      renderRound();
      renderRoundTabs();
    });
    const none = el("button", "", "Clear");
    none.addEventListener("click", function () {
      players.forEach(function (p) { if (p.team === team) delete round.stats[p.id]; });
      markDirty();
      renderRound();
      renderRoundTabs();
    });
    btns.appendChild(all);
    btns.appendChild(none);
    head.appendChild(btns);
    block.appendChild(head);

    players.filter(function (p) { return p.team === team; }).forEach(function (p) {
      block.appendChild(playerStatRow(p, round));
    });
    return block;
  }

  function renderStatsEntry(box, round) {
    box.appendChild(el("h3", "", "Player stats"));
    const imp = el("button", "import-btn", "Import from screenshot");
    imp.addEventListener("click", function () { if (window.openScreenshotImport) window.openScreenshotImport(); });
    box.appendChild(imp);
    box.appendChild(el("p", "muted", "Tick the players who played, then fill in K (kills), D (deaths), A (assists). S&D K is how many of the kills came in Search &amp; Destroy, Hill s is seconds on the hill, and Plants and Defuses are bombs planted or defused in Search &amp; Destroy. Enter the match score (maps won) above so teams get their map-win points. The points on the right update as you type. Players who didn't play score 0."));

    const inMatch = [];
    round.matches.forEach(function (m) {
      [m.teamA, m.teamB].forEach(function (t) { if (!inMatch.includes(t)) inMatch.push(t); });
    });
    const others = teamNames().filter(function (t) { return !inMatch.includes(t); });
    inMatch.concat(others).forEach(function (team) {
      const match = round.matches.find(function (m) { return m.teamA === team || m.teamB === team; }) || null;
      box.appendChild(teamBlock(round, team, match));
    });
  }

  // ---- Publish and recalculate -------------------------------------------

  // Things worth a second look before publishing. These are warnings, not blockers.
  function checkResults() {
    const out = [];
    rounds.forEach(function (r) {
      if (!Object.keys(r.stats).length) return;   // a stage with no results yet is just upcoming
      r.matches.forEach(function (m) {
        if (m.teamA === m.teamB) out.push(r.name + ": " + m.teamA + " is set to play itself.");
        let mvps = 0;
        [m.teamA, m.teamB].forEach(function (t) {
          const mine = players.filter(function (p) { return p.team === t; });
          const played = mine.filter(function (p) { return r.stats[p.id]; });
          if (!played.length) out.push(r.name + ": no players marked as played for " + t + ".");
          const teamMvps = played.filter(function (p) { return r.stats[p.id].mvp; }).length;
          mvps += teamMvps;
          if (teamMvps > 1) out.push(r.name + ": " + teamMvps + " MVPs picked for " + t + " (usually one per team).");
        });
        (m.games || []).forEach(function (g, gi) {
          const prob = gameScoreProblem(g);
          if (prob) out.push(r.name + ": map " + (gi + 1) + " of " + m.teamA + " vs " + m.teamB + ": " + prob + ".");
        });
        const fromMaps = seriesFromGames(m);
        if (fromMaps && typeof m.scoreA === "number" && typeof m.scoreB === "number" && (fromMaps.a !== m.scoreA || fromMaps.b !== m.scoreB)) {
          out.push(r.name + ": " + m.teamA + " vs " + m.teamB + " series score " + m.scoreA + ":" + m.scoreB + " doesn't match the map scores (" + fromMaps.a + ":" + fromMaps.b + ").");
        }
        if (mvps === 0) out.push(r.name + ": no MVP picked in " + m.teamA + " vs " + m.teamB + ".");
      });
      players.forEach(function (p) {
        const s = r.stats[p.id];
        if (s && (s.sndKills || 0) > s.kills) out.push(r.name + ": " + p.name + " has more S&D kills than kills.");
      });
      const playing = [];
      r.matches.forEach(function (m) { playing.push(m.teamA, m.teamB); });
      players.forEach(function (p) {
        if (r.stats[p.id] && !playing.includes(p.team)) out.push(r.name + ": " + p.name + " has stats but " + p.team + " has no match.");
      });
    });
    return out;
  }

  // ---- Checking squads before they reach the leaderboard ------------------------

  // Squads are stored in each player's account, so a determined player could change one outside the game.
  // These are the rules the game enforces in the browser; anything that breaks them is worth a look.
  function squadProblems(saved) {
    const out = [];
    if (!Array.isArray(saved)) return ["unreadable squad"];
    const chipStage = {};
    saved.forEach(function (sq, r) {
      if (!sq || !Array.isArray(sq.players)) { out.push("unreadable squad data"); return; }
      const stage = rounds[r] ? rounds[r].name : "Stage " + (r + 1);
      const ids = sq.players;
      if (new Set(ids).size !== ids.length) out.push(stage + ": the same player twice");
      if (ids.length > SQUAD_SIZE) out.push(stage + ": " + ids.length + " players (max " + SQUAD_SIZE + ")");

      const perTeam = {};
      ids.forEach(function (id) {
        const p = playerById(id);
        if (p) perTeam[p.team] = (perTeam[p.team] || 0) + 1;
      });
      Object.keys(perTeam).forEach(function (t) {
        if (perTeam[t] > MAX_PER_TEAM) out.push(stage + ": " + perTeam[t] + " players from " + t + " (max " + MAX_PER_TEAM + ")");
      });

      const hasSub = sq.sub !== null && sq.sub !== undefined && ids.includes(sq.sub);
      if (ids.length === SQUAD_SIZE) {
        if (!hasSub) out.push(stage + ": no sub chosen (a full squad would score all six players)");
        else if (!isValidStarting(ids.filter(function (id) { return id !== sq.sub; }))) out.push(stage + ": the starting five isn't a valid formation");
      }
      [["captain", sq.captain], ["vice-captain", sq.vice]].forEach(function (c) {
        if (c[1] !== null && c[1] !== undefined && !ids.includes(c[1])) out.push(stage + ": the " + c[0] + " isn't in the squad");
      });
      if (hasSub && (sq.sub === sq.captain || sq.sub === sq.vice)) out.push(stage + ": the sub is also captain or vice-captain");

      if (typeof sq.bank === "number") {
        if (sq.bank < -0.05) out.push(stage + ": over budget by " + Math.abs(sq.bank).toFixed(1));
        if (sq.bank > STARTING_BUDGET + rounds.reduce(function (n, x, i) { return n + budgetBonusIn(i); }, 0) + 10) out.push(stage + ": money left looks too high");
      }

      if (sq.chip) {
        const chip = CHIPS.find(function (c) { return c.id === sq.chip; });
        if (!chip) {
          out.push(stage + ": unknown chip");
        } else {
          if ((sq.chip === "wildcard" || sq.chip === "freehit") && r === 0) out.push(stage + ": " + chip.name + " can't be played in the first stage");
          if (chipStage[sq.chip] !== undefined) out.push(chip.name + " used in two stages");
          else chipStage[sq.chip] = r;
          if (sq.chip === "twelfth" && typeof sq.extra === "number" && ids.includes(sq.extra)) out.push(stage + ": the 12th man is already in the squad");
        }
      }
    });
    return out;
  }

  // A small box that lists the flagged squads and lets the organiser decide. Resolves to "leave", "include" or "cancel".
  function askFlagged(flagged) {
    return new Promise(function (resolve) {
      let dlg = $("check-dialog");
      if (!dlg) {
        dlg = el("dialog");
        dlg.id = "check-dialog";
        document.body.appendChild(dlg);
      }
      dlg.innerHTML = "";
      let answered = false;
      const done = function (v) {
        if (answered) return;
        answered = true;
        if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
        resolve(v);
      };
      dlg.appendChild(el("h3", "", "Check these squads"));
      dlg.appendChild(el("p", "muted", flagged.length + " squad" + (flagged.length === 1 ? " breaks" : "s break") + " the game rules. It may be an honest slip, or an edit made outside the game. You can leave them off this leaderboard, or include them anyway."));
      const list = el("div", "check-list");
      flagged.slice(0, 12).forEach(function (f) {
        const item = el("div", "check-item");
        item.appendChild(el("b", "", f.name));
        item.appendChild(el("div", "muted", f.problems.slice(0, 4).join("; ") + (f.problems.length > 4 ? "; and " + (f.problems.length - 4) + " more" : "")));
        list.appendChild(item);
      });
      if (flagged.length > 12) list.appendChild(el("p", "muted", "...and " + (flagged.length - 12) + " more."));
      dlg.appendChild(list);
      const actions = el("div", "dialog-actions");
      [["Leave them out", "leave", ""], ["Include anyway", "include", "outline"], ["Cancel", "cancel", "outline"]].forEach(function (b) {
        const btn = el("button", b[2], b[0]);
        btn.type = "button";
        btn.addEventListener("click", function () { done(b[1]); });
        actions.appendChild(btn);
      });
      dlg.appendChild(actions);
      dlg.addEventListener("cancel", function () { done("cancel"); }, { once: true });
      if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
    });
  }

  // Save the tournament. Returns true when it worked.
  async function publish(quiet) {
    const name = $("t-name").value.trim();
    if (!name) { note("The tournament needs a name.", true); return false; }
    const budget = parseFloat($("t-budget").value);
    if (isNaN(budget) || budget <= 0) { note("Enter a budget above 0.", true); return false; }
    meta = { name: name, status: $("t-status").value };
    settings.budget = budget;
    const sm = parseInt($("t-maps").value, 10);
    settings.standardMaps = isNaN(sm) || sm < 0 ? 0 : sm;
    STANDARD_MAPS = settings.standardMaps;
    settings.format = FORMAT;
    settings.teamSlot = !!TEAM_SLOT;
    settings.teamLogos = Object.assign({}, TEAM_LOGOS);
    settings.lineup = JSON.parse(JSON.stringify(LINEUP));
    settings.scoring = Object.assign({}, SCORING);
    const size = JSON.stringify({ players: players, rounds: rounds, settings: settings }).length;
    if (size > 900000) { note("This tournament is " + Math.round(size / 1000) + " KB, close to the 1 MB limit. Remove some uploaded photos (the built-in characters are tiny).", true); return false; }
    ensureMatchIds();   // every match needs an id so Pick'Em picks stay attached to it
    // Remember the price a player had before this change, so the market can show an arrow.
    players.forEach(function (p) {
      const before = priceAtLoad[p.id];
      if (before !== undefined && p.price !== before) p.prevPrice = before;
      priceAtLoad[p.id] = p.price;
    });
    try {
      await window.Cloud.saveTournament(tid, {
        name: meta.name, status: meta.status,
        data: { players: players, rounds: rounds, settings: settings },
      });
      dirty = false;
      updateBar();
      await refreshList(tid);
      if (!quiet) note("Published. Players will see the changes when they reload. Now press Recalculate leaderboard.");
      return true;
    } catch (e) {
      note("Couldn't publish: " + (e.message || e), true);
      return false;
    }
  }

  // Work out everyone's score and write the leaderboard. Returns the number of players, or -1 on failure.
  async function recalc(skipConfirm) {
    if (!skipConfirm && dirty && !confirm("You have unpublished changes. Recalculate using what you see here anyway?")) return -1;
    note("Recalculating...");
    try {
      const all = await window.Cloud.allSquads(tid);
      let rows = [];
      const flagged = [];
      let skipped = 0;
      all.forEach(function (s) {
        let saved = null;
        try { saved = JSON.parse(s.json); } catch (e) { /* skipped below */ }
        const score = saved ? scoreSquads(saved) : null;
        if (!score) { skipped++; return; }
        const problems = squadProblems(saved);
        if (problems.length) flagged.push({ uid: s.uid, name: s.name, problems: problems });
        rows.push({ uid: s.uid, name: s.name, total: score.total, rounds: score.rounds });
      });

      // Ownership: share of squads (with a team in that stage) that own each player. Only percentages are published.
      const own = { n: rounds.map(function () { return 0; }), own: rounds.map(function () { return {}; }) };
      const counts = rounds.map(function () { return {}; });
      all.forEach(function (s) {
        let saved = null;
        try { saved = JSON.parse(s.json); } catch (e) { return; }
        if (!Array.isArray(saved)) return;
        rounds.forEach(function (_, r) {
          const sq = saved[r];
          if (!sq || !Array.isArray(sq.players) || sq.players.length === 0) return;
          own.n[r]++;
          sq.players.forEach(function (id) { counts[r][id] = (counts[r][id] || 0) + 1; });
        });
      });
      rounds.forEach(function (_, r) {
        Object.keys(counts[r]).forEach(function (id) {
          own.own[r][id] = Math.round((counts[r][id] / own.n[r]) * 100);
        });
      });

      let held = 0;
      if (flagged.length) {
        const choice = await askFlagged(flagged);
        if (choice === "cancel") { note("Cancelled. The leaderboard wasn't changed."); return -1; }
        if (choice === "leave") {
          const bad = new Set(flagged.map(function (f) { return f.uid; }));
          rows = rows.filter(function (r) { return !bad.has(r.uid); });
          held = bad.size;
          if (window.Cloud.deleteScores) await window.Cloud.deleteScores(tid, Array.from(bad));
        }
      }

      await window.Cloud.writeScores(tid, rows);
      try { if (window.Cloud.writeOwnership) await window.Cloud.writeOwnership(tid, own); } catch (e) { console.warn("Ownership not written:", e); }

      // Pick'Em: score everyone's predictions too. A failure here (for example the new rules aren't deployed yet) doesn't stop the main leaderboard.
      let pickNote = "";
      try {
        if (window.Cloud.allPicks && window.Cloud.writePickScores) {
          const pickRows = [];
          (await window.Cloud.allPicks(tid)).forEach(function (p) {
            let picks = null;
            try { picks = JSON.parse(p.json); } catch (e) { return; }
            const sc = scorePickEm(picks);
            pickRows.push({ uid: p.uid, name: p.name, total: sc.total, correct: sc.correct, played: sc.played, rounds: sc.rounds });
          });
          await window.Cloud.writePickScores(tid, pickRows);
          pickNote = " Pick'Em updated for " + pickRows.length + " player(s).";
        }
      } catch (e) {
        pickNote = " (Pick'Em wasn't updated: " + (e.message || e) + ")";
      }
      note("Leaderboard updated for " + rows.length + " player(s)" + (skipped ? " (" + skipped + " skipped: unreadable squad)" : "") + (held ? " (" + held + " held back for review)" : "") + "." + pickNote);
      return rows.length;
    } catch (e) {
      note("Couldn't recalculate: " + (e.message || e), true);
      return -1;
    }
  }

  // The one-tap way: check, publish, then update the leaderboard.
  async function publishAll() {
    if (busy || !tid) return;
    const warnings = checkResults();
    if (warnings.length) {
      const shown = warnings.slice(0, 8).join("\n\u2022 ");
      const more = warnings.length > 8 ? "\n\u2022 ...and " + (warnings.length - 8) + " more" : "";
      if (!confirm("Check these before publishing:\n\n\u2022 " + shown + more + "\n\nPublish anyway?")) return;
    }
    setBusy(true);
    try {
      note("Publishing...");
      if (!(await publish(true))) return;
      note("Published. Updating the leaderboard...");
      const n = await recalc(true);
      if (n >= 0) note("Done. Results are live and the leaderboard is updated for " + n + " player(s)." + (warnings.length ? " (" + warnings.length + " warning(s) ignored.)" : ""));
    } finally {
      setBusy(false);
    }
  }

  // Delete the open tournament, after the organiser types its name to confirm.
  async function deleteCurrent() {
    if (busy || !tid) return;
    const typed = prompt("This permanently deletes \"" + meta.name + "\" with all squads, scores and mini-leagues.\n\nType the tournament name to confirm:");
    if (typed === null) return;
    if (typed.trim() !== meta.name) { note("The name didn't match, so nothing was deleted.", true); return; }
    setBusy(true);
    try {
      note("Deleting...");
      const gone = tid;
      const n = await window.Cloud.deleteTournament(gone);
      tid = null;
      dirty = false;
      $("t-panel").style.display = "none";
      updateBar();
      await refreshList(null);
      note("Deleted \"" + meta.name + "\" (" + n + " documents removed).");
    } catch (e) {
      note("Couldn't delete everything: " + (e.message || e) + ". If it says permission denied, deploy the new firestore.rules (firebase deploy) and try again.", true);
    } finally {
      setBusy(false);
    }
  }

  // A small door for import.js (the screenshot importer).
  window.AdminAPI = {
    roundIndex: function () { return selectedRound; },
    markDirty: markDirty,
    refresh: function () { renderRoundTabs(); renderRound(); },
  };

  // ---- Start up -----------------------------------------------------------

  // ---- Picture library ------------------------------------------------------

  function renderLibrary() {
    const grid = $("lib-grid");
    grid.innerHTML = "";
    Avatars.libraryItems().forEach(function (it) {
      const cell = el("div", "lib-item");
      cell.appendChild(Avatars.make("lib:" + it.id, it.name, 72));
      cell.appendChild(el("div", "muted lib-name", it.name));
      const del = el("button", "outline", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!confirm("Delete \"" + it.name + "\"? Players and teams using it go back to initials.")) return;
        Avatars.removeFromLibrary(it.id).then(function () { renderLibrary(); if (tid) renderPlayers(); })
          .catch(function (e) { $("lib-note").textContent = "Couldn't delete: " + (e.message || e); });
      });
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    if (!Avatars.libraryItems().length) grid.appendChild(el("p", "muted", "No pictures yet."));
  }

  function setupLibrary() {
    renderLibrary();
    window.addEventListener("avatars-ready", function () { renderLibrary(); if (tid) renderPlayers(); });
    $("rd-check").addEventListener("click", checkReadiness);
    $("lib-file").addEventListener("change", function () {
      const files = Array.prototype.slice.call($("lib-file").files || []);
      $("lib-file").value = "";
      let done = 0, failed = [];
      if (!files.length) return;
      $("lib-note").textContent = "Saving " + files.length + "...";
      files.forEach(function (f) {
        Avatars.addToLibrary(f, function (err) {
          if (err) failed.push(f.name + ": " + err);
          done++;
          if (done === files.length) {
            $("lib-note").textContent = failed.length ? "Some failed: " + failed.join("; ") : "Saved " + files.length + " picture(s).";
            renderLibrary();
            if (tid) renderPlayers();
          }
        });
      });
    });
  }

  function showTool() {
    $("admin-status").style.display = "none";
    $("admin-body").style.display = "block";
    setupLibrary();
    $("t-select").addEventListener("change", function () { selectTournament($("t-select").value); });
    $("btn-create").addEventListener("click", createTournament);
    $("t-maps").addEventListener("change", function () {
      const v = parseInt($("t-maps").value, 10);
      STANDARD_MAPS = isNaN(v) || v < 0 ? 0 : v;
      markDirty();
      if (tid) renderRound();
    });
    $("t-format").addEventListener("change", function () {
      FORMAT = $("t-format").value === "bracket" ? "bracket" : "league";
      markDirty();
    });
    $("btn-publish").addEventListener("click", function () { publish(false); });
    $("btn-recalc").addEventListener("click", function () { recalc(false); });
    $("btn-publish-all").addEventListener("click", publishAll);
    $("btn-delete").addEventListener("click", deleteCurrent);
    $("admin-bar-publish").addEventListener("click", publishAll);
    window.addEventListener("beforeunload", function (ev) {
      if (dirty) { ev.preventDefault(); ev.returnValue = ""; }
    });
  }

  function status(text) { $("admin-status").textContent = text; }

  let started = false;

  async function onUser(user) {
    if (started) return;
    if (!user) { status("Sign in on the game page first, then come back to this page."); return; }
    try {
      if (!(await window.Cloud.isAdmin())) {
        status("This account isn't an organiser. To make it one, create a document in Firestore: collection \"admins\", document ID: " + user.uid);
        return;
      }
      started = true;
      showTool();
      await refreshList(null);
    } catch (e) {
      status("Couldn't check your access: " + (e.message || e));
    }
  }

  function start() {
    if (!window.Cloud) { status("Firebase isn't set up. Fill in firebase-config.js first."); return; }
    window.Cloud.onAuth(onUser);
  }

  if (window.Cloud !== undefined) start();
  else window.addEventListener("cloud-ready", start);
  setTimeout(function () {
    if (window.Cloud === undefined) status("Couldn't load Firebase. Open this page from your website address, not from a file.");
  }, 6000);
})();