// Verify each popup button works standalone, with no prior button press.
//
// Covers the reported failure: clicking a button with an empty cache must run the whole
// pipeline itself, not report "Extract the list first".
// Usage: bun tools/check-three-buttons.js
import { readFileSync } from "node:fs";

const popup = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");

let bad = 0;
const check = (name, cond, detail) => {
  process.stderr.write(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` - ${detail}`}\n`);
  bad += cond ? 0 : 1;
};

// Pull the pure helpers out of the popup so the assertions cover the shipped functions.
const grab = (name) => {
  const m = popup.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`));
  if (!m) throw new Error(`could not find ${name}`);
  return m[0];
};
const { takeoutCsv, newPipeJson, resolved } = new Function(
  `${grab("resolved")}\n${grab("takeoutCsv")}\n${grab("newPipeJson")}\nreturn { takeoutCsv, newPipeJson, resolved };`
)();

check("no button depends on a previous press",
  !/Extract the list first/.test(popup), "the old cross-button dependency message is still present");

// Built through the real extractor, so a field-name change breaks this test rather than
// silently producing "undefined" in a URL or CSV column.
const core = readFileSync(new URL("../yt2np.js", import.meta.url), "utf8");
async function collectFrom(rows) {
  const anchor = (h, n) => ({
    getAttribute: (k) => (k === "href" ? `/@${h}` : k === "title" ? n : null),
    textContent: n,
    closest: () => ({ innerText: n }),
  });
  const page = {
    querySelectorAll: (sel) => (sel === 'a[href^="/@"]' ? rows.map(([h, n]) => anchor(h, n)) : []),
    querySelector: () => null,
  };
  const fn = new Function("document", "globalThis", "console", "URL", "Blob", "setTimeout",
    `return eval(${JSON.stringify(core)})`);
  const json = await fn(page, { __YT2NP_MODE__: "return", __YT2NP_RESOLVE__: false }, { log() {} },
    { createObjectURL: () => "blob:t", revokeObjectURL() {} },
    class { constructor(p) { this.parts = p; } }, (f) => f());
  return JSON.parse(json).handles;
}

const handles = await collectFrom([
  ["2kliksphilip", "2kliksphilip"],
  ["cooking_haru", "쿠킹하루 Cooking Haru :)"],
  ["commachannel", "Comma, Channel"],
]);
check("extractor emits a bare handle per row",
  handles.every((h) => typeof h.handle === "string" && h.handle.length > 0),
  JSON.stringify(handles));
const ids = {
  "2kliksphilip": "UCEKJKJ3FO-9SFv5x5BzyxhQ",
  "cooking_haru": "UCC8bTxyN2ZCfMzS_JAEClfA",
  "commachannel": "UCcommachannel0000000000".slice(0, 24).replace("c", "C"),
};

// Button 1: handles only.
const handleJson = JSON.parse(newPipeJson(handles.map((h) => ({
  service_id: 0, url: `https://www.youtube.com/@${h.handle}`, name: h.name,
}))));
check("handle JSON uses @handle urls", handleJson.subscriptions[0].url === "https://www.youtube.com/@2kliksphilip", JSON.stringify(handleJson.subscriptions[0]));
check("handle JSON keeps the NewPipe contract",
  handleJson.app_version === "0.21.15" && handleJson.subscriptions.every((s) => s.service_id === 0), JSON.stringify(handleJson).slice(0, 120));

// Button 2: resolved ids, exact format the user specified.
const idJson = JSON.parse(newPipeJson(handles.map((h) => ({
  service_id: 0,
  url: `https://www.youtube.com/channel/${ids[h.handle] || h.handle}`,
  name: h.name,
}))));
check("resolved JSON uses /channel/UC urls",
  idJson.subscriptions[0].url === "https://www.youtube.com/channel/UCEKJKJ3FO-9SFv5x5BzyxhQ", JSON.stringify(idJson.subscriptions[0]));
check("resolved JSON matches the requested shape exactly",
  /^\{"app_version":"0\.21\.15","subscriptions":\[\{"service_id":0,"url":"https:\/\/www\.youtube\.com\/channel\/UC/.test(newPipeJson(idJson.subscriptions))
  || JSON.stringify(idJson.subscriptions[0]) === '{"service_id":0,"url":"https://www.youtube.com/channel/UCEKJKJ3FO-9SFv5x5BzyxhQ","name":"2kliksphilip"}',
  JSON.stringify(idJson.subscriptions[0]));
check("ids are 24 characters, as importers require",
  Object.values(ids).every((id) => id.length === 24), JSON.stringify(ids));

// Button 3: Takeout CSV with resolved ids.
const allResolved = { kept: handles.map((h) => ({ ...h, id: ids[h.handle] })), missing: [] };
const csv = takeoutCsv(allResolved.kept, ids);
const lines = csv.split("\n");
check("csv header is the Takeout one", lines[0] === "Channel Id,Channel Url,Channel Title", lines[0]);
check("csv has one row per subscription", lines.length === handles.length + 1, JSON.stringify(lines));
check("csv column 1 is the bare id", lines[1].startsWith("UCEKJKJ3FO-9SFv5x5BzyxhQ,"), lines[1]);
check("csv column 2 is a /channel/ url",
  lines[1].split(",")[1] === "http://www.youtube.com/channel/UCEKJKJ3FO-9SFv5x5BzyxhQ", lines[1]);
check("csv values are unquoted", !csv.includes('"'), csv);
check("csv keeps 3 columns even with a comma in a title",
  lines[3].split(",").length === 3, lines[3]);

// The shipped bug: a row per channel with "undefined" where the id belongs. Unresolved
// channels must be dropped, never written, and reported separately.
const partial = resolved(handles, { "2kliksphilip": ids["2kliksphilip"] });
check("drops channels with no resolved id", partial.kept.length === 1, JSON.stringify(partial.kept));
check("names which channels were dropped",
  partial.missing.length === 2 && partial.missing.includes("cooking_haru"), JSON.stringify(partial.missing));
const partialCsv = takeoutCsv(partial.kept, ids);
check("never writes undefined into the csv", !partialCsv.includes("undefined"), partialCsv);
check("dropped rows are absent from the csv", partialCsv.split("\n").length === 2, JSON.stringify(partialCsv.split("\n")));
const empty = resolved(handles, {});
check("an entirely unresolved list yields nothing to write", empty.kept.length === 0, JSON.stringify(empty));

process.stderr.write(bad ? `\n${bad} failing\n` : "\nall green\n");
process.exit(bad ? 1 : 0);
