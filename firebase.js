// Talks to Firebase. Loaded as a module (see index.html). Everything the rest of the
// app needs is exposed as window.Cloud, so the game code never imports Firebase itself.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, writeBatch, serverTimestamp,
  collection, query, where, orderBy, limit, getDocs, documentId,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const MAX_LEAGUE_SIZE = 30;   // Firestore "in" queries take at most 30 ids
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O/1/I to avoid mix-ups

const config = window.FIREBASE_CONFIG;
const configured = config && config.apiKey && !config.apiKey.startsWith("PASTE");

if (!configured) {
  window.Cloud = null;   // the game still works offline
} else {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const listeners = [];

  const RESERVED = ["admin", "administrator", "organiser", "organizer", "moderator", "mod", "support", "clutch", "clutchfantasy", "staff", "official"];

  // Returns a message if the username isn't allowed, or null if it is.
  function checkUsername(name) {
    const n = String(name || "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(n)) return "A username is 3 to 20 letters, numbers or underscores (no spaces).";
    if (RESERVED.indexOf(n.toLowerCase()) !== -1) return "That username is reserved. Try another one.";
    return null;
  }

  async function isUsernameFree(name) {
    const snap = await getDoc(doc(db, "usernames", String(name).trim().toLowerCase()));
    if (!snap.exists()) return true;
    return !!(auth.currentUser && snap.data().uid === auth.currentUser.uid);
  }

  // Claim a username for the signed-in player and release their old one.
  async function setUsername(name) {
    const u = auth.currentUser;
    if (!u) throw new Error("Please sign in first");
    const n = String(name).trim();
    const problem = checkUsername(n);
    if (problem) throw new Error(problem);
    if (!(await isUsernameFree(n))) throw new Error("That username is taken. Try another one.");
    const key = n.toLowerCase();
    const mine = await getDoc(doc(db, "profiles", u.uid));
    const oldName = mine.exists() ? mine.data().username : null;
    const batch = writeBatch(db);
    batch.set(doc(db, "usernames", key), { uid: u.uid, createdAt: serverTimestamp() });
    batch.set(doc(db, "profiles", u.uid), { username: n, updatedAt: serverTimestamp() }, { merge: true });
    if (oldName && oldName.toLowerCase() !== key) batch.delete(doc(db, "usernames", oldName.toLowerCase()));
    try {
      await batch.commit();
    } catch (e) {
      if (e && e.code === "permission-denied") throw new Error("Couldn't save that username (it may have just been taken).");
      throw e;
    }
    await updateProfile(u, { displayName: n });
    return n;
  }

  function currentUser() {
    const u = auth.currentUser;
    if (!u) return null;
    return { uid: u.uid, email: u.email, name: u.displayName || (u.email || "Player").split("@")[0] };
  }

  function emit() {
    const u = currentUser();
    listeners.forEach(function (cb) { cb(u); });
  }

  onAuthStateChanged(auth, emit);

  function makeCode() {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return code;
  }

  function needUser() {
    const u = currentUser();
    if (!u) throw new Error("Please sign in first");
    return u;
  }

  window.Cloud = {
    onAuth: function (cb) { listeners.push(cb); cb(currentUser()); },

    signInGoogle: async function () {
      const provider = new GoogleAuthProvider();
      try {
        return await signInWithPopup(auth, provider);
      } catch (e) {
        // Popup blocked: use a full-page redirect instead.
        if (e.code === "auth/popup-blocked") return signInWithRedirect(auth, provider);
        throw e;
      }
    },

    // Usernames: 3-20 letters, numbers or underscores, unique (not case sensitive).
    checkUsername: checkUsername,
    isUsernameFree: isUsernameFree,
    setUsername: setUsername,

    signUp: async function (name, email, password) {
      // Check the username before creating the account, so a taken name doesn't leave a half-made account.
      const problem = checkUsername(name);
      if (problem) throw new Error(problem);
      if (!(await isUsernameFree(name))) throw new Error("That username is taken. Try another one.");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      try { await setUsername(name); } catch (e) { /* the account exists; they can set the username again from the profile */ }
      emit();   // the name was set after the first auth event, so tell the app again
    },

    signIn: function (email, password) { return signInWithEmailAndPassword(auth, email, password); },

    logOut: function () { return signOut(auth); },

    // ---- Tournaments. Anyone can read them, only the organiser creates or changes them. ----

    listTournaments: async function () {
      const snap = await getDocs(collection(db, "tournaments"));
      const list = snap.docs.map(function (d) {
        return { id: d.id, name: d.data().name, status: d.data().status, createdAt: d.data().createdAt };
      });
      list.sort(function (a, b) {
        const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
        const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
        return tb - ta;   // newest first
      });
      return list;
    },

    // Returns { id, name, status, data: { players, rounds } } or null.
    loadTournament: async function (tid) {
      const snap = await getDoc(doc(db, "tournaments", tid));
      if (!snap.exists()) return null;
      return { id: snap.id, name: snap.data().name, status: snap.data().status, data: JSON.parse(snap.data().json) };
    },

    // ---- A player's squads in one tournament (private to them) ----

    // The squads are stored as one JSON string (simple and avoids Firestore array limits).
    loadSquads: async function (tid) {
      const u = needUser();
      const snap = await getDoc(doc(db, "tournaments", tid, "squads", u.uid));
      return snap.exists() ? JSON.parse(snap.data().json) : null;
    },

    // Scores are NOT written here: only the organiser writes scores (see writeScores),
    // so players can't fake their points.
    saveProgress: async function (tid, p) {
      const u = needUser();
      await setDoc(doc(db, "tournaments", tid, "squads", u.uid), {
        json: JSON.stringify(p.squads), name: String(p.name).slice(0, 30), updatedAt: serverTimestamp(),
      });
    },

    // ---- Organiser tools ----
    isAdmin: async function () {
      const u = currentUser();
      if (!u) return false;
      const snap = await getDoc(doc(db, "admins", u.uid));
      return snap.exists();
    },

    createTournament: async function (name, data) {
      needUser();
      const ref = doc(collection(db, "tournaments"));   // a fresh id
      await setDoc(ref, {
        name: String(name).slice(0, 60), status: "open", json: JSON.stringify(data),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      return ref.id;
    },

    saveTournament: async function (tid, t) {
      needUser();
      await updateDoc(doc(db, "tournaments", tid), {
        name: String(t.name).slice(0, 60), status: t.status, json: JSON.stringify(t.data), updatedAt: serverTimestamp(),
      });
    },

    allSquads: async function (tid) {
      needUser();
      const snap = await getDocs(collection(db, "tournaments", tid, "squads"));
      return snap.docs.map(function (d) {
        return { uid: d.id, name: d.data().name || "Player", json: d.data().json };
      });
    },

    writeScores: async function (tid, rows) {
      needUser();
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        rows.slice(i, i + 400).forEach(function (r) {
          batch.set(doc(db, "tournaments", tid, "scores", r.uid), {
            name: String(r.name).slice(0, 30), total: r.total, rounds: r.rounds, updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
    },

    // Players' own pictures: one small document per player, only they can change theirs.
    loadProfiles: async function (uids) {
      const out = {};
      for (let i = 0; i < uids.length; i += MAX_LEAGUE_SIZE) {
        const chunk = uids.slice(i, i + MAX_LEAGUE_SIZE);
        const snap = await getDocs(query(collection(db, "profiles"), where(documentId(), "in", chunk)));
        snap.forEach(function (d) { out[d.id] = { avatar: d.data().avatar || "", username: d.data().username || "" }; });
      }
      return out;
    },
    saveProfile: async function (avatar) {
      const u = needUser();
      await setDoc(doc(db, "profiles", u.uid), { avatar: String(avatar || ""), updatedAt: serverTimestamp() }, { merge: true });
    },

    // Shared picture library (small resized pictures; only the organiser can add or remove).
    listAvatars: async function () {
      const snap = await getDocs(collection(db, "avatarLibrary"));
      const out = snap.docs.map(function (d) { return { id: d.id, name: d.data().name || "", data: d.data().data || "", at: d.data().createdAt ? d.data().createdAt.toMillis() : 0 }; });
      out.sort(function (a, b) { return a.at - b.at; });
      return out;
    },
    addAvatar: async function (name, data) {
      needUser();
      const ref = doc(collection(db, "avatarLibrary"));
      await setDoc(ref, { name: String(name).slice(0, 40), data: String(data), createdAt: serverTimestamp() });
      return ref.id;
    },
    deleteAvatar: async function (id) {
      needUser();
      await deleteDoc(doc(db, "avatarLibrary", id));
    },

    // Ownership percentages: one special doc inside "scores" with no "total" field, so it never shows on the leaderboard.
    writeOwnership: async function (tid, o) {
      needUser();
      await setDoc(doc(db, "tournaments", tid, "scores", "_ownership"), {
        json: JSON.stringify(o), updatedAt: serverTimestamp(),
      });
    },
    loadOwnership: async function (tid) {
      needUser();
      const snap = await getDoc(doc(db, "tournaments", tid, "scores", "_ownership"));
      if (!snap.exists()) return null;
      try { return JSON.parse(snap.data().json); } catch (e) { return null; }
    },

    // Remove leaderboard rows (used when the organiser holds a squad back for review).
    deleteScores: async function (tid, uids) {
      needUser();
      for (const uid of uids) {
        await deleteDoc(doc(db, "tournaments", tid, "scores", uid));
      }
    },

    // ---- Pick'Em: a player's predictions (private) and the organiser-written Pick'Em scores ----

    loadPicks: async function (tid) {
      const u = needUser();
      const snap = await getDoc(doc(db, "tournaments", tid, "picks", u.uid));
      return snap.exists() ? JSON.parse(snap.data().json) : {};
    },

    savePicks: async function (tid, p) {
      const u = needUser();
      await setDoc(doc(db, "tournaments", tid, "picks", u.uid), {
        json: JSON.stringify(p.picks), name: String(p.name).slice(0, 30), updatedAt: serverTimestamp(),
      });
    },

    allPicks: async function (tid) {
      needUser();
      const snap = await getDocs(collection(db, "tournaments", tid, "picks"));
      return snap.docs.map(function (d) {
        return { uid: d.id, name: d.data().name || "Player", json: d.data().json };
      });
    },

    writePickScores: async function (tid, rows) {
      needUser();
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        rows.slice(i, i + 400).forEach(function (r) {
          batch.set(doc(db, "tournaments", tid, "pickscores", r.uid), {
            name: String(r.name).slice(0, 30), total: r.total, correct: r.correct, played: r.played,
            rounds: r.rounds, updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
    },

    topPickScores: async function (tid, n) {
      needUser();
      const q = query(collection(db, "tournaments", tid, "pickscores"), orderBy("total", "desc"), limit(n));
      const snap = await getDocs(q);
      return snap.docs.map(function (d) {
        return { uid: d.id, name: d.data().name, total: d.data().total, correct: d.data().correct || 0, played: d.data().played || 0 };
      });
    },

    // Delete a tournament completely: its squads, leaderboard rows, mini-leagues, then the tournament itself.
    // Needs the organiser rules from firestore.rules. Returns how many documents were removed.
    deleteTournament: async function (tid) {
      needUser();
      let removed = 0;
      async function wipe(refs) {
        for (let i = 0; i < refs.length; i += 400) {
          const batch = writeBatch(db);
          refs.slice(i, i + 400).forEach(function (r) { batch.delete(r); });
          await batch.commit();
        }
        removed += refs.length;
      }
      const squads = await getDocs(collection(db, "tournaments", tid, "squads"));
      await wipe(squads.docs.map(function (d) { return d.ref; }));
      const scores = await getDocs(collection(db, "tournaments", tid, "scores"));
      await wipe(scores.docs.map(function (d) { return d.ref; }));
      const picks = await getDocs(collection(db, "tournaments", tid, "picks"));
      await wipe(picks.docs.map(function (d) { return d.ref; }));
      const pickScores = await getDocs(collection(db, "tournaments", tid, "pickscores"));
      await wipe(pickScores.docs.map(function (d) { return d.ref; }));
      const leagues = await getDocs(query(collection(db, "leagues"), where("tournamentId", "==", tid)));
      await wipe(leagues.docs.map(function (d) { return d.ref; }));
      await deleteDoc(doc(db, "tournaments", tid));
      return removed + 1;
    },

    // ---- Leaderboard and mini-leagues (all inside one tournament) ----

    topScores: async function (tid, n) {
      needUser();
      const q = query(collection(db, "tournaments", tid, "scores"), orderBy("total", "desc"), limit(n));
      const snap = await getDocs(q);
      return snap.docs.map(function (d) {
        return { uid: d.id, name: d.data().name, total: d.data().total, rounds: d.data().rounds || [] };
      });
    },

    createLeague: async function (tid, name) {
      const u = needUser();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        try {
          // The rules only allow a create when no league with this code exists yet.
          await setDoc(doc(db, "leagues", code), {
            name: String(name).slice(0, 40), tournamentId: tid, ownerId: u.uid,
            memberIds: [u.uid], createdAt: serverTimestamp(),
          });
          return code;
        } catch (e) {
          if (attempt === 4) throw e;
        }
      }
    },

    joinLeague: async function (tid, rawCode) {
      const u = needUser();
      const code = String(rawCode).trim().toUpperCase();
      const ref = doc(db, "leagues", code);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("No league with that code");
      if (snap.data().tournamentId !== tid) throw new Error("That code belongs to a different tournament");
      const ids = snap.data().memberIds;
      if (ids.includes(u.uid)) return { code: code, name: snap.data().name };
      if (ids.length >= MAX_LEAGUE_SIZE) throw new Error("That league is full");
      await updateDoc(ref, { memberIds: arrayUnion(u.uid) });
      return { code: code, name: snap.data().name };
    },

    // Leagues you're in, for this tournament only.
    myLeagues: async function (tid) {
      const u = needUser();
      const q = query(collection(db, "leagues"), where("memberIds", "array-contains", u.uid));
      const snap = await getDocs(q);
      return snap.docs
        .filter(function (d) { return d.data().tournamentId === tid; })
        .map(function (d) { return { code: d.id, name: d.data().name, count: d.data().memberIds.length }; });
    },

    leagueTable: async function (tid, code) {
      needUser();
      const snap = await getDoc(doc(db, "leagues", code));
      if (!snap.exists() || snap.data().tournamentId !== tid) throw new Error("League not found");
      const ids = snap.data().memberIds;
      const q = query(collection(db, "tournaments", tid, "scores"), where(documentId(), "in", ids));
      const scores = await getDocs(q);
      const byId = {};
      scores.docs.forEach(function (d) { byId[d.id] = d.data(); });
      const rows = ids.map(function (id) {
        const s = byId[id];
        return { uid: id, name: s ? s.name : "(awaiting results)", total: s ? s.total : 0, rounds: s ? (s.rounds || []) : [] };
      });
      rows.sort(function (a, b) { return b.total - a.total; });
      return { name: snap.data().name, code: code, rows: rows };
    },
  };
}

window.dispatchEvent(new Event("cloud-ready"));