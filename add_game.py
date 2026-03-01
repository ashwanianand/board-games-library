#!/usr/bin/env python3
"""Add a new game to the board-games library."""

import argparse
import os
import re
import sys


def slugify(name):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def build_frontmatter(name, slug, args):
    lines = ["---"]
    lines.append(f'title: "{name}"')
    lines.append(f'slug: "{slug}"')

    lines.append("players:")
    lines.append(f"  min: {args.min_players if args.min_players is not None else ''}")
    lines.append(f"  max: {args.max_players if args.max_players is not None else ''}")

    lines.append("playtime:")
    lines.append(f"  min: {args.min_time if args.min_time is not None else ''}")
    lines.append(f"  max: {args.max_time if args.max_time is not None else ''}")

    lines.append(f"weight: {args.weight if args.weight is not None else ''}")

    lines.append("tags:")
    for tag in (args.tags or []):
        lines.append(f"  - {tag}")

    lines.append("links:")
    lines.append(f'  bgg: "{args.bgg or ""}"')
    lines.append(f'  rules: "{args.rules or ""}"')
    lines.append(f'  tutorial: "{args.tutorial or ""}"')

    lines.append(f'assetsPath: "game_files/{slug}/"')
    lines.append("---")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Add a new game to the library.")
    parser.add_argument("name", help='Game name (e.g. "My Game")')
    parser.add_argument("--slug", help="Override the auto-generated slug")
    parser.add_argument("--min-players", type=int, metavar="N")
    parser.add_argument("--max-players", type=int, metavar="N")
    parser.add_argument("--min-time", type=int, metavar="MIN")
    parser.add_argument("--max-time", type=int, metavar="MIN")
    parser.add_argument("--weight", type=float, metavar="W", help="BGG weight (1–5)")
    parser.add_argument("--tags", nargs="+", metavar="TAG", help="Space-separated tags")
    parser.add_argument("--bgg", metavar="URL")
    parser.add_argument("--rules", metavar="URL")
    parser.add_argument("--tutorial", metavar="URL")
    parser.add_argument("--force", action="store_true", help="Overwrite existing .md file")

    args = parser.parse_args()

    slug = args.slug or slugify(args.name)
    script_dir = os.path.dirname(os.path.abspath(__file__))

    md_path = os.path.join(script_dir, "games", f"{slug}.md")
    game_files_dir = os.path.join(script_dir, "game_files", slug)

    if os.path.exists(md_path) and not args.force:
        print(f"Error: games/{slug}.md already exists. Use --force to overwrite.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(game_files_dir, exist_ok=True)
    print(f"Created directory: game_files/{slug}/")

    content = build_frontmatter(args.name, slug, args)
    with open(md_path, "w") as f:
        f.write(content)
    print(f"Created file:      games/{slug}.md")


if __name__ == "__main__":
    main()
