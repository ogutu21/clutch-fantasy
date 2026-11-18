// Screenshot import (Phase 5b/5c): read a Call of Duty: Mobile "Detail Report" scoreboard photo
// and fill in the stats for the stage that is open on the admin page.
// It can read the picture for free in the browser (ocr.js) or with Claude (needs an API key).
// Nothing is saved until you review the numbers, press Apply, and then publish as usual.
(function () {
  "use strict";

  const MODEL = "claude-sonnet-5-5";                 // change here if you want a different model
  const API_URL = "https://api.anthropic.com/v1/messages";
  const KEY_STORE = "clutch-anthropic-key";          // kept only in this browser, never in the code
  const METHOD_STORE = "clutch-import-method";       // "free" (read in the browser) or "claude"
  const MAX_SIDE = 1600;                             // screenshots are shrunk to this width before sending

  const PROMPT =
    "This is a Call of Duty: Mobile \"Detail Report\" scoreboard screenshot. " +
    "The blue team is on the left and the red team is on the right. Extract every player row. " +
    "Reply with ONLY a JSON object (no other text, no code fences) in exactly this shape: " +
    "{\"result\":\"VICTORY\"|\"DEFEAT\"|\"DRAW\"|null,\"scoreLeft\":number|null,\"scoreRight\":number|null," +
    "\"mode\":string|null,\"map\":string|null," +
    "\"left\":[{\"name\":string,\"kills\":number,\"deaths\":number,\"assists\":number,\"mvp\":boolean,\"hillTime\":number|null}]," +
    "\"right\":[{\"name\":string,\"kills\":number,\"deaths\":number,\"assists\":number,\"mvp\":boolean,\"hillTime\":number|null}]}. " +
    "hillTime is the number in the TIME column converted to seconds (for example 1:15 is 75), or null if the screenshot has no TIME column. " +
    "Rules: the K/D/A column is written kills/deaths/assists, so 44/29/11 means 44 kills, 29 deaths, 11 assists. " +
    "scoreLeft and scoreRight are the two numbers next to VICTORY or DEFEAT at the top (left team first). " +
    "mvp is true only for a player who has an MVP badge next to their row. " +
    "Copy each player name exactly as shown, including symbols and clan tags, but do not include the small level number under the name. " +
    "Keep the rows in top-to-bottom order. If a value cannot be read, use null (for names, skip the row).";

  const st = { files: [], urls: [], matchIdx: "all", mode: "auto", results: [], rows: [] };

  // Is a game mode name Search & Destroy? (The Claude reader reports the mode; the free reader does not.)
  function isSnd(mode) { return /search|s\s*&\s*d|snd/i.test(String(mode || "")); }
  function sndPicture(res) { return st.mode === "snd" || (st.mode === "auto" && isSnd(res.mode)); }
  let dlg = null;
  let body = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function getMethod() {
    try { return localStorage.getItem(METHOD_STORE) === "claude" ? "claude" : "free"; } catch (e) { return "free"; }
  }
  function setMethod(m) {
    try { localStorage.setItem(METHOD_STORE, m); } catch (e) { /* ignore */ }
  }
  function setKey(k) {
    try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ }
  }

  // ---- Matching names from the screenshot to your players ------------------

  function norm(s) {
    return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = [];
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function sim(a, b) {
    const len = Math.max(a.length, b.length);
    return len ? 1 - lev(a, b) / len : 0;
  }

  // How well does the name from the screenshot fit this player? 0 to 1.
  function nameScore(rawNorm, p) {
    const cands = [p.name].concat(p.aliases || []).map(norm).filter(Boolean);
    const tokens = rawNorm.split(" ");
    let best = 0;
    cands.forEach(function (n) {
      let s = 0;
      if (rawNorm === n) s = 1;
      else if (tokens.indexOf(n) !== -1) s = 0.95;
      else if (n.length >= 4 && rawNorm.indexOf(n) !== -1) s = 0.9;
      else if (n.length >= 5) {
        const pool = tokens.filter(function (t) { return t.length >= 5; }).concat([rawNorm]);
        pool.forEach(function (t) { s = Math.max(s, sim(t, n)); });
        if (s < 0.8) s = 0;
      }
      best = Math.max(best, s);
    });
    return best;
  }

  // Give each row its best player, never the same player twice.
  function autoMatch(rows, pool) {
    const cands = [];
    rows.forEach(function (row) {
      pool.forEach(function (p) {
        let s = 0;
        (row.keys && row.keys.length ? row.keys : [norm(row.raw)]).forEach(function (k) { s = Math.max(s, nameScore(k, p)); });
        if (s >= 0.8) cands.push({ row: row, p: p, s: s });
      });
    });
    cands.sort(function (a, b) { return b.s - a.s; });
    const usedRows = new Set();
    const usedPlayers = new Set();
    cands.forEach(function (c) {
      if (usedRows.has(c.row) || usedPlayers.has(c.p.id)) return;
      c.row.player = c.p;
      usedRows.add(c.row);
      usedPlayers.add(c.p.id);
    });
  }

  function learnAlias(p, raw) {
    const n = norm(raw);
    if (!n || n === norm(p.name)) return;
    p.aliases = p.aliases || [];
    if (p.aliases.some(function (a) { return norm(a) === n; })) return;
    if (p.aliases.length >= 10) return;
    p.aliases.push(String(raw).trim().slice(0, 40));
  }

  // ---- Reading the screenshot with Claude ---------------------------------

  async function toBase64(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }

  function count(v) {
    const n = Math.round(Number(v));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function cleanRows(list) {
    return (Array.isArray(list) ? list : []).filter(function (r) {
      return r && typeof r.name === "string" && r.name.trim();
    }).map(function (r) {
      return { name: r.name.trim(), kills: count(r.kills), deaths: count(r.deaths), assists: count(r.assists), mvp: r.mvp === true, hillTime: count(r.hillTime) };
    });
  }

  function parseReply(text) {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("The reply didn't contain any results.");
    const j = JSON.parse(text.slice(a, b + 1));
    const out = {
      result: typeof j.result === "string" ? j.result.toUpperCase() : null,
      scoreLeft: isFinite(Number(j.scoreLeft)) && j.scoreLeft !== null ? Number(j.scoreLeft) : null,
      scoreRight: isFinite(Number(j.scoreRight)) && j.scoreRight !== null ? Number(j.scoreRight) : null,
      mode: typeof j.mode === "string" ? j.mode : null,
      map: typeof j.map === "string" ? j.map : null,
      left: cleanRows(j.left),
      right: cleanRows(j.right),
    };
    if (!out.left.length && !out.right.length) throw new Error("No player rows were found in that picture.");
    return out;
  }

  async function askModel(key, base64) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
              { type: "text", text: PROMPT },
            ],
          }],
        }),
      });
    } catch (e) {
      throw new Error("Couldn't reach the service. Check your internet connection.");
    }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = (j.error && j.error.message) || ""; } catch (e) { /* ignore */ }
      if (res.status === 401 || res.status === 403) throw new Error("The API key was rejected. Check it and try again.");
      if (res.status === 429) throw new Error("Too many requests right now. Wait a moment and try again.");
      throw new Error("The service returned an error (" + res.status + ")." + (detail ? " " + detail : ""));
    }
    const data = await res.json();
    const text = (data.content || []).map(function (c) { return c.type === "text" ? c.text : ""; }).join("");
    return parseReply(text);
  }

  // ---- Putting the pictures together ----------------------------------------

  function pool() {
    const round = rounds[window.AdminAPI.roundIndex()];
    if (st.matchIdx === "all") return players.slice();
    const m = round.matches[Number(st.matchIdx)];
    if (!m) return players.slice();
    return players.filter(function (p) { return p.team === m.teamA || p.team === m.teamB; });
  }

  // One row per distinct player; the numbers of several maps are added together.
  // The free reader can spell a name slightly differently on each map, so similar names are joined,
  // but two names from the same screenshot are never joined (they are different players).
  function aggregate(results) {
    const out = [];
    st.keyMap = {};
    const squash = function (k) { return k.replace(/ /g, ""); };

    results.forEach(function (res, ri) {
      ["left", "right"].forEach(function (side) {
        res[side].forEach(function (r) {
          const key = norm(r.name) || ("row" + out.length);
          const sq = squash(key);
          let row = null;
          const free = out.filter(function (o) { return !o.imgs.has(ri); });
          row = free.find(function (o) { return squash(o.key) === sq || o.keys.indexOf(key) !== -1; }) || null;
          if (!row && sq.length >= 4) {
            let best = 0.7;
            free.forEach(function (o) {
              const s = sim(squash(o.key), sq);
              if (s >= best) { best = s; row = o; }
            });
          }
          if (!row) {
            row = { raw: r.name, key: key, keys: [], k: 0, d: 0, a: 0, sk: 0, hill: 0, mvp: false, maps: 0, player: null, unsure: false, imgs: new Set() };
            out.push(row);
          }
          if (row.keys.indexOf(key) === -1) row.keys.push(key);
          st.keyMap[key] = row;
          row.imgs.add(ri);
          row.k += r.kills;
          row.d += r.deaths;
          row.a += r.assists;
          if (sndPicture(res)) row.sk += r.kills;
          row.hill += r.hillTime || 0;   // null (no TIME column) counts as 0
          row.mvp = row.mvp || r.mvp;
          row.unsure = row.unsure || r.unsure === true;
          row.maps++;
        });
      });
    });
    autoMatch(out, pool());
    return out;
  }

  // Which of the match's teams won how many maps? Uses which side your players were on.
  function winnerSuggestion() {
    if (st.matchIdx === "all") return null;
    const round = rounds[window.AdminAPI.roundIndex()];
    const m = round.matches[Number(st.matchIdx)];
    if (!m || m.teamA === m.teamB) return null;
    const rowByKey = st.keyMap || {};

    function sideTeam(list) {
      const tally = {};
      list.forEach(function (r) {
        const row = rowByKey[norm(r.name)];
        if (row && row.player && (row.player.team === m.teamA || row.player.team === m.teamB)) {
          tally[row.player.team] = (tally[row.player.team] || 0) + 1;
        }
      });
      const a = tally[m.teamA] || 0, b = tally[m.teamB] || 0;
      if (a === b) return null;
      return a > b ? m.teamA : m.teamB;
    }
    const other = function (t) { return t === m.teamA ? m.teamB : m.teamA; };

    const wins = {};
    wins[m.teamA] = 0;
    wins[m.teamB] = 0;
    let counted = 0;
    st.results.forEach(function (res) {
      let leftWon = null;
      if (res.scoreLeft !== null && res.scoreRight !== null && res.scoreLeft !== res.scoreRight) leftWon = res.scoreLeft > res.scoreRight;
      else if (res.result === "VICTORY") leftWon = true;
      else if (res.result === "DEFEAT") leftWon = false;
      if (leftWon === null) return;
      const lt = sideTeam(res.left);
      const rt = sideTeam(res.right);
      let winner = null;
      if (lt) winner = leftWon ? lt : other(lt);
      else if (rt) winner = leftWon ? other(rt) : rt;
      if (!winner) return;
      wins[winner]++;
      counted++;
    });
    if (!counted) return null;
    const a = wins[m.teamA], b = wins[m.teamB];
    const out = { matchIdx: Number(st.matchIdx), of: counted, scoreA: a, scoreB: b, teamA: m.teamA, teamB: m.teamB };
    if (a === b) out.tie = true;
    else out.team = a > b ? m.teamA : m.teamB;
    return out;
  }

  // ---- The dialog ------------------------------------------------------------

  function ensureDialog() {
    if (dlg) return;
    dlg = el("dialog");
    dlg.id = "import-dialog";
    body = el("div");
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
  }

  function freeUrls() {
    st.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    st.urls = [];
  }

  function close() {
    freeUrls();
    if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
  }

  function open() {
    ensureDialog();
    st.files = [];
    st.results = [];
    st.rows = [];
    freeUrls();
    const round = rounds[window.AdminAPI.roundIndex()];
    st.matchIdx = round.matches.length === 1 ? "0" : "all";
    renderPick();
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  }

  function message(text, isError) {
    const m = $("imp-msg");
    if (!m) return;
    m.textContent = text || "";
    m.className = isError ? "error" : "muted";
  }

  function renderPick() {
    body.innerHTML = "";
    body.appendChild(el("h3", "", "Import from screenshot"));
    const round = rounds[window.AdminAPI.roundIndex()];
    body.appendChild(el("p", "muted", "Upload the Detail Report screenshot(s) for this match. If the match was played over several maps, choose all of them together and the numbers are added up. You'll check everything before it is applied to " + round.name + "."));

    // How to read the picture
    const methodRow = el("div", "imp-field");
    methodRow.appendChild(el("label", "", "Reader"));
    const methodSel = el("select");
    [["free", "Free: read it in this browser"], ["claude", "Claude AI: more accurate (needs an API key)"]].forEach(function (m) {
      const o = el("option", "", m[1]);
      o.value = m[0];
      methodSel.appendChild(o);
    });
    methodSel.value = getMethod();
    methodSel.addEventListener("change", function () { setMethod(methodSel.value); renderPick(); });
    methodRow.appendChild(methodSel);
    body.appendChild(methodRow);

    if (getMethod() === "free") {
      body.appendChild(el("p", "muted", "Nothing is sent anywhere. The first time, your browser downloads the reader (about 10 MB), so it needs a connection for that. Names and numbers can occasionally be misread, so check the next screen."));
    } else {
      // API key
      const keyBox = el("div", "imp-key");
      if (getKey()) {
        keyBox.appendChild(el("span", "muted", "API key saved in this browser."));
        const change = el("button", "outline", "Remove key");
        change.type = "button";
        change.addEventListener("click", function () { setKey(""); renderPick(); });
        keyBox.appendChild(change);
      } else {
        keyBox.appendChild(el("p", "muted", "Paste your Claude API key once. It is stored only in this browser (never in your code or online), and is used to read the screenshots. Use a key with a low spending limit."));
        const input = el("input");
        input.type = "password";
        input.placeholder = "sk-ant-...";
        input.autocomplete = "off";
        const save = el("button", "", "Save key");
        save.type = "button";
        save.addEventListener("click", function () {
          const v = input.value.trim();
          if (!v) { message("Paste the key first.", true); return; }
          setKey(v);
          renderPick();
        });
        keyBox.appendChild(input);
        keyBox.appendChild(save);
      }
      body.appendChild(keyBox);
    }

    // Which match
    const row = el("div", "imp-field");
    row.appendChild(el("label", "", "Match"));
    const sel = el("select");
    round.matches.forEach(function (m, i) {
      const o = el("option", "", m.teamA + " vs " + m.teamB);
      o.value = String(i);
      sel.appendChild(o);
    });
    const all = el("option", "", "Any players (no match chosen)");
    all.value = "all";
    sel.appendChild(all);
    sel.value = st.matchIdx;
    sel.addEventListener("change", function () { st.matchIdx = sel.value; });
    row.appendChild(sel);
    body.appendChild(row);

    // Game mode of these screenshots (decides which kills count as Search & Destroy kills)
    const modeRow = el("div", "imp-field");
    modeRow.appendChild(el("label", "", "Game mode"));
    const modeSel = el("select");
    [["auto", "Auto (read from the screenshot)"], ["hp", "Hardpoint"], ["snd", "Search & Destroy"], ["ctl", "Control"], ["other", "Other"]].forEach(function (m) {
      const o = el("option", "", m[1]);
      o.value = m[0];
      modeSel.appendChild(o);
    });
    modeSel.value = st.mode;
    modeSel.addEventListener("change", function () { st.mode = modeSel.value; });
    modeRow.appendChild(modeSel);
    body.appendChild(modeRow);
    body.appendChild(el("p", "muted", "Choose the mode these screenshots are from. In Search & Destroy every kill counts as an S&D kill. Both readers read the mode line and the Hardpoint TIME column; check them on the next screen. Bomb plants and defuses aren't on this screen, so type them in."));

    // Files
    const pick = el("input");
    pick.type = "file";
    pick.accept = "image/*";
    pick.multiple = true;
    pick.id = "imp-file";
    pick.addEventListener("change", function () {
      st.files = Array.prototype.slice.call(pick.files);
      freeUrls();
      thumbs.innerHTML = "";
      st.files.forEach(function (f) {
        const url = URL.createObjectURL(f);
        st.urls.push(url);
        const img = el("img", "imp-thumb");
        img.src = url;
        img.alt = f.name;
        thumbs.appendChild(img);
      });
    });
    body.appendChild(pick);
    const thumbs = el("div", "imp-thumbs");
    body.appendChild(thumbs);

    body.appendChild(el("p", "muted", ""));
    const msg = el("p", "muted", "");
    msg.id = "imp-msg";
    body.appendChild(msg);

    const actions = el("div", "dialog-actions");
    const go = el("button", "", "Read screenshots");
    go.type = "button";
    go.id = "imp-go";
    go.addEventListener("click", readAll);
    const cancel = el("button", "outline", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    actions.appendChild(go);
    actions.appendChild(cancel);
    body.appendChild(actions);
  }

  async function readAll() {
    const method = getMethod();
    const key = getKey();
    if (method === "claude" && !key) { message("Save your API key first.", true); return; }
    if (!st.files.length) { message("Choose at least one screenshot.", true); return; }
    if (method === "free" && !window.ScoreboardOCR) { message("The free reader isn't loaded. Make sure ocr.js is on the page.", true); return; }
    const go = $("imp-go");
    go.disabled = true;
    try {
      const results = [];
      for (let i = 0; i < st.files.length; i++) {
        const label = "Screenshot " + (i + 1) + " of " + st.files.length;
        message("Reading " + label.toLowerCase() + "...");
        if (method === "free") {
          results.push(await window.ScoreboardOCR.read(st.files[i], function (m) {
            if (m.stage === "load") message("Loading the reader (first time only): " + Math.round((m.progress || 0) * 100) + "%");
            else message(label + ": " + m.text);
          }));
        } else {
          results.push(await askModel(key, await toBase64(st.files[i])));
        }
      }
      st.results = results;
      st.rows = aggregate(results);
      renderReview();
    } catch (e) {
      message(e.message || "Something went wrong reading the screenshot.", true);
      go.disabled = false;
    }
  }

  function numField(label, value, onChange) {
    const wrap = el("label", "num");
    wrap.appendChild(el("span", "", label));
    const i = el("input");
    i.type = "number";
    i.min = "0";
    i.step = "1";
    i.inputMode = "numeric";
    i.value = value;
    i.addEventListener("focus", function () { i.select(); });
    i.addEventListener("change", function () { onChange(count(i.value)); i.value = count(i.value); });
    wrap.appendChild(i);
    return wrap;
  }

  function reviewRow(row, onAssign) {
    const box = el("div", "imp-row" + (row.player ? "" : " unmatched"));
    const head = el("div", "imp-head");
    head.appendChild(el("span", "imp-raw", row.raw));
    if (row.maps > 1) head.appendChild(el("span", "chip", row.maps + " maps"));
    if (row.unsure) head.appendChild(el("span", "chip status-ended", "check numbers"));
    box.appendChild(head);

    const sel = el("select", "imp-who");
    const skip = el("option", "", "Skip (not in this tournament)");
    skip.value = "";
    sel.appendChild(skip);
    pool().forEach(function (p) {
      const o = el("option", "", p.name + " (" + p.team.replace("Team ", "") + ")");
      o.value = String(p.id);
      sel.appendChild(o);
    });
    sel.value = row.player ? String(row.player.id) : "";
    sel.addEventListener("change", function () {
      row.player = sel.value ? players.find(function (p) { return String(p.id) === sel.value; }) : null;
      box.classList.toggle("unmatched", !row.player);
      onAssign();
    });
    box.appendChild(sel);

    const nums = el("div", "nums");
    nums.appendChild(numField("K", row.k, function (v) { row.k = v; }));
    nums.appendChild(numField("D", row.d, function (v) { row.d = v; }));
    nums.appendChild(numField("A", row.a, function (v) { row.a = v; }));
    nums.appendChild(numField("S&D K", row.sk, function (v) { row.sk = v; }));
    nums.appendChild(numField("Hill s", row.hill, function (v) { row.hill = v; }));
    const mvpLabel = el("label", "num mvp");
    mvpLabel.appendChild(el("span", "", "MVP"));
    const mvp = el("input");
    mvp.type = "checkbox";
    mvp.checked = row.mvp;
    mvp.addEventListener("change", function () { row.mvp = mvp.checked; });
    mvpLabel.appendChild(mvp);
    nums.appendChild(mvpLabel);
    box.appendChild(nums);
    return box;
  }

  function renderReview() {
    body.innerHTML = "";
    body.appendChild(el("h3", "", "Check the numbers"));

    const info = st.results.map(function (r, i) {
      const bits = [];
      if (r.mode) bits.push(r.mode);
      if (r.map) bits.push(r.map);
      if (r.result) bits.push(r.result + (r.scoreLeft !== null && r.scoreRight !== null ? " " + r.scoreLeft + ":" + r.scoreRight : ""));
      return (st.results.length > 1 ? "Map " + (i + 1) + ": " : "") + (bits.join(" · ") || "scoreboard read");
    });
    info.forEach(function (t) { body.appendChild(el("div", "imp-info", t)); });
    body.appendChild(el("p", "muted", "Names in the picture are matched to your players automatically. Fix any wrong match, or choose Skip for people who aren't in your tournament. The numbers can be edited." + (st.results.some(function (r) { return r.source === "ocr"; }) ? " The free reader can misread a digit or a name, so look at each row against the screenshot." : "")));

    const winnerBox = el("div", "imp-winner");
    function updateWinner() {
      winnerBox.innerHTML = "";
      const sug = winnerSuggestion();
      st.sug = sug || null;
      if (!sug) return;
      const short = function (t) { return t.replace("Team ", ""); };
      const label = el("label", "check");
      const chk = el("input");
      chk.type = "checkbox";
      chk.checked = true;
      chk.id = "imp-result-chk";
      label.appendChild(chk);
      label.appendChild(document.createTextNode(" Set the match result from the pictures: " + short(sug.teamA) + " " + sug.scoreA + " : " + sug.scoreB + " " + short(sug.teamB) +
        " (maps won in " + sug.of + " picture" + (sug.of > 1 ? "s" : "") + ")" +
        (sug.tie ? ". It's level, so set the winner yourself afterwards." : ". The winner is " + short(sug.team) + ".")));
      winnerBox.appendChild(label);
    }
    body.appendChild(winnerBox);

    const matched = st.rows.filter(function (r) { return r.player; });
    const others = st.rows.filter(function (r) { return !r.player; });
    const list = el("div", "imp-list");
    if (matched.length) list.appendChild(el("div", "imp-label", "Matched to your players (" + matched.length + ")"));
    matched.forEach(function (row) { list.appendChild(reviewRow(row, updateWinner)); });
    if (others.length) list.appendChild(el("div", "imp-label", "Not matched, skipped unless you choose a player (" + others.length + ")"));
    others.forEach(function (row) { list.appendChild(reviewRow(row, updateWinner)); });
    body.appendChild(list);
    updateWinner();

    const addLabel = el("label", "check");
    const add = el("input");
    add.type = "checkbox";
    add.id = "imp-add";
    addLabel.appendChild(add);
    addLabel.appendChild(document.createTextNode(" Add to numbers already entered (instead of replacing them)"));
    body.appendChild(addLabel);

    const msg = el("p", "muted", "");
    msg.id = "imp-msg";
    body.appendChild(msg);

    const actions = el("div", "dialog-actions");
    const apply = el("button", "", "Apply to stage");
    apply.type = "button";
    apply.addEventListener("click", applyRows);
    const back = el("button", "outline", "Back");
    back.type = "button";
    back.addEventListener("click", renderPick);
    actions.appendChild(apply);
    actions.appendChild(back);
    body.appendChild(actions);
  }

  function applyRows() {
    const round = rounds[window.AdminAPI.roundIndex()];
    const add = $("imp-add").checked;
    const byPlayer = new Map();
    st.rows.forEach(function (r) {
      if (!r.player) return;
      const cur = byPlayer.get(r.player.id) || { k: 0, d: 0, a: 0, sk: 0, hill: 0, mvp: false };
      cur.k += r.k; cur.d += r.d; cur.a += r.a; cur.sk += r.sk || 0; cur.hill += r.hill || 0; cur.mvp = cur.mvp || r.mvp;
      byPlayer.set(r.player.id, cur);
    });
    if (!byPlayer.size) { message("No players are matched yet. Choose who each row is, or press Back.", true); return; }
    byPlayer.forEach(function (v, id) {
      const old = round.stats[id];
      const s = { kills: v.k, deaths: v.d, assists: v.a, mvp: v.mvp };
      if (v.sk) s.sndKills = Math.min(v.sk, v.k);
      if (v.hill) s.hillTime = v.hill;
      if (add && old) {
        s.kills += old.kills; s.deaths += old.deaths; s.assists += old.assists; s.mvp = s.mvp || old.mvp;
        if (old.sndKills) s.sndKills = (s.sndKills || 0) + old.sndKills;
        if (old.hillTime) s.hillTime = (s.hillTime || 0) + old.hillTime;
      }
      round.stats[id] = s;
    });
    st.rows.forEach(function (r) { if (r.player) learnAlias(r.player, r.raw); });
    const chk = $("imp-result-chk");
    if (chk && chk.checked && st.sug) {
      const m = round.matches[st.sug.matchIdx];
      let a = st.sug.scoreA, b = st.sug.scoreB;
      if (add && typeof m.scoreA === "number" && typeof m.scoreB === "number") { a += m.scoreA; b += m.scoreB; }
      m.scoreA = a;
      m.scoreB = b;
      if (a !== b) m.winner = a > b ? m.teamA : m.teamB;
    }
    window.AdminAPI.markDirty();
    window.AdminAPI.refresh();
    close();
  }

  window.openScreenshotImport = open;
})();