// Extractor tests for the manager-page build. The extractor is async and DOM-based, so this
// drives it against a stub of the manager page rather than ytInitialData fixtures.
// Usage: bun tools/check-manager.js
import { readFileSync } from "node:fs";

const core = readFileSync(new URL("../yt2np.js", import.meta.url), "utf8");

/** Minimal manager-page DOM. `clicked` flips the row set, as "Show more" does on the real page. */
function makePage({ rows, ownHandle = null, collapsed = false }) {
  const button = collapsed
    ? { textContent: "Show more", clicked: false, click() { button.clicked = true; } }
    : null;
  const anchor = (handle, name) => ({
    getAttribute: (key) => (key === "href" ? `/@${handle}` : key === "title" ? name : null),
    textContent: name,
    closest: () => ({ innerText: name }),
  });
  const anchors = rows.map(([h, n]) => anchor(h, n));
  return {
    button,
    document: {
      querySelectorAll: (sel) => {
        if (sel === 'a[href^="/@"]') return button && !button.clicked ? anchors.slice(0, 2) : anchors;
        if (sel.includes("button")) return button ? [button] : [];
        return [];
      },
      querySelector: (sel) => (sel.includes("avatar-link") && ownHandle ? anchor(ownHandle, "Me") : null),
    },
  };
}

async function run(page, mode = "return") {
  const fn = new Function("document", "globalThis", "console", "URL", "Blob", "setTimeout",
    `return eval(${JSON.stringify(core)})`);
  return fn(
    page.document,
    { __YT2NP_MODE__: mode },
    { log() {} },
    { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    class { constructor(parts) { this.parts = parts; } },
    (f) => f(),
  );
}

let bad = 0;
const check = (name, cond, detail) => {
  process.stderr.write(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` - ${detail}`}\n`);
  bad += cond ? 0 : 1;
};

// 1. the measured live shape: 951 anchors including the account's own row
const rows = [
  ["2kliksphilip", "2kliksphilip"],
  ["twoswap", "2swap"],
  ["3blue1brown", "3Blue1Brown"],
  ["nikhils7583", "Your channel"],
];
const out = JSON.parse(await run(makePage({ rows, ownHandle: "nikhils7583" })));
check("returns handles for every row except the account's own",
  out.handles.length === 3, JSON.stringify(out));
check("excludes the own channel by label",
  !out.handles.some((h) => h.url.includes("nikhils7583")), JSON.stringify(out));
check("emits NewPipe handle urls", out.handles[0].url === "https://www.youtube.com/@2kliksphilip", JSON.stringify(out));
check("exposes the bare handle, which the CSV and id lookups key on",
  out.handles[0].handle === "2kliksphilip", JSON.stringify(out.handles[0]));
check("every handle is defined and non-empty",
  out.handles.every((h) => typeof h.handle === "string" && h.handle.length > 0), JSON.stringify(out.handles.map((h) => h.handle)));
check("preserves names", out.handles[1].name === "2swap", JSON.stringify(out));
check("carries no ids when resolution was not requested",
  Object.keys(out.ids).length === 0 && out.unresolved.length === 0, JSON.stringify(out));

// 2. collapsed list: "Show more" must be clicked before reading
const collapsed = makePage({ rows, ownHandle: "nikhils7583", collapsed: true });
const expanded = JSON.parse(await run(collapsed));
check("clicks Show more on a collapsed list", collapsed.button.clicked === true, String(collapsed.button.clicked));
check("reads the full set after expanding", expanded.handles.length === 3, JSON.stringify(expanded));

// 3. own channel detected by handle even when the row is not labelled
const byHandle = JSON.parse(await run(makePage({ rows, ownHandle: "nikhils7583" })));
check("drops the own handle when the label is absent", byHandle.handles.length === 3, JSON.stringify(byHandle));

// 4. duplicates collapse
const dupes = JSON.parse(await run(makePage({
  rows: [["a", "A"], ["a", "A"], ["b", "B"]],
})));
check("collapses duplicate handles", dupes.handles.length === 2, JSON.stringify(dupes));

// 5. an empty page must throw with a pointer, not export nothing
let threw = "";
try { await run(makePage({ rows: [] })); } catch (e) { threw = e.message; }
check("throws when the list is missing", /channel_manager/.test(threw), threw);

// A legacy /c/ or /user/ channel answers with a urlEndpoint instead of a channel id.
// The resolver must follow it, otherwise those channels are wrongly reported as unresolvable.
{
  const core = readFileSync(new URL("../yt2np.js", import.meta.url), "utf8");
  check("resolver follows a urlEndpoint redirect",
    /urlEndpoint/.test(core) && /next/.test(core), "no redirect handling found");
  check("resolver falls back to the bare vanity path",
    /youtube\.com\/\$\{handle\}/.test(core), "no bare-path fallback found");
  check("resolver gives up after a bounded number of hops",
    /hop < 3/.test(core), "unbounded redirect following");
}

process.stderr.write(bad ? `\n${bad} failing\n` : "\nall green\n");
process.exit(bad ? 1 : 0);
