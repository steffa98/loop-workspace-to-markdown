// Popup: finds the pages, hands them to background.js, and offers resume / retry / download again.
const $ = id => document.getElementById(id);
const SECONDS_PER_PAGE = 5.3; // measured with 4 windows on the 137-page workspace (2026-11-19)

function setStatus(kind, text, detail = '') {
  $('status').className = kind;
  $('status').textContent = text;
  $('progress').textContent = detail;
}

function screenArea() {
  return { width: screen.availWidth, height: screen.availHeight, left: screen.availLeft, top: screen.availTop };
}

async function loopTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('loop.cloud.microsoft')) {
    setStatus('error', 'Please navigate to a Microsoft Loop workspace page');
    return null;
  }
  return tab;
}

async function runInTab(tabId, func, world = 'ISOLATED') {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func, world });
  return result;
}

// Reads every page and the workspace name from the sidebar's own data, after opening collapsed folders. Null if Loop changed.
function readPageList(tabId) {
  return runInTab(tabId, async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tree = () => [...document.querySelectorAll('[role="tree"]')].pop();
    if (!tree()) return null;
    for (let round = 0; round < 60; round++) {
      const closed = [...tree().querySelectorAll('[role="treeitem"][aria-expanded="false"] [data-testid="CollapsiblePageChevron"]')];
      if (!closed.length) break;
      closed.forEach(chevron => chevron.click()); // the chevron only, so no page gets opened
      await sleep(600);
    }
    const item = tree().querySelector('[role="treeitem"]');
    if (!item) return null;
    const key = Object.keys(item).find(k => k.startsWith('__reactFiber'));
    for (let f = item[key], i = 0; f && i < 60; i++, f = f.return) {
      const list = f.memoizedProps && f.memoizedProps.pageListItems;
      if (Array.isArray(list)) {
        const first = list.find(p => p.pageView && p.pageView.workspaceName);
        return {
          workspaceName: first ? first.pageView.workspaceName : 'Loop_Workspace',
          items: list.filter(p => p.item && p.item.link).map(p => ({
            title: p.item.displayText || 'Untitled', link: p.item.link, value: p.value, parentValue: p.parentValue
          }))
        };
      }
    }
    return null;
  }, 'MAIN'); // React's data on DOM nodes is only visible from the page's own world
}

function countNodes(tree) {
  return tree.reduce((n, node) => n + 1 + countNodes(node.children || []), 0);
}

async function start(kind, tree, name) {
  const response = await chrome.runtime.sendMessage({
    action: 'startExport', kind, tree, workspaceName: name, screen: screenArea()
  });
  if (!response || !response.ok) throw new Error(response ? response.error : 'Background worker did not answer');
}

async function exportWorkspace() {
  $('exportBtn').disabled = true;
  try {
    const tab = await loopTab();
    if (!tab) return;
    setStatus('info', 'Reading the page list...');
    const list = await readPageList(tab.id);
    if (!list) {
      setStatus('error', "Couldn't read the workspace's page list.", 'Open the workspace with its sidebar showing. If it still fails, Loop has changed and the extension needs an update.');
      return;
    }
    const tree = pageListToTree(list.items);
    if (!tree.length) {
      setStatus('error', 'No pages found. Open the workspace with its sidebar showing.');
      return;
    }
    const total = countNodes(tree);
    await start('workspace', tree, list.workspaceName);
    setStatus('success', `Exporting ${total} pages in 4 windows, about ${Math.ceil(total * SECONDS_PER_PAGE / 4 / 60)} min. Don't close them.`,
      'The file is saved to your Downloads folder at the end. This popup can be closed.');
  } catch (error) {
    setStatus('error', 'Error: ' + error.message, 'See console (F12) for details');
    console.error('Export error:', error);
  } finally {
    $('exportBtn').disabled = false;
  }
}

