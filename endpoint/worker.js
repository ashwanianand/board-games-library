/**
 * endpoint/worker.js — Cloudflare Worker: play-logging endpoint
 *
 * Routes:
 *   GET  /stats          → returns { [slug]: { playCount, lastPlayed } }
 *   GET  /stats/:slug    → returns { playCount, lastPlayed } for one game
 *   POST /play/:slug     → increments playCount, sets lastPlayed; returns updated stats
 *
 * Storage: Cloudflare KV namespace bound as STATS (see wrangler.toml)
 *   Key format: "game:<slug>"  → JSON string "{ playCount, lastPlayed }"
 *   Key format: "slugs"        → JSON array of known slugs (for bulk GET /stats)
 *
 * Abuse prevention:
 *   - Each POST /play/:slug carries a client-derived key
 *     (IP + slug), stored in KV with a short TTL (30 min default).
 *     If the key exists the request is accepted but not double-counted.
 *   - Slug validation: only lowercase letters, digits, and hyphens.
 *   - Max slug length: 80 chars.
 *
 * CORS: configured to accept requests from the GitHub Pages origin.
 *   Set ALLOWED_ORIGIN env var (wrangler.toml [vars]) to your pages URL,
 *   or "*" for open access.
 */

const DEBOUNCE_TTL_SECS = 30 * 60; // 30 minutes
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

/* ── CORS helpers ─────────────────────────────────────────────────── */
function corsHeaders(env, requestOrigin) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  const origin =
    allowed === "*"
      ? "*"
      : allowed.split(",").map((o) => o.trim()).includes(requestOrigin)
      ? requestOrigin
      : allowed.split(",")[0].trim();

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200, corsHdrs = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Cache-Control": "no-store",
      ...corsHdrs,
    },
  });
}

/* ── Stats KV helpers ─────────────────────────────────────────────── */
async function getStats(kv, slug) {
  const raw = await kv.get(`game:${slug}`, "text");
  if (!raw) return { playCount: 0, lastPlayed: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { playCount: 0, lastPlayed: null };
  }
}

async function saveStats(kv, slug, stats) {
  await kv.put(`game:${slug}`, JSON.stringify(stats));
}

/**
 * Register a slug in the "slugs" index so GET /stats can return all games.
 * This is best-effort; if it fails we lose nothing important.
 */
async function registerSlug(kv, slug) {
  try {
    const raw = await kv.get("slugs", "text");
    const slugs = raw ? JSON.parse(raw) : [];
    if (!slugs.includes(slug)) {
      slugs.push(slug);
      await kv.put("slugs", JSON.stringify(slugs));
    }
  } catch {
    // Ignore — slug index is an optimisation, not critical.
  }
}

/* ── Route handlers ───────────────────────────────────────────────── */
async function handleGetAllStats(env, cors) {
  const raw = await env.STATS.get("slugs", "text");
  if (!raw) return jsonResponse({}, 200, cors);

  let slugs;
  try { slugs = JSON.parse(raw); }
  catch { return jsonResponse({}, 200, cors); }

  const entries = await Promise.all(
    slugs.map(async (slug) => [slug, await getStats(env.STATS, slug)])
  );

  return jsonResponse(Object.fromEntries(entries), 200, cors);
}

async function handleGetStats(slug, env, cors) {
  if (!SLUG_RE.test(slug)) {
    return jsonResponse({ error: "Invalid slug" }, 400, cors);
  }
  const stats = await getStats(env.STATS, slug);
  return jsonResponse(stats, 200, cors);
}

async function handlePostPlay(slug, request, env, cors) {
  if (!SLUG_RE.test(slug)) {
    return jsonResponse({ error: "Invalid slug" }, 400, cors);
  }

  // Debounce: use client IP + slug as dedup key
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const debounceKey = `debounce:${ip}:${slug}`;
  const alreadyLogged = await env.STATS.get(debounceKey, "text");

  const stats = await getStats(env.STATS, slug);

  if (!alreadyLogged) {
    // First log within the window — increment
    stats.playCount = (stats.playCount || 0) + 1;
    stats.lastPlayed = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    await saveStats(env.STATS, slug, stats);
    await registerSlug(env.STATS, slug);
    // Mark debounce key with TTL
    await env.STATS.put(debounceKey, "1", { expirationTtl: DEBOUNCE_TTL_SECS });
  }
  // If already logged: return current stats without incrementing (idempotent)

  return jsonResponse(stats, 200, cors);
}

/* ── Main fetch handler ───────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const cors   = corsHeaders(env, request.headers.get("Origin") || "");

    // Pre-flight CORS
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    // parts[0] = "stats" | "play"
    // parts[1] = optional slug

    try {
      // GET /stats
      if (method === "GET" && parts[0] === "stats" && !parts[1]) {
        return await handleGetAllStats(env, cors);
      }

      // GET /stats/:slug
      if (method === "GET" && parts[0] === "stats" && parts[1]) {
        return await handleGetStats(parts[1], env, cors);
      }

      // POST /play/:slug
      if (method === "POST" && parts[0] === "play" && parts[1]) {
        return await handlePostPlay(parts[1], request, env, cors);
      }

      return jsonResponse({ error: "Not found" }, 404, cors);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal server error" }, 500, cors);
    }
  },
};
