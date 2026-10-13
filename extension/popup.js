// Popup: three independent buttons.
//
//   1. JSON with handles   - fast, importable in NewPipe via Previous export
//   2. JSON with UC ids    - resolves ids, the format every importer accepts
//   3. CSV in Takeout form - resolves ids, Google Takeout's subscriptions.csv layout
//
// Each button runs the whole pipeline on its own: read the list, resolve ids if that format
// needs them, then save. Nothing depends on another button having been pressed first.
// Resolution results are cached locally so a second click does not repeat the work.
//
// The list itself comes from /feed/channel_manager in a BACKGROUND tab that is closed as soon
// as the data is read; /feed/channels only ever seeds about 98 of ~950 channels.
const MANAGER = 'https://www.youtube.com/feed/channel_manager';
const LOAD_MS = 20000;    // page load budget
const ROWS_MS = 12000;    // how long to wait for the list to render after load
const ROWS_READY = 'a[href^="/@"]';

// Cached extraction and resolution, so repeat clicks reuse both. sessionStorage is scoped to
// this popup instance, which is the right lifetime: the popup closes when it loses focus.
const CACHE_KEY = 'yt2np.data';
const CACHE_TTL_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const cached = JSON.parse(raw);
    if (cached.at && Date.now() - cached.at > CACHE_TTL_MS) return {};
    return cached;
  } catch {
    return {};
  }
}

function writeCache(patch) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...patch, at: Date.now() }));
  } catch {
    // Cache is an optimisation; the pipeline works without it.
  }
}

function setStatus(message, kind) {
  const el = $('status');
  el.textContent = message;
  el.className = `status ${kind || ''}`;
  el.hidden = !message;
}

const BUTTONS = ['handlesBtn', 'idsBtn', 'csvBtn'];

function setBusy(busy, message) {
  for (const id of BUTTONS) $(id).disabled = busy;
  if (message) setStatus(message);
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

/** Show resolution progress: it is the slow stage and silence looks like a hang. */
function progressTimer(tabId) {
  return setInterval(async () => {
    const [probe] = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => globalThis.__YT2NP_PROGRESS__,
    }).catch(() => [{ result: null }]);
    if (probe?.result) setStatus(`Resolving channel IDs\u2026 ${probe.result}`);
  }, 1000);
}

/** Read handles, and resolve ids too when `resolve` is set. Runs in one background tab. */
async function fetchData({ resolve, slowMessage }) {
  const tab = await browser.tabs.create({ url: MANAGER, active: false });
  const timer = resolve ? progressTimer(tab.id) : null;
  try {
    await waitForLoad(tab.id, LOAD_MS);
    const deadline = Date.now() + ROWS_MS;
    for (let i = 0; ; i++) {
      const [probe] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (sel) => document.querySelectorAll(sel).length,
        args: [ROWS_READY],
      }).catch(() => [{ result: 0 }]);
      if ((probe?.result || 0) > 0) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, i < 4 ? 250 : 750));
    }

    // Flags first: the injected file reads them on entry.
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (wantIds, note) => {
        globalThis.__YT2NP_MODE__ = 'return';
        globalThis.__YT2NP_RESOLVE__ = wantIds;
        globalThis.__YT2NP_PROGRESS__ = '';
        globalThis.__YT2NP_NOTE__ = note;
      },
      args: [resolve, slowMessage || ''],
    });

    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['yt2np.js'],
    });
    const value = await result?.result;
    if (typeof value !== 'string') {
      return { error: result?.error?.message || 'The page returned no subscription data.' };
    }
    return JSON.parse(value);
  } catch (e) {
    return { error: `Cannot read the page: ${e.message}` };
  } finally {
    clearInterval(timer);
    // Closed in every case, including failure, so no stray tab is left behind.
    await browser.tabs.remove(tab.id).catch(() => {});
  }
}

/** Handles, from cache when present, otherwise from a fresh extraction. */
async function getHandles() {
  const cached = readCache();
  if (cached.handles) return { handles: cached.handles };
  const data = await fetchData({ resolve: false });
  if (data.error) return { error: data.error };
  writeCache({ handles: data.handles });
  return { handles: data.handles };
}

/** Ids, resolved on demand and cached so repeat clicks are instant. */
async function getIds() {
  const cached = readCache();
  if (cached.ids && Object.keys(cached.ids).length) {
    return { ids: cached.ids, unresolved: [] };
  }
  await getHandles();
  const data = await fetchData({ resolve: true });
  if (data.error) return { error: data.error };
  writeCache({ ids: data.ids, unresolved: data.unresolved || [] });
  return { ids: data.ids, unresolved: data.unresolved || [] };
}

