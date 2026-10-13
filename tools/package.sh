#!/bin/sh
# Build the Chrome-loadable zip from the extension/ directory, and assert every
# file it ships is the one the repo currently generates.
set -eu
cd "$(dirname "$0")/.."

python3 tools/embed.py
rm -f youtube-to-newpipe-chrome.zip
(cd extension && zip -q -r -X ../youtube-to-newpipe-chrome.zip . -x '.*' -x '*/.*')

# The zip must contain exactly the extension directory's files, byte for byte.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q youtube-to-newpipe-chrome.zip -d "$tmp"
diff -r extension "$tmp"
echo "youtube-to-newpipe-chrome.zip: $(wc -c < youtube-to-newpipe-chrome.zip | tr -d ' ') bytes, $(unzip -l youtube-to-newpipe-chrome.zip | grep -oE '[0-9]+ files' | head -1)"
