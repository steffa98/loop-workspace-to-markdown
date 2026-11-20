const test = require('node:test');
const assert = require('node:assert/strict');
const {
  printUrl, linkFromPageUrl, pageListToTree, flattenTree,
  pendingIndexes, runStatus, isPrintBroken, buildReport
} = require('../export-core.js');

const b64url = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

test('printUrl matches the address Loop itself uses', () => {
  // Same shape as the address Loop's own "Print & PDF export" menu opens: /print/ + base64url({"p":{"u":link}}),
  // no padding. Made-up tenant; the real one was checked against Loop in 2026-11.
  const link = 'https://contoso.sharepoint.com/:fl:/r/contentstorage/CSP_0000/Document%20Library/LoopAppData/Untitled%201.loop?d=w1234&csf=1&web=1&nav=cz0lMkY%3D';
  const known = 'eyJwIjp7InUiOiJodHRwczovL2NvbnRvc28uc2hhcmVwb2ludC5jb20vOmZsOi9yL2NvbnRlbnRzdG9yYWdlL0NTUF8wMDAwL0RvY3VtZW50JTIwTGlicmFyeS9Mb29wQXBwRGF0YS9VbnRpdGxlZCUyMDEubG9vcD9kPXcxMjM0JmNzZj0xJndlYj0xJm5hdj1jejBsTWtZJTNEIn19';
  assert.equal(printUrl(link), 'https://loop.cloud.microsoft/print/' + known);
});

test('printUrl handles non-ASCII titles in links', () => {
  const link = 'https://x.sharepoint.com/LoopAppData/Réunion été.loop?d=w1';
  const seg = printUrl(link).split('/print/')[1];
  assert.match(seg, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(unb64url(seg)), { p: { u: link } });
});

test('linkFromPageUrl reads p.u', () => {
  const seg = b64url(JSON.stringify({ w: { u: 'W', r: false }, p: { u: 'L', r: false }, i: { i: 'x' } }));
  assert.equal(linkFromPageUrl('https://loop.cloud.microsoft/p/' + seg), 'L');
  assert.equal(linkFromPageUrl('https://loop.cloud.microsoft/'), null);
  assert.equal(linkFromPageUrl('https://loop.cloud.microsoft/p/!!notbase64'), null);
});

const item = (title, value, parentValue) => ({ title, link: 'L-' + title, value, parentValue });
const titles = nodes => nodes.map(n => n.children.length ? [n.title, titles(n.children)] : n.title);

test('pageListToTree nests by parentValue and keeps order', () => {
  const tree = pageListToTree([item('a', 1), item('b', 2, 1), item('c', 3), item('d', 4, 2)]);
  assert.deepEqual(titles(tree), [['a', [['b', ['d']]]], 'c']);
  assert.equal(tree[0].print, printUrl('L-a'));
  assert.equal(tree[0].link, 'L-a');
});

test('pageListToTree puts orphans at the root and accepts a child listed before its parent', () => {
  const items = [item('child', 2, 1), item('parent', 1), item('orphan', 3, 99)];
  const tree = pageListToTree(items);
  assert.deepEqual(titles(tree), [['parent', ['child']], 'orphan']);
  assert.equal(flattenTree(tree).length, items.length);
});

test('flattenTree is depth-first', () => {
  const tree = pageListToTree([item('a', 1), item('b', 2, 1), item('c', 3), item('d', 4, 2)]);
  assert.deepEqual(flattenTree(tree).map(n => n.title), ['a', 'b', 'd', 'c']);
});

const stored = { 0: { text: 'x' }, 2: { error: 'e' }, 4: { text: '' } };

test('pendingIndexes returns missing and failed', () => {
  assert.deepEqual(pendingIndexes(5, stored), [1, 2, 3]);
});

test('runStatus counts', () => {
  assert.deepEqual(runStatus(5, stored), { done: 2, failed: 1, missing: 2 });
});

test('isPrintBroken', () => {
  assert.equal(isPrintBroken([false], 1), true);
  assert.equal(isPrintBroken([false], 5), false);
  assert.equal(isPrintBroken([false, false, false], 5), true);
  assert.equal(isPrintBroken([false, true], 5), false);
  assert.equal(isPrintBroken([false, false], 2), true);
});

test('buildReport lists failures with links', () => {
  const nodes = flattenTree(pageListToTree([item('one', 1), item('two', 2), item('three', 3)]));
  const report = buildReport({
    workspaceName: 'WS', date: new Date(2026, 10, 20),
    nodes, stored: { 0: { text: 'a' }, 1: { error: 'not finished after 45s' }, 2: { text: 'c' } }
  });
  assert.match(report, /Exported: 2 of 3/);
  assert.ok(report.split('\n').some(l => l.includes('two') && l.includes("didn't finish loading") && l.includes('L-two')));
  const clean = buildReport({ workspaceName: 'WS', date: new Date(), nodes, stored: { 0: {}, 1: {}, 2: {} } });
  assert.match(clean, /None/);
});

const { isWorkerWindow, makeLoadWatcher, runPool } = require('../export-core.js');

