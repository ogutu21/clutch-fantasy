// Budget: cheapest 6 cost ~38.5, an average 6 cost ~47.4, so 48 forces trade-offs.
let STARTING_BUDGET = 48.0;   // a tournament can set its own (see applyTournament)
let FORMAT = "league";        // "league" (matchweeks and a table) or "bracket" (knockout rounds)
let STANDARD_MAPS = 0;        // 0 = off. Otherwise kills, assists and deaths are scaled to a series of this many maps
const SQUAD_SIZE = 6;      // 5 starters + 1 sub
const STARTERS = 5;

// Roles. Older tournaments used slayer / anchor / obj; they are converted when loaded (see applyTournament).
// The six weapon-class roles of the 2026 esports ruleset.
const ROLES = ["ar", "smg", "lmg", "shotgun", "marksman", "sniper"];
const LEGACY_ROLE = { slayer: "smg", anchor: "ar", obj: "ar" };

// Lineup rules for the starting five: the fewest and most players of each role.
// A tournament can change these (settings.lineup); these are the defaults.
const DEFAULT_LINEUP = {
  // Follows each team's role pool in the ruleset: 3 AR, 3 SMG, 1 LMG, 1 Shotgun, 1 Marksman, 1 Sniper.
  min: { ar: 1, smg: 1, lmg: 0, shotgun: 0, marksman: 0, sniper: 0 },
  max: { ar: 3, smg: 3, lmg: 1, shotgun: 1, marksman: 1, sniper: 1 },
};
let LINEUP = JSON.parse(JSON.stringify(DEFAULT_LINEUP));

// How points are earned. A tournament can change these (settings.scoring); these are the defaults.
//   kill / assist / death: points per kill, assist, death
//   sndKillBonus: extra points for each kill made in Search & Destroy (so an S&D kill is worth kill + this)
//   hillPer30s: points for every 30 seconds spent on the hill (Hardpoint)
//   bomb: points for each bomb planted or defused (Search & Destroy)
//   mapWin: points for every map your player's team wins in its match (on top of the match win)
//   teamWin / teamMap: for the optional Team slot, points when the picked team wins its match / for each map it wins
const DEFAULT_SCORING = { kill: 1, assist: 0.5, death: 0.5, sndKillBonus: 0.5, hillPer30s: 1.5, bomb: 1.5, mapWin: 1, win: 3, mvp: 3, teamWin: 6, teamMap: 1 };
let SCORING = Object.assign({}, DEFAULT_SCORING);

// Optional Team slot (a tournament turns it on with settings.teamSlot): besides the six players, you back one whole team.
let TEAM_SLOT = false;

// Team logos chosen by the organiser: { "Team name": look }. See avatars.js for what a look is.
let TEAM_LOGOS = {};
function teamLogoEl(team, size) {
  return Avatars.make(TEAM_LOGOS[team] || "", team, size);
}
function playerAvatarEl(p, size) {
  return Avatars.make(p.avatar || "", p.name, size);
}

// Ownership: what share of squads own each player, worked out by the organiser when results are published.
// { n: [squads counted per stage], own: [ { playerId: percent } per stage ] } or null if not published yet.
let OWNERSHIP = null;
function setOwnership(o) {
  OWNERSHIP = o && Array.isArray(o.own) ? o : null;
}
// Percent of squads that own player id in stage r (the latest stage that has data if r has none), or null.
function ownershipOf(id, r) {
  if (!OWNERSHIP) return null;
  let at = Math.min(r, OWNERSHIP.own.length - 1);
  while (at > 0 && !(OWNERSHIP.n && OWNERSHIP.n[at])) at--;
  if (at < 0 || !OWNERSHIP.n || !OWNERSHIP.n[at]) return null;
  const v = OWNERSHIP.own[at] && OWNERSHIP.own[at][id];
  return typeof v === "number" ? v : 0;
}

function countRoles(ids) {
  const counts = { ar: 0, smg: 0, lmg: 0, shotgun: 0, marksman: 0, sniper: 0 };
  for (const id of ids) {
    const p = players.find(function (x) { return x.id === id; });
    if (p && counts[p.role] !== undefined) counts[p.role]++;
  }
  return counts;
}

// Score limits of one map in the 2026 ruleset. Hardpoint ends at 250 points (or at the time limit),
// Control at 3 rounds, Search & Destroy at 9 rounds (overtime can go on to 20).
const SCORE_LIMITS = { hp: { max: 250, name: "Hardpoint" }, ctl: { max: 3, name: "Control" }, snd: { max: 20, normal: 9, name: "Search & Destroy" } };

// What is wrong with a map's typed score, or null if it looks fine (or isn't entered yet).
function gameScoreProblem(g) {
  if (!g || typeof g.scoreA !== "number" || typeof g.scoreB !== "number") return null;
  const lim = SCORE_LIMITS[g.mode];
  if (g.scoreA === g.scoreB) return "a map can't end in a tie";
  if (lim && (g.scoreA > lim.max || g.scoreB > lim.max)) return lim.name + " scores can't go above " + lim.max;
  return null;
}

// Maps each team won, from the typed map scores. Returns null unless every map has a score.
function seriesFromGames(m) {
  if (!m || !Array.isArray(m.games) || !m.games.length) return null;
  let a = 0, b = 0;
  for (const g of m.games) {
    if (typeof g.scoreA !== "number" || typeof g.scoreB !== "number" || g.scoreA === g.scoreB) return null;
    if (g.scoreA > g.scoreB) a++; else b++;
  }
  return { a: a, b: b };
}

// What is missing from a squad (used by the Home banner, the leave-page check and the organiser's list).
// Returns a list of short phrases; empty means the squad is ready. Budget is checked separately, since it depends on the stage being open.
function squadIssues(sq) {
  const out = [];
  if (!sq || !Array.isArray(sq.players) || sq.players.length === 0) return ["no squad picked"];
  if (sq.players.length < SQUAD_SIZE) {
    out.push(sq.players.length + " of " + SQUAD_SIZE + " players picked");
  } else if (!sq.sub || sq.players.indexOf(sq.sub) === -1) {
    out.push("no sub picked");
  } else if (!isValidStarting(startersOf(sq))) {
    out.push("starting five breaks the lineup rules (" + lineupText() + ")");
  }
  if (TEAM_SLOT && !sq.team) out.push("no Team slot picked");
  return out;
}

// The roles a player can fill: their main role, plus an optional second one (the 2026 ruleset gives every player two).
function rolesOf(p) {
  const out = [p.role];
  if (p.role2 && p.role2 !== p.role && ROLES.includes(p.role2)) out.push(p.role2);
  return out;
}
function roleText(p) {
  return rolesOf(p).map(function (r) { return ROLE_LABEL[r]; }).join(" / ");
}