async function exportPage() {
  $('exportPageBtn').disabled = true;
  try {
    const tab = await loopTab();
    if (!tab) return;
    const link = linkFromPageUrl(tab.url);
    if (!link) {
      setStatus('error', 'Open a Loop page first');
      return;
    }
    // Loop puts the page title in the tab title; the file is named after the page
    const title = tab.title && tab.title !== 'Microsoft Loop' ? tab.title : 'Untitled Page';
    await start('page', [{ title, link, print: printUrl(link), children: [] }], title);
    setStatus('success', `Exporting: ${title}`, 'The file is saved to your Downloads folder.');
  } catch (error) {
    setStatus('error', 'Error: ' + error.message, 'See console (F12) for details');
    console.error('Export page error:', error);
  } finally {
    $('exportPageBtn').disabled = false;
  }
}

async function resume() {
  const response = await chrome.runtime.sendMessage({ action: 'resumeExport', kind: 'workspace', screen: screenArea() });
  if (response && response.ok) {
    $('lastRun').hidden = true;
    setStatus('success', 'Export restarted. Don\'t close the export windows.',
      'The file is saved to your Downloads folder at the end. This popup can be closed.');
  } else {
    setStatus('error', response ? response.error : 'Background worker did not answer');
  }
}

const MAX_LISTED = 5;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Shows what happened to the last workspace export, with Continue / Try again / Download again
async function showLastRun() {
  const { running } = (await chrome.runtime.sendMessage({ action: 'isRunning' })) || {};
  if (running) {
    setStatus('info', 'An export is running. Don\'t close its windows.');
    return;
  }
  const run = (await chrome.storage.local.get('run:workspace'))['run:workspace'];
  if (!run) return;
  const keys = Array.from({ length: run.total }, (_, i) => `page:${run.id}:${i}`);
  const data = await chrome.storage.local.get(keys);
  const stored = {};
  keys.forEach((k, i) => { if (data[k]) stored[i] = data[k]; });
  const { done, failed, missing } = runStatus(run.total, stored);

  $('lastRun').hidden = false;
  if (run.error) setStatus('error', run.error);
  if (missing > 0) {
    $('lastRunSummary').textContent = `"${run.workspaceName}" stopped after ${done} of ${run.total} pages.`;
    $('resumeBtn').textContent = `Continue export (${plural(missing + failed, 'page')} left)`;
    $('resumeBtn').hidden = false;
    return;
  }
  $('lastRunSummary').textContent = failed
    ? `"${run.workspaceName}": ${done} of ${run.total} pages exported. ${failed === 1 ? 'This page' : `These ${failed} pages`} couldn't be exported:`
    : `"${run.workspaceName}": all ${run.total} pages exported.`;
  const failures = run.nodes.map((n, i) => ({ n, s: stored[i] })).filter(({ s }) => s && s.error);
  failures.slice(0, MAX_LISTED).forEach(({ n, s }) => {
    const li = document.createElement('li');
    li.textContent = `${n.title}: ${describeError(s.error, n.link)}`;
    $('failedList').append(li);
  });
  if (failures.length > MAX_LISTED) {
    const li = document.createElement('li');
    li.textContent = `…and ${failures.length - MAX_LISTED} more, listed in _export-report.md in the ZIP`;
    $('failedList').append(li);
  }
  if (failed) {
    $('retryBtn').textContent = failed === 1 ? 'Try this page again' : `Try these ${failed} pages again`;
    $('retryBtn').hidden = $('retryNote').hidden = false;
  }
  $('redownloadBtn').hidden = !run.finishedAt;
}

$('exportBtn').addEventListener('click', exportWorkspace);
$('exportPageBtn').addEventListener('click', exportPage);
$('resumeBtn').addEventListener('click', resume);
$('retryBtn').addEventListener('click', resume);
$('redownloadBtn').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('markdown-generator.html?run=workspace') }));
showLastRun().catch(error => console.error('Popup: could not read the last export:', error));