test('isWorkerWindow only matches windows holding blank or Loop print tabs', () => {
  assert.equal(isWorkerWindow([{ url: 'about:blank' }, { url: 'https://loop.cloud.microsoft/print/abc' }]), true);
  assert.equal(isWorkerWindow([{ url: 'https://loop.cloud.microsoft/print/abc' }, { url: 'https://mail.example.com/' }]), false);
  assert.equal(isWorkerWindow([{ url: 'https://loop.cloud.microsoft/p/abc' }]), false);
  assert.equal(isWorkerWindow([]), false);
});

test('makeLoadWatcher ignores a "complete" from the previous load', () => {
  const url = 'https://loop.cloud.microsoft/print/NEW';
  const seen = makeLoadWatcher(url);
  assert.equal(seen({ status: 'complete' }, { url: 'https://loop.cloud.microsoft/print/OLD' }), false);
  assert.equal(seen({ status: 'complete' }, { url }), false); // same URL, but no new load started yet
  assert.equal(seen({ status: 'loading' }, { url }), false);
  assert.equal(seen({ status: 'complete' }, { url }), true);
});

test('runPool: a page put back by a closed window is captured by a worker still open', async () => {
  const closed = new Set(), captured = [];
  const queue = [0, 1, 2];
  await runPool([1, 2], queue, {
    alive: async tabId => !closed.has(tabId),
    capture: async (tabId, i) => {
      await new Promise(r => setTimeout(r, tabId === 2 && i === 1 ? 30 : 5));
      if (tabId === 2 && i === 1) closed.add(2); // window 2 closed while on page 1, after worker 1 ran out of work
      return { text: `p${i}` };
    },
    record: async (i, result) => { captured.push(i); }
  });
  assert.deepEqual(captured.sort(), [0, 1, 2]);
  assert.deepEqual(queue, []);
});

test('runPool stops with pages left when every window is closed', async () => {
  const queue = [0, 1, 2];
  const captured = [];
  let closed = false;
  await runPool([1], queue, {
    alive: async () => !closed,
    capture: async (tabId, i) => { closed = true; return { text: `p${i}` }; },
    record: async i => { captured.push(i); }
  });
  assert.deepEqual(captured, []); // closed during its first page: nothing recorded
  assert.deepEqual(queue.sort(), [0, 1, 2]); // all left for Resume
});

const { describeError } = require('../export-core.js');

test('describeError explains failures in plain words', () => {
  assert.equal(describeError('page is empty'), "it's empty in Loop's print view (it may not be a normal page)");
  assert.equal(describeError('not finished after 45s'), "it didn't finish loading within 45 seconds");
  assert.equal(describeError("print page didn't load within 30s"), "Loop didn't open it in time");
  assert.equal(describeError('page took over 80s'), "Loop didn't open it in time");
  assert.equal(describeError('something new'), 'something new');
});

test('buildReport uses the plain-words reason', () => {
  const nodes = flattenTree(pageListToTree([item('one', 1)]));
  const report = buildReport({ workspaceName: 'WS', date: new Date(), nodes, stored: { 0: { error: 'page is empty' } } });
  assert.ok(report.includes("- one — it's empty in Loop's print view (it may not be a normal page) — [Open in Loop](L-one)"));
});

test('describeError says when a page lives in a personal OneDrive', () => {
  const personal = 'https://contoso-my.sharepoint.com/:fl:/g/personal/someone_contoso_com/Ee9q?nav=x';
  assert.equal(describeError('not finished after 45s', personal),
    "it didn't finish loading within 45 seconds. It's stored in someone's personal OneDrive, so you may no longer have access (for example if they left the company)");
  assert.equal(describeError('not finished after 45s', 'https://contoso.sharepoint.com/:fl:/r/contentstorage/x.loop'),
    "it didn't finish loading within 45 seconds");
});

test('buildReport mentions the personal OneDrive', () => {
  const nodes = [{ title: 'gone', link: 'https://contoso-my.sharepoint.com/personal/a_b/x', print: 'p', children: [] }];
  const report = buildReport({ workspaceName: 'WS', date: new Date(), nodes, stored: { 0: { error: 'page is empty' } } });
  assert.match(report, /personal OneDrive/);
});

const { filePaths } = require('../export-core.js');
const node = (title, children = []) => ({ title, link: 'L', print: 'P', children });

test('filePaths mirrors the tree as folders, in flattenTree order', () => {
  assert.deepEqual(filePaths([node('A', [node('B', [node('C')])]), node('D')]), ['A.md', 'A/B.md', 'A/B/C.md', 'D.md']);
});

test('filePaths makes same-named siblings unique, ignoring case (Windows folders)', () => {
  assert.deepEqual(filePaths([node('Notes'), node('notes'), node('Notes')]), ['Notes.md', 'notes-2.md', 'Notes-3.md']);
  assert.deepEqual(filePaths([node('X', [node('Same')]), node('Y', [node('Same')])]), ['X.md', 'X/Same.md', 'Y.md', 'Y/Same.md']);
});

test('filePaths cleans titles Windows or ZIP tools would reject', () => {
  assert.deepEqual(filePaths([node('RE: a/b? "c"'), node(''), node('...'), node('CON'), node('x'.repeat(150))]),
    ['RE-ab-c.md', 'untitled.md', 'untitled-2.md', 'CON-.md', 'x'.repeat(100) + '.md']);
});

test('filePaths never uses the report file name', () => {
  assert.deepEqual(filePaths([node('_export-report')]), ['_export-report-2.md']);
});