// A starting five is valid if each player can be given one of their roles so the lineup limits hold.
function isValidStarting(ids) {
  if (ids.length !== STARTERS) return false;
  const list = ids.map(playerById);
  if (list.some(function (p) { return !p; })) return false;
  function fits(i, counts) {
    if (i === list.length) {
      return ROLES.every(function (r) { return counts[r] >= LINEUP.min[r] && counts[r] <= LINEUP.max[r]; });
    }
    const options = rolesOf(list[i]);
    for (const r of options) {
      if (counts[r] + 1 > LINEUP.max[r]) continue;
      counts[r]++;
      const ok = fits(i + 1, counts);
      counts[r]--;
      if (ok) return true;
    }
    return false;
  }
  const counts = {};
  ROLES.forEach(function (r) { counts[r] = 0; });
  return fits(0, counts);
}

// The lineup rule in words, for messages and the rules panel.
function lineupText() {
  const bits = [];
  ROLES.forEach(function (r) {
    const lo = LINEUP.min[r], hi = LINEUP.max[r];
    if (hi === 0) return;
    if (lo === hi) bits.push("exactly " + lo + " " + ROLE_LABEL[r]);
    else if (lo > 0) bits.push(lo + "-" + hi + " " + ROLE_LABEL[r]);
    else bits.push("up to " + hi + " " + ROLE_LABEL[r]);
  });
  return bits.join(", ");
}

function startersOf(sq) {
  return sq.players.filter(function (id) { return id !== sq.sub; });
}

function setSub(id) {
  const sq = currentSquad();
  if (isLocked(currentRound)) return;
  if (!sq.players.includes(id)) return;
  if (sq.captain === id) sq.captain = null;
  if (sq.vice === id) sq.vice = null;
  sq.sub = id;
  render();
}

// Stage types. The organiser picks one for each stage; a stage can also override the free transfers and add budget.
const STAGE_TYPES = {
  group: "Group stage",
  playoffs: "Playoffs",
  knockout: "Knockout",
  final: "Final",
};

function stageTypeName(r) {
  const t = rounds[r] && rounds[r].type;
  return STAGE_TYPES[t] || "";
}

// Free transfers in stage r: the stage's own number if the organiser set one, otherwise the usual two.
function freeTransfersIn(r) {
  const v = rounds[r] && rounds[r].freeTransfers;
  return typeof v === "number" && v >= 0 ? v : FREE_TRANSFERS;
}

// Extra budget a stage gives you when you move on to it (for example before the playoffs).
function budgetBonusIn(r) {
  const v = rounds[r] && rounds[r].budgetBonus;
  return typeof v === "number" && v > 0 ? v : 0;
}

const MAX_PER_TEAM = 3;
const FREE_TRANSFERS = 2;   // free transfers each round
const TRANSFER_HIT = 4;     // points lost per transfer beyond the free ones

// Chips: one use each over the tournament, one chip per round.
const CHIPS = [
  { id: "wildcard",      name: "Wildcard",       info: "Unlimited free transfers this round. Changes are permanent." },
  { id: "freehit",       name: "Free Hit",       info: "Unlimited free transfers this round, then your squad reverts next round. Not in Round 1." },
  { id: "triplecaptain", name: "Triple Captain", info: "Your captain scores x3 instead of x2." },
  { id: "benchboost",    name: "Bench Boost",    info: "Your sub's points count this round." },
  { id: "maxcaptain",    name: "Max Captain",    info: "Your best scorer this round gets the captain bonus automatically (x2)." },
  { id: "twelfth",       name: "12th Man",       info: "Pick one extra player (any team, any price). Their points count this round." },
];

let currentRound = 0;
let view = "pitch";        // "pitch" or "list"
let roleFilter = "all";    // "all", or one of ROLES

const ROLE_LABEL = { ar: "AR", smg: "SMG", lmg: "LMG", shotgun: "Shotgun", marksman: "Marksman", sniper: "Sniper" };
const ROW_LABEL = { sniper: "Long range", marksman: "Mid range", lmg: "Support", shotgun: "Close quarters", smg: "Rush", ar: "All-round" };

// Which tournament this page is showing: index.html?t=TOURNAMENT_ID.
// No "t" means the home page. "demo" is the practice tournament built from data.js.
const TID = new URLSearchParams(location.search).get("t");
const STORAGE_KEY = "clutch-squads-" + (TID || "demo");
let tournamentInfo = null;   // { id, name, status } once loaded from the cloud

function setTournamentInfo(info) { tournamentInfo = info; }

function blankSquad() {
  return { players: [], captain: null, vice: null, sub: null, chip: null, team: null };
}

const squads = rounds.map(blankSquad);

// Keep one squad per stage: add blank ones for new stages, drop extras.
function resizeSquads() {
  while (squads.length < rounds.length) squads.push(blankSquad());
  squads.length = rounds.length;
}

// The stage to show first: the first one still open, or the last one if all are locked.
function defaultStage() {
  for (let i = 0; i < rounds.length; i++) {
    if (!isLocked(i)) return i;
  }
  return rounds.length - 1;
}

// A round is locked if it was locked by hand, or its deadline (lockAt) has passed.
function isLocked(r) {
  const round = rounds[r];
  if (tournamentInfo && tournamentInfo.status === "ended") return true;
  if (round.locked) return true;
  if (round.lockAt) return Date.now() >= Date.parse(round.lockAt);
  return false;
}

