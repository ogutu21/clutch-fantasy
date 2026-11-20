// Rules panel (Phase 9): a "How scoring and rules work" box at the bottom of the Home tab.
// It reads the numbers from script.js, so it always matches what the game really does.
(function () {
  "use strict";

  const pane = document.querySelector('[data-pane="home"]');
  if (!pane) return;

  const box = document.createElement("details");
  box.className = "rules";
  box.id = "rules-box";
  const summary = document.createElement("summary");
  summary.textContent = "How scoring and rules work";
  box.appendChild(summary);
  const body = document.createElement("div");
  body.className = "rules-body";
  box.appendChild(body);
  pane.appendChild(box);

  function section(title, items) {
    const h = document.createElement("h3");
    h.textContent = title;
    body.appendChild(h);
    const ul = document.createElement("ul");
    items.forEach(function (t) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  function fill() {
    if (typeof CHIPS === "undefined" || typeof LINEUP === "undefined") return;
    body.innerHTML = "";

    const fmt = function (n) { return (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n); };
    const points = [
      "Each kill: " + fmt(SCORING.kill),
      "Each Search & Destroy kill: " + fmt(SCORING.kill + SCORING.sndKillBonus) + " (a bonus on top of the normal kill)",
      "Each assist: " + fmt(SCORING.assist),
      "Each death: " + fmt(-SCORING.death),
      "Hardpoint: " + fmt(SCORING.hillPer30s) + " for every 30 seconds on the hill",
      "Search & Destroy: " + fmt(SCORING.bomb) + " for each bomb planted or defused",
      "Each map your team wins in its match: " + fmt(SCORING.mapWin),
      "Your player's team wins the match: " + fmt(SCORING.win),
      "MVP: " + fmt(SCORING.mvp),
    ];
    if (STANDARD_MAPS) {
      points.push("Series length: kills, assists and deaths are adjusted so a series of any length counts like a " + STANDARD_MAPS + "-map series. The win and MVP bonuses stay the same.");
    }
    section("Points", points);

    section("Your squad", [
      SQUAD_SIZE + " players: " + STARTERS + " starters and 1 sub",
      "Budget " + STARTING_BUDGET.toFixed(1) + ", and at most " + MAX_PER_TEAM + " players from one team",
      "Starting five: " + lineupText() + " (roles: AR, SMG, Marksman, Sniper)",
      "Captain scores x2. If the captain doesn't play, the vice-captain gets it instead",
      "If a starter doesn't play, your sub steps in as long as the lineup stays valid",
      "Squads lock at each stage's deadline",
      "Tie-break: players level on points are ordered by points in the latest stage, then the stage before it, and so on. Players still level after that share a rank",
    ].concat(TEAM_SLOT ? ["Team slot: also back one whole team each stage. " + fmt(SCORING.teamWin) + " if it wins its match, " + fmt(SCORING.teamMap) + " for each map it wins. Free to change every stage."] : []));

    section("Transfers and prices", [
      FREE_TRANSFERS + " free transfers each stage (some stages give a different number, shown on the stage), then -" + TRANSFER_HIT + " points for each extra one",
      "If a player's price rises after you buy him, you keep half the profit when you sell (in steps of 0.5). If it falls, you get the lower price",
    ]);

    section("Chips (each can be used once)", CHIPS.map(function (c) { return c.name + ": " + c.info; }));
  }

  fill();

  // script.js calls renderHome() after every redraw; piggy-back on that so the text follows the tournament's settings.
  const previous = window.renderHome;
  window.renderHome = function () {
    if (typeof previous === "function") previous();
    fill();
  };
})();