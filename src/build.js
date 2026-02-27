#!/usr/bin/env node
/**
 * src/build.js — Static site generator
 *
 * Usage:
 *   node src/build.js          — one-off build
 *   node src/build.js --watch  — rebuild on file changes (requires 'chokidar')
 *
 * Output: docs/  (configured in src/config.js)
 *
 * What it does:
 *  1. Reads every *.md from games/, parses front matter + Markdown body.
 *  2. Reads every stats/<slug>.json (committed play stats).
 *  3. Emits docs/index.html  — home page with all games.
 *  4. Emits docs/games/<slug>/index.html — individual game pages.
 *  5. Copies src/static/ → docs/static/
 *  6. Copies game_files/  → docs/game_files/
 */

"use strict";

const path   = require("path");
const fs     = require("fs-extra");
const matter = require("gray-matter");
const { marked }  = require("marked");
const { globSync } = require("glob");

const config = require("./config");

const ROOT      = path.resolve(__dirname, "..");
const OUT_DIR   = path.join(ROOT, config.outDir);
const GAMES_DIR = path.join(ROOT, "games");
const STATS_DIR = path.join(ROOT, "stats");
const STATIC_SRC = path.join(__dirname, "static");
const GAME_FILES_SRC = path.join(ROOT, "game_files");

/* ── Marked configuration ─────────────────────────────────────────── */
marked.setOptions({ breaks: false, gfm: true });

