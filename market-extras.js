// Market extras (Phase 7): an "In squad" badge on the players you've picked, what each one would sell for,
// and a small up or down arrow next to a price that has changed. It only decorates the market cards.
(function () {
  "use strict";

  const list = document.getElementById("player-list");
  if (!list) return;

  function decorate() {
    if (typeof currentSquad !== "function") return;
    const sq = currentSquad();
    list.querySelectorAll(".pcard[data-pid]").forEach(function (card) {
      const p = playerById(Number(card.dataset.pid));
      if (!p) return;

      const teamLine = card.querySelector(".pcard-team");
      const price = card.querySelector(".pcard-price");
      if (teamLine && sq.players.includes(p.id) && !card.querySelector(".in-squad")) {
        const badge = document.createElement("span");
        badge.className = "in-squad";
        badge.textContent = "In squad";
        teamLine.appendChild(badge);
      }

      const own = typeof ownershipOf === "function" ? ownershipOf(p.id, currentRound) : null;
      if (own !== null && teamLine && !card.querySelector(".own-pct")) {
        const o = document.createElement("span");
        o.className = "own-pct";
        o.textContent = "Owned " + own + "%";
        o.title = "Share of squads that own this player";
        teamLine.appendChild(o);
      }

      const info = sellInfo(sq, p);
      if (info && !card.querySelector(".sell-line")) {
        const bought = sq.buy[p.id];
        const line = document.createElement("div");
        line.className = "sell-line";
        line.textContent = info + (bought !== p.price ? " \u00b7 paid " + bought.toFixed(1) : "");
        const stats = card.querySelector(".pcard-stats");
        if (stats) stats.parentNode.insertBefore(line, stats.nextSibling);
      }

      if (price && typeof p.prevPrice === "number" && p.prevPrice !== p.price && !price.querySelector(".pchg")) {
        const d = p.price - p.prevPrice;
        const s = document.createElement("span");
        s.className = "pchg " + (d > 0 ? "up" : "down");
        s.textContent = (d > 0 ? "\u25B2" : "\u25BC") + Math.abs(d).toFixed(1);
        s.title = "Was " + p.prevPrice.toFixed(1);
        price.appendChild(s);
      }
    });
  }

  // The market list is rebuilt on every search, sort and squad change, so decorate again each time.
  new MutationObserver(decorate).observe(list, { childList: true });
  window.addEventListener("load", decorate);
})();