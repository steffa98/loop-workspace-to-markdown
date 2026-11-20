// Shared, side-effect-free logic for the export. Loaded by the popup, the service worker
// (importScripts), the Markdown generator and the Node tests (tests/export-core.test.js).
// Relies on Loop internals found in the 2026-11-19 spike: see docs/superpowers/specs/2026-11-19-faster-export-design.md.

const LOOP_ORIGIN = 'https://loop.cloud.microsoft';

function base64url(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(segment) {
  const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

// Loop's print view for a page, from the page's SharePoint link
function printUrl(link) {
  return `${LOOP_ORIGIN}/print/${base64url(JSON.stringify({ p: { u: link } }))}`;
}

// The page's SharePoint link from a Loop page address (/p/<base64url JSON with p.u>), or null
function linkFromPageUrl(url) {
  try {
    const u = new URL(url);
    if (u.origin !== LOOP_ORIGIN || !u.pathname.startsWith('/p/')) return null;
    const data = JSON.parse(unbase64url(u.pathname.slice(3)));
    return (data && data.p && typeof data.p.u === 'string') ? data.p.u : null;
  } catch (e) {
    return null;
  }
}

// Flat sidebar list -> tree. Children go under their parent wherever it is listed; orphans go to the root.
function pageListToTree(items) {
  const byValue = new Map();
  const nodes = items.map(it => {
    const node = { title: it.title, link: it.link, print: printUrl(it.link), children: [] };
    byValue.set(it.value, node);
    return node;
  });
  const roots = [];
  items.forEach((it, i) => {
    const parent = it.parentValue != null && byValue.get(it.parentValue);
    (parent && parent !== nodes[i] ? parent.children : roots).push(nodes[i]);
  });
  return roots;
}

// Depth-first, parent before children. A node's position here is its storage index.
function flattenTree(tree) {
  const out = [];
  const walk = nodes => nodes.forEach(n => { out.push(n); walk(n.children || []); });
  walk(tree);
  return out;
}

// File path of each page in the ZIP, in flattenTree order: a page's children go in a folder named like it.
// Names are made safe for Windows and unique per folder, ignoring case (Windows folders do).
function filePaths(tree) {
  const paths = [], used = new Set(['/_export-report']); // the ZIP's report file
  const safe = title => {
    const name = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().replace(/\s+/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 100) || 'untitled';
    return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `${name}-` : name;
  };
  const walk = (nodes, folder) => nodes.forEach(n => {
    const base = safe(n.title || '');
    let name = base;
    for (let k = 2; used.has(`${folder}/${name}`.toLowerCase()); k++) name = `${base}-${k}`;
    used.add(`${folder}/${name}`.toLowerCase());
    const path = folder ? `${folder}/${name}` : name;
    paths.push(`${path}.md`);
    walk(n.children || [], path);
  });
  walk(tree, '');
  return paths;
}

// Indexes still to capture: never stored, or stored as a failure
function pendingIndexes(total, stored) {
  const out = [];
  for (let i = 0; i < total; i++) if (!stored[i] || stored[i].error) out.push(i);
  return out;
}

function runStatus(total, stored) {
  let done = 0, failed = 0;
  for (let i = 0; i < total; i++) {
    if (!stored[i]) continue;
    if (stored[i].error) failed++; else done++;
  }
  return { done, failed, missing: total - done - failed };
}

// True when the first pages tried all failed: Loop probably changed its print address.
// Needs min(3, pending) failures so one unprintable page at the start doesn't abort the run.
function isPrintBroken(attempts, pendingCount) {
  return attempts.length >= Math.min(3, pendingCount) && attempts.every(ok => !ok);
}

// Why a page couldn't be exported, in words for the person reading the popup or report
function describeError(error, link = '') {
  let text = error;
  if (/empty/.test(error)) text = "it's empty in Loop's print view (it may not be a normal page)";
  else if (/not finished after/.test(error)) text = "it didn't finish loading within 45 seconds";
  else if (/didn't load within|took over/.test(error)) text = "Loop didn't open it in time";
  // Pages in a personal OneDrive (-my.sharepoint.com/personal/) become unreachable when the owner leaves
  if (/-my\.sharepoint\.com\/(:\w+:\/\w\/)?personal\//.test(link)) {
    text += ". It's stored in someone's personal OneDrive, so you may no longer have access (for example if they left the company)";
  }
  return text;
}

function buildReport({ workspaceName, date, nodes, stored }) {
  const failed = [];
  nodes.forEach((n, i) => {
    const s = stored[i];
    if (!s || s.error) failed.push(`- ${n.title} — ${describeError(s ? s.error : 'it was not copied', n.link)} — [Open in Loop](${n.link})`);
  });
  return [
    '# Export report', '',
    `Workspace: ${workspaceName}`,
    `Date: ${date.toLocaleString()}`,
    `Exported: ${nodes.length - failed.length} of ${nodes.length}`, '',
    "## Couldn't export", '',
    ...(failed.length ? failed : ['None']), ''
  ].join('\n');
}

// A window we opened as a worker: every tab blank or a Loop print view. Window ids restart after
// a Chrome restart, so a stored id may now belong to one of the user's own windows.
function isWorkerWindow(tabs) {
  return tabs.length > 0 && tabs.every(t => {
    const url = t.url || t.pendingUrl || '';
    return url === 'about:blank' || url.startsWith(`${LOOP_ORIGIN}/print/`);
  });
}

// For chrome.tabs.onUpdated: true once the navigation to `url` has started AND then completed,
// so a late "complete" from the previous page (or previous attempt) isn't taken for this one.
function makeLoadWatcher(url) {
  let started = false;
  return (info, tab) => {
    if (info.status === 'loading' && (info.url || tab.url || tab.pendingUrl) === url) started = true;
    return started && info.status === 'complete' && (tab.url || '').includes('/print/');
  };
}

// Workers take indexes from the shared queue. A page whose window was closed mid-capture goes back
// in the queue; workers still open keep going until it's empty. If every window is closed, the
// remaining indexes stay in the queue (the run is then resumable).
async function runPool(tabIds, queue, { alive, capture, record }) {
  let live = tabIds;
  while (queue.length && live.length) {
    await Promise.all(live.map(async tabId => {
      while (queue.length) {
        if (!(await alive(tabId))) return;
        const i = queue.shift();
        const result = await capture(tabId, i);
        if (!(await alive(tabId))) { queue.push(i); return; }
        await record(i, result);
      }
    }));
    const stillOpen = await Promise.all(live.map(alive));
    live = live.filter((_, k) => stillOpen[k]);
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    printUrl, linkFromPageUrl, pageListToTree, flattenTree, pendingIndexes, runStatus, isPrintBroken, buildReport,
    isWorkerWindow, makeLoadWatcher, runPool, describeError, filePaths
  };
}