/* ── Helpers ──────────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON safely embedded inside a <script> tag
function safeJSON(obj) {
  return JSON.stringify(obj).replace(/<\/script>/gi, "<\\/script>");
}

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

/* ── Load games ───────────────────────────────────────────────────── */
function loadGames() {
  const mdFiles = globSync("**/*.md", { cwd: GAMES_DIR, absolute: true });

  return mdFiles.map((fp) => {
    const raw  = fs.readFileSync(fp, "utf8");
    const { data: fm, content: body } = matter(raw);
    const slug = fm.slug || path.basename(fp, ".md");
    return { ...fm, slug, body };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

/* ── Load stats ───────────────────────────────────────────────────── */
function loadAllStats() {
  const statsFiles = globSync("**/*.json", { cwd: STATS_DIR, absolute: true });
  const out = {};
  statsFiles.forEach((fp) => {
    try {
      const slug = path.basename(fp, ".json");
      out[slug] = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      // Skip malformed stats
    }
  });
  return out;
}

/* ── Shared HTML ──────────────────────────────────────────────────── */
function siteHeader(title) {
  return `
<header class="site-header">
  <div class="container">
    <a class="site-title" href="${config.basePath}/">${esc(config.siteTitle)}</a>
    <span class="header-meta" id="header-game-count"></span>
  </div>
</header>`.trim();
}

function siteFooter() {
  return `
<footer class="site-footer">
  <div class="container">
    <p>${esc(config.siteTitle)} &mdash; built with <a href="https://pages.github.com/">GitHub Pages</a></p>
  </div>
</footer>`.trim();
}

function htmlShell({ title, headExtra = "", bodyClass = "", body, scripts = [] }) {
  const scriptTags = scripts.map((s) => `<script src="${s}"></script>`).join("\n    ");
  // If title is the siteTitle itself, don't duplicate it
  const pageTitle = title === config.siteTitle
    ? esc(config.siteTitle)
    : `${esc(title)} — ${esc(config.siteTitle)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <link rel="stylesheet" href="${config.basePath}/static/style.css" />
  ${headExtra}
</head>
<body class="${bodyClass}">
  ${body}
  ${scriptTags}
</body>
</html>`;
}

/* ── Home page ────────────────────────────────────────────────────── */
function buildHomePage(games, allStats) {
  // Build the committed-stats array for immediate display in cards
  const committedStats = games.map((g) => ({
    slug: g.slug,
    playCount: allStats[g.slug]?.playCount || 0,
    lastPlayed: allStats[g.slug]?.lastPlayed || null,
  }));

  // Collect all unique tags for the filter <select>
  const allTags = [...new Set(games.flatMap((g) => g.tags || []))].sort();
  const tagOptions = allTags
    .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`)
    .join("\n            ");

  const headExtra = `
  <!-- Fuse.js for fuzzy search -->
  <script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js"></script>
  <script>
    // Game data injected at build time — no fetch required for basic display.
    window.GAMES = ${safeJSON(games.map(({ body, ...rest }) => rest))};
    window.COMMITTED_STATS = ${safeJSON(committedStats)};
    window.STATS_ENDPOINT = ${safeJSON(config.statsEndpoint)};
    window.BASE_PATH = ${safeJSON(config.basePath)};
  </script>`;

  const pageBody = `
${siteHeader(config.siteTitle)}

<section class="search-section" aria-label="Search and filter">
  <div class="container">
    <div class="search-controls">
      <div class="search-input-wrapper">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <label for="search-input" class="visually-hidden">Search games</label>
        <input
          type="search"
          id="search-input"
          placeholder="Search games… (press / to focus)"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="search-clear" id="search-clear" aria-label="Clear search" title="Clear">✕</button>
      </div>

      <label for="tag-filter" class="visually-hidden">Filter by tag</label>
      <select id="tag-filter" class="filter-select" aria-label="Filter by tag">
        <option value="">All tags</option>
        ${tagOptions}
      </select>

      <label for="player-filter" class="visually-hidden">Filter by player count</label>
      <select id="player-filter" class="filter-select" aria-label="Filter by player count">
        <option value="">Any players</option>
        <option value="1">Solo (1)</option>
        <option value="2">2 players</option>
        <option value="3">3 players</option>
        <option value="4">4 players</option>
        <option value="5">5 players</option>
        <option value="6">6+ players</option>
      </select>

      <label for="sort-select" class="visually-hidden">Sort games</label>
      <select id="sort-select" class="sort-select" aria-label="Sort games">
        <option value="az">A – Z</option>
        <option value="za">Z – A</option>
        <option value="most-played">Most played</option>
        <option value="recently-played">Recently played</option>
      </select>
    </div>
    <div class="search-results-count" id="results-count" aria-live="polite"></div>
  </div>
</section>

<main class="games-section">
  <div class="container">
    <div class="games-grid" id="games-grid" role="list" aria-label="Board games">
      <!-- Cards rendered by main.js -->
      <noscript>
        <p>Please enable JavaScript to view the game list and search.</p>
        <ul>
${games.map((g) => `          <li><a href="${config.basePath}/games/${g.slug}/">${esc(g.title)}</a></li>`).join("\n")}
        </ul>
      </noscript>
    </div>
  </div>
</main>

${siteFooter()}`;

  const html = htmlShell({
    title: config.siteTitle,
    headExtra,
    bodyClass: "page-home",
    body: pageBody,
    scripts: [`${config.basePath}/static/main.js`],
  });

  const outPath = path.join(OUT_DIR, "index.html");
  fs.outputFileSync(outPath, html, "utf8");
  console.log("  ✓", "docs/index.html");
}

/* ── Individual game pages ────────────────────────────────────────── */
function buildGamePage(game, allStats) {
  const stats         = allStats[game.slug] || { playCount: 0, lastPlayed: null };
  const renderedBody  = marked(game.body || "");
  const gameUrl       = `${config.basePath}/games/${game.slug}/`;
  const assetsPath    = game.assetsPath || `game_files/${game.slug}/`;

  // Resolve a link URL: relative paths are resolved against assetsPath
  const resolveUrl = (url) => {
    if (/^https?:\/\/|^\/\//.test(url)) return url;
    const base = `${config.basePath}/${assetsPath}`.replace(/([^/])\/+$/, "$1/");
    return base + url;
  };

  // Links section
  const linksHtml = game.links && Object.keys(game.links).length > 0
    ? `<section class="mt-2" aria-label="External links">
    <h2 class="section-heading">Links</h2>
    <div class="links-section">
      ${Object.entries(game.links).map(([label, url]) =>
          `<a class="link-btn" href="${esc(resolveUrl(url))}" target="_blank" rel="noopener noreferrer">
          ${esc(label.charAt(0).toUpperCase() + label.slice(1))} ↗
        </a>`).join("\n      ")}
    </div>
  </section>`
    : "";

  // Tags
  const tagsHtml = (game.tags || [])
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join(" ");

  const headExtra = `
  <script>
    window.GAME_SLUG = ${safeJSON(game.slug)};
    window.STATS_ENDPOINT = ${safeJSON(config.statsEndpoint)};
    window.INITIAL_STATS = ${safeJSON(stats)};
  </script>`;

  // Format last played date
  function fmt(iso) {
    if (!iso) return "Never";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch { return iso; }
  }

  const pageBody = `
${siteHeader(game.title)}

<main class="game-page">
  <div class="container">

    <!-- Breadcrumb -->
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="${config.basePath}/">Home</a> › ${esc(game.title)}
    </nav>

    <!-- NFC banner — hidden by default, shown by game.js when ?played=1 -->
    <div id="nfc-banner" class="nfc-banner" hidden aria-live="assertive"></div>

    <!-- Game header -->
    <div class="game-header">
      <div class="game-header__info">
        <h1 class="game-header__title">${esc(game.title)}</h1>

        <div class="game-facts" aria-label="Game facts">
          <span class="fact-pill">
            <span class="fact-pill__label">Players</span>
            ${esc(formatPlayers(game.players))}
          </span>
          <span class="fact-pill">
            <span class="fact-pill__label">Time</span>
            ${esc(formatTime(game.playtime))}
          </span>
          <span class="fact-pill">
            <span class="fact-pill__label">Weight</span>
            ${game.weight != null ? esc(String(game.weight)) : "?"}
          </span>
        </div>

        <div class="game-card__tags" aria-label="Tags">${tagsHtml}</div>

        ${linksHtml}
      </div>

      <!-- Stats panel -->
      <aside class="stats-panel" aria-label="Play statistics">
        <div class="stats-panel__title">Play Stats</div>
        <div class="stats-panel__row">
          <span class="stats-panel__key">Times played</span>
          <span class="stats-panel__value" id="stat-play-count">${stats.playCount || 0}</span>
        </div>
        <div class="stats-panel__row">
          <span class="stats-panel__key">Last played</span>
          <span class="stats-panel__value" id="stat-last-played">${esc(fmt(stats.lastPlayed))}</span>
        </div>
      </aside>
    </div>

    <!-- Markdown content -->
    <article class="game-content">
      <div class="prose">
        ${renderedBody}
      </div>
    </article>

  </div>
</main>

${siteFooter()}`;

  const html = htmlShell({
    title: game.title,
    headExtra,
    bodyClass: "page-game",
    body: pageBody,
    scripts: [`${config.basePath}/static/game.js`],
  });

  const outPath = path.join(OUT_DIR, "games", game.slug, "index.html");
  fs.outputFileSync(outPath, html, "utf8");
  console.log("  ✓", `docs/games/${game.slug}/index.html`);
}

/* ── 404 page ─────────────────────────────────────────────────────── */
function build404() {
  const pageBody = `
${siteHeader("Page Not Found")}
<main style="padding:4rem 0;text-align:center;">
  <div class="container">
    <h1 style="font-size:3rem;color:var(--color-primary);">404</h1>
    <p style="margin:1rem 0 2rem;">That page doesn't exist.</p>
    <a class="log-play-btn" href="${config.basePath}/">← Back to home</a>
  </div>
</main>
${siteFooter()}`;

  const html = htmlShell({ title: "Page Not Found", body: pageBody });
  fs.outputFileSync(path.join(OUT_DIR, "404.html"), html, "utf8");
  console.log("  ✓", "docs/404.html");
}

/* ── Main build function ──────────────────────────────────────────── */
async function build() {
  console.log("\n🔨 Building board-games-library…\n");

  // Clean and recreate output directory
  fs.ensureDirSync(OUT_DIR);

  // Load source data
  const games    = loadGames();
  const allStats = loadAllStats();

  console.log(`  Found ${games.length} game(s), ${Object.keys(allStats).length} stats file(s)\n`);

  // Home page
  buildHomePage(games, allStats);

  // Game pages
  games.forEach((game) => buildGamePage(game, allStats));

  // 404
  build404();

  // Copy static assets  (CSS, JS)
  fs.copySync(STATIC_SRC, path.join(OUT_DIR, "static"));
  console.log("  ✓", "docs/static/");

  // Copy game_files
  if (fs.existsSync(GAME_FILES_SRC)) {
    fs.copySync(GAME_FILES_SRC, path.join(OUT_DIR, "game_files"));
    console.log("  ✓", "docs/game_files/");
  }

  // Copy stats directory so they can be fetched at runtime if desired
  if (fs.existsSync(STATS_DIR)) {
    fs.copySync(STATS_DIR, path.join(OUT_DIR, "stats"));
    console.log("  ✓", "docs/stats/");
  }

  // Emit a combined stats.json for bulk fetch
  const combinedStats = {};
  games.forEach((g) => {
    combinedStats[g.slug] = allStats[g.slug] || { playCount: 0, lastPlayed: null };
  });
  fs.outputJsonSync(path.join(OUT_DIR, "stats.json"), combinedStats, { spaces: 2 });
  console.log("  ✓", "docs/stats.json");

  // robots.txt — disallow all crawlers (private collection, not for indexing)
  fs.outputFileSync(
    path.join(OUT_DIR, "robots.txt"),
    "User-agent: *\nDisallow: /\n",
    "utf8"
  );
  console.log("  ✓", "docs/robots.txt");

  console.log(`\n✅ Build complete → ${config.outDir}/\n`);
}

/* ── Watch mode ───────────────────────────────────────────────────── */
async function watch() {
  await build();
  try {
    const chokidar = require("chokidar");
    const watchPaths = [
      path.join(ROOT, "games"),
      path.join(ROOT, "stats"),
      path.join(__dirname, "static"),
      path.join(__dirname, "config.js"),
    ];
    console.log("👀 Watching for changes… (Ctrl+C to stop)\n");
    const watcher = chokidar.watch(watchPaths, { ignoreInitial: true });
    watcher.on("all", async (event, fp) => {
      console.log(`\n[${event}] ${path.relative(ROOT, fp)}`);
      await build().catch(console.error);
    });
  } catch {
    console.warn("⚠️  Install chokidar for watch mode: npm install --save-dev chokidar");
  }
}

/* ── Entry point ──────────────────────────────────────────────────── */
const isWatch = process.argv.includes("--watch");
(isWatch ? watch() : build()).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
