"use strict";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarsePointer = matchMedia("(pointer: coarse)").matches;

const Audio_ = (() => {
  const SFX_FILES = {
    select: "assets/audio/menu-select.wav",
    enter: "assets/audio/enter.wav",
    equip: "assets/audio/equip.wav",
    unequip: "assets/audio/unequip.wav",
    leave: "assets/audio/leave.wav",

  };
  let ctx = null;
  let master = null;
  const buffers = {};
  const pending = {};
  let enabled = true;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    for (const name of Object.keys(SFX_FILES)) load(name);
    return ctx;
  }

  function load(name) {
    if (pending[name]) return pending[name];
    pending[name] = (async () => {
      try {
        const r = await fetch(SFX_FILES[name]);
        if (!r.ok) throw new Error(r.status);
        buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch {
        buffers[name] = null;
      }
    })();
    return pending[name];
  }

  function synthSelect(t) {
    const notes = [[1568, 0], [2093, 0.055]];
    for (const [freq, off] of notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.5, t + off + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
      g.connect(master);
      const o1 = ctx.createOscillator();
      o1.type = "sine"; o1.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = "triangle"; o2.frequency.value = freq * 2;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o1.connect(g); o2.connect(g2); g2.connect(g);
      o1.start(t + off); o2.start(t + off);
      o1.stop(t + off + 0.25); o2.stop(t + off + 0.25);
    }
  }

  function play(name) {
    if (!enabled || !SFX_FILES[name]) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") c.resume();

    if (!(name in buffers)) { load(name).then(() => play(name)); return; }
    const t = c.currentTime;
    const buf = buffers[name];
    if (buf) {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start(t);
    } else if (name === "select") {
      synthSelect(t);
    }
  }

  function unlock() {
    const c = ensureContext();
    if (c && c.state === "suspended") c.resume();
  }

  ensureContext();

  return {
    play, unlock,
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },
  };
})();

function spawnRipple(el, x, y) {
  if (reducedMotion) return;
  const r = el.getBoundingClientRect();
  const s = Math.ceil(Math.max(r.width, r.height) / 6) + 2;
  const dot = document.createElement("span");
  dot.className = "ripple";
  dot.style.setProperty("--x", `${x - r.left}px`);
  dot.style.setProperty("--y", `${y - r.top}px`);
  dot.style.setProperty("--s", s);
  el.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove(), { once: true });
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const sfxEl = e.target.closest("[data-sfx]");
  if (sfxEl) Audio_.play(sfxEl.dataset.sfx);
  const fxEl = e.target.closest(".btn-fx");
  if (fxEl) spawnRipple(fxEl, e.clientX, e.clientY);
}, { passive: true });

document.addEventListener("click", (e) => {
  const a = e.target.closest('a[data-sfx="leave"]');
  if (!a || !Audio_.enabled) return;
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute("href");
  if (!href || href === "#" || href.startsWith("mailto:") || a.target === "_blank") return;
  e.preventDefault();
  setTimeout(() => { location.href = href; }, 900);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest("[data-sfx]");
  if (!el) return;
  Audio_.play(el.dataset.sfx);
  if (el.classList.contains("btn-fx")) {
    const r = el.getBoundingClientRect();
    spawnRipple(el, r.left + r.width / 2, r.top + r.height / 2);
  }
});

function particles(canvas, opts) {
  if (!canvas || reducedMotion) return { stop() {} };
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  let w = 0, h = 0, raf = 0, running = false, last = 0;
  const pts = [];

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(opts.max, (w * h) / opts.density));
    while (pts.length < n) pts.push(spawn(true));
    pts.length = n;
  }
  function spawn(anywhere) {
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]),
      vx: (Math.random() - 0.5) * opts.drift,
      vy: -(opts.rise[0] + Math.random() * (opts.rise[1] - opts.rise[0])),
      ph: Math.random() * Math.PI * 2,
      tw: 0.6 + Math.random() * 1.4,
    };
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.color;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.ph += dt * p.tw;
      p.x += (p.vx + Math.sin(p.ph) * opts.sway) * dt;
      p.y += p.vy * dt;
      if (p.y < -10 || p.x < -10 || p.x > w + 10) pts[i] = spawn(false);
      const a = opts.alpha * (0.5 + 0.5 * Math.sin(p.ph * 2));
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  resize();
  addEventListener("resize", resize, { passive: true });
  new IntersectionObserver(([en]) => (en.isIntersecting ? start() : stop())).observe(canvas);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  return { stop, start };
}

const stars = particles($("#title-stars"), { max: 90, density: 9000, size: [0.6, 1.8], drift: 4, rise: [2, 8], sway: 3, alpha: 0.9, color: "#efe3c2" });
particles($("#fireflies"), { max: 45, density: 22000, size: [1.2, 2.6], drift: 12, rise: [6, 18], sway: 10, alpha: 0.85, color: "#f3d77a" });

