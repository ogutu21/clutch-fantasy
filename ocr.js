// Free scoreboard reader (Phase 5c): reads a Call of Duty: Mobile "Detail Report" screenshot
// inside the browser with Tesseract.js. No account, no key, no cost. The first use downloads the
// reader (about 10 MB, then it is cached by the browser).
// It returns the same shape of result as the Claude reader in import.js.
(function () {
  "use strict";

  const W = 1600;   // every screenshot is scaled to this width first, so the measurements below are the same for any phone
  const SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  let workerPromise = null;
  let onProgress = null;

  function cfg() { return window.TESSERACT_CONFIG || {}; }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (window.Tesseract) { resolve(); return; }
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't download the free reader. Check your internet connection.")); };
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async function () {
        await loadScript(cfg().scriptUrl || SCRIPT);
        const opts = {
          logger: function (m) { if (onProgress && m && m.status) onProgress({ stage: "load", status: m.status, progress: m.progress || 0 }); },
        };
        ["workerPath", "corePath", "langPath"].forEach(function (k) { if (cfg()[k]) opts[k] = cfg()[k]; });
        if (cfg().gzip === false) opts.gzip = false;
        return await window.Tesseract.createWorker("eng", 1, opts);
      })().catch(function (e) {
        workerPromise = null;
        throw e;
      });
    }
    return workerPromise;
  }

  async function recognize(worker, canvas, params) {
    await worker.setParameters(params);
    const res = await worker.recognize(canvas);
    return res.data;
  }

  const SPARSE = { tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" };
  const LINE_DIGITS = { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789/" };
  const LINE_SCORE = { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789:" };
  const LINE_TIME = { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789:" };
  const BLOCK_TEXT = { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" };
  const LINE_TEXT = { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "" };

  // ---- Pictures ---------------------------------------------------------------

  async function loadBase(file) {
    const bmp = await createImageBitmap(file);
    if (bmp.height > bmp.width) throw new Error("That picture is upright. Use the landscape scoreboard screenshot.");
    const base = document.createElement("canvas");
    base.width = W;
    base.height = Math.round(bmp.height * (W / bmp.width));
    const ctx = base.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, base.width, base.height);
    return base;
  }

  // Cut out a box, enlarge it, turn it grey, and optionally stretch the contrast and invert it.
  function region(base, x0, y0, x1, y1, k, opts) {
    x0 = Math.max(0, Math.round(x0));
    y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(base.width, Math.round(x1));
    y1 = Math.min(base.height, Math.round(y1));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const c = document.createElement("canvas");
    c.width = w * k;
    c.height = h * k;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, x0, y0, w, h, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = g;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    if ((opts.contrast || opts.invert) && hi > lo) {
      const scale = opts.contrast ? 255 / (hi - lo) : 1;
      const off = opts.contrast ? lo : 0;
      for (let i = 0; i < d.length; i += 4) {
        let v = (d[i] - off) * scale;
        if (opts.invert) v = 255 - v;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const READ = { contrast: true, invert: true };

  // ---- Finding the layout ---------------------------------------------------------

  function wordsOf(data) {
    if (data.words) return data.words;
    const out = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); });
      });
    });
    return out;
  }

  // The tables have a blue and a red header bar. Their left and right edges tell us where the columns are.
  function findTables(base, firstRowY, pitch) {
    const fallback = { left: [0.011 * W, 0.5 * W], right: [0.501 * W, 0.989 * W] };
    try {
      const yc = Math.round(firstRowY - pitch);
      const y0 = Math.max(0, yc - 8), y1 = Math.min(base.height, yc + 8);
      const ctx = base.getContext("2d", { willReadFrequently: true });
      const d = ctx.getImageData(0, y0, W, y1 - y0).data;
      const rows = y1 - y0;
      function extent(test) {
        let min = -1, max = -1;
        for (let x = 0; x < W; x++) {
          let hits = 0;
          for (let r = 0; r < rows; r++) {
            const i = (r * W + x) * 4;
            if (test(d[i], d[i + 1], d[i + 2])) hits++;
          }
          if (hits >= Math.max(3, rows / 3)) { if (min < 0) min = x; max = x; }
        }
        return min < 0 ? null : [min, max];
      }
      const blue = extent(function (r, g, b) { return b > 140 && r < 120 && b - r > 50; });
      const red = extent(function (r, g, b) { return r > 130 && g < 120 && r - b > 40; });
      const ok = function (e) { return e && e[1] - e[0] > 0.3 * W && e[1] - e[0] < 0.55 * W; };
      if (ok(blue) && ok(red)) return { left: blue, right: red };
    } catch (e) { /* use the fallback */ }
    return fallback;
  }

  function cluster(values, tol) {
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const groups = [];
    sorted.forEach(function (v) {
      const g = groups[groups.length - 1];
      if (g && v - g[g.length - 1] <= tol) g.push(v); else groups.push([v]);
    });
    return groups.map(function (g) { return g.reduce(function (a, b) { return a + b; }, 0) / g.length; });
  }

  function cleanName(t) {
    const parts = String(t || "").replace(/[\r\n]+/g, " ").trim().split(/\s+/).filter(Boolean);
    // small bits at the end are usually the little icons next to the name
    while (parts.length > 1 && parts[parts.length - 1].replace(/[^A-Za-z0-9]/g, "").length <= 2) parts.pop();
    return parts.join(" ").replace(/^[^A-Za-z0-9\[\(]+/, "").replace(/[^A-Za-z0-9\]\)]+$/, "");
  }

  function parseKda(text) {
    const m = /^(\d{1,3})\/(\d{1,3})\/(\d{1,3})$/.exec(String(text || "").replace(/[^0-9/]/g, ""));
    return m ? { kills: +m[1], deaths: +m[2], assists: +m[3] } : null;
  }

  // "00:48" -> 48, "1:09" -> 69. Returns null if it doesn't look like a time.
  function parseTime(text) {
    const t = String(text || "").replace(/[^0-9:]/g, "");
    let m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) { m = /^(\d{1,2})(\d{2})$/.exec(t); }   // the colon was missed: "0048"
    if (!m) return null;
    const mins = +m[1], secs = +m[2];
    return secs < 60 && mins < 20 ? mins * 60 + secs : null;
  }

  // The line under the date at the top left says the mode and the map, e.g. "HARDPOINT NUKETOWN".
  const MODES = [
    [/HARDPOINT|HARD\s*POINT/i, "Hardpoint"],
    [/SEARCH\s*(&|AND|8)?\s*DESTROY/i, "Search & Destroy"],
    [/CONTROL/i, "Control"],
    [/DOMINATION/i, "Domination"],
    [/FRONTLINE/i, "Frontline"],
  ];
  function parseModeLine(text) {
    const lines = String(text || "").split(/[\r\n]+/);
    for (const line of lines) {
      for (const m of MODES) {
        const hit = m[0].exec(line);
        if (hit) {
          const map = line.slice(hit.index + hit[0].length).replace(/[^A-Za-z0-9 '\-]/g, " ").replace(/\s+/g, " ").trim();
          return { mode: m[1], map: map || null };
        }
      }
    }
    return { mode: null, map: null };
  }

  // ---- Reading one screenshot --------------------------------------------------------

  async function read(file, progress) {
    onProgress = progress || null;
    const worker = await getWorker();
    const base = await loadBase(file);
    const H = base.height;

    function step(text) { if (onProgress) onProgress({ stage: "read", text: text }); }

    // 1. Where are the K/D/A numbers? They are easy to spot, and tell us where every row is.
    step("Finding the scoreboard...");
    const first = await recognize(worker, region(base, 0, 0, W, H, 2, {}), SPARSE);
    const words = wordsOf(first).map(function (w) {
      return { text: String(w.text || "").trim(), x0: w.bbox.x0 / 2, y0: w.bbox.y0 / 2, x1: w.bbox.x1 / 2, y1: w.bbox.y1 / 2 };
    });
    const kdaWords = words.filter(function (w) {
      return /\/\d{1,3}\/\d{1,3}$/.test(w.text) || /^\d{1,3}\/\d{1,3}\/\S{1,3}$/.test(w.text);
    });
    if (kdaWords.length < 2) throw new Error("Couldn't find a scoreboard in that picture. Use the full Detail Report screenshot.");

    const mid = W / 2;
    const side = { left: [], right: [] };
    kdaWords.forEach(function (w) { ((w.x0 + w.x1) / 2 < mid ? side.left : side.right).push(w); });

    // 2. The rows: one y position per player row, shared by both teams.
    let rowYs = cluster(kdaWords.map(function (w) { return (w.y0 + w.y1) / 2; }), 0.02 * W);
    let pitch = 0.0453 * W;
    if (rowYs.length > 1) {
      const diffs = [];
      for (let i = 1; i < rowYs.length; i++) diffs.push(rowYs[i] - rowYs[i - 1]);
      diffs.sort(function (a, b) { return a - b; });
      pitch = diffs[0] > 0.03 * W ? diffs[0] : pitch;   // the smallest gap is one row
    }
    // fill gaps where a whole row was missed
    const filled = [rowYs[0]];
    for (let i = 1; i < rowYs.length; i++) {
      const gap = Math.round((rowYs[i] - rowYs[i - 1]) / pitch);
      for (let g = 1; g < gap; g++) filled.push(rowYs[i - 1] + g * pitch);
      filled.push(rowYs[i]);
    }
    rowYs = filled.slice(0, 6);

    // 3. Table edges and the K/D/A column of each team.
    const tables = findTables(base, rowYs[0], pitch);
    function kdaBounds(list) {
      if (!list.length) return null;
      const centers = list.map(function (w) { return (w.x0 + w.x1) / 2; });
      const c = centers.reduce(function (a, b) { return a + b; }, 0) / centers.length;
      const half = Math.max(0.035 * W, Math.max.apply(null, list.map(function (w) { return (w.x1 - w.x0) / 2; })) + 0.008 * W);
      return [c - half, c + half];
    }
    const kdaCols = { left: kdaBounds(side.left), right: kdaBounds(side.right) };

    // 4. Result at the top left.
    let result = null, scoreLeft = null, scoreRight = null;
    const verdict = words.find(function (w) { return /^(VICTORY|DEFEAT|DRAW)/i.test(w.text) && w.y1 < 0.3 * H; });
    if (verdict) {
      result = /^VICTORY/i.test(verdict.text) ? "VICTORY" : /^DEFEAT/i.test(verdict.text) ? "DEFEAT" : "DRAW";
      step("Reading the result...");
      const sc = await recognize(worker, region(base, verdict.x1 + 6, verdict.y0 - 10, verdict.x1 + 0.17 * W, verdict.y1 + 10, 3, READ), LINE_SCORE);
      const m = /(\d{1,3})\s*:\s*(\d{1,3})/.exec(String(sc.text || ""));
      if (m) {
        const a = +m[1], b = +m[2];
        const consistent = (result === "VICTORY" && a > b) || (result === "DEFEAT" && a < b) || (result === "DRAW" && a === b);
        if (consistent) { scoreLeft = a; scoreRight = b; }
      }
    }

    // 4b. Mode and map (the line under the date).
    let mode = null, map = null;
    try {
      step("Reading the mode...");
      const top = verdict ? verdict.y1 + 0.012 * W : 0.078 * W;
      const md = await recognize(worker, region(base, 8, top, 0.27 * W, top + 0.05 * W, 3, READ), BLOCK_TEXT);
      const pm = parseModeLine(md.text);
      mode = pm.mode;
      map = pm.map;
    } catch (e) { /* the mode can still be chosen by hand */ }
    // The TIME column (time on the hill) exists only in Hardpoint. Without a readable mode, try it and keep it only if it looks like times.
    const tryTime = mode ? /hardpoint/i.test(mode) : true;

    // 5. Each row, each team: name, numbers and MVP badge.
    const out = { left: [], right: [] };
    const baseCtx = base.getContext("2d", { willReadFrequently: true });
    for (let i = 0; i < rowYs.length; i++) {
      const y = rowYs[i];
      for (const sideName of ["left", "right"]) {
        const tbl = tables[sideName];
        const tw = tbl[1] - tbl[0];
        step("Reading " + (sideName === "left" ? "left" : "right") + " team, player " + (i + 1) + " of " + rowYs.length + "...");

        // numbers
        let kda = null;
        const col = kdaCols[sideName];
        if (col) {
          const d = await recognize(worker, region(base, col[0], y - 20, col[1], y + 20, 4, READ), LINE_DIGITS);
          kda = parseKda(d.text);
        }
        if (!kda) {
          const near = side[sideName].find(function (w) { return Math.abs((w.y0 + w.y1) / 2 - y) < pitch / 3; });
          if (near) kda = parseKda(near.text);
        }
        if (!kda && !(side[sideName].some(function (w) { return Math.abs((w.y0 + w.y1) / 2 - y) < pitch / 3; }))) continue;   // no player on this row

        // time on the hill (Hardpoint): the column sits to the right of K/D/A
        let hillTime = null;
        if (tryTime && col) {
          const tc = (col[0] + col[1]) / 2 + 0.0615 * W;
          const td = await recognize(worker, region(base, tc - 0.032 * W, y - 18, tc + 0.032 * W, y + 18, 4, READ), LINE_TIME);
          hillTime = parseTime(td.text);
        }

        // name
        const nd = await recognize(worker, region(base, tbl[0] + 0.172 * tw, y - 30, tbl[0] + 0.325 * tw, y + 1, 4, READ), LINE_TEXT);
        const name = cleanName(nd.text);

        // MVP badge: a bright label above the name, right next to it
        const bx0 = Math.round(tbl[0] + 0.335 * tw), bx1 = Math.round(tbl[0] + 0.40 * tw);
        const by0 = Math.round(y - 32), by1 = Math.round(y - 14);
        const px = baseCtx.getImageData(bx0, by0, Math.max(1, bx1 - bx0), Math.max(1, by1 - by0)).data;
        let bright = 0;
        for (let p = 0; p < px.length; p += 4) {
          if ((px[p] + px[p + 1] + px[p + 2]) / 3 > 115) bright++;
        }
        const mvp = bright / (px.length / 4) > 0.25;

        out[sideName].push({
          name: name || ("Player " + (i + 1)),
          kills: kda ? kda.kills : 0,
          deaths: kda ? kda.deaths : 0,
          assists: kda ? kda.assists : 0,
          mvp: mvp,
          hillTime: hillTime,
          unsure: !kda || !name || (mode && /hardpoint/i.test(mode) && hillTime === null),
        });
      }
    }
    if (!out.left.length && !out.right.length) throw new Error("Couldn't read any players from that picture.");
    // With no readable mode, keep the times only if most rows gave a real time (otherwise it was just noise).
    if (!mode) {
      const all = out.left.concat(out.right);
      const good = all.filter(function (r) { return r.hillTime !== null; }).length;
      if (good < Math.max(3, all.length * 0.6)) all.forEach(function (r) { r.hillTime = null; });
    }
    return { result: result, scoreLeft: scoreLeft, scoreRight: scoreRight, mode: mode, map: map, left: out.left, right: out.right, source: "ocr" };
  }

  window.ScoreboardOCR = { read: read, parseTime: parseTime, parseModeLine: parseModeLine };
})();