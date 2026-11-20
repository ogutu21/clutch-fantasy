// Avatars for players and team logos.
// A "look" is a short string saved in the tournament data:
//   "lib:<id>"              a picture in the shared library (organisers upload them in the admin page; shrunk automatically)
//   "img:<path>"            a picture from the avatars folder (listed in avatars-library.js)
//   "data:image/..."        a photo or logo the organiser uploaded (shrunk to a small square)
//   ""                      nothing chosen: a badge with initials is drawn instead
(function () {
  "use strict";

  // Pictures you add yourself: put image files in an "avatars" folder next to index.html and list them in avatars-library.js.
  // The shared library, kept in Firestore (collection "avatarLibrary") so every device sees the same pictures.
  let cloudLib = {};        // id -> { id, name, data }
  let cloudOrder = [];
  function setCloud(list) {
    cloudLib = {};
    cloudOrder = [];
    (list || []).forEach(function (it) {
      if (it && typeof it.id === "string" && /^data:image\//.test(it.data || "")) { cloudLib[it.id] = it; cloudOrder.push(it.id); }
    });
  }
  async function loadCloud() {
    if (!window.Cloud || !window.Cloud.listAvatars) return;
    try {
      setCloud(await window.Cloud.listAvatars());
      window.dispatchEvent(new Event("avatars-ready"));
    } catch (e) { /* the library is optional */ }
  }
  if (window.Cloud) loadCloud(); else window.addEventListener("cloud-ready", loadCloud);

  function library() { return Array.isArray(window.AVATAR_LIBRARY) ? window.AVATAR_LIBRARY : []; }

  function initials(label) {
    const parts = String(label || "?").replace(/^Team /i, "").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
  }

  // The picture address for a look (library picture, uploaded photo or file), or null for none.
  function srcOf(look) {
    if (typeof look !== "string") return null;
    if (/^lib:[\w-]+$/.test(look)) { const it = cloudLib[look.slice(4)]; return it ? it.data : null; }
    if (/^data:image\/(png|jpeg|webp);base64,/.test(look)) return look;
    if (/^img:[\w\-./]+$/.test(look)) return look.slice(4);
    return null;
  }

  // ---- Players' own pictures (Firestore "profiles/<uid>") ----
  const profiles = {};      // uid -> look
  const names = {};         // uid -> chosen username
  const asked = {};         // uids already requested
  function initialsOf(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  // The round badge used for people (leaderboard, profile): their picture if they chose one, otherwise initials.
  function userEl(name, uid, big) {
    const b = document.createElement("span");
    b.className = "avatar" + (big ? " big" : "");
    b.setAttribute("data-uid", uid || "");
    b.setAttribute("data-name", name || "");
    b.setAttribute("data-big", big ? "1" : "");
    const src = uid ? srcOf(profiles[uid]) : null;
    if (src) {
      b.classList.add("has-pic");
      const img = document.createElement("img");
      img.src = src;
      img.alt = name || "";
      b.appendChild(img);
    } else {
      b.textContent = initialsOf((uid && names[uid]) || name);
    }
    return b;
  }
  function refreshUserEls() {
    document.querySelectorAll(".avatar[data-uid]").forEach(function (n) {
      const uid = n.getAttribute("data-uid");
      if (!uid) return;
      const fresh = userEl(n.getAttribute("data-name"), uid, !!n.getAttribute("data-big"));
      n.className = fresh.className;
      n.innerHTML = fresh.innerHTML;
    });
    document.querySelectorAll("[data-uname]").forEach(function (n) {
      const u = n.getAttribute("data-uname");
      if (u && names[u]) n.textContent = names[u];
    });
  }
  async function fetchProfiles(uids) {
    if (!window.Cloud || !window.Cloud.loadProfiles) return;
    const need = (uids || []).filter(function (u) { return u && !asked[u]; });
    if (!need.length) return;
    need.forEach(function (u) { asked[u] = true; });
    try {
      const got = await window.Cloud.loadProfiles(need);
      Object.keys(got || {}).forEach(function (u) {
        if (got[u].avatar) profiles[u] = got[u].avatar;
        if (got[u].username) names[u] = got[u].username;
      });
      refreshUserEls();
    } catch (e) { need.forEach(function (u) { delete asked[u]; }); }
  }
  // Save my own picture ("" removes it).
  async function saveMyPicture(uid, look) {
    await window.Cloud.saveProfile(look);
    if (look) profiles[uid] = look; else delete profiles[uid];
    asked[uid] = true;
    refreshUserEls();
  }
  function setMyName(uid, name) { names[uid] = name; asked[uid] = true; refreshUserEls(); }
  window.addEventListener("avatars-ready", refreshUserEls);

  // An element showing the look, a photo, or initials. label is used for the initials and the alt text.
  function make(look, label, size) {
    const box = document.createElement("span");
    box.className = "pic";
    const px = (size || 36) + "px";
    box.style.width = px;
    box.style.height = px;
    box.title = label || "";
    const shared = typeof look === "string" && /^lib:[\w-]+$/.test(look) ? cloudLib[look.slice(4)] : null;
    if ((typeof look === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(look)) || shared) {
      const img = document.createElement("img");
      img.src = shared ? shared.data : look;
      img.alt = label || "";
      box.appendChild(img);
    } else {
      if (typeof look === "string" && /^img:[\w\-./]+$/.test(look)) {
        const img = document.createElement("img");
        img.src = look.slice(4);
        img.alt = label || "";
        box.appendChild(img);
      } else {
        box.classList.add("pic-initials");
        box.style.fontSize = Math.round((size || 36) * 0.4) + "px";
        box.textContent = initials(label);
      }
    }
    return box;
  }

  // Shrink an uploaded image file to a small square JPEG (a data string) so it fits in the tournament document.
  function fromFile(file, done, size) {
    if (!file || !/^image\//.test(file.type)) { done(null, "That isn't an image."); return; }
    const reader = new FileReader();
    reader.onerror = function () { done(null, "Couldn't read that file."); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { done(null, "Couldn't open that image."); };
      img.onload = function () {
        const S = size || 128;
        // Crop the middle square, then shrink in halves: one big jump makes a blurry, jagged picture.
        const side = Math.min(img.width, img.height);
        let cur = document.createElement("canvas");
        let w = side;
        cur.width = w; cur.height = w;
        let g = cur.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, w, w);
        while (w / 2 >= S) {
          const next = document.createElement("canvas");
          w = Math.round(w / 2);
          next.width = w; next.height = w;
          g = next.getContext("2d");
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = "high";
          g.drawImage(cur, 0, 0, w, w);
          cur = next;
        }
        const out = document.createElement("canvas");
        out.width = S; out.height = S;
        g = out.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(cur, 0, 0, S, S);
        // WebP is smaller at the same quality; fall back to JPEG where the browser can't make it.
        let data = out.toDataURL("image/webp", 0.92);
        if (data.indexOf("data:image/webp") !== 0) data = out.toDataURL("image/jpeg", 0.92);
        done(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // A pop-up for choosing a look. onPick(look) gets "" for "no picture".
  function pick(title, current, onPick) {
    const back = document.createElement("div");
    back.className = "av-back";
    const box = document.createElement("div");
    box.className = "av-box";
    back.appendChild(box);
    const h = document.createElement("h3");
    h.textContent = title;
    box.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "av-grid";
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    function choose(look) { close(); onPick(look); }
    const lib = library();
    cloudOrder.forEach(function (id) {
      const it = cloudLib[id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-item";
      b.title = it.name || "";
      b.appendChild(make("lib:" + id, it.name, 56));
      b.addEventListener("click", function () { choose("lib:" + id); });
      grid.appendChild(b);
    });
    lib.forEach(function (it) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "av-item";
      b.title = it.name || "";
      b.appendChild(make("img:" + it.src, it.name, 56));
      b.addEventListener("click", function () { choose("img:" + it.src); });
      grid.appendChild(b);
    });
    if (!lib.length && !cloudOrder.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No shared pictures yet. Upload one below, or ask an organiser to add some to the picture library.";
      box.appendChild(p);
    }
    box.appendChild(grid);

    const msg = document.createElement("p");
    msg.className = "muted";
    const row = document.createElement("div");
    row.className = "av-actions";
    const up = document.createElement("input");
    up.type = "file";
    up.accept = "image/*";
    up.style.display = "none";
    up.addEventListener("change", function () {
      Avatars.fromFile(up.files[0], function (data, err) {
        if (err) { msg.textContent = err; return; }
        choose(data);
      });
    });
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "Upload a photo or logo";
    upBtn.addEventListener("click", function () { up.click(); });
    const none = document.createElement("button");
    none.type = "button";
    none.className = "outline";
    none.textContent = "No picture (initials)";
    none.addEventListener("click", function () { choose(""); });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "outline";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    row.appendChild(upBtn); row.appendChild(up); row.appendChild(none); row.appendChild(cancel);
    box.appendChild(row);
    box.appendChild(msg);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    // A modal <dialog> sits above everything else on the page, so inside one the chooser has to live in it.
    (document.querySelector("dialog[open]") || document.body).appendChild(back);
  }

  // Shrink an image to a 256px square and add it to the shared library (organisers only). done(err, item).
  function addToLibrary(file, done) {
    if (!window.Cloud || !window.Cloud.addAvatar) { done("Sign in as an organiser first."); return; }
    fromFile(file, function (data, err) {
      if (err) { done(err); return; }
      const name = String(file.name || "Picture").replace(/\.[^.]+$/, "").slice(0, 40) || "Picture";
      window.Cloud.addAvatar(name, data).then(function (id) {
        cloudLib[id] = { id: id, name: name, data: data };
        cloudOrder.push(id);
        done(null, cloudLib[id]);
      }).catch(function (e) { done((e && e.message) || "Couldn't save the picture."); });
    }, 256);
  }
  function removeFromLibrary(id) {
    return window.Cloud.deleteAvatar(id).then(function () {
      delete cloudLib[id];
      cloudOrder = cloudOrder.filter(function (x) { return x !== id; });
    });
  }

  const Avatars = {
    make: make, pick: pick, fromFile: fromFile, addToLibrary: addToLibrary, removeFromLibrary: removeFromLibrary,
    srcOf: srcOf, userEl: userEl, fetchProfiles: fetchProfiles, saveMyPicture: saveMyPicture, profileOf: function (uid) { return profiles[uid] || ""; }, nameOf: function (uid) { return names[uid] || ""; }, setMyName: setMyName,
    libraryItems: function () { return cloudOrder.map(function (id) { return cloudLib[id]; }); }, reload: loadCloud,
  };
  window.Avatars = Avatars;
})();
