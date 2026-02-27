/**
 * game.js — Individual game page logic
 *
 * Responsibilities:
 *  1. Fetch live play stats from the endpoint and display them.
 *  2. Handle the NFC "?played=1" URL parameter:
 *     - Automatically log a play once on page load.
 *     - Remove the param from the URL without a page reload.
 *     - Show a confirmation banner.
 *
 * Play-logging protection lives on the SERVER (Cloudflare Worker):
 *  - A global per-game cooldown (default 6 hours) ensures that only one
 *    play is counted per game per window — regardless of how many people
 *    tap the NFC tag to browse rules/links.
 *  - Client only guards against double-POST within the same page load
 *    (in-memory flag — no sessionStorage needed).
 *
 * The build script injects:
 *   window.GAME_SLUG      — slug of the current game, e.g. "settlers-of-catan"
 *   window.STATS_ENDPOINT — URL of the play-logging endpoint (may be "")
 *   window.INITIAL_STATS  — { playCount, lastPlayed } from committed JSON
 */

(function () {
  "use strict";

  const SLUG           = window.GAME_SLUG || "";
  const STATS_ENDPOINT = (window.STATS_ENDPOINT || "").trim();
  const INITIAL_STATS  = window.INITIAL_STATS || { playCount: 0, lastPlayed: null };

  // In-memory flag: prevents double-POST if somehow called twice on the same
  // page load. The real cooldown enforcement is on the server.
  let postedThisLoad = false;

  /* ── DOM refs ──────────────────────────────────────────────────── */
  const statPlayCount  = document.getElementById("stat-play-count");
  const statLastPlayed = document.getElementById("stat-last-played");

  /* ── Toast notification ────────────────────────────────────────── */
  let toastEl = null;

  function showToast(message, type = "info", duration = 3500) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = `toast toast--${type}`;
    // Force reflow to restart animation
    void toastEl.offsetWidth;
    toastEl.classList.add("toast--visible");

    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove("toast--visible");
    }, duration);
  }

  /* ── Stats display ─────────────────────────────────────────────── */
  function formatDate(iso) {
    if (!iso) return "Never";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function updateStatsDisplay(stats) {
    if (statPlayCount)  statPlayCount.textContent  = stats.playCount  ?? 0;
    if (statLastPlayed) statLastPlayed.textContent = formatDate(stats.lastPlayed);
  }

  // Seed page with committed stats immediately (no flash while fetching)
  updateStatsDisplay(INITIAL_STATS);

  async function fetchStats() {
    if (!STATS_ENDPOINT || !SLUG) return;
    try {
      const res = await fetch(`${STATS_ENDPOINT}/stats/${SLUG}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const stats = await res.json();
      updateStatsDisplay(stats);
    } catch {
      // Silently degrade — committed stats already visible.
    }
  }

  /* ── Log a play ────────────────────────────────────────────────── */
  async function logPlay({ fromNfc = false } = {}) {
    if (!SLUG) return;

    if (!STATS_ENDPOINT) {
      showToast("📌 Stats endpoint not configured — see README to set it up.", "info");
      return;
    }

    if (postedThisLoad) return; // prevent double-POST on same page load
    postedThisLoad = true;

    try {
      const res = await fetch(`${STATS_ENDPOINT}/play/${SLUG}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.status);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const stats = await res.json();
      updateStatsDisplay(stats);

      const msg = fromNfc
        ? `📲 NFC tap recorded! Plays: ${stats.playCount}`
        : `🎲 Play logged! Total plays: ${stats.playCount}`;
      showToast(msg, "success");
    } catch (err) {
      console.warn("logPlay failed:", err.message);
      showToast("⚠️ Could not log play — check your connection.", "error");
      postedThisLoad = false; // allow retry on network failure
    } finally {}
  }

  /* ── NFC / ?played=1 handler ────────────────────────────────────── */
  function handleNfcParam() {
    const url    = new URL(window.location.href);
    const played = url.searchParams.get("played");

    if (played !== "1") return;

    // Remove the param from the URL immediately (no reload)
    url.searchParams.delete("played");
    history.replaceState(null, "", url.toString());

    // Show the NFC banner
    const banner = document.getElementById("nfc-banner");
    if (banner) {
      banner.hidden = false;
      banner.textContent = "📲 Logging play via NFC tap…";
    }

    // Log the play
    logPlay({ fromNfc: true }).then(() => {
      if (banner) banner.textContent = "📲 Play logged via NFC!";
    });
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  function init() {
    fetchStats();        // Fetch live stats (may update over committed ones)
    handleNfcParam();   // Check for ?played=1 and auto-log if present
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