function timeLeftText(ms) {
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return d + "d " + h + "h";
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

function updateLockNote() {
  const round = rounds[currentRound];
  let text = "";
  if (isLocked(currentRound)) {
    text = "LOCKED. Picks can't be changed.";
  } else if (round.lockAt) {
    const left = Date.parse(round.lockAt) - Date.now();
    text = "Deadline in " + timeLeftText(left) + " (" + new Date(round.lockAt).toLocaleString() + ")";
  }
  // What is special about this stage
  const extras = [];
  if (stageTypeName(currentRound)) extras.push(stageTypeName(currentRound));
  if (freeTransfersIn(currentRound) !== FREE_TRANSFERS) extras.push(freeTransfersIn(currentRound) + " free transfers");
  if (budgetBonusIn(currentRound)) extras.push("+" + budgetBonusIn(currentRound).toFixed(1) + " budget");
  if (extras.length) text = (text ? text + " \u00b7 " : "") + extras.join(" \u00b7 ");
  document.getElementById("lock-note").textContent = text;
}

function lockState() {
  return rounds.map(function (_, i) { return isLocked(i) ? "1" : "0"; }).join("");
}

function currentSquad() {
  return squads[currentRound];
}

// Kills, assists and deaths are multiplied by "scale" (1 unless a standard series length is set),
// so a player in a 3-map series and one in a 7-map series are scored fairly. The win and MVP bonuses are not scaled.
// Search & Destroy kills (s.sndKills, a part of s.kills) earn a bonus, and time on the hill (s.hillTime, seconds) earns points.
// Bomb plants and defuses (s.plants, s.defuses) earn points too. mapsWon is how many maps the player's team won in its match.
function calcPoints(s, teamWon, scale, mapsWon) {
  const k = typeof scale === "number" ? scale : 1;
  const snd = Math.min(s.sndKills || 0, s.kills);
  const bombs = (s.plants || 0) + (s.defuses || 0);
  let pts = (s.kills * SCORING.kill + snd * SCORING.sndKillBonus + s.assists * SCORING.assist -
    s.deaths * SCORING.death + ((s.hillTime || 0) / 30) * SCORING.hillPer30s + bombs * SCORING.bomb) * k;
  if (k !== 1 || snd || s.hillTime || bombs) pts = Math.round(pts * 10) / 10;
  if (teamWon) pts += SCORING.win;
  if (typeof mapsWon === "number" && mapsWon > 0) pts += mapsWon * SCORING.mapWin;
  if (s.mvp) pts += SCORING.mvp;
  return pts;
}

// How many maps a team won in its match this stage (from the match score, e.g. 3:1), or 0 if no score was entered.
function mapsWonBy(team, round) {
  const m = matchOfTeam(team, round);
  if (!m || typeof m.scoreA !== "number" || typeof m.scoreB !== "number") return 0;
  return m.teamA === team ? m.scoreA : m.scoreB;
}

// ---- Matches: ids, results, and Pick'Em scoring --------------------------------

// Every match gets a short id so Pick'Em picks stay attached to it even if the organiser reorders matches.
function newMatchId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function ensureMatchIds() {
  const seen = {};
  rounds.forEach(function (r) {
    r.matches.forEach(function (m) {
      if (!m.id || seen[m.id]) m.id = newMatchId();
      seen[m.id] = true;
    });
  });
}

// A match has a result once the organiser entered its score. Without a score, stats for its teams count,
// but only when neither team plays a second match in the same stage (otherwise we can't tell the matches apart).
function matchDecided(m, round) {
  if (typeof m.scoreA === "number" && typeof m.scoreB === "number") return true;
  const shared = round.matches.some(function (o) {
    return o !== m && (o.teamA === m.teamA || o.teamB === m.teamA || o.teamA === m.teamB || o.teamB === m.teamB);
  });
  if (shared) return false;
  return players.some(function (p) { return (p.team === m.teamA || p.team === m.teamB) && round.stats[p.id]; });
}

// The winning team of a match (the score decides if there is one, otherwise the winner the organiser picked).
function matchWinner(m) {
  if (typeof m.scoreA === "number" && typeof m.scoreB === "number" && m.scoreA !== m.scoreB) {
    return m.scoreA > m.scoreB ? m.teamA : m.teamB;
  }
  return m.winner;
}

// Pick'Em: predict who wins each match. Points per correct pick, and a bonus for a perfect stage.
const PICK_POINTS = 3;
const PICK_PERFECT_BONUS = 5;   // for getting every match of a stage right (needs at least 2 matches)

// picks: { matchId: "Team name" }. Returns { total, correct, played, rounds: [points per stage] }.
function scorePickEm(picks) {
  const out = { total: 0, correct: 0, played: 0, rounds: [] };
  rounds.forEach(function (round) {
    let pts = 0, decided = 0, right = 0;
    round.matches.forEach(function (m) {
      if (!m.id || !matchDecided(m, round)) return;
      decided++;
      if (picks && picks[m.id]) {
        out.played++;
        if (picks[m.id] === matchWinner(m)) { right++; pts += PICK_POINTS; }
      }
    });
    if (decided >= 2 && right === decided) pts += PICK_PERFECT_BONUS;
    out.correct += right;
    out.total += pts;
    out.rounds.push(pts);
  });
  return out;
}

function matchOfTeam(team, round) {
  for (const m of round.matches) {
    if (m.teamA === team || m.teamB === team) return m;
  }
  return null;
}

// How many maps a match went to: typed in by the organiser, or the two scores added up.
function mapsPlayed(m) {
  if (!m) return 0;
  if (Array.isArray(m.games) && m.games.length > 0) return m.games.length;
  if (typeof m.maps === "number" && m.maps > 0) return m.maps;
  if (typeof m.scoreA === "number" && typeof m.scoreB === "number" && m.scoreA + m.scoreB > 0) return m.scoreA + m.scoreB;
  return 0;
}

function seriesScale(team, round) {
  if (!STANDARD_MAPS) return 1;
  const n = mapsPlayed(matchOfTeam(team, round));
  if (!n) return 1;
  return Math.min(3, Math.max(0.4, STANDARD_MAPS / n));
}

function teamOf(id) {
  const p = players.find(function (x) { return x.id === id; });
  return p ? p.team : null;
}

function teamWonInRound(team, round) {
  for (const m of round.matches) {
    if (m.teamA === team || m.teamB === team) {
      return m.winner === team;
    }
  }
  return false;
}

// The captain gets the double. If the captain has no stats (didn't play),
// the vice-captain gets it instead.
function effectiveCaptain(r) {
  const sq = squads[r];
  const stats = rounds[r].stats;
  if (sq.chip === "maxcaptain") {
    // Max Captain: whoever scores most in the lineup gets the bonus.
    let best = null, bestPts = -Infinity;
    scoringIds(r).forEach(function (id) {
      if (!stats[id]) return;
      const p = rawPoints(id, r);
      if (p > bestPts) { bestPts = p; best = id; }
    });
    return best;
  }
  if (sq.captain !== null && stats[sq.captain]) return sq.captain;
  if (sq.vice !== null && stats[sq.vice]) return sq.vice;
  return null;
}

function pointsInRound(id, r) {
  const round = rounds[r];
  const s = round.stats[id];
  if (!s) return 0;
  const won = teamWonInRound(teamOf(id), round);
  let pts = calcPoints(s, won, seriesScale(teamOf(id), round), mapsWonBy(teamOf(id), round));
  if (effectiveCaptain(r) === id) pts *= (squads[r].chip === "triplecaptain" ? 3 : 2);
  return pts;
}

// The round whose squad round r builds on. Normally r-1, but a Free Hit squad
// is temporary, so we skip back over it to the squad from before.
// Returns -1 if there is none.
function baseIndex(r) {
  let b = r - 1;
  while (b >= 0 && squads[b].chip === "freehit") b--;
  return b;
}

// Transfers made in round r = players in round r's squad who weren't in its base squad.
// The first squad, and an empty base squad, mean nothing to transfer from.
function transfersIn(r) {
  const b = baseIndex(r);
  if (b < 0) return 0;
  const previous = squads[b].players;
  if (previous.length === 0) return 0;
  let n = 0;
  for (const id of squads[r].players) {
    if (!previous.includes(id)) n++;
  }
  return n;
}

function hitIn(r) {
  if (squads[r].chip === "wildcard" || squads[r].chip === "freehit") return 0;
  return Math.max(0, transfersIn(r) - freeTransfersIn(r)) * TRANSFER_HIT;
}

// Points the picked Team slot earned in round r (0 if the slot is off, empty, or its match isn't decided yet).
function teamPointsIn(r) {
  const sq = squads[r];
  if (!TEAM_SLOT || !sq || !sq.team) return 0;
  const round = rounds[r];
  const m = matchOfTeam(sq.team, round);
  if (!m || !matchDecided(m, round)) return 0;
  return (matchWinner(m) === sq.team ? SCORING.teamWin : 0) + mapsWonBy(sq.team, round) * SCORING.teamMap;
}

function totalPoints() {
  let total = 0;
  for (let r = 0; r < rounds.length; r++) {
    total -= hitIn(r);
    total += teamPointsIn(r);
    for (const id of scoringIds(r)) {
      total += pointsInRound(id, r);
    }
  }
  return total;
}

// Who actually scores in round r: the lineup (see baseScoringIds) plus the 12th man if that chip is on.
function scoringIds(r) {
  const ids = baseScoringIds(r);
  const sq = squads[r];
  // 12th Man: one extra player, from anywhere, also scores.
  if (sq.chip === "twelfth" && typeof sq.extra === "number" && !ids.includes(sq.extra) && playerById(sq.extra)) {
    ids.push(sq.extra);
  }
  return ids;
}

// The lineup that scores in round r.
// - Bench Boost: everyone in the squad.
// - Otherwise the starters. If a starter has no stats (didn't play), the sub
//   replaces them, but only if the stats exist and the formation stays valid.
// - A squad with no sub set just scores everyone.
function baseScoringIds(r) {
  const sq = squads[r];
  const stats = rounds[r].stats;
  if (sq.chip === "benchboost" || !sq.sub || !sq.players.includes(sq.sub)) {
    return sq.players.slice();
  }
  const starters = startersOf(sq);
  if (stats[sq.sub]) {
    for (const out of starters) {
      if (!stats[out]) {
        const swapped = starters.map(function (id) { return id === out ? sq.sub : id; });
        if (isValidStarting(swapped)) return swapped;
      }
    }
  }
  return starters;
}

// The auto-sub that happened in round r, if any: { out, in } or null.
function autoSubIn(r) {
  const sq = squads[r];
  if (sq.chip === "benchboost" || !sq.sub) return null;
  const used = scoringIds(r);
  if (used.includes(sq.sub)) {
    const out = startersOf(sq).find(function (id) { return !used.includes(id); });
    return out === undefined ? null : { out: out, in: sq.sub };
  }
  return null;
}

function roundTotal(r) {
  let total = teamPointsIn(r);
  for (const id of scoringIds(r)) {
    total += pointsInRound(id, r);
  }
  return total;
}

function round1(x) { return Math.round(x * 10) / 10; }

// Sell-price protection: if a player's price went up since you bought him, you keep half of the
// profit (in steps of 0.5, rounded down). If the price went down, you get the lower price.
function sellValue(boughtAt, price) {
  if (price <= boughtAt) return price;
  return round1(boughtAt + Math.floor((price - boughtAt) / 2 / 0.5) * 0.5);
}

// Each squad remembers what you paid for every player (squad.buy) and how much money you have left (squad.bank).
// Squads saved before this existed are treated as if everyone was bought at today's price.
function migrateSquad(sq) {
  if (typeof sq.bank === "number" && sq.buy) return;
  sq.buy = {};
  let spent = 0;
  sq.players.forEach(function (id) {
    const p = playerById(id);
    if (p) { sq.buy[id] = p.price; spent += p.price; }
  });
  sq.bank = round1(STARTING_BUDGET - spent);
}

function bankOf(sq) {
  if (typeof sq.bank === "number" && sq.buy) return sq.bank;
  let spent = 0;
  sq.players.forEach(function (id) {
    const p = playerById(id);
    if (p) spent += p.price;
  });
  return round1(STARTING_BUDGET - spent);
}

function budgetLeft() {
  return bankOf(currentSquad());
}

// Text for what a player in your squad would sell for right now, or "".
function sellInfo(sq, p) {
  if (!sq.buy || typeof sq.buy[p.id] !== "number") return "";
  return "Sell " + sellValue(sq.buy[p.id], p.price).toFixed(1);
}

function teamCount(team) {
  let n = 0;
  for (const p of players) {
    if (currentSquad().players.includes(p.id) && p.team === team) n++;
  }
  return n;
}

function transfersMade() {
  return transfersIn(currentRound);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(squads));
  } catch (e) {
    // storage can be unavailable; the app still works without it
  }
  // Let the online part (social.js) know the squads changed.
  if (typeof window.afterSave === "function") window.afterSave();
}