const bgm = $("#bgm");
bgm.volume = 0.4;
const titleScreen = $("#title-screen");
const musicBtn = $("#toggle-music");
const sfxBtn = $("#toggle-sfx");
document.body.classList.add("is-locked");

function setMusic(on) {
  if (on) bgm.play().catch(() => setMusicUI(false));
  else bgm.pause();
  setMusicUI(on);
}
function setMusicUI(on) { musicBtn.setAttribute("aria-pressed", String(on)); }
bgm.addEventListener("error", () => setMusicUI(false));

$("#press-start").addEventListener("click", () => {
  Audio_.unlock();
  titleScreen.classList.add("is-leaving");
  document.body.classList.remove("is-locked");
  setMusic(true);
  revealHero();
  setTimeout(() => { titleScreen.classList.add("is-hidden"); stars.stop(); }, 750);
});

musicBtn.addEventListener("click", () => setMusic(bgm.paused));
sfxBtn.addEventListener("click", () => {
  Audio_.enabled = !Audio_.enabled;
  sfxBtn.setAttribute("aria-pressed", String(Audio_.enabled));
});

(function splitTitle() {
  const el = $("[data-split]");
  if (!el) return;
  const text = el.textContent;
  el.textContent = "";
  [...text].forEach((ch, i) => {
    const s = document.createElement("span");
    s.className = "ch"; s.style.setProperty("--n", i); s.textContent = ch;
    el.appendChild(s);
  });
})();

function revealHero() {
  $$(".hero .reveal").forEach((el, i) => { el.style.setProperty("--n", i); el.classList.add("is-in"); });
}

(function parallax() {
  const bg = $("[data-parallax]");
  if (!bg || reducedMotion) return;
  let ticking = false;
  const update = () => {
    const y = Math.min(scrollY, innerHeight);
    bg.style.transform = `translate3d(0, ${y * 0.25}px, 0)`;
    ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
})();

const revealIO = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    en.target.classList.add("is-in");
    revealIO.unobserve(en.target);
  }
}, { rootMargin: "0px 0px -10% 0px" });
$$(".reveal:not(.hero .reveal)").forEach((el) => revealIO.observe(el));

const links = $$(".subscreen__list a");
const cursor = $("#menu-cursor");
const sections = links.map((a) => $(a.getAttribute("href")));

function moveCursor(a) {
  if (!a) { cursor.classList.remove("is-on"); return; }
  cursor.style.setProperty("--x", `${a.offsetLeft}px`);
  cursor.style.setProperty("--w", `${a.offsetWidth}px`);
  cursor.style.setProperty("--y", `${a.offsetTop}px`);
  cursor.style.setProperty("--h", `${a.offsetHeight}px`);

  a.parentElement.parentElement.scrollTo({ left: a.offsetLeft - 16, behavior: reducedMotion ? "auto" : "smooth" });
  cursor.classList.add("is-on");
}
function setActive(id) {
  let active = null;
  for (const a of links) {
    const on = a.getAttribute("href") === "#" + id;
    a.classList.toggle("is-active", on);
    if (on) active = a;
  }
  moveCursor(active);
}
const sectionIO = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) setActive(en.target.id);
}, { rootMargin: "-40% 0px -50% 0px" });
sections.forEach((s) => s && sectionIO.observe(s));
links.forEach((a) => a.addEventListener("mouseenter", () => moveCursor(a)));
$("#menu").addEventListener("mouseleave", () => moveCursor($(".subscreen__list a.is-active")));
addEventListener("resize", () => moveCursor($(".subscreen__list a.is-active")), { passive: true });

(function equipment() {
  const list = $("#gear");
  const label = $("#equipped");
  if (!list) return;

  function burst(item) {
    if (reducedMotion) return;
    const ring = document.createElement("i");
    ring.className = "ring";
    item.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const d = 34 + Math.random() * 24;
      s.style.setProperty("--dx", `${Math.cos(ang) * d}px`);
      s.style.setProperty("--dy", `${Math.sin(ang) * d}px`);
      item.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
    }
  }

  function equip(item) {
    const was = item.classList.contains("is-equipped");
    $$(".gear__item", list).forEach((el) => el.classList.remove("is-equipped"));
    item.classList.remove("is-equipping");
    void item.offsetWidth;
    item.classList.add("is-equipping");
    if (!was) item.classList.add("is-equipped");
    Audio_.play(was ? "unequip" : "equip");
    burst(item);
    label.textContent = was ? "Nothing equipped." : `Equipped: ${$(".gear__name", item).textContent}.`;
  }

  list.addEventListener("click", (e) => {
    const item = e.target.closest(".gear__item:not(.gear__item--empty)");
    if (item) equip(item);
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".gear__item:not(.gear__item--empty)");
    if (item) { e.preventDefault(); equip(item); }
  });
})();

