// Background service worker: captures the pages of an export in tiled windows.
// Design: docs/superpowers/specs/2026-11-19-faster-export-design.md
importScripts('export-core.js');

const WORKERS = { workspace: 4, page: 1 };
const LOAD_MS = 30000;      // print page must finish loading within this
const STILL_MS = 4000;      // page is finished when its text hasn't changed for this long
const SETTLE_MS = 45000;    // ...but give up after this
const PAGE_CAP_MS = 80000;  // hard limit per attempt, in case the page freezes
const ABORT_MESSAGE = 'Loop has changed how pages are printed; the extension needs an update';

let running = null; // 'workspace' | 'page' | null; in memory, so null again after a service-worker restart

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'isRunning') {
    sendResponse({ running });
    return;
  }
  if (request.action === 'startExport' || request.action === 'resumeExport') {
    if (running) {
      sendResponse({ ok: false, error: 'An export is already running.' });
      return;
    }
    running = request.kind; // set now so a second click can't start a second run
    const work = request.action === 'startExport' ? startExport(request) : resumeExport(request);
    work.catch(error => {
      console.error('Background: export error:', error);
      setBadge('ERR');
      running = null;
    });
    sendResponse({ ok: true });
  }
});

const runKey = kind => `run:${kind}`;
const pageKey = (run, i) => `page:${run.id}:${i}`;

async function getRun(kind) {
  return (await chrome.storage.local.get(runKey(kind)))[runKey(kind)] || null;
}

function saveRun(run) {
  return chrome.storage.local.set({ [runKey(run.kind)]: run });
}

async function loadStored(run) {
  const keys = Array.from({ length: run.total }, (_, i) => pageKey(run, i));
  const data = await chrome.storage.local.get(keys);
  const stored = {};
  keys.forEach((k, i) => { if (data[k]) stored[i] = data[k]; });
  return stored;
}

async function startExport({ kind, tree, workspaceName, screen }) {
  const old = await getRun(kind);
  if (old) {
    await closeWindows(old.windowIds);
    await chrome.storage.local.remove(Array.from({ length: old.total }, (_, i) => pageKey(old, i)));
  }
  // Keys of the previous version of the extension
  await chrome.storage.local.remove(['exportData', 'workspaceName', 'lastPrintContent']);
  const nodes = flattenTree(tree).map(({ title, link, print }) => ({ title, link, print }));
  await saveRun({
    id: Date.now().toString(36), kind, workspaceName, tree, nodes,
    total: nodes.length, screen, startedAt: Date.now()
  });
  await runCapture(kind);
}

async function resumeExport({ kind, screen }) {
  const run = await getRun(kind);
  if (!run) throw new Error('No export to resume');
  if (screen) run.screen = screen;
  await saveRun(run);
  await runCapture(kind);
}

async function runCapture(kind) {
  // MV3 service workers can be stopped when idle; a periodic extension API call keeps this one alive
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  let run = await getRun(kind);
  try {
    delete run.error;
    await closeWindows(run.windowIds); // left over if a previous service worker died mid-run
    const stored = await loadStored(run);
    const queue = pendingIndexes(run.total, stored);
    const record = async (i, result) => {
      stored[i] = result;
      await chrome.storage.local.set({ [pageKey(run, i)]: result });
      setBadge(`${runStatus(run.total, stored).done}/${run.total}`);
    };

    if (queue.length) {
      const workers = await openWorkers(WORKERS[kind], run.screen);
      run.windowIds = workers.map(w => w.windowId);
      await saveRun(run);

      // Preflight on the first worker: stop early if Loop's print address no longer works
      const attempts = [], pendingCount = queue.length;
      while (queue.length) {
        const i = queue.shift();
        const result = await captureWithRetry(workers[0].tabId, run.nodes[i].print);
        if (!(await tabAlive(workers[0].tabId))) { queue.unshift(i); break; }
        await record(i, result);
        attempts.push(!result.error);
        if (!result.error) break;
        // Only a workspace run where no page has ever succeeded can conclude "Loop changed";
        // a retry of a few genuinely unprintable pages, or a single page, just records the failure.
        if (kind === 'workspace' && runStatus(run.total, stored).done === 0 && isPrintBroken(attempts, pendingCount)) {
          run.error = ABORT_MESSAGE;
          await saveRun(run);
          setBadge('ERR');
          return;
        }
      }

      await runPool(workers.map(w => w.tabId), queue, {
        alive: tabAlive,
        capture: (tabId, i) => captureWithRetry(tabId, run.nodes[i].print),
        record
      });
    }

    const status = runStatus(run.total, stored);
    if (status.missing === 0) {
      run.finishedAt = Date.now();
      await saveRun(run);
      await closeWindows(run.windowIds);
      // Its own window: a tab would go to Chrome's "current window", which may be one of the
      // worker windows just closed or a window behind others, so the page didn't show (2026-11-20)
      await chrome.windows.create({ url: chrome.runtime.getURL(`markdown-generator.html?run=${kind}`), focused: true, type: 'normal' });
      setBadge(status.failed ? `!${status.failed}` : '');
    }
    // Otherwise every window was closed: the run stays resumable from the popup
  } finally {
    clearInterval(keepAlive);
    await closeWindows(run.windowIds);
    running = null;
  }
}

