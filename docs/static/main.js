/**
 * main.js — Home page logic
 *
 * Responsibilities:
 *  1. Fuzzy search over games using Fuse.js (loaded via CDN)
 *  2. Tag / player-count filters
 *  3. Sorting (A-Z, most played, recently played)
 *  4. Fetch live play-stats from the stats endpoint (if configured)
 *     and merge into cards displayed on the page.
 *
 * The build script injects the following globals into the page:
 *   window.GAMES          — array of game metadata objects
 *   window.STATS_ENDPOINT — URL of the play-logging endpoint (may be "")
 *   window.BASE_PATH      — site base path, e.g. "/board-games-library"
 */

(function () {
  "use strict";

  /* ── Data from build script ────────────────────────────────────── */
  const GAMES = window.GAMES || [];
  const STATS_ENDPOINT = (window.STATS_ENDPOINT || "").trim();
  const BASE_PATH = (window.BASE_PATH || "").replace(/\/$/, "");

  /* ── DOM refs ──────────────────────────────────────────────────── */
  const searchInput    = document.getElementById("search-input");
  const searchClear    = document.getElementById("search-clear");
  const tagFilter      = document.getElementById("tag-filter");
  const playerFilter   = document.getElementById("player-filter");
  const sortSelect     = document.getElementById("sort-select");
  const resultsCount   = document.getElementById("results-count");
  const gamesGrid      = document.getElementById("games-grid");

  // Stats cache keyed by slug: { playCount, lastPlayed }
  const statsCache = {};

  // Populate statsCache from initial committed stats embedded in page
  (window.COMMITTED_STATS || []).forEach(({ slug, playCount, lastPlayed }) => {
    statsCache[slug] = { playCount: playCount || 0, lastPlayed: lastPlayed || null };
  });

  /* ── Fuse.js setup ─────────────────────────────────────────────── */
  let fuse = null;

  function initFuse() {
    fuse = new Fuse(GAMES, {
      keys: [
        { name: "title",    weight: 0.5 },
        { name: "tags",     weight: 0.3 },
        { name: "slug",     weight: 0.1 },
        { name: "weight",   weight: 0.05 },
      ],
      threshold: 0.4,       // 0 = exact, 1 = match anything
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    });
  }

  /* ── Tag filter options ────────────────────────────────────────── */
  function populateTagFilter() {
    const allTags = new Set();
    GAMES.forEach((g) => (g.tags || []).forEach((t) => allTags.add(t)));
    const sorted = [...allTags].sort();
    sorted.forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      tagFilter.appendChild(opt);
    });
  }

  /* ── Filtering/sorting pipeline ───────────────────────────────── */
  function getFilteredGames() {
    const query  = searchInput.value.trim();
    const tag    = tagFilter.value;
    const players = parseInt(playerFilter.value, 10);
    const sort   = sortSelect.value;

    // 1. Fuzzy search or identity
    let results = query.length >= 2
      ? fuse.search(query).map((r) => r.item)
      : [...GAMES];

    // 2. Tag filter
    if (tag) {
      results = results.filter((g) => (g.tags || []).includes(tag));
    }

    // 3. Player count filter
    if (!isNaN(players)) {
      results = results.filter((g) => {
        const min = typeof g.players === "object" ? g.players.min : 1;
        const max = typeof g.players === "object" ? g.players.max : 99;
        return players >= min && players <= max;
      });
    }

    // 4. Sort
    if (sort === "az") {
      results.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === "za") {
      results.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sort === "most-played") {
      results.sort((a, b) => {
        const pa = statsCache[a.slug]?.playCount || 0;
        const pb = statsCache[b.slug]?.playCount || 0;
        return pb - pa;
      });
    } else if (sort === "recently-played") {
      results.sort((a, b) => {
        const da = statsCache[a.slug]?.lastPlayed || "";
        const db = statsCache[b.slug]?.lastPlayed || "";
        return db.localeCompare(da);
      });
    }

    return results;
  }

  /* ── Render helpers ────────────────────────────────────────────── */
  function formatPlayers(players) {
    if (!players) return "?";
    if (typeof players === "string") return players;
    if (players.min === players.max) return String(players.min);
    return `${players.min}–${players.max}`;
  }

  function formatTime(playtime) {
    if (!playtime) return "?";
    if (typeof playtime === "string") return playtime;
    if (playtime.min === playtime.max) return `${playtime.min} min`;
    return `${playtime.min}–${playtime.max} min`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    // Display as "Jan 15, 2025"
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function renderCard(game) {
    const stats   = statsCache[game.slug] || {};
    const count   = stats.playCount || 0;
    const last    = stats.lastPlayed || null;
    const gameUrl = `${BASE_PATH}/games/${game.slug}/`;

    const tagsHtml = (game.tags || [])
      .map((t) => `<span class="tag">${esc(t)}</span>`)
      .join("");

    return `
<a class="game-card" href="${gameUrl}" aria-label="${esc(game.title)}">
  <div class="game-card__title">${esc(game.title)}</div>
  <div class="game-card__meta">
    <span class="meta-item" title="Players">
      <span aria-hidden="true">👥</span> ${esc(formatPlayers(game.players))} players
    </span>
    <span class="meta-item" title="Play time">
      <span aria-hidden="true">⏱</span> ${esc(formatTime(game.playtime))}
    </span>
    <span class="meta-item" title="Complexity weight">
      <span aria-hidden="true">⚖️</span> ${game.weight != null ? game.weight : "?"}
    </span>
  </div>
  <div class="game-card__tags">${tagsHtml}</div>
  <div class="game-card__stats" data-slug="${esc(game.slug)}">
    <span class="stats-item" title="Times played">
      <span aria-hidden="true">🎲</span>
      <span class="stat-play-count">${count}</span>× played
    </span>
    <span class="stats-item" title="Last played">
      <span aria-hidden="true">📅</span>
      <span class="stat-last-played">${formatDate(last)}</span>
    </span>
  </div>
</a>`.trim();
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── Render loop ───────────────────────────────────────────────── */
  function render() {
    const games = getFilteredGames();
    resultsCount.textContent = `${games.length} game${games.length !== 1 ? "s" : ""}`;

    if (games.length === 0) {
      gamesGrid.innerHTML =
        '<p class="no-results">No games match your search. Try different terms.</p>';
      return;
    }

    gamesGrid.innerHTML = games.map(renderCard).join("");
  }

  /* ── Live stats update ─────────────────────────────────────────── */
  /**
   * After the stats are fetched / updated, patch the visible card stats
   * in-place so we don't need a full re-render.
   */
  function patchCardStats(slug) {
    const stats = statsCache[slug];
    if (!stats) return;
    const cards = gamesGrid.querySelectorAll(`[data-slug="${CSS.escape(slug)}"]`);
    cards.forEach((card) => {
      const countEl = card.querySelector(".stat-play-count");
      const lastEl  = card.querySelector(".stat-last-played");
      if (countEl) countEl.textContent = stats.playCount || 0;
      if (lastEl)  lastEl.textContent  = formatDate(stats.lastPlayed);
    });
  }

  /**
   * Fetch all stats from the endpoint (GET /stats).
   * Falls back to committed stats already in statsCache.
   */
  async function fetchLiveStats() {
    if (!STATS_ENDPOINT) return;
    try {
      const res = await fetch(`${STATS_ENDPOINT}/stats`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      // data is { [slug]: { playCount, lastPlayed } }
      Object.entries(data).forEach(([slug, s]) => {
        statsCache[slug] = s;
        patchCardStats(slug);
      });
    } catch {
      // Silently ignore: committed stats are still shown
    }
  }

  /* ── Event listeners ───────────────────────────────────────────── */
  function onInput() {
    searchClear.style.display = searchInput.value ? "block" : "none";
    render();
  }

  function onClear() {
    searchInput.value = "";
    searchClear.style.display = "none";
    searchInput.focus();
    render();
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  function init() {
    if (!gamesGrid) return; // Not the home page

    initFuse();
    populateTagFilter();
    render();
    fetchLiveStats();

    searchInput.addEventListener("input", onInput);
    searchClear.addEventListener("click", onClear);
    tagFilter.addEventListener("change", render);
    playerFilter.addEventListener("change", render);
    sortSelect.addEventListener("change", render);

    // Keyboard shortcut: "/" focuses search
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
