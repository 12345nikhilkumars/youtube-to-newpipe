# YouTube to NewPipe Subscription Extractor

Export your full YouTube subscription list as a NewPipe-compatible JSON file.

## Chrome

1. Unzip `youtube-to-newpipe.zip` somewhere permanent
2. `chrome://extensions` -> enable **Developer mode**
3. **Load unpacked** -> pick the unzipped folder
4. Click the toolbar icon, then pick one of three buttons

Each button runs the whole job on its own, so nothing has to be pressed first:

| Button | Output | Time (950 channels) |
| --- | --- | --- |
| JSON with handles | `newpipe_handles_DATE.json`, `@handle` URLs | about 2 s |
| JSON with resolved IDs | `newpipe_ids_DATE.json`, `UC…` URLs | about 8 s |
| CSV in Takeout format | `subscriptions_DATE.csv`, `UC…` columns | about 8 s |

The list is read from `youtube.com/feed/channel_manager` in a **background tab** that never
takes focus and is **closed** as soon as the data is read, including on failure. Results are
cached for the popup's lifetime, so a second button reuses the first one's work.

## Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** -> pick `extension/manifest.json`

The same manifest works on both browsers (MV3).

## Bookmarklet

Drag `bookmarklet.js` to your bookmarks bar, open **youtube.com/feed/channel_manager**, click it.

## Console

Open **youtube.com/feed/channel_manager**, press F12, paste `console-script.js`.

## Python

```bash
pip install yt-dlp
python3 extract_subs.py -b chrome
```

## Importing into NewPipe

Settings -> Content -> Import/Export -> Import subscriptions.

## Why the manager page, not the feed

`youtube.com/feed/subscriptions` is a **video** feed (channels that posted recently) and lists no
subscriptions. `youtube.com/feed/channels` seeds only the **first ~98** channels into
`ytInitialData`; on a 954-channel account it still returns 98, because the remaining rows are
unhydrated skeletons and its continuation request returns an empty stub. `youtube.com/feed/channel_manager`
renders the **complete** list once "Show more" is clicked, so that is what this reads.

That page renders **names and `@handles`**, not `UC…` channel ids. The two ID-based buttons
resolve each handle through `navigation/resolve_url`, one small request per channel (about
1.5 KB, 24 in flight), which measured 940 of 951 resolved in 8.3 s. The account's own channel is
appended to the manager list and is excluded from every export.

## Layout

| Path | Purpose |
| --- | --- |
| `yt2np.js` | The extractor. Single source of truth for every browser method. |
| `extension/` | The unpacked extension (MV3) for Chrome and Firefox. |
| `youtube-to-newpipe.zip` | Packaged `extension/`, built by `tools/package.sh`. |
| `tools/embed.py` | Regenerates the launchers from `yt2np.js`. Run after editing it. |
| `tools/package.sh` | Regenerates the launchers, builds the zip, verifies it matches `extension/`. |
| `tools/check-manager.js` | Extractor behaviour against a stub manager page. |
| `tools/check-launchers.js` | Asserts the bookmarklet and console script match the source. |
| `tools/check-three-buttons.js` | Output formats for all three buttons. |

`bookmarklet.js`, `console-script.js` and `extension/yt2np.js` are generated; edit `yt2np.js`
and run `python3 tools/embed.py`.

```bash
bun tools/check-manager.js && bun tools/check-launchers.js && bun tools/check-three-buttons.js
```