async function captureWithRetry(tabId, url) {
  try {
    return await capturePage(tabId, url);
  } catch (first) {
    console.warn('Background: retrying after:', first.message);
    try {
      return await capturePage(tabId, url);
    } catch (error) {
      return { error: error.message };
    }
  }
}

function capturePage(tabId, url) {
  const attempt = (async () => {
    const loaded = waitForPrintLoad(tabId, url); // listener first, to not miss 'complete'
    await chrome.tabs.update(tabId, { url });
    await loaded;
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: waitForPrintContent,
      args: [STILL_MS, SETTLE_MS]
    });
    if (result && result.timedOut && !result.len) throw new Error('page is empty'); // e.g. not a normal Loop page
    if (!result || result.timedOut) throw new Error(`not finished after ${SETTLE_MS / 1000}s`);
    if (!result.text.trim()) throw new Error('page is empty');
    return { html: result.html, text: result.text };
  })();
  const cap = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`page took over ${PAGE_CAP_MS / 1000}s`)), PAGE_CAP_MS));
  return Promise.race([attempt, cap]);
}

// Runs inside the print page. Loop keeps filling the page for a few seconds and can pause
// mid-load (up to 3 s seen), so "finished" = text unchanged for stillMs with a content frame present.
async function waitForPrintContent(stillMs, maxMs) {
  const start = Date.now();
  let last = -1, changed = start;
  while (Date.now() - start < maxMs) {
    const len = document.body ? document.body.innerText.length : 0;
    if (len !== last) {
      last = len;
      changed = Date.now();
    } else if (len > 0 && document.querySelector('.scriptor-pageFrame') && Date.now() - changed >= stillMs) {
      const el = document.querySelector('[role="main"], main, .print-content, body');
      return { html: el.innerHTML, text: el.innerText };
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { timedOut: true, len: Math.max(last, 0) };
}

function waitForPrintLoad(tabId, url) {
  return new Promise((resolve, reject) => {
    const done = ok => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      ok ? resolve() : reject(new Error(`print page didn't load within ${LOAD_MS / 1000}s`));
    };
    const loadedNow = makeLoadWatcher(url);
    const listener = (id, info, tab) => {
      if (id === tabId && loadedNow(info, tab)) done(true);
    };
    const timer = setTimeout(() => done(false), LOAD_MS);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openWorkers(count, screen) {
  const s = screen || { width: 1280, height: 800, left: 0, top: 0 };
  const cols = count > 1 ? 2 : 1, rows = Math.ceil(count / cols);
  const width = Math.floor(s.width / cols), height = Math.floor(s.height / rows);
  const workers = [];
  for (let k = 0; k < count; k++) {
    const win = await chrome.windows.create({
      url: 'about:blank', focused: k === 0,
      left: s.left + (k % cols) * width, top: s.top + Math.floor(k / cols) * height, width, height
    });
    workers.push({ windowId: win.id, tabId: win.tabs[0].id });
  }
  return workers;
}

// Closes only windows that still look like our workers: after a Chrome restart a stored id may be the user's window
function closeWindows(ids) {
  return Promise.all((ids || []).map(async id => {
    try {
      const win = await chrome.windows.get(id, { populate: true });
      if (isWorkerWindow(win.tabs || [])) await chrome.windows.remove(id);
    } catch (e) { /* already closed */ }
  }));
}

function tabAlive(tabId) {
  return chrome.tabs.get(tabId).then(() => true, () => false);
}

function setBadge(text) {
  chrome.action.setBadgeText({ text }).catch(() => {});
}
