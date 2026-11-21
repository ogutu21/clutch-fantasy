# Clutch Fantasy

A fantasy game for university Call of Duty: Mobile tournaments. Pick a squad under a budget,
score points from real match stats, and climb the leaderboard. Each tournament has its own
players, stages, leaderboard and mini-leagues.

Live site: https://clutch-fantasy-55b29.web.app

## How the game works
- **Squad:** 6 players (5 starters + 1 sub), a budget, and at most 3 players from one team.
- **Roles:** AR, SMG, Marksman, Sniper. The organiser sets how many of each role a starting five may have.
- **Points:** kills, assists, deaths, team win, MVP. Search & Destroy kills earn a bonus, bomb plants and defuses earn points,
  time on the hill (Hardpoint) earns points, and every map your team wins in its match earns points. All the numbers are set per tournament.
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

6. **Back up this tournament (JSON)** saves players, stages, results, settings and every squad, score and Pick'Em pick to a file. **Restore setup from a backup** puts back the players, stages, results and settings only.
7. **Update prices** can work from performance (points) or demand (how many squads own the player; needs one Publish first).

## Extras
- Season table on the home page: points from all tournaments added together (newest tournament breaks ties).
- Double-elimination playoffs after the group stage: in admin press **+ Double-elimination playoffs**, pick the four seeds. Four stages are added (UB Semifinals, UB Final & LB Semifinal, LB Final, Grand Final). Enter each result and Publish: the next matches are created automatically. Players see the bracket under Matches > Playoffs.
- League chat: every mini-league has a message box under its table (members only, 300 characters, delete your own; the league owner can delete any). Needs `firebase deploy --only firestore:rules`.
- Pick'Em leaderboard ties: points, then correct picks.
- Installable on a phone (Add to Home Screen): `manifest.json`, `sw.js`, `icons/`. Pages always load from the network first, so deploys show straight away.

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
- `manifest.json`, `sw.js`, `icons/`, `logo.jpg`: the installable app and the league logo
- `data.js`: placeholder players used for the practice tournament and as the template for new ones

## Not built yet
- Live in-match swaps (a big build, probably not worth it)
- Reading bomb plants and defuses from screenshots (needs a "More data" sample screenshot)
- Deadlines are enforced in the browser only, not on the server. Squads of all stages live in one document, so the rules can't tell which stage was edited; fixing that means storing one document per stage (a bigger change)