(function tilt() {
  if (coarsePointer || reducedMotion) return;
  let raf = 0;
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".rcard:not(.rcard--locked)");
    if (!card) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(900px) rotateY(${px * 8}deg) rotateX(${-py * 8}deg) translateY(-4px)`;
    });
  }, { passive: true });
  document.addEventListener("pointerout", (e) => {
    const card = e.target.closest(".rcard");
    if (card && !card.contains(e.relatedTarget)) card.style.transform = "";
  }, { passive: true });
})();

(function robloxCards() {
  const cards = $$(".rcard[data-roblox]");
  if (!cards.length) return;
  const cache = (window.ROBLOX_GAMES && window.ROBLOX_GAMES.games) || {};

  const placeIdFrom = (s) => {
    const m = String(s).match(/games\/(\d+)/) || String(s).match(/^(\d+)$/);
    return m ? m[1] : null;
  };
  const fmt = (n) => {
    if (n == null) return "–";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function skeleton(card) {
    card.classList.add("is-loading");
    card.insertAdjacentHTML("afterbegin", `
      <div class="rcard__thumb"></div>
      <div class="rcard__head"><div class="rcard__icon"></div><div style="flex:1"><span class="sk" style="width:70%"></span><span class="sk" style="width:40%;margin-top:.4rem"></span></div></div>
      <div class="rcard__stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div>
      <div class="rcard__desc"><span class="sk"></span><span class="sk" style="margin-top:.4rem;width:80%"></span></div>`);
  }

  function render(card, g) {
    const total = (g.upVotes || 0) + (g.downVotes || 0);
    const pct = total ? Math.round((g.upVotes / total) * 100) : null;
    const note = $(".rcard__note", card);
    card.querySelectorAll(":scope > :not(.rcard__note)").forEach((n) => n.remove());
    card.classList.remove("is-loading");
    card.classList.add("is-ready");
    if (g.universeId) card.dataset.universe = g.universeId;
    card.insertAdjacentHTML("afterbegin", `
      <div class="rcard__body">
        <div class="rcard__thumb">
          <span class="rcard__live" data-field="playing"${g.playing == null ? " hidden" : ""}>${fmt(g.playing ?? 0)} playing</span>
          ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" loading="lazy" decoding="async">` : ""}
        </div>
        <div class="rcard__head">
          <div class="rcard__icon">${g.icon ? `<img src="${esc(g.icon)}" alt="" loading="lazy" decoding="async">` : ""}</div>
          <h3 class="rcard__title">${esc(g.name)}<span class="rcard__creator">by ${esc(g.creator)}</span></h3>
        </div>
        <div class="rcard__stats">
          <div class="rcard__stat"><b><img src="assets/img/icons/rupee.png" alt="" width="32" height="32"><span data-count="${g.visits ?? 0}" data-field="visits">0</span></b><small>visits</small></div>
          <div class="rcard__stat"><b><img src="assets/img/icons/heart-piece.png" alt="" width="32" height="32"><span data-count="${g.favorites ?? 0}" data-field="favorites">0</span></b><small>favorites</small></div>
          <div class="rcard__stat"><b><img src="assets/img/icons/gold-skulltula.png" alt="" width="32" height="32"><span data-field="rating">${pct == null ? "–" : pct + "%"}</span></b><small><span data-field="likes">${fmt(g.upVotes)}</span> likes</small></div>
        </div>
        <div class="rcard__rating" aria-hidden="true"><i data-field="bar" style="--pct:${pct ?? 0}%"></i></div>
        <p class="rcard__desc">${esc(g.description).split("\n")[0]}</p>
        <div class="rcard__foot">
          <a class="rcard__play btn-fx" href="${esc(g.url)}" target="_blank" rel="noopener" data-sfx="leave"><svg><use href="#ic-play"/></svg>Play</a>
          <span class="rcard__genre">${esc(g.genre || "")}</span>
        </div>
      </div>`);
    if (note) card.appendChild(note);
    countUp(card);
  }

  function renderError(card, msg) {
    card.querySelectorAll(":scope > :not(.rcard__note)").forEach((n) => n.remove());
    card.classList.remove("is-loading");
    card.classList.add("is-error");
    card.insertAdjacentHTML("afterbegin", `<div class="rcard__thumb">${esc(msg)}</div>`);
  }

  function countUp(card) {
    const spans = $$("[data-count]", card);
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now(), dur = reducedMotion ? 0 : 1100;
      const step = (now) => {
        const k = dur ? Math.min((now - t0) / dur, 1) : 1;
        const e = 1 - Math.pow(1 - k, 3);
        for (const s of spans) s.textContent = fmt(Math.round(Number(s.dataset.count) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.3 });
    io.observe(card);
  }

  const RP = {
    apis: "https://apis.roproxy.com",
    games: "https://games.roproxy.com",
    thumbs: "https://thumbnails.roproxy.com",
  };
  async function getJson(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function fetchLive(placeId) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const { universeId } = await getJson(`${RP.apis}/universes/v1/places/${placeId}/universe`, ac.signal);
      const [games, votes, icons, thumbs] = await Promise.all([
        getJson(`${RP.games}/v1/games?universeIds=${universeId}`, ac.signal),
        getJson(`${RP.games}/v1/games/votes?universeIds=${universeId}`, ac.signal).catch(() => ({ data: [] })),
        getJson(`${RP.thumbs}/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`, ac.signal).catch(() => ({ data: [] })),
        getJson(`${RP.thumbs}/v1/games/multiget/thumbnails?universeIds=${universeId}&size=768x432&format=Png&countPerUniverse=1`, ac.signal).catch(() => ({ data: [] })),
      ]);
      const g = games.data[0], v = votes.data[0] || {};
      return {
        placeId, universeId, name: g.name, description: g.description, creator: g.creator?.name,
        playing: g.playing, visits: g.visits, favorites: g.favoritedCount, genre: g.genre,
        upVotes: v.upVotes, downVotes: v.downVotes,
        icon: icons.data?.[0]?.imageUrl, thumbnail: thumbs.data?.[0]?.thumbnails?.[0]?.imageUrl,
        url: `https://www.roblox.com/games/${placeId}`,
      };
    } finally { clearTimeout(timer); }
  }

  function setVotes(card, up, down) {
    if (up == null || down == null) return;
    const total = up + down;
    const pct = total ? Math.round((up / total) * 100) : null;
    setField(card, "rating", pct == null ? "–" : pct + "%");
    setField(card, "likes", up);
    const bar = $('[data-field="bar"]', card);
    if (bar) bar.style.setProperty("--pct", `${pct ?? 0}%`);
  }
  function setField(card, field, value) {
    const el = $(`[data-field="${field}"]`, card);
    if (!el || value == null) return;
    const text = field === "playing" ? `${fmt(value)} playing` : typeof value === "number" ? fmt(value) : String(value);
    if (el.dataset.count != null) el.dataset.count = value;
    if (el.textContent === text) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("is-tick");
    void el.offsetWidth;
    el.classList.add("is-tick");
  }

  const live = { timer: 0, interval: 60000, base: 60000, max: 300000 };
  async function pollLive() {
    const ids = $$(".rcard.is-ready[data-universe]").map((c) => c.dataset.universe);
    if (!ids.length) return;
    try {
      const { data } = await getJson(`${RP.games}/v1/games?universeIds=${[...new Set(ids)].join(",")}`);
      for (const g of data) {
        for (const card of $$(`.rcard[data-universe="${g.id}"]`)) {
          setField(card, "playing", g.playing);
          setField(card, "visits", g.visits);
          setField(card, "favorites", g.favoritedCount);
        }
      }
      live.interval = live.base;
    } catch {
      live.interval = Math.min(live.interval * 2, live.max);
    }
  }
  async function refreshSnapshot() {
    try {
      const { games } = await getJson(`data/games.json?t=${Date.now()}`);
      for (const g of Object.values(games)) {
        for (const card of $$(`.rcard[data-universe="${g.universeId}"]`)) {
          setField(card, "playing", g.playing);
          setField(card, "visits", g.visits);
          setField(card, "favorites", g.favorites);
          setVotes(card, g.upVotes, g.downVotes);
        }
      }
    } catch {}
  }
  function scheduleLive() {
    clearTimeout(live.timer);
    if (document.hidden) return;
    live.timer = setTimeout(async () => { await pollLive(); scheduleLive(); }, live.interval);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(live.timer);
    else { pollLive(); scheduleLive(); }
  });

  const jobs = [];
  for (const card of cards) {
    const id = placeIdFrom(card.dataset.roblox);
    if (!id) { renderError(card, "Not a Roblox game link"); continue; }
    if (cache[id]) { render(card, cache[id]); continue; }
    skeleton(card);
    jobs.push(fetchLive(id)
      .then((g) => render(card, g))
      .catch(() => renderError(card, "Couldn't reach Roblox for this game")));
  }
  Promise.all(jobs).then(() => {
    pollLive(); scheduleLive();
    setInterval(() => { if (!document.hidden) refreshSnapshot(); }, 300000);
  });
})();