// Copy saved squads (from this device or the cloud) into the live squads.
// Returns false if the data doesn't look right.
// Stages the saved data doesn't have yet (new stages) start empty; extra ones are dropped.
function applySquads(saved) {
  if (!Array.isArray(saved)) return false;
  for (let i = 0; i < saved.length; i++) {
    const s = saved[i];
    if (!s || !Array.isArray(s.players)) return false;
  }
  resizeSquads();
  for (let i = 0; i < squads.length; i++) {
    squads[i] = saved[i] || blankSquad();
    if (squads[i].captain === undefined) squads[i].captain = null;
    if (squads[i].sub === undefined) squads[i].sub = null;
    if (squads[i].vice === undefined) squads[i].vice = null;
    if (squads[i].chip === undefined) squads[i].chip = null;
    if (squads[i].team === undefined) squads[i].team = null;
  }
  cleanSquads();
  return true;
}

// Forget players who no longer exist in this tournament (the organiser may remove players).
function cleanSquads() {
  for (const sq of squads) {
    sq.players.forEach(function (id) {
      if (!playerById(id) && sq.buy && typeof sq.buy[id] === "number") {
        sq.bank = round1(sq.bank + sq.buy[id]);
        delete sq.buy[id];
      }
    });
    sq.players = sq.players.filter(function (id) { return playerById(id); });
    if (!sq.players.includes(sq.captain)) sq.captain = null;
    if (!sq.players.includes(sq.vice)) sq.vice = null;
    if (!sq.players.includes(sq.sub)) sq.sub = null;
    if (sq.team && !players.some(function (p) { return p.team === sq.team; })) sq.team = null;
    if (typeof sq.extra === "number" && !playerById(sq.extra)) sq.extra = null;
  }
}

