#!/usr/bin/env python3
"""YouTube -> NewPipe subscription exporter.

Fetches the authenticated subscriptions feed with yt-dlp (no browser automation)
and writes a NewPipe-importable JSON file.

    pip install yt-dlp requests
    python3 extract_subs.py                 # reads Firefox cookies
    python3 extract_subs.py -b chrome       # or chrome / edge / brave / chromium / safari / vivaldi
    python3 extract_subs.py -o subs.json
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import yt_dlp

CHANNEL_URL = "https://www.youtube.com/channel/{}"
CHANNEL_ID = re.compile(r"UC[\w-]{22}")
PROFILE_URL = "https://www.youtube.com/{}"
APP_VERSION = "0.21.15"
FEED = "https://www.youtube.com/feed/channels"


def normalize(entry):
    """Map one yt-dlp feed entry to a NewPipe subscription, or None."""
    if not entry:
        return None
    for candidate in (entry.get("channel_id"), entry.get("id"), entry.get("url", "")):
        match = CHANNEL_ID.search(candidate or "")
        if match:
            return {
                "service_id": 0,
                "url": CHANNEL_URL.format(match.group()),
                "name": entry.get("channel") or entry.get("title") or "Unknown",
            }
    return None


def fetch(browser):
    opts = {"quiet": True, "extract_flat": True, "ignoreerrors": True, "cookiesfrombrowser": (browser,)}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(FEED, download=False, process=False) or {}
    entries = list(info.get("entries") or [])
    if not entries:
        raise RuntimeError("no subscriptions returned - check that you are signed in")

    result = []
    for entry in entries:
        sub = normalize(entry)
        if sub:
            result.append(sub)
    if not result:
        raise RuntimeError(
            "feed returned entries but none carried a channel id; "
            "a browser cookie export may be required"
        )
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-b", "--browser", default="firefox", help="browser to read cookies from (default: firefox)")
    parser.add_argument("-o", "--output", type=Path, help="output path (default: newpipe_subscriptions_<date>.json)")
    args = parser.parse_args(argv)

    try:
        subs = fetch(args.browser)
    except Exception as exc:  # yt-dlp raises many unrelated types
        print(f"[YT->NewPipe] {exc}", file=sys.stderr)
        print(f"[YT->NewPipe] Try a different cookie source: {parser.prog} -b chrome", file=sys.stderr)
        return 1

    out = args.output or Path(f"newpipe_subscriptions_{date.today().isoformat()}.json")
    out.write_text(
        json.dumps({"app_version": APP_VERSION, "subscriptions": subs}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[YT->NewPipe] {len(subs)} subscriptions -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
