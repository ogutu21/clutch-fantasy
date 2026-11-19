// The online part of the game: the tournament list, sign-in, saving your squad to the cloud,
// and each tournament's leaderboard and mini-leagues. All Firebase calls go through window.Cloud.
// Which tournament is open comes from the page address: index.html?t=TOURNAMENT_ID (TID in script.js).
(function () {
  "use strict";

  const inPractice = TID === "demo";   // the built-in practice tournament never touches the cloud

  let user = null;          // the signed-in player, or null
  let synced = false;       // true once we've loaded their cloud squad (so we never overwrite it by mistake)
  let pushTimer = null;
  let tab = "global";       // "global" or "leagues"
  let openCode = null;      // the league whose table is showing
  let cloudState = "waiting";   // "waiting", "off" (not configured / failed to load) or "on"
  let tournamentReady = null;   // resolves to true once the tournament is loaded and the game started

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cloud() { return window.Cloud || null; }

  function friendly(e) {
    const code = (e && e.code) || "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Wrong email or password.";
    if (code === "auth/email-already-in-use") return "That email already has an account. Try signing in.";
    if (code === "auth/weak-password") return "Password must be at least 6 characters.";
    if (code === "auth/invalid-email") return "That email doesn't look right.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
    if (code === "auth/unauthorized-domain") return "This website address isn't allowed yet. Add it under Authentication > Settings > Authorized domains.";
    if (code === "permission-denied") return "Permission denied. Check your Firestore rules.";
    return (e && e.message) || "Something went wrong.";
  }

  function gameError(text) { $("game-error").textContent = text || ""; }

  // ---- Opening the tournament -------------------------------------------

  async function openFromCloud() {
    try {
      const t = await cloud().loadTournament(TID);
      if (!t) { gameError("That tournament doesn't exist."); return false; }
      if (!applyTournament(t.data)) { gameError("This tournament's data looks broken."); return false; }
      setTournamentInfo({ id: t.id, name: t.name, status: t.status });
      startGame();
      return true;
    } catch (e) {
      gameError("Couldn't load the tournament: " + friendly(e));
      return false;
    }
  }

  // ---- Saving to the cloud ----------------------------------------------

  function canSave() {
    return user && synced && cloud() && TID && !inPractice &&
      !(tournamentInfo && tournamentInfo.status === "ended");
  }

  function schedulePush() {
    if (!canSave()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      cloud().saveProgress(TID, { squads: squads, name: user.name })
        .catch(function (e) { console.warn("Cloud save failed:", e); setNote(friendly(e)); });
    }, 1500);
  }

  window.afterSave = schedulePush;   // script.js calls this after every save()

  async function handleAuth(u) {
    user = u;
    if (u) Avatars.fetchProfiles([u.uid]);
    synced = false;
    openCode = null;
    renderAuthBar();
    renderBoard();
    if (!u || !TID || inPractice) return;
    try {
      if (tournamentReady && !(await tournamentReady)) return;
      const saved = await cloud().loadSquads(TID);
      if (saved && applySquads(saved)) selectRound(defaultStage());   // the cloud copy wins over this device
      synced = true;
      schedulePush();
    } catch (e) {
      setNote("Couldn't load your saved squad: " + friendly(e));
    }
    try {
      if (cloud().loadOwnership) { setOwnership(await cloud().loadOwnership(TID)); render(); }
    } catch (e) { /* ownership is optional */ }
    renderBoard();
  }

  // ---- Tournament list (home page) --------------------------------------

  function tournamentCard(name, statusText, statusClass, href) {
    const card = el("div", "t-card");
    card.appendChild(el("h3", "", name));
    card.appendChild(el("span", "chip status-" + statusClass, statusText));
    const go = el("a", "btn", "Enter");
    go.href = href;
    card.appendChild(go);
    return card;
  }

  async function renderHome() {
    const box = $("tournament-list");
    box.innerHTML = "";
    box.appendChild(el("p", "muted", "Loading tournaments..."));
    let list = [];
    let problem = "";
    if (cloudState === "on") {
      try { list = await cloud().listTournaments(); } catch (e) { problem = friendly(e); }
    } else {
      problem = "Online tournaments aren't available right now (offline mode).";
    }
    box.innerHTML = "";
    if (problem) box.appendChild(el("p", "error", problem));
    if (!problem && !list.length) box.appendChild(el("p", "muted", "No tournaments yet. Check back soon."));
    list.forEach(function (t) {
      box.appendChild(tournamentCard(t.name, t.status === "ended" ? "Ended" : "Open", t.status, "index.html?t=" + encodeURIComponent(t.id)));
    });
    box.appendChild(tournamentCard("Practice tournament", "Practice", "practice", "index.html?t=demo"));
  }

  // ---- Top bar and sign-in dialog ---------------------------------------

  function renderAuthBar() {
    const bar = $("auth-bar");
    bar.innerHTML = "";
    if (cloudState !== "on") {
      bar.appendChild(el("span", "muted", cloudState === "waiting" ? "Connecting..." : "Offline mode"));
      return;
    }
    if (user) {
      bar.appendChild(el("span", "muted", user.name));
      const out = el("button", "", "Sign out");
      out.addEventListener("click", function () { cloud().logOut(); });
      bar.appendChild(out);
    } else {
      const inBtn = el("button", "", "Sign in");
      inBtn.addEventListener("click", openAuthDialog);
      bar.appendChild(inBtn);
    }
  }

  let signUpMode = false;

  function openAuthDialog() {
    signUpMode = false;
    $("auth-error").textContent = "";
    updateAuthMode();
    const d = $("auth-dialog");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }

  function closeAuthDialog() {
    const d = $("auth-dialog");
    if (d.close) d.close(); else d.removeAttribute("open");
  }

  function updateAuthMode() {
    $("auth-name-row").style.display = signUpMode ? "block" : "none";
    $("auth-submit").textContent = signUpMode ? "Create account" : "Sign in";
    $("auth-switch").textContent = signUpMode ? "I already have an account" : "Create an account";
  }

  async function runAuth(action) {
    $("auth-error").textContent = "";
    try {
      await action();
      closeAuthDialog();
    } catch (e) {
      $("auth-error").textContent = friendly(e);
    }
  }

  function setupAuthDialog() {
    $("auth-google").addEventListener("click", function () {
      runAuth(function () { return cloud().signInGoogle(); });
    });
    $("auth-switch").addEventListener("click", function () {
      signUpMode = !signUpMode;
      updateAuthMode();
    });
    $("auth-cancel").addEventListener("click", closeAuthDialog);
    $("auth-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      const email = $("auth-email").value.trim();
      const password = $("auth-password").value;
      const name = $("auth-name").value.trim();
      if (signUpMode) {
        if (!name) { $("auth-error").textContent = "Pick a display name for the leaderboard."; return; }
        runAuth(function () { return cloud().signUp(name, email, password); });
      } else {
        runAuth(function () { return cloud().signIn(email, password); });
      }
    });
  }

  // ---- Leaderboard and leagues (for the open tournament) -----------------

  function setNote(text) { $("board-note").textContent = text || ""; }

  function renderBoard() {
    const tabs = $("board-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";
    for (const t of ["global", "leagues"]) {
      const b = el("button", "", t === "global" ? "Everyone" : "My leagues");
      if (t === tab) b.classList.add("active");
      b.addEventListener("click", function () { tab = t; openCode = null; renderBoard(); });
      tabs.appendChild(b);
    }
    setNote("");
    const body = $("board-body");
    body.innerHTML = "";

    if (inPractice) {
      body.appendChild(el("p", "muted", "The practice tournament has no leaderboard. Open a real tournament to compete."));
      return;
    }
    if (cloudState !== "on") {
      body.appendChild(el("p", "muted", cloudState === "waiting"
        ? "Connecting to the online service..."
        : "Online features are off. Fill in firebase-config.js and open the game through a web server to turn them on."));
      return;
    }
    if (!user) {
      body.appendChild(el("p", "muted", "Sign in to save your squad, see the leaderboard and join leagues."));
      return;
    }
    if (tab === "global") renderGlobal(body); else renderLeagues(body);
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function avatar(name, big, uid) {
    return Avatars.userEl(name, uid, big);
  }

  // The top three as a podium (shown when there are at least three players).
  function makePodium(rows, ranks) {
    const podium = el("div", "podium");
    [1, 0, 2].forEach(function (i) {
      const row = rows[i];
      const col = el("div", "podium-col place-" + (i + 1) + (user && row.uid === user.uid ? " me" : ""));
      col.appendChild(avatar(row.name, true, row.uid));
      col.appendChild(el("div", "podium-name", row.name));
      col.appendChild(el("div", "podium-pts", row.total.toFixed(1)));
      col.appendChild(el("div", "podium-step", String(ranks[i])));
      podium.appendChild(col);
    });
    return podium;
  }

  // rows: [{ uid, name, total, rounds: [points per stage] }]
  function makeTable(rows) {
    const box = el("div", "board-wrap");
    Avatars.fetchProfiles(rows.map(function (r) { return r.uid; }));

    // Equal points share a rank.
    const ranks = [];
    let rank = 0;
    let prevTotal = null;
    rows.forEach(function (row, i) {
      if (row.total !== prevTotal) rank = i + 1;
      prevTotal = row.total;
      ranks.push(rank);
    });

    // "You are #N" banner
    const mine = user ? rows.findIndex(function (r) { return r.uid === user.uid; }) : -1;
    if (mine >= 0) {
      const banner = el("div", "you-banner");
      banner.appendChild(avatar(rows[mine].name, false, rows[mine].uid));
      banner.appendChild(el("span", "", "You are #" + ranks[mine] + " of " + rows.length));
      banner.appendChild(el("b", "", rows[mine].total.toFixed(1) + " pts"));
      box.appendChild(banner);
    }

    if (tournamentInfo && tournamentInfo.status === "ended" && rows.length) {
      const champs = rows.filter(function (r, i) { return ranks[i] === 1; }).map(function (r) { return r.name; });
      box.appendChild(el("div", "champ-banner", "\ud83c\udfc6 Champion" + (champs.length > 1 ? "s" : "") + ": " + champs.join(", ")));
    }

    if (rows.length >= 3) box.appendChild(makePodium(rows, ranks));

    const wrap = el("div", "table-wrap");
    const table = el("table", "board");
    const head = el("tr");
    head.appendChild(el("th", "", "#"));
    head.appendChild(el("th", "", "Player"));
    rounds.forEach(function (r, i) {
      const th = el("th", "stage", "S" + (i + 1));
      th.title = r.name;
      head.appendChild(th);
    });
    head.appendChild(el("th", "", "Total"));
    table.appendChild(head);
    rows.forEach(function (row, i) {
      const tr = el("tr");
      const isMe = user && row.uid === user.uid;
      if (isMe) tr.className = "me";
      tr.appendChild(el("td", ranks[i] <= 3 ? "rank rank-" + ranks[i] : "rank", String(ranks[i])));
      const nameCell = el("td", "player-cell");
      const inner = el("div", "pc-inner");
      inner.appendChild(avatar(row.name, false, row.uid));
      inner.appendChild(el("span", "pname", row.name));
      if (isMe) inner.appendChild(el("span", "you-tag", "YOU"));
      nameCell.appendChild(inner);
      tr.appendChild(nameCell);
      rounds.forEach(function (_, k) {
        const pts = row.rounds && typeof row.rounds[k] === "number" ? row.rounds[k].toFixed(1) : "-";
        tr.appendChild(el("td", "stage", pts));
      });
      tr.appendChild(el("td", "total", row.total.toFixed(1)));
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    return box;
  }

  async function renderGlobal(body) {
    body.appendChild(el("p", "muted", "Loading..."));
    try {
      const rows = await cloud().topScores(TID, 50);
      if (tab !== "global" || !user) return;   // the player moved on while we waited
      body.innerHTML = "";
      body.appendChild(el("p", "muted", "Scores update when the organiser publishes new results."));
      const refresh = el("button", "", "Refresh");
      refresh.addEventListener("click", renderBoard);
      body.appendChild(refresh);
      body.appendChild(rows.length ? makeTable(rows) : el("p", "muted", "No scores yet."));
    } catch (e) {
      body.innerHTML = "";
      body.appendChild(el("p", "error", friendly(e)));
    }
  }

  async function renderLeagues(body) {
    // Create / join forms
    const forms = el("div", "league-forms");

    const createRow = el("div", "form-row");
    const nameInput = el("input");
    nameInput.placeholder = "New league name";
    nameInput.maxLength = 40;
    const createBtn = el("button", "", "Create");
    createBtn.addEventListener("click", async function () {
      const name = nameInput.value.trim();
      if (!name) { setNote("Give your league a name."); return; }
      try {
        const code = await cloud().createLeague(TID, name);
        openCode = code;
        setNote("League created! Share the code " + code + " with your friends.");
        renderLeaguesAgain();
      } catch (e) { setNote(friendly(e)); }
    });
    createRow.appendChild(nameInput);
    createRow.appendChild(createBtn);

    const joinRow = el("div", "form-row");
    const codeInput = el("input");
    codeInput.placeholder = "Join code";
    codeInput.maxLength = 6;
    const joinBtn = el("button", "", "Join");
    joinBtn.addEventListener("click", async function () {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) { setNote("Type a join code."); return; }
      try {
        const lg = await cloud().joinLeague(TID, code);
        openCode = lg.code;
        setNote("Joined " + lg.name + ".");
        renderLeaguesAgain();
      } catch (e) { setNote(friendly(e)); }
    });
    joinRow.appendChild(codeInput);
    joinRow.appendChild(joinBtn);

    forms.appendChild(createRow);
    forms.appendChild(joinRow);
    body.appendChild(forms);

    const listBox = el("div", "league-list");
    const tableBox = el("div", "league-table");
    body.appendChild(listBox);
    body.appendChild(tableBox);

    listBox.appendChild(el("p", "muted", "Loading your leagues..."));
    try {
      const mine = await cloud().myLeagues(TID);
      if (tab !== "leagues" || !user) return;
      listBox.innerHTML = "";
      if (!mine.length) {
        listBox.appendChild(el("p", "muted", "You're not in any league for this tournament yet. Create one or enter a code."));
        return;
      }
      mine.forEach(function (lg) {
        const b = el("button", "", lg.name + " (" + lg.count + ")");
        if (lg.code === openCode) b.classList.add("active");
        b.addEventListener("click", function () { openCode = lg.code; renderLeaguesAgain(); });
        listBox.appendChild(b);
      });
      if (openCode) showLeagueTable(tableBox, openCode);
    } catch (e) {
      listBox.innerHTML = "";
      listBox.appendChild(el("p", "error", friendly(e)));
    }
  }

  // Re-draw the leagues tab but keep the message the player just got.
  function renderLeaguesAgain() {
    const note = $("board-note").textContent;
    renderBoard();
    setNote(note);
  }

  async function showLeagueTable(box, code) {
    box.appendChild(el("p", "muted", "Loading table..."));
    try {
      const lg = await cloud().leagueTable(TID, code);
      if (openCode !== code) return;
      box.innerHTML = "";
      const head = el("div", "league-head");
      head.appendChild(el("h3", "", lg.name));
      head.appendChild(el("span", "code", "Code: " + lg.code));
      const copy = el("button", "", "Copy");
      copy.addEventListener("click", function () {
        try { navigator.clipboard.writeText(lg.code); copy.textContent = "Copied"; } catch (e) { /* ignore */ }
      });
      head.appendChild(copy);
      box.appendChild(head);
      box.appendChild(makeTable(lg.rows));
    } catch (e) {
      box.innerHTML = "";
      box.appendChild(el("p", "error", friendly(e)));
    }
  }

  // ---- Start up -----------------------------------------------------------

  function start() {
    if (cloudState !== "waiting") return;   // already decided
    if (cloud()) {
      cloudState = "on";
      if (TID && !inPractice) tournamentReady = openFromCloud();
      cloud().onAuth(handleAuth);
    } else {
      cloudState = "off";
      if (TID && !inPractice) gameError("Online features are off, so this tournament can't be opened. Try the practice tournament.");
    }
    renderAuthBar();
    renderBoard();
    if (!TID) renderHome();
  }

  setupAuthDialog();
  renderAuthBar();
  renderBoard();

  if (window.Cloud !== undefined) start();
  else window.addEventListener("cloud-ready", start);

  // If the Firebase module never loads (no internet, or the page was opened as a file), say so.
  setTimeout(function () {
    if (cloudState === "waiting") {
      cloudState = "off";
      if (TID && !inPractice) gameError("Couldn't reach the online service, so this tournament can't be opened.");
      renderAuthBar();
      renderBoard();
      if (!TID) renderHome();
    }
  }, 6000);
})();