// Replace the players and rounds with data published by the organiser (from Firestore).
// The arrays are changed in place, so everything already pointing at them keeps working.
// Returns false if the data doesn't look right (then the defaults in data.js stay).
function applyTournament(t) {
  if (!t || !Array.isArray(t.players) || !Array.isArray(t.rounds) || t.rounds.length === 0) return false;
  const stagesOk = t.rounds.every(function (r) {
    return r && typeof r.name === "string" && Array.isArray(r.matches) && r.stats && typeof r.stats === "object";
  });
  if (!stagesOk) return false;
  // Older tournaments used slayer / anchor / obj: convert them so live data keeps working.
  t.players.forEach(function (p) { if (p && LEGACY_ROLE[p.role]) p.role = LEGACY_ROLE[p.role]; });
  const ok = t.players.every(function (p) {
    return p && typeof p.id === "number" && typeof p.name === "string" && ROLES.includes(p.role) &&
      typeof p.team === "string" && typeof p.price === "number";
  });
  if (!ok) return false;
  t.players.forEach(function (p) { if (p.role2 && (!ROLES.includes(p.role2) || p.role2 === p.role)) delete p.role2; });
  players.splice(0, players.length, ...t.players);
  rounds.splice(0, rounds.length, ...t.rounds);
  const budget = t.settings && t.settings.budget;
  STARTING_BUDGET = (typeof budget === "number" && budget > 0) ? budget : 48.0;
  const maps = t.settings && t.settings.standardMaps;
  STANDARD_MAPS = (typeof maps === "number" && maps > 0) ? maps : 0;
  FORMAT = (t.settings && t.settings.format === "bracket") ? "bracket" : "league";
  TEAM_SLOT = !!(t.settings && t.settings.teamSlot);
  TEAM_LOGOS = (t.settings && t.settings.teamLogos && typeof t.settings.teamLogos === "object") ? Object.assign({}, t.settings.teamLogos) : {};
  // Lineup rules and scoring: the tournament's own numbers over the defaults.
  LINEUP = JSON.parse(JSON.stringify(DEFAULT_LINEUP));
  const lu = t.settings && t.settings.lineup;
  if (lu && lu.min && lu.max) {
    ROLES.forEach(function (r) {
      if (typeof lu.min[r] === "number") LINEUP.min[r] = Math.max(0, Math.min(STARTERS, lu.min[r]));
      if (typeof lu.max[r] === "number") LINEUP.max[r] = Math.max(0, Math.min(STARTERS, lu.max[r]));
    });
  }
  SCORING = Object.assign({}, DEFAULT_SCORING);
  const sc = t.settings && t.settings.scoring;
  if (sc && typeof sc === "object") {
    Object.keys(DEFAULT_SCORING).forEach(function (k) {
      if (typeof sc[k] === "number" && isFinite(sc[k])) SCORING[k] = sc[k];
    });
  }
  resizeSquads();
  if (currentRound >= rounds.length) currentRound = rounds.length - 1;
  return true;
}

// Work out the score of someone else's saved squads (used by the admin page).
// Returns { total, rounds: [...] } or null if the squads look broken.
function scoreSquads(saved) {
  const backup = squads.slice();
  try {
    if (!applySquads(JSON.parse(JSON.stringify(saved)))) return null;
    const perRound = rounds.map(function (_, r) {
      return Math.round((roundTotal(r) - hitIn(r)) * 10) / 10;
    });
    return { total: Math.round(totalPoints() * 10) / 10, rounds: perRound };
  } finally {
    squads.splice(0, squads.length, ...backup);   // put our own squads back
  }
}

