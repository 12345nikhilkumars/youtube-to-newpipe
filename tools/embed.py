#!/usr/bin/env python3
"""Embed the single shared extractor (yt2np.js) into its three launchers.

    python3 tools/embed.py

bookmarklet.js must be one line starting with `javascript:` - any newline or leading `//`
turns the remainder into a comment and the bookmark silently does nothing - so its copy is
minified by stripping comments and blank lines. console-script.js keeps the readable source.
extension/yt2np.js is the copy injected by the extension (main-world file injection cannot
load a file from outside the extension directory), with the return-value mode preset.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "yt2np.js"
BANNER = "// Generated from yt2np.js by tools/embed.py - do not edit.\n"


def strip_comments(source: str) -> str:
    """Remove whole-line comments, keeping the code parseable.

    Joining lines is unsafe: a template literal spanning lines would keep its newline and
    break the statement. Join with a newline instead, so the bookmarklet stays valid while
    remaining a single URL.
    """
    lines = [line.rstrip() for line in source.splitlines()]
    kept = [line for line in lines if line.strip() and not line.strip().startswith("//")]
    return "\n".join(kept)


def main():
    core = CORE.read_text(encoding="utf-8")
    outputs = {
        # One line after the scheme; no comments, or the whole bookmarklet becomes a comment.
        "bookmarklet.js": "javascript:" + strip_comments(core),
        "console-script.js": BANNER
        + "// Usage: open youtube.com/feed/channel_manager, F12, paste this file into the console.\n"
        + core,
        "extension/yt2np.js": BANNER + 'globalThis.__YT2NP_MODE__ = "return";\n' + core,
        "extension-firefox/yt2np.js": BANNER + 'globalThis.__YT2NP_MODE__ = "return";\n' + core,
    }
    for name, content in outputs.items():
        path = ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"{name}: {len(content)} bytes")


if __name__ == "__main__":
    main()
