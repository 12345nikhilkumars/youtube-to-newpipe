# YouTube to NewPipe Subscription Extractor

It was built for personal use, shared for like minded people
Export your full YouTube subscription list as a NewPipe-compatible JSON file.

## Chrome

1. Unzip `youtube-to-newpipe-chrome.zip` somewhere permanent
2. `chrome://extensions` -> enable **Developer mode**
3. **Load unpacked** -> pick the unzipped folder
4. Click the toolbar icon, then pick one of three buttons

Each button runs the whole job on its own, so nothing has to be pressed first:

| Button | Output | Time (950 channels) |
| --- | --- | --- |
| JSON with handles | `newpipe_handles_DATE.json`, `@handle` URLs | about 2 s |
| JSON with resolved IDs | `newpipe_ids_DATE.json`, `UC…` URLs | about 8 s |
| CSV in Takeout format | `subscriptions_DATE.csv`, `UC…` columns | about 8 s |

All three are generated locally. The extension never uploads anything.

The list is read from `youtube.com/feed/channel_manager` in a **background tab** that never
takes focus and is **closed** as soon as the data is read, including on failure. Results are
cached for the popup's lifetime, so a second button reuses the first one's work.

The list is rendered by YouTube into its own page, so it can only be read from inside that page.
Nothing is scraped over the network and no separate service is contacted.

## Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** -> pick `extension-firefox/manifest.json` (or `youtube-to-newpipe-firefox.zip`)

Firefox build requires minimum Firefox 142 and sets data collection permissions.

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

Settings -> Content -> Import/Export -> **Import from** -> **Previous export**, then choose the
JSON file. Use the **JSON with resolved IDs** for the format every importer accepts; the handle
JSON is for NewPipe's own import. The CSV is Google Takeout's `subscriptions.csv` layout, for
tools that expect Takeout.

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

## Why the extension asks for its permissions

All four are declared in `extension/manifest.json` and each is used for one thing only.

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Finds the active tab when you click the toolbar icon, opens the subscriptions list in a background tab, waits for it to load, and closes it once the data is read. No tab is opened, closed or inspected without that click. |
| `scripting` | Runs one bundled file, `yt2np.js`, inside the youtube.com tab, because the subscription list exists only in that page. It reads the rendered channel list, checks whether the list has finished loading, tells that file whether you asked for resolved IDs, and reports progress during resolution. Nothing is fetched from a remote source and nothing is injected into any other site. |
| `downloads` | Saves the exported file, and only when you press an export button. There is no download on install and no automatic download. |
| `https://www.youtube.com/*` | Required for two things: injecting `yt2np.js` into the manager page, and calling YouTube's own same-origin `navigation/resolve_url` endpoint to turn channel handles into `UC…` ids. `https://www.youtube.com/*` is a single named host, not `<all_urls>`, and no other host is requested. |

No permission is used to collect analytics, track browsing, or send data anywhere. The whole
pipeline runs in the browser and ends in a file in your Downloads folder.

## Layout

| Path | Purpose |
| --- | --- |
| `yt2np.js` | The extractor. Single source of truth for every browser method. |
| `extension/` | The unpacked extension (MV3) for Chrome and Firefox. |
| `youtube-to-newpipe-chrome.zip` | Packaged `extension/`, built by `tools/package.sh`. Git-ignored; attach it to a release rather than committing it. |
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
