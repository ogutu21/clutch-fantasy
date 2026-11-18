// ROLES: ar = assault rifle (all-rounder), smg = close-range rusher, lmg = light machine gun, shotgun = close quarters, marksman = mid range, sniper = long range.
// NOTE: roles below are PLACEHOLDERS (same pattern per team). Change them to match real players.
const players = [
  { id: 1,  name: "Zuko",  team: "Team Alpha",   role: "smg", price: 10.0 },
  { id: 2,  name: "Tengen",  team: "Team Alpha",   role: "smg", price: 9.5 },
  { id: 3,  name: "Sun",  team: "Team Alpha",   role: "ar", price: 8.5 },
  { id: 4,  name: "Vintage",  team: "Team Alpha",   role: "marksman", price: 7.5 },
  { id: 5,  name: "Dullsum",  team: "Team Alpha",   role: "sniper", price: 6.5 },
  
  { id: 6,  name: "Thors",  team: "Team Bravo",   role: "smg", price: 9.0 },
  { id: 7,  name: "Haterbroom",  team: "Team Bravo",   role: "smg", price: 8.5 },
  { id: 8,  name: "Hillary",  team: "Team Bravo",   role: "ar", price: 8.0 },
  { id: 9,  name: "Saint",  team: "Team Bravo",   role: "marksman", price: 7.0 },
  { id: 10, name: "Mudavadih", team: "Team Bravo",   role: "sniper", price: 9.0 },
 
  { id: 11, name: "Snappy", team: "Team Charlie", role: "smg", price: 9.5 },
  { id: 12, name: "Ryan", team: "Team Charlie", role: "smg", price: 8.0 },
  { id: 13, name: "Ogutu", team: "Team Charlie", role: "ar", price: 7.5 },
  { id: 14, name: "Senpai", team: "Team Charlie", role: "marksman", price: 8.5 },
  { id: 15, name: "Diddy", team: "Team Charlie", role: "sniper", price: 6.0 },
  
  { id: 16, name: "Guts", team: "Team Delta", role: "smg", price: 9.0 },
  { id: 17, name: "Jayson", team: "Team Delta", role: "smg", price: 8.0 },
  { id: 18, name: "Ginger", team: "Team Delta", role: "ar", price: 7.5 },
  { id: 19, name: "Stanley", team: "Team Delta", role: "marksman", price: 6.5 },
  { id: 20, name: "Chemu", team: "Team Delta", role: "sniper", price: 5.5 },
];

// Fake stats for one round. Missing players score 0.
const rounds = [
  {
    name: "Round 1",
    locked: false,                         // true = locked by hand, whatever the deadline
    lockAt: "2026-11-08T18:00:00+03:00",   // deadline: the round locks automatically then
    matches: [
      { teamA: "Team Alpha",   teamB: "Team Bravo", winner: "Team Alpha" },
      { teamA: "Team Charlie", teamB: "Team Delta", winner: "Team Charlie" },
    ],
    stats: {
      1:  { kills: 42, deaths: 30, assists: 8,  mvp: true },
      2:  { kills: 35, deaths: 28, assists: 12, mvp: false },
      3:  { kills: 28, deaths: 31, assists: 6,  mvp: false },
      6:  { kills: 30, deaths: 34, assists: 5,  mvp: false },
      7:  { kills: 25, deaths: 36, assists: 9,  mvp: false },
      11: { kills: 38, deaths: 27, assists: 10, mvp: false },
    },
  },
  {
    name: "Semifinal",
    locked: false,
    lockAt: "2026-11-15T18:00:00+03:00",
    matches: [
      { teamA: "Team Alpha", teamB: "Team Charlie", winner: "Team Alpha" },
    ],
    stats: {
      1:  { kills: 30, deaths: 20, assists: 5, mvp: false },
      11: { kills: 22, deaths: 33, assists: 4, mvp: false },
    },
  },
  {
    name: "Final",
    locked: false,
    lockAt: "2026-11-22T18:00:00+03:00",
    matches: [],
    stats: {},
  },
];