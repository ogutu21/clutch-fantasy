# Clutch Fantasy

A fantasy game for university Call of Duty: Mobile tournaments. Pick a squad under a budget,
score points from real match stats, and climb the leaderboard. Each tournament has its own
players, stages, leaderboard and mini-leagues.

Live site: https://clutch-fantasy-55b29.web.app

## How the game works
- **Squad:** 6 players (5 starters + 1 sub), a budget, and at most 3 players from one team.
- **Roles:** AR, SMG, LMG, Shotgun, Marksman, Sniper. The organiser sets how many of each role a starting five may have.
- **Points:** kills, assists, deaths, team win, MVP. Search & Destroy kills earn a bonus, bomb plants and defuses earn points,
  time on the hill (Hardpoint) earns points, and every map your team wins in its match earns points. All the numbers are set per tournament.
- **Pictures:** in the admin Players section, each player has a Look button and each team has a logo button. Upload a photo or logo (shrunk to 96px automatically) or pick one from your own `avatars` folder (list the files in `avatars-library.js`). No picture shows initials.
- **Picture library:** in the admin page, "Picture library" lets you pick image files (several at once). Each is resized to a 256px square and saved in Firestore for everyone, then appears in the picker for players and team logos. Deploy `firestore.rules` first.
- **Ownership %:** player cards show "Owned N%" (share of squads with that player in the stage). Worked out when you press Publish & update; only percentages are shown, never squads.
- **Team slot (optional):** turn on "Use the Team slot" in the tournament settings. Players back one team per stage: +6 if it wins its match, +1 per map won (both editable). Free to change each stage. Off by default.
- **Pick'Em:** predict who wins each match (Matches tab, Pick'Em). +3 per correct pick, +5 for a perfect stage, with its own leaderboard.
  Picks lock with the stage deadline.
- **Captain** scores x2 (the vice-captain takes over if the captain doesn't play). The **sub** steps in for a starter who didn't play.
- **Transfers:** 2 free each stage (a stage can change this), then -4 points for each extra one.
- **Chips** (each once): Wildcard, Free Hit, Triple Captain, Bench Boost, Max Captain, 12th Man.
- **Tournaments:** League (matchweeks and a table) or Bracket (knockout rounds). Stages can be Group, Playoffs, Knockout or Final,
  and a stage can have its own free transfers and a budget bonus.
- **Leaderboard** per tournament, with a column for every stage, plus mini-leagues with join codes.

## For the organiser (admin.html)
1. Sign in on the game page, then open `admin.html`. Your account must have a document in the Firestore
   `admins` collection (the document ID is your user id; the admin page shows it if you are not an organiser yet).
2. Create a tournament (choose League or Bracket), edit the players, roles and prices, set the budget, lineup rules and points.
3. Add a stage for each part of the tournament, with a deadline, matches, the maps played (and their mode), and player stats.
   Stats can be typed in or imported from a Detail Report screenshot.
4. Press **Publish & update leaderboard**. This also scores everyone's Pick'Em picks. Prices can be updated between stages from the Players section.
5. To remove a tournament for good, use **Delete this tournament** in the Danger zone at the bottom (you type its name to confirm).
   It deletes the squads, scores, Pick'Em picks and mini-leagues too. Deploy `firestore.rules` first.

## Built with
HTML, CSS and JavaScript (no build step), Firebase Authentication, Firestore and Hosting.

## Running and deploying
- Open the folder with a local server (for example VS Code Live Server at http://127.0.0.1:5500). Opening the files directly will not work.
- Deploy with `firebase deploy` from this folder. Rules are in `firestore.rules`.
- Add any extra address you use under Firebase Authentication, Settings, Authorized domains.

## Files
- `script.js`: game rules, scoring and the squad screen
- `social.js`, `firebase.js`: sign-in, saving, leaderboard, leagues
- `admin.js`, `admin.html`, `import.js`, `ocr.js`: the organiser page and screenshot import
- `pickem.js`: the Pick'Em view
- `home.js`, `matches.js`, `stats.js`, `profile.js`, `share.js`, `rules.js`, `market-extras.js`, `account.js`, `nav.js`: the tabs and extras
- `data.js`: placeholder players used for the practice tournament and as the template for new ones

## Not built yet
- Live in-match swaps (a big build, probably not worth it)
- Reading bomb plants/defuses from screenshots (they're on the "More data" screen, not the Detail Report)
- Deadlines are enforced in the browser only, not on the server


## 2026 ruleset notes
- Roles follow the ruleset's six weapon classes (AR, SMG, LMG, Shotgun, Marksman, Sniper). The default lineup limits follow a team's role pool: up to 3 AR, 3 SMG, 1 LMG, 1 Shotgun, 1 Marksman, 1 Sniper. Change them per tournament in the admin settings.
- In a match's "+ Map" list, new maps default to the best-of-5 order: Hardpoint, Search & Destroy, Control, Hardpoint, Search & Destroy.
- Two roles: in the admin Players table every player has a main role and an optional second role ("+ 2nd role"). A starting five is valid if each player can be given one of their roles so the limits hold. Cards show both (e.g. "AR / SMG"), and the role filter finds a player under either.
- Map pools: each map in a match's list has a map picker with the ruleset pool for its mode (Hardpoint: Summit, Hacienda, Combine, Takeoff, Arsenal. S&D: Tunisia, Firing Range, Coastal, Slums, Meltdown. Control: Raid, Standoff, Crossroads Strike). The Matches tab shows it.
- Score limits: type each map's score next to its map. Limits from the ruleset are checked (Hardpoint 250, Control 3, Search & Destroy 9, up to 20 in overtime) and ties are refused. When every map has a score, the series score is filled in for you, and Publish warns if the two disagree. The Matches tab shows each map's score.
