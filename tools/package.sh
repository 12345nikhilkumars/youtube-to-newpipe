#!/bin/sh
# Build the Chrome-loadable zip from the extension/ directory, and assert every
# file it ships is the one the repo currently generates.
set -eu
cd "$(dirname "$0")/.."

python3 tools/embed.py
rm -f youtube-to-newpipe-chrome.zip youtube-to-newpipe-firefox.zip
(cd extension && zip -q -r -X ../youtube-to-newpipe-chrome.zip . -x '.*' -x '*/.*')
(cd extension-firefox && zip -q -r -X ../youtube-to-newpipe-firefox.zip . -x '.*' -x '*/.*')

# The zips must contain exactly their extension directory files, byte for byte.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q youtube-to-newpipe-chrome.zip -d "$tmp/chrome"
diff -r extension "$tmp/chrome"
unzip -q youtube-to-newpipe-firefox.zip -d "$tmp/firefox"
diff -r extension-firefox "$tmp/firefox"
echo "youtube-to-newpipe-chrome.zip: $(wc -c < youtube-to-newpipe-chrome.zip | tr -d ' ') bytes, $(unzip -l youtube-to-newpipe-chrome.zip | grep -oE '[0-9]+ files' | head -1)"
echo "youtube-to-newpipe-firefox.zip: $(wc -c < youtube-to-newpipe-firefox.zip | tr -d ' ') bytes, $(unzip -l youtube-to-newpipe-firefox.zip | grep -oE '[0-9]+ files' | head -1)"
