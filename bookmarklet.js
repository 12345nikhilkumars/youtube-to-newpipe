javascript:(() => {
  const ROW = 'a[href^="/@"]';
  const MORE = ['Show more', 'Show fewer'];
  const HANDLE = /^\/@([^/?#]+)/;
  const CONCURRENCY = 24;   // 24 in flight measured ~120 channels/s with no failures
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Click the "Show more" control, if the list is collapsed. */
  async function expand() {
    const button = [...document.querySelectorAll('button, a, yt-button-shape, tp-yt-paper-button')]
      .find((el) => el.textContent?.trim() === MORE[0]);
    if (!button) return false;
    button.click();
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if (document.querySelectorAll(ROW).length > 50) return true;
    }
    return true;
  }
  /** The account's own channel: the manager list appends it last, labelled "Your channel". */
  function ownHandle() {
    const link = document.querySelector('a#avatar-link, ytd-topbar-logo-renderer a[href^="/@"]');
    const match = HANDLE.exec(link?.getAttribute('href') || '');
    return match ? match[1].toLowerCase() : null;
  }
  /** Subscription rows, in the order YouTube lists them. Names come from the row text. */
  function rows() {
    const handle = (el) => {
      const match = HANDLE.exec(el.getAttribute('href') || '');
      return match ? match[1] : null;
    };
    return [...document.querySelectorAll(ROW)]
      .map((el) => {
        const row = el.closest('ytd-channel-renderer, ytd-grid-channel-renderer, li, div');
        const label = el.getAttribute('title')?.trim() || el.textContent?.trim();
        const rowName = row?.innerText?.split('\n')[0]?.trim();
        return {
          handle: handle(el),
          name: (label && label.length > 1 ? label : rowName) || '',
        };
      })
      .filter((row) => row.handle);
  }
  function build(entries) {
    const mine = ownHandle();
    const seen = new Set();
    const subs = [];
    for (const { handle, name } of entries) {
      const key = handle.toLowerCase();
      if (key === mine || /^your channel$/i.test(name) || seen.has(key)) continue;
      seen.add(key);
      subs.push({
        service_id: 0,
        handle,
        url: `https://www.youtube.com/@${handle}`,
        name: name || handle,
      });
    }
    return subs;
  }
  async function collect() {
    await expand();
    const entries = rows();
    if (!entries.length) {
      throw new Error(
        'No subscription rows found. Open youtube.com/feed/channel_manager and let the list load.'
      );
    }
    return build(entries);
  }
  /** One resolve_url call. Returns an id, or the URL YouTube redirected us to. */
  async function resolveOnce(config, url) {
    const response = await fetch(
      `/youtubei/v1/navigation/resolve_url?key=${config.key}&prettyPrint=false`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: config.context, url }),
        credentials: 'include',
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const id = (/"(?:browseId|externalId|channelId)":"(UC[\w-]{22})"/.exec(body) || [])[1];
    if (id) return { id };
    const next = (/"urlEndpoint":\{"url":"([^"]+)"/.exec(body) || [])[1];
    return next ? { next: next.replace(/\\u0026/g, '&') } : {};
  }
  /** Resolve one handle, following at most a few redirects. */
  async function resolveHandle(config, handle) {
    const seen = new Set();
    let url = `https://www.youtube.com/@${handle}`;
    for (let hop = 0; hop < 3; hop++) {
      if (seen.has(url)) break;
      seen.add(url);
      const { id, next } = await resolveOnce(config, url);
      if (id) return id;
      if (!next) break;
      url = next;
    }
    const bare = `https://www.youtube.com/${handle}`;
    if (!seen.has(bare)) {
      const { id } = await resolveOnce(config, bare).catch(() => ({}));
      if (id) return id;
    }
    return null;
  }
  /**
   * Map an @handle to its UC id via the page's own Innertube client.
   *
   * Renewed per call from `ytcfg`, so nothing is hardcoded. Resolution is opt-in: it costs one
   * small request (~1.5 KB) per channel, versus ~1.7 MB for fetching the channel page.
   */
  async function resolveHandles(handles, onProgress) {
    const config = readClientConfig();
    if (!config) throw new Error('YouTube client config not found on this page.');
    const ids = new Map();
    const failed = [];
    let done = 0;
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= handles.length) return;
        const handle = handles[index];
        try {
          const id = await resolveHandle(config, handle);
          if (id) ids.set(handle, id);
          else failed.push(handle);
        } catch {
          failed.push(handle);
        }
        done += 1;
        if (onProgress) onProgress(done, handles.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, handles.length) }, worker));
    const retry = [];
    for (const handle of failed.splice(0)) {
      try {
        const id = await resolveHandle(config, handle);
        if (id) ids.set(handle, id);
        else retry.push(handle);
      } catch {
        retry.push(handle);
      }
    }
    return { ids, failed: retry };
  }
  /** Innertube key and context, read from the page's own config block. */
  function readClientConfig() {
    const script = [...document.scripts]
      .map((el) => el.textContent || '')
      .find((text) => text.includes('INNERTUBE_CONTEXT'));
    if (!script) return null;
    const start = script.indexOf('{"ID_TOKEN"') >= 0
      ? script.indexOf('{"ID_TOKEN"')
      : script.indexOf('{"CLIENT_CANARY_STATE"');
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < script.length; i++) {
      if (script[i] === '{') depth++;
      else if (script[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) return null;
    try {
      const config = JSON.parse(script.slice(start, end));
      const context = config.INNERTUBE_CONTEXT;
      context.client.clientVersion = config.INNERTUBE_CLIENT_VERSION;
      return { key: config.INNERTUBE_API_KEY, context };
    } catch {
      return null;
    }
  }
  function download(json, count) {
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `newpipe_subscriptions_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    console.log(`[YT→NewPipe] ${count} subscriptions written to ${a.download}`);
  }
  const resolve = Boolean(globalThis.__YT2NP_RESOLVE__);
  const mode = globalThis.__YT2NP_MODE__;
  const result = collect().then(async (subs) => {
    let ids = {};
    let failed = [];
    if (resolve) {
      const outcome = await resolveHandles(
        subs.map((s) => s.url.split('/@')[1]).filter(Boolean),
        (done, total) => {
          globalThis.__YT2NP_PROGRESS__ = `${done}/${total}`;
        }
      );
      ids = Object.fromEntries(outcome.ids);
      failed = outcome.failed;
    }
    const payload = JSON.stringify({ handles: subs, ids, unresolved: failed });
    if (mode === 'return') return payload;
    download(payload, subs.length);
    return subs.length;
  });
  return result;
})();