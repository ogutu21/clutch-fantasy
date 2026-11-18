// Share squad picture (Phase 6): draws your squad for the open stage as a picture
// (4:5, ready for WhatsApp, X or Instagram) and lets you share or download it.
// It only reads the game state from script.js; it never changes the game.
(function () {
  "use strict";

  const W = 1080, H = 1350;
  const C = {
    bg: "#07080c", panel: "#0f121a", line: "#242a3b",
    accent: "#22e5ff", violet: "#9b5cff", text: "#e9edf7", muted: "#8a93a8",
    ar: "#3dffa0", smg: "#ff4d6d", lmg: "#4da3ff", shotgun: "#ff7a2e", marksman: "#ffb02e", sniper: "#9b5cff",
  };
  const HEAD = '"Space Grotesk","Segoe UI",Arial,sans-serif';
  const BODY = 'Inter,"Segoe UI",Arial,sans-serif';
  const ROLE_ORDER = ["sniper", "marksman", "lmg", "shotgun", "smg", "ar"];

  let me = null;       // signed-in player { uid, name }, or null
  let dlg = null;
  let blob = null;
  let objectUrl = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- Drawing helpers ------------------------------------------------------

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spacing(ctx, px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }

  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "\u2026").width > maxW) t = t.slice(0, -1);
    return t + "\u2026";
  }

  function text(ctx, str, x, y, font, color, opts) {
    opts = opts || {};
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    spacing(ctx, opts.spacing || 0);
    const out = opts.maxW ? fit(ctx, str, opts.maxW) : str;
    ctx.fillText(out, x, y);
    spacing(ctx, 0);
  }

  function initials(name) {
    return String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  }

  // ---- The picture --------------------------------------------------------------

  function background(ctx) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // soft light behind the pitch
    const g = ctx.createRadialGradient(W / 2, 650, 40, W / 2, 650, 620);
    g.addColorStop(0, "rgba(155,92,255,0.20)");
    g.addColorStop(1, "rgba(155,92,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W - 40, 250, 20, W - 40, 250, 520);
    g2.addColorStop(0, "rgba(34,229,255,0.14)");
    g2.addColorStop(1, "rgba(34,229,255,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    // faint grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // glowing edge bars
    const left = ctx.createLinearGradient(0, 170, 0, 620);
    left.addColorStop(0, "rgba(155,92,255,0)");
    left.addColorStop(0.5, "rgba(155,92,255,0.95)");
    left.addColorStop(1, "rgba(155,92,255,0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 170, 12, 450);
    const right = ctx.createLinearGradient(0, 700, 0, 1080);
    right.addColorStop(0, "rgba(34,229,255,0)");
    right.addColorStop(0.5, "rgba(34,229,255,0.95)");
    right.addColorStop(1, "rgba(34,229,255,0)");
    ctx.fillStyle = right;
    ctx.fillRect(W - 12, 700, 12, 380);
  }

  function header(ctx, ownerName, stageName) {
    // brand mark
    const g = ctx.createLinearGradient(60, 62, 156, 158);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, C.violet);
    ctx.fillStyle = g;
    rr(ctx, 60, 62, 96, 96, 18);
    ctx.fill();
    text(ctx, "CF", 108, 128, "700 48px " + HEAD, "#04121a", { align: "center" });

    text(ctx, "CLUTCH FANTASY", 184, 94, "700 24px " + HEAD, C.accent, { spacing: 7 });
    text(ctx, ownerName.toUpperCase(), 184, 154, "700 66px " + HEAD, C.text, { maxW: 600 });

    // stage pill
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    rr(ctx, 806, 66, 214, 62, 31);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, stageName.toUpperCase(), 913, 107, "700 26px " + HEAD, C.muted, { align: "center", spacing: 4, maxW: 180 });
  }

  function lineupPanel(ctx, stageName) {
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    rr(ctx, 56, 232, 968, 96, 14);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, "STARTING FIVE", 88, 268, "700 20px " + HEAD, C.muted, { spacing: 6 });
    text(ctx, stageName.toUpperCase() + " LINEUP", 88, 308, "700 36px " + HEAD, C.text, { maxW: 880 });
  }

  function card(ctx, x, y, w, h, p, o) {
    const col = o.sub ? C.accent : (C[p.role] || C.muted);
    ctx.save();
    // body
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#1b2132");
    g.addColorStop(1, "#0b0e16");
    ctx.fillStyle = g;
    rr(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = o.sub || o.captain ? C.accent : "rgba(255,255,255,0.14)";
    ctx.lineWidth = o.sub || o.captain ? 3 : 2;
    ctx.stroke();
    // coloured top edge
    ctx.save();
    rr(ctx, x, y, w, h, 16);
    ctx.clip();
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, 7);
    ctx.restore();

    // monogram
    const cx = x + w / 2, cy = y + h * 0.40, r = h * 0.2;
    const mg = ctx.createRadialGradient(cx, cy - r / 2, 4, cx, cy, r * 1.3);
    mg.addColorStop(0, col + "55");
    mg.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    text(ctx, initials(p.name), cx, cy + r * 0.34, "700 " + Math.round(r * 0.9) + "px " + HEAD, C.text, { align: "center" });

    // name and details
    text(ctx, p.name.toUpperCase(), cx, y + h - 50, "700 " + Math.round(h * 0.145) + "px " + HEAD, C.text, { align: "center", maxW: w - 24 });
    const role = (ROLE_LABEL[p.role] || p.role).toUpperCase();
    ctx.font = "600 " + Math.round(h * 0.083) + "px " + BODY;
    spacing(ctx, 1.5);
    const roleW = ctx.measureText(role + " ").width;
    const rest = p.team.replace("Team ", "").toUpperCase();
    const restFit = fit(ctx, rest, w - 24 - roleW);
    const total = roleW + ctx.measureText(restFit).width;
    spacing(ctx, 0);
    const startX = cx - total / 2;
    text(ctx, role, startX, y + h - 18, "600 " + Math.round(h * 0.083) + "px " + BODY, col, { spacing: 1.5 });
    text(ctx, restFit, startX + roleW, y + h - 18, "600 " + Math.round(h * 0.083) + "px " + BODY, C.muted, { spacing: 1.5 });

    // points
    if (o.pts !== null && o.pts !== undefined) {
      text(ctx, o.pts.toFixed(1), x + 14, y + 40, "700 " + Math.round(h * 0.115) + "px " + HEAD, C.accent);
    }
    // badges
    if (o.badge) {
      const bw = o.badge === "SUB" ? 70 : 46;
      ctx.fillStyle = C.accent;
      rr(ctx, x + w - bw - 10, y + 16, bw, 32, 8);
      ctx.fill();
      text(ctx, o.badge, x + w - bw / 2 - 10, y + 40, "700 20px " + HEAD, "#04121a", { align: "center" });
    }
    ctx.restore();
  }

  function pitch(ctx, sq) {
    const starters = startersOf(sq).map(playerById).filter(Boolean).sort(function (a, b) {
      return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    });
    // Always a 2-1-2 layout (fits the picture whatever the roles are); each card shows the player's role.
    const sizes = starters.length >= 5 ? [2, 1, 2] : starters.length === 4 ? [2, 2] : starters.length === 3 ? [2, 1] : [starters.length];
    const rows = [];
    let at = 0;
    sizes.forEach(function (n) { if (n > 0) rows.push(starters.slice(at, at + n)); at += n; });

    if (!rows.length) {
      text(ctx, "NO SQUAD PICKED YET", W / 2, 700, "700 40px " + HEAD, C.muted, { align: "center", spacing: 4 });
      return;
    }
    const cw = 214, ch = 208, gapX = 26, gapY = 26;
    const areaTop = 360, areaH = 3 * ch + 2 * gapY;
    const used = rows.length * ch + (rows.length - 1) * gapY;
    let y = areaTop + (areaH - used) / 2;
    rows.forEach(function (row) {
      const total = row.length * cw + (row.length - 1) * gapX;
      let x = (W - total) / 2;
      row.forEach(function (p) {
        card(ctx, x, y, cw, ch, p, {
          pts: pointsInRound(p.id, currentRound),
          badge: p.id === sq.captain ? "C" : p.id === sq.vice ? "VC" : "",
          captain: p.id === sq.captain,
        });
        x += cw + gapX;
      });
      y += ch + gapY;
    });
  }

  function bottom(ctx, sq, tournamentName) {
    const top = 1072, h = 236;
    // sub
    const sub = sq.sub !== null ? playerById(sq.sub) : null;
    if (sub && sq.players.includes(sub.id)) {
      card(ctx, 56, top, 236, h, sub, { sub: true, badge: "SUB", pts: pointsInRound(sub.id, currentRound) });
    } else {
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      rr(ctx, 56, top, 236, h, 16);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, "NO SUB", 174, top + h / 2 + 8, "700 28px " + HEAD, C.muted, { align: "center", spacing: 3 });
    }

    // points panel
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    rr(ctx, 322, top, 702, h, 18);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    const chip = sq.chip ? CHIPS.find(function (c) { return c.id === sq.chip; }) : null;
    text(ctx, "THE BENCH", 358, top + 46, "700 20px " + HEAD, C.accent, { spacing: 6 });
    text(ctx, chip ? chip.name.toUpperCase() + " PLAYED" : "READY TO SCORE", 358, top + 90, "700 34px " + HEAD, C.text, { maxW: 640 });
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(358, top + 112);
    ctx.lineTo(990, top + 112);
    ctx.stroke();

    const stagePts = roundTotal(currentRound) - hitIn(currentRound);
    text(ctx, "STAGE POINTS", 358, top + 148, "600 19px " + BODY, C.muted, { spacing: 3 });
    text(ctx, stagePts.toFixed(1), 358, top + 212, "700 70px " + HEAD, C.text);
    text(ctx, "TOTAL POINTS", 690, top + 148, "600 19px " + BODY, C.muted, { spacing: 3 });
    text(ctx, totalPoints().toFixed(1), 690, top + 212, "700 70px " + HEAD, C.accent);

    // footer
    text(ctx, tournamentName.toUpperCase(), 56, 1336, "600 18px " + BODY, "rgba(138,147,168,0.7)", { spacing: 4, maxW: 600 });
    text(ctx, "#CLUTCHFANTASY", 1024, 1336, "700 20px " + HEAD, C.muted, { align: "right", spacing: 4 });
  }

  async function render() {
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('700 40px "Space Grotesk"'),
          document.fonts.load('600 20px Inter'),
        ]);
      } catch (e) { /* the fallback fonts are fine */ }
    }
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const sq = currentSquad();
    const stageName = rounds[currentRound].name;
    const tournamentName = tournamentInfo ? tournamentInfo.name : "Practice tournament";
    const owner = me && me.name ? me.name : "My squad";
    background(ctx);
    header(ctx, owner, stageName);
    lineupPanel(ctx, stageName);
    pitch(ctx, sq);
    bottom(ctx, sq, tournamentName);
    return canvas;
  }

  // ---- The dialog -------------------------------------------------------------------

  function toBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
  }

  function fileName() {
    const stage = rounds[currentRound].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "clutch-fantasy-" + (stage || "squad") + ".png";
  }

  function ensureDialog() {
    if (dlg) return;
    dlg = el("dialog");
    dlg.id = "share-dialog";
    dlg.innerHTML = "";
    dlg.appendChild(el("h3", "", "Share your squad"));
    const img = el("img", "share-preview");
    img.id = "share-img";
    img.alt = "Your squad picture";
    dlg.appendChild(img);
    dlg.appendChild(el("p", "muted", ""));
    dlg.lastChild.id = "share-msg";
    const actions = el("div", "dialog-actions");
    const share = el("button", "", "Share");
    share.type = "button";
    share.id = "share-go";
    const down = el("button", "", "Download");
    down.type = "button";
    down.id = "share-down";
    const close = el("button", "outline", "Close");
    close.type = "button";
    actions.appendChild(share);
    actions.appendChild(down);
    actions.appendChild(close);
    dlg.appendChild(actions);
    document.body.appendChild(dlg);

    close.addEventListener("click", closeDialog);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeDialog(); });
    down.addEventListener("click", function () {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    share.addEventListener("click", async function () {
      if (!blob) return;
      const file = new File([blob], fileName(), { type: "image/png" });
      const message = "My Clutch Fantasy squad for " + rounds[currentRound].name + " #ClutchFantasy";
      try {
        await navigator.share({ files: [file], title: "Clutch Fantasy", text: message });
      } catch (e) {
        if (e && e.name !== "AbortError") $msg("Couldn't open sharing. Use Download instead.");
      }
    });
  }

  function $msg(t) { const m = document.getElementById("share-msg"); if (m) m.textContent = t || ""; }

  function closeDialog() {
    if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    blob = null;
  }

  async function open() {
    ensureDialog();
    $msg("Drawing your picture...");
    document.getElementById("share-img").removeAttribute("src");
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
    try {
      const canvas = await render();
      blob = await toBlob(canvas);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      document.getElementById("share-img").src = objectUrl;
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], "x.png", { type: "image/png" })] }));
      document.getElementById("share-go").style.display = canShare ? "" : "none";
      $msg(canShare ? "Tap Share to post it, or Download to save it." : "Tap Download to save it, then post it anywhere.");
    } catch (e) {
      console.error("Share picture:", e);
      $msg("Couldn't draw the picture. Try again.");
    }
  }

  window.addEventListener("load", function () {
    const btn = document.getElementById("share-btn");
    if (btn) btn.addEventListener("click", open);
    if (window.Cloud) window.Cloud.onAuth(function (u) { me = u; });
  });
})();