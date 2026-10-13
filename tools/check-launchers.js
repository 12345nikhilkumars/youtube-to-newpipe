// The bookmarklet must be a single javascript: line, and must produce the same subscription
// list as the source it was generated from. console-script.js must match too.
// Usage: bun tools/check-launchers.js
import { readFileSync } from "node:fs";

const core = readFileSync(new URL("../yt2np.js", import.meta.url), "utf8");
const bookmarklet = readFileSync(new URL("../bookmarklet.js", import.meta.url), "utf8");
const consoleScript = readFileSync(new URL("../console-script.js", import.meta.url), "utf8");

const anchor = (h, n) => ({
  getAttribute: (k) => (k === "href" ? `/@${h}` : k === "title" ? n : null),
  textContent: n,
  closest: () => ({ innerText: n }),
});
const rows = [["a", "A"], ["b", "B"], ["mine", "Your channel"]];
const page = {
  querySelectorAll: (s) => (s === 'a[href^="/@"]' ? rows.map(([h, n]) => anchor(h, n)) : []),
  querySelector: (s) => (s.includes("avatar-link") ? anchor("mine", "Me") : null),
};

async function extract(code) {
  const fn = new Function("document", "globalThis", "console", "URL", "Blob", "setTimeout",
    `return eval(${JSON.stringify(code)})`);
  return fn(page, { __YT2NP_MODE__: "return" }, { log() {} },
    { createObjectURL: () => "blob:t", revokeObjectURL() {} },
    class { constructor(p) { this.parts = p; } }, (f) => f());
}

let bad = 0;
const check = (name, cond, detail) => {
  process.stderr.write(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` - ${detail}`}\n`);
  bad += cond ? 0 : 1;
};

const body = bookmarklet.replace(/^javascript:/, "");
check("bookmarklet starts with the javascript: scheme", bookmarklet.startsWith("javascript:"), bookmarklet.slice(0, 30));
// A bookmarklet may span lines: browsers normalise whitespace in a javascript: URL. What it
// must not contain is a line comment, which would swallow the remainder of the script.
check("bookmarklet has no line comments", !/(^|\n)\s*\/\//.test(body), "a // comment would disable the rest");
check("bookmarklet has no leading comment", !/^\s*\/\//.test(body), body.slice(0, 40));

const fromSource = JSON.parse(await extract(core));
const fromBookmarklet = JSON.parse(await extract(body));
const fromConsole = JSON.parse(await extract(consoleScript.replace(/^(?:\/\/[^\n]*\n)+/, "")));
check("bookmarklet equals the source output",
  JSON.stringify(fromBookmarklet) === JSON.stringify(fromSource), JSON.stringify(fromBookmarklet));
check("console script equals the source output",
  JSON.stringify(fromConsole) === JSON.stringify(fromSource), JSON.stringify(fromConsole));
check("all variants drop the account's own channel",
  [fromSource, fromBookmarklet, fromConsole].every((o) => o.handles.length === 2));

process.stderr.write(bad ? `\n${bad} failing\n` : "\nall green\n");
process.exit(bad ? 1 : 0);