function load() {
  try {
    applySquads(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (e) {
    // ignore broken or missing saved data
  }
}

function selectRound(i) {
  currentRound = i;
  const sq = currentSquad();
  const b = baseIndex(i);
  if (!isLocked(i) && sq.players.length === 0 && b >= 0) {
    migrateSquad(squads[b]);
    sq.players = squads[b].players.slice();
    sq.bank = round1((typeof squads[b].bank === "number" ? squads[b].bank : bankOf(squads[b])) + budgetBonusIn(i));
    sq.buy = Object.assign({}, squads[b].buy);
    sq.captain = squads[b].captain;
    sq.vice = squads[b].vice;
    sq.sub = squads[b].sub;
    sq.team = squads[b].team || null;
  }
  render();
}

// Play (or cancel) a chip in the current round.
function playChip(chipId) {
  const round = rounds[currentRound];
  const sq = currentSquad();
  if (isLocked(currentRound)) {
    alert("This round is locked");
    return;
  }
  if (sq.chip === chipId) {
    sq.chip = null;            // click again to cancel
    render();
    return;
  }
  for (let r = 0; r < squads.length; r++) {
    if (r !== currentRound && squads[r].chip === chipId) {
      alert("You already used this chip in " + rounds[r].name);
      return;
    }
  }
  if ((chipId === "freehit" || chipId === "wildcard") && baseIndex(currentRound) < 0) {
    alert("This chip can't be played in the first round");
    return;
  }
  sq.chip = chipId;            // replaces any other chip this round
  render();
}

function togglePlayer(id) {
  if (isLocked(currentRound)) {
    alert("This round is locked");
    return;
  }
  const sq = currentSquad();
  migrateSquad(sq);
  if (sq.players.includes(id)) {
    const leaving = playerById(id);
    if (leaving) {
      const paid = typeof sq.buy[id] === "number" ? sq.buy[id] : leaving.price;
      sq.bank = round1(sq.bank + sellValue(paid, leaving.price));
    }
    delete sq.buy[id];
    sq.players = sq.players.filter(function (x) { return x !== id; });
    if (sq.captain === id) sq.captain = null;
    if (sq.sub === id) sq.sub = null;
    if (sq.vice === id) sq.vice = null;
  } else {
    const player = players.find(function (p) { return p.id === id; });
    if (sq.players.length >= SQUAD_SIZE) {
      alert("Squad is full");
      return;
    }
    if (teamCount(player.team) >= MAX_PER_TEAM) {
      alert("Max " + MAX_PER_TEAM + " players from one team");
      return;
    }
    if (player.price > budgetLeft()) {
      alert("Not enough budget");
      return;
    }
    sq.players.push(id);
    sq.buy[id] = player.price;
    sq.bank = round1(sq.bank - player.price);
  }
  render();
}

function playerById(id) {
  return players.find(function (p) { return p.id === id; });
}

function setCaptain(id) {
  const sq = currentSquad();
  if (sq.sub === id) {
    alert("The sub can't be captain");
    return;
  }
  if (sq.vice === id) sq.vice = null;
  sq.captain = id;
  render();
}

function setVice(id) {
  const sq = currentSquad();
  if (sq.sub === id) {
    alert("The sub can't be vice-captain");
    return;
  }
  if (sq.captain === id) {
    alert("The captain can't also be vice-captain");
    return;
  }
  sq.vice = id;
  render();
}

function makeButton(text, title, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

// The small row of action buttons for a squad member.
function actionButtons(p) {
  const row = document.createElement("div");
  row.className = "actions";
  row.appendChild(makeButton("C", "Make captain", function () { setCaptain(p.id); }));
  row.appendChild(makeButton("VC", "Make vice-captain", function () { setVice(p.id); }));
  row.appendChild(makeButton("Sub", "Move to the bench", function () { setSub(p.id); }));
  row.appendChild(makeButton("X", "Remove from squad", function () { togglePlayer(p.id); }));
  return row;
}

function badgeFor(sq, id) {
  if (id === sq.captain) return "C";
  if (id === sq.vice) return "VC";
  return "";
}

// One player card for the pitch and the bench.
function makeCard(p, sq, round, benched) {
  const card = document.createElement("div");
  card.className = "card role-" + p.role + (benched ? " benched" : "");
  card.dataset.pid = p.id;

  const badge = badgeFor(sq, p.id);
  if (badge) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = badge;
    card.appendChild(b);
  }

  card.appendChild(playerAvatarEl(p, 38));
  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = p.name;
  card.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = roleText(p) + " · " + p.team.replace("Team ", "");
  card.appendChild(meta);

  const pts = document.createElement("div");
  pts.className = "card-pts";
  pts.textContent = pointsInRound(p.id, currentRound).toFixed(1) + " pts";
  card.appendChild(pts);

  const sell = sellInfo(sq, p);
  if (sell) {
    const sellLine = document.createElement("div");
    sellLine.className = "card-sell";
    sellLine.textContent = sell;
    card.appendChild(sellLine);
  }

  if (!isLocked(currentRound)) card.appendChild(actionButtons(p));
  return card;
}

function renderPitch(sq, round) {
  const box = document.getElementById("squad-view");
  box.innerHTML = "";

  const pitch = document.createElement("div");
  pitch.className = "pitch";

  const starters = startersOf(sq).map(playerById).filter(Boolean);
  // Long range at the top of the pitch, then mid range, rush, and the all-rounders at the back.
  for (const role of ["sniper", "marksman", "lmg", "shotgun", "smg", "ar"]) {
    const group = starters.filter(function (p) { return p.role === role; });
    if (group.length === 0) continue;
    const row = document.createElement("div");
    row.className = "pitch-row";
    row.dataset.label = ROW_LABEL[role];
    for (const p of group) row.appendChild(makeCard(p, sq, round, false));
    pitch.appendChild(row);
  }
  if (starters.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Pick players from the list below to fill your squad.";
    pitch.appendChild(empty);
  }
  box.appendChild(pitch);

  const bench = document.createElement("div");
  bench.className = "bench";
  const label = document.createElement("div");
  label.className = "bench-label";
  label.textContent = "Bench";
  bench.appendChild(label);
  if (sq.sub !== null && sq.players.includes(sq.sub) && playerById(sq.sub)) {
    bench.appendChild(makeCard(playerById(sq.sub), sq, round, true));
  } else {
    const none = document.createElement("span");
    none.className = "empty";
    none.textContent = "No sub yet. Use the Sub button on a player.";
    bench.appendChild(none);
  }
  box.appendChild(bench);
}

function renderSquadList(sq, round) {
  const box = document.getElementById("squad-view");
  box.innerHTML = "";
  const ul = document.createElement("ul");
  for (const p of players) {
    if (!sq.players.includes(p.id)) continue;
    const li = document.createElement("li");
    li.className = "squad-row";
    const tag = badgeFor(sq, p.id) || (p.id === sq.sub ? "sub" : "");
    const text = document.createElement("span");
    text.textContent = p.name + (tag ? " (" + tag + ")" : "") + " - " + roleText(p) + " - " +
      p.team + " - " + p.price.toFixed(1) + " | " + pointsInRound(p.id, currentRound).toFixed(1) + " pts" +
      (sellInfo(sq, p) ? " | " + sellInfo(sq, p).toLowerCase() : "");
    li.appendChild(text);
    if (!isLocked(currentRound)) li.appendChild(actionButtons(p));
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

function renderTabs() {
  const tabs = document.getElementById("round-tabs");
  tabs.innerHTML = "";
  for (let i = 0; i < rounds.length; i++) {
    const b = document.createElement("button");
    const hasResults = Object.keys(rounds[i].stats).length > 0;
    b.textContent = rounds[i].name + (isLocked(i) ? " (locked)" : "") +
      (hasResults ? " · " + (roundTotal(i) - hitIn(i)).toFixed(1) : "");
    if (i === currentRound) b.classList.add("active");
    b.addEventListener("click", function () { selectRound(i); });
    tabs.appendChild(b);
  }
}

function renderChips(sq) {
  const chipsDiv = document.getElementById("chips");
  chipsDiv.innerHTML = "";
  for (const c of CHIPS) {
    const b = document.createElement("button");
    let usedIn = -1;
    for (let r = 0; r < squads.length; r++) {
      if (squads[r].chip === c.id) usedIn = r;
    }
    const usedElsewhere = usedIn >= 0 && usedIn !== currentRound;
    b.textContent = c.name + (usedElsewhere ? " (used: " + rounds[usedIn].name + ")" : "");
    b.title = c.info;
    if (sq.chip === c.id) b.classList.add("active");
    if (usedElsewhere) b.disabled = true;
    b.addEventListener("click", function () { playChip(c.id); });
    chipsDiv.appendChild(b);
  }

  // 12th Man: choose the extra player
  if (sq.chip === "twelfth") {
    const row = document.createElement("div");
    row.className = "extra-row";
    const label = document.createElement("span");
    label.textContent = "12th man:";
    row.appendChild(label);
    const sel = document.createElement("select");
    sel.appendChild(new Option("Choose a player...", ""));
    players.filter(function (p) { return !sq.players.includes(p.id); }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }).forEach(function (p) {
      sel.appendChild(new Option(p.name + " (" + p.team.replace("Team ", "") + ", " + p.price.toFixed(1) + ")", String(p.id)));
    });
    sel.value = typeof sq.extra === "number" ? String(sq.extra) : "";
    sel.disabled = isLocked(currentRound);
    sel.addEventListener("change", function () {
      sq.extra = sel.value ? Number(sel.value) : null;
      render();
    });
    row.appendChild(sel);
    chipsDiv.appendChild(row);
  }

  const chipNote = [];
  if (sq.chip) chipNote.push("Chip active: " + CHIPS.find(function (c) { return c.id === sq.chip; }).info);
  const auto = autoSubIn(currentRound);
  if (auto) {
    chipNote.push("Auto-sub: " + playerById(auto.in).name + " replaced " + playerById(auto.out).name + " (no stats).");
  }
  document.getElementById("chip-note").textContent = chipNote.join(" ");
}

function renderStats(sq) {
  document.getElementById("budget").textContent = budgetLeft().toFixed(1);
  document.getElementById("spent").textContent = (STARTING_BUDGET - budgetLeft()).toFixed(1);
  document.getElementById("count").textContent = sq.players.length;
  document.getElementById("transfers").textContent = transfersMade() + " (" + freeTransfersIn(currentRound) + " free)";
  document.getElementById("hit").textContent = "-" + hitIn(currentRound);
  document.getElementById("points").textContent = totalPoints().toFixed(1);
  document.getElementById("round-points").textContent = roundTotal(currentRound).toFixed(1);

  let warning = "";
  if (sq.players.length === SQUAD_SIZE) {
    if (!sq.sub) warning = "Pick a sub.";
    else if (!isValidStarting(startersOf(sq))) warning = "Starting five isn't valid. You need " + lineupText() + ".";
  }
  document.getElementById("formation-note").textContent = warning;
}

function renderViewSwitch() {
  const box = document.getElementById("view-switch");
  box.innerHTML = "";
  for (const v of ["pitch", "list"]) {
    const b = makeButton(v === "pitch" ? "Pitch" : "List", "Show squad as " + v, function () {
      view = v;
      render();
    });
    if (v === view) b.classList.add("active");
    box.appendChild(b);
  }
}

// ---- Player market ----------------------------------------------------
let marketSearch = "";
let marketSort = "price-desc";
let marketTeam = "all";

// A player's points in one stage as a plain player (no captain bonus).
function rawPoints(id, r) {
  const round = rounds[r];
  const s = round.stats[id];
  if (!s) return 0;
  return calcPoints(s, teamWonInRound(teamOf(id), round), seriesScale(teamOf(id), round), mapsWonBy(teamOf(id), round));
}

function rawTotal(id) {
  let t = 0;
  for (let r = 0; r < rounds.length; r++) t += rawPoints(id, r);
  return t;
}

function renderFilters() {
  const box = document.getElementById("role-filter");
  box.innerHTML = "";
  for (const r of ["all"].concat(ROLES)) {
    const b = makeButton(r === "all" ? "All" : ROLE_LABEL[r], "Show " + r, function () {
      roleFilter = r;
      render();
    });
    if (r === roleFilter) b.classList.add("active");
    box.appendChild(b);
  }

  // The team dropdown is rebuilt each time, because the organiser can change the teams.
  const sel = document.getElementById("market-team");
  if (sel) {
    const teams = [];
    players.forEach(function (p) { if (!teams.includes(p.team)) teams.push(p.team); });
    sel.innerHTML = "";
    sel.appendChild(new Option("All teams", "all"));
    teams.forEach(function (t) { sel.appendChild(new Option(t, t)); });
    if (!teams.includes(marketTeam)) marketTeam = "all";
    sel.value = marketTeam;
  }
}

// Why a player can't be added to the squad right now, or "" if they can be added or removed.
function blockReason(p, sq) {
  if (isLocked(currentRound)) return "Locked";
  if (sq.players.includes(p.id)) return "";
  if (sq.players.length >= SQUAD_SIZE) return "Squad full";
  if (teamCount(p.team) >= MAX_PER_TEAM) return "Max " + MAX_PER_TEAM + " per team";
  if (p.price > budgetLeft()) return "Too expensive";
  return "";
}

// One player card in the market.
function makePlayerCard(p, sq) {
  const picked = sq.players.includes(p.id);
  const card = document.createElement("div");
  card.className = "pcard role-" + p.role + (picked ? " picked" : "");
  card.dataset.pid = p.id;

  const top = document.createElement("div");
  top.className = "pcard-top";
  const role = document.createElement("span");
  role.className = "pcard-role";
  role.textContent = roleText(p);
  const price = document.createElement("span");
  price.className = "pcard-price";
  price.textContent = p.price.toFixed(1);
  top.appendChild(role);
  top.appendChild(price);
  card.appendChild(top);

  const nameRow = document.createElement("div");
  nameRow.className = "pcard-name-row";
  nameRow.appendChild(playerAvatarEl(p, 34));
  const name = document.createElement("div");
  name.className = "pcard-name";
  name.textContent = p.name;
  nameRow.appendChild(name);
  card.appendChild(nameRow);

  const team = document.createElement("div");
  team.className = "pcard-team";
  team.textContent = p.team;
  card.appendChild(team);

  const stats = document.createElement("div");
  stats.className = "pcard-stats";
  [["Round", rawPoints(p.id, currentRound)], ["Total", rawTotal(p.id)]].forEach(function (x) {
    const cell = document.createElement("div");
    const val = document.createElement("b");
    val.textContent = x[1].toFixed(1);
    const lab = document.createElement("span");
    lab.textContent = x[0];
    cell.appendChild(val);
    cell.appendChild(lab);
    stats.appendChild(cell);
  });
  card.appendChild(stats);

  // The button says why a player can't be added.
  const btn = document.createElement("button");
  btn.type = "button";
  const reason = blockReason(p, sq);
  btn.textContent = reason || (picked ? "Remove" : "Add");
  btn.disabled = !!reason;
  if (picked && !reason) btn.classList.add("remove");
  btn.addEventListener("click", function () { togglePlayer(p.id); });
  card.appendChild(btn);
  return card;
}

function renderPlayers(sq) {
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  const q = marketSearch.trim().toLowerCase();
  const shown = players.filter(function (p) {
    if (roleFilter !== "all" && rolesOf(p).indexOf(roleFilter) === -1) return false;
    if (marketTeam !== "all" && p.team !== marketTeam) return false;
    if (q && (p.name + " " + p.team).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  const sorters = {
    "price-desc": function (a, b) { return b.price - a.price; },
    "price-asc": function (a, b) { return a.price - b.price; },
    "points-desc": function (a, b) { return rawTotal(b.id) - rawTotal(a.id); },
    "round-desc": function (a, b) { return rawPoints(b.id, currentRound) - rawPoints(a.id, currentRound); },
    "name-asc": function (a, b) { return a.name.localeCompare(b.name); },
  };
  shown.sort(sorters[marketSort] || sorters["price-desc"]);

  const count = document.getElementById("market-count");
  if (count) count.textContent = shown.length + " of " + players.length + " players";
  if (shown.length === 0) {
    const none = document.createElement("p");
    none.className = "empty";
    none.textContent = "No players match your search.";
    list.appendChild(none);
    return;
  }
  for (const p of shown) list.appendChild(makePlayerCard(p, sq));
}

// Search and sort controls. They only redraw the list, so typing keeps its focus.
function initMarket() {
  const search = document.getElementById("market-search");
  const sort = document.getElementById("market-sort");
  const team = document.getElementById("market-team");
  if (!search || !sort || !team) return;
  search.addEventListener("input", function () {
    marketSearch = search.value;
    renderPlayers(currentSquad());
  });
  sort.addEventListener("change", function () {
    marketSort = sort.value;
    renderPlayers(currentSquad());
  });
  team.addEventListener("change", function () {
    marketTeam = team.value;
    renderPlayers(currentSquad());
  });
}

// Points for each stage, so you can see how the tournament is going.
function renderStages() {
  const box = document.getElementById("stage-summary");
  if (!box) return;
  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "board";
  const head = document.createElement("tr");
  ["Stage", "Chip", "Transfers", "Hit", "Points"].forEach(function (h) {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  table.appendChild(head);
  let total = 0;
  rounds.forEach(function (r, i) {
    const sq = squads[i];
    const chip = sq.chip ? CHIPS.find(function (c) { return c.id === sq.chip; }).name : "-";
    const pts = roundTotal(i) - hitIn(i);
    total += pts;
    const tr = document.createElement("tr");
    if (i === currentRound) tr.className = "me";
    [r.name + (stageTypeName(i) ? " \u00b7 " + stageTypeName(i) : "") + (isLocked(i) ? " (locked)" : ""), chip, sq.players.length ? String(transfersIn(i)) : "-",
      "-" + hitIn(i), pts.toFixed(1)].forEach(function (text) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  const foot = document.createElement("tr");
  ["Total", "", "", "", total.toFixed(1)].forEach(function (text) {
    const td = document.createElement("td");
    td.textContent = text;
    td.style.fontWeight = "bold";
    foot.appendChild(td);
  });
  table.appendChild(foot);
  wrap.appendChild(table);
  box.appendChild(wrap);
}

function renderHeader() {
  const name = document.getElementById("tournament-name");
  if (name) name.textContent = tournamentInfo ? tournamentInfo.name : "Practice tournament";
  const status = document.getElementById("tournament-status");
  if (status) {
    const s = tournamentInfo ? tournamentInfo.status : "practice";
    status.textContent = s === "open" ? "Open" : s === "ended" ? "Ended" : "Practice";
    status.className = "chip status-" + s;
  }
}

// The Team slot picker (only when the tournament has the slot on).
function renderTeamSlot(sq) {
  const box = document.getElementById("team-slot");
  if (!box) return;
  box.innerHTML = "";
  if (!TEAM_SLOT) return;
  const label = document.createElement("label");
  label.textContent = "Team slot: ";
  const sel = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(no team)";
  sel.appendChild(none);
  const names = [];
  players.forEach(function (p) { if (names.indexOf(p.team) === -1) names.push(p.team); });
  names.forEach(function (t) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  });
  sel.value = sq.team || "";
  sel.disabled = isLocked(currentRound);
  sel.addEventListener("change", function () {
    if (isLocked(currentRound)) return;
    currentSquad().team = sel.value || null;
    render();
  });
  label.appendChild(sel);
  box.appendChild(label);
  const info = document.createElement("span");
  info.className = "muted";
  info.textContent = " +" + SCORING.teamWin + " if they win their match, +" + SCORING.teamMap + " per map won. Free to change each stage.";
  box.appendChild(info);
  if (sq.team) {
    const m = matchOfTeam(sq.team, rounds[currentRound]);
    const earned = document.createElement("div");
    earned.className = "muted";
    earned.textContent = m && matchDecided(m, rounds[currentRound]) ? "This stage: " + teamPointsIn(currentRound).toFixed(1) + " pts" : "Waiting for their match result.";
    box.appendChild(earned);
  }
}

function render() {
  const sq = currentSquad();
  const round = rounds[currentRound];

  renderHeader();
  renderTeamSlot(sq);
  renderStages();
  renderTabs();
  renderChips(sq);
  updateLockNote();
  renderStats(sq);
  renderViewSwitch();
  if (view === "pitch") renderPitch(sq, round);
  else renderSquadList(sq, round);
  renderFilters();
  renderPlayers(sq);
  if (typeof renderHome === "function") renderHome();
  save();
}

// Start the game screen. The practice tournament ("demo") starts straight away;
// a real tournament starts once social.js has loaded it from the cloud.
let gameStarted = false;
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  load();
  selectRound(defaultStage());

  // Keep the deadline countdown fresh, and re-render if a stage just locked.
  let lastLockState = lockState();
  setInterval(function () {
    const now = lockState();
    if (now !== lastLockState) {
      lastLockState = now;
      render();
    } else {
      updateLockNote();
    }
  }, 30000);
}

// The admin page reuses this file for scoring, but has no game screen.
if (document.getElementById("game-view")) {
  document.getElementById("game-view").style.display = TID ? "" : "none";
  document.getElementById("home-view").style.display = TID ? "none" : "";
  initMarket();
  if (TID === "demo") startGame();
}
// When the shared picture library arrives, draw the pictures.
window.addEventListener("avatars-ready", function () { if (!document.getElementById("squad-view")) return; try { render(); } catch (e) { /* the page may not be ready yet */ } });