const stamp = () => new Date().toISOString().slice(0, 10);

function download(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  browser.downloads.download({ url, filename, saveAs: false })
    .catch((e) => setStatus(`Download failed: ${e.message}`, 'error'));
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}

function newPipeJson(entries) {
  return JSON.stringify({ app_version: '0.21.15', subscriptions: entries }, null, 2);
}

/**
 * Ids keyed by handle. Unresolved channels are dropped rather than written with an undefined
 * id, so the output stays importable; the count is reported in the status line.
 */
function resolved(handles, ids) {
  const kept = [];
  const missing = [];
  for (const channel of handles) {
    const id = ids[channel.handle];
    if (id) kept.push({ ...channel, id });
    else missing.push(channel.handle);
  }
  return { kept, missing };
}

/**
 * Google Takeout subscriptions.csv.
 *
 * NewPipe's Takeout importer skips the header and reads column 2 as the channel URL, so a
 * UC id is required there. Values are unquoted, matching real Takeout files; a comma inside a
 * title cannot be represented without shifting columns, so it becomes a space.
 */
function takeoutCsv(handles, ids) {
  const cell = (v) => String(v).replace(/,/g, ' ').trim();
  const rows = handles.map((h) => [h.id, `http://www.youtube.com/channel/${h.id}`, cell(h.name)].join(','));
  return ['Channel Id,Channel Url,Channel Title', ...rows].join('\n');
}

/** Report how many channels received ids, and name any that did not. */
function resolutionNote(kept, ids, missing, label) {
  if (!missing.length) {
    setStatus(`${label} saved. ${kept.length} subscriptions, all IDs resolved.`, 'success');
    return;
  }
  setStatus(
    `${label} saved. ${kept.length} rows written, ${missing.length} skipped (no ID): ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '\u2026' : ''}`,
    'error'
  );
}

$('handlesBtn').addEventListener('click', async () => {
  setBusy(true, 'Reading the subscriptions list\u2026');
  try {
    const { handles, error } = await getHandles();
    if (error) return setStatus(error, 'error');
    const entries = handles.map((h) => ({
      service_id: 0,
      url: `https://www.youtube.com/@${h.handle}`,
      name: h.name,
    }));
    download(newPipeJson(entries), `newpipe_handles_${stamp()}.json`);
    setStatus(`JSON saved. ${entries.length} subscriptions with @handle URLs.`, 'success');
  } finally {
    setBusy(false);
  }
});

$('idsBtn').addEventListener('click', async () => {
  setBusy(true, 'Reading the subscriptions list\u2026');
  try {
    const { handles, error } = await getHandles();
    if (error) return setStatus(error, 'error');
    setStatus('Resolving channel IDs\u2026');
    const { ids, unresolved, error: idError } = await getIds();
    if (idError) return setStatus(idError, 'error');
    const { kept, missing } = resolved(handles, ids);
    if (!kept.length) {
      return setStatus(`No channel IDs could be resolved. ${unresolved.slice(0, 4).join(', ')}`, 'error');
    }
    const entries = kept.map((h) => ({
      service_id: 0,
      url: `https://www.youtube.com/channel/${h.id}`,
      name: h.name,
    }));
    download(newPipeJson(entries), `newpipe_ids_${stamp()}.json`);
    resolutionNote(kept, ids, missing, 'JSON with IDs');
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    setBusy(false);
  }
});

$('csvBtn').addEventListener('click', async () => {
  setBusy(true, 'Reading the subscriptions list\u2026');
  try {
    const { handles, error } = await getHandles();
    if (error) return setStatus(error, 'error');
    setStatus('Resolving channel IDs\u2026');
    const { ids, unresolved, error: idError } = await getIds();
    if (idError) return setStatus(idError, 'error');
    const { kept, missing } = resolved(handles, ids);
    if (!kept.length) {
      return setStatus(`No channel IDs could be resolved. ${unresolved.slice(0, 4).join(', ')}`, 'error');
    }
    download(takeoutCsv(kept, ids), `subscriptions_${stamp()}.csv`);
    resolutionNote(kept, ids, missing, 'CSV');
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    setBusy(false);
  }
});

// Show what is already cached when the popup reopens during the same session.
{
  const cached = readCache();
  if (cached.handles) {
    const resolved = Object.keys(cached.ids || {}).length;
    const count = $('count');
    count.textContent = resolved
      ? `${cached.handles.length} subscriptions, ${resolved} IDs resolved`
      : `${cached.handles.length} subscriptions ready`;
    count.hidden = false;
  }
}
