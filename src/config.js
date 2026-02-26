// Site-wide configuration
// Edit this file to customise your deployment.

module.exports = {
  // GitHub Pages base path — must match your repo name
  // e.g. for https://ashwanianand.github.io/board-games-library/
  basePath: "/board-games-library",

  // Site title shown in the header and <title> tag
  siteTitle: "Ashwani's Board Game Library",

  // URL of the Cloudflare Worker (or other serverless) play-logging endpoint.
  // Set to an empty string to disable live stats fetching.
  // The same value is baked into every built page at build time.
  // Example: "https://board-games-worker.your-subdomain.workers.dev"
  statsEndpoint: "https://board-games-worker.board-games-library.workers.dev",

  // Output directory for the built static site (served by GitHub Pages)
  outDir: "docs",
};
