# Dry run checklist

Do this once on the real site before inviting everyone. Use a throwaway tournament called "Dry run" and delete it afterwards (admin page, Delete tournament).

## Before you start
- [ ] `firebase deploy --only firestore:rules` and `firebase deploy --only hosting` done with the latest files
- [ ] You can open the admin page and see the Picture library and Tournaments sections (proves the admin rule works)
- [ ] Authentication, Settings, Authorized domains lists your web address

## Setup (admin page)
- [ ] Create a tournament "Dry run" (League format)
- [ ] Add teams and players. Rename one team and check its players and matches follow
- [ ] Give one player a picture and one team a logo
- [ ] Add a stage with a deadline a few hours ahead, and a match with maps (Hardpoint, Search & Destroy, Control) and their scores
- [ ] Publish. Open the tournament page on your phone

## Players (use 2 or 3 friends plus a second account of your own)
- [ ] Sign up with a username. Try one that is taken: it should be refused
- [ ] Pick a squad. Check the Home banner while it is incomplete, then ready
- [ ] Leave the page with an incomplete squad: you should get the "Leave anyway?" check
- [ ] Choose a profile picture
- [ ] Join a mini-league with a code

## Results (admin page)
- [ ] Squads not ready: press Check squads and compare with what the players see
- [ ] Import one real screenshot of each mode (Hardpoint, Search & Destroy, Control). Check names, K/D/A, Hardpoint times
- [ ] Type bomb plants and defuses by hand for the Search & Destroy match
- [ ] Publish & update leaderboard. Check the leaderboard, ownership percentages on market cards and Pick'Em
- [ ] Download the leaderboard CSV and the stage CSV and open them in Excel

## Tie-break
- [ ] Make two players level on points but different in the latest stage and check the order matches the Rules text

## Clean up
- [ ] Delete the "Dry run" tournament

## Added in build 18
- Home page (signed in): Season table appears and lists you.
- Admin: Back up this tournament downloads a .json; restoring it into a throwaway tournament fills the players and stages (then Publish).
- Admin: Update prices > Based on Demand works after one Publish.
- Phone: open the site in Chrome, menu > Add to Home Screen / Install app.
- League chat: with two accounts in one mini-league, send a message from each; both appear within a second; delete one; the person who is not in the league can't see it.
- Playoffs: add the double-elimination stages with 4 teams, enter the two UB semifinal scores, Publish, and check the UB Final and LB Semifinal appear and the Playoffs tab shows them.
