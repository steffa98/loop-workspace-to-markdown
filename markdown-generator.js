// Summary page: builds the export's Markdown files from storage and saves them to Downloads.
// Opened by background.js when an export ends, and by the popup's "Download last export again".
const $ = id => document.getElementById(id);
const kind = new URLSearchParams(location.search).get('run') || 'workspace';

function show(text, type = 'info') {
  $('status').textContent = text;
  $('status').className = type;
}

function pageMarkdown(node, content) {
  if (!content) return `# ${node.title}\n\n*Page content not available.*\n`;
  if (content.error) {
    return `# ${node.title}\n\n*Couldn't export this page: ${describeError(content.error, node.link)}. [Open it in Loop](${node.link})*\n`;
  }
  let body = content.html ? loopToMarkdown(content.html) : `${content.text}\n`;
  if (body.startsWith(`${node.title}\n`)) body = body.slice(node.title.length).trimStart(); // Loop repeats the title as the first line
  return `# ${node.title}\n\n${body}`;
}

function timestamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Chrome's downloads API, not a link click, so pop-up and download blockers don't apply
async function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
    show(`✓ Saved to Downloads: ${filename}`, 'success');
  } catch (error) {
    show(`Couldn't save the file: ${error.message}`, 'error');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000); // the download may still be reading the blob
  }
}

async function build() {
  const run = (await chrome.storage.local.get(`run:${kind}`))[`run:${kind}`];
  if (!run) return show('No export found. Start one from the extension popup.', 'error');
  const keys = run.nodes.map((_, i) => `page:${run.id}:${i}`);
  const data = await chrome.storage.local.get(keys);
  const stored = {};
  keys.forEach((k, i) => { if (data[k]) stored[i] = data[k]; });
  const filename = `${(run.workspaceName || 'Loop_Workspace').replace(/[^a-z0-9]/gi, '_')}_${timestamp()}`;
  $('title').textContent = run.workspaceName || 'Loop export';

  if (kind === 'page') {
    // One page: shown for editing; Download saves what's in the editor
    $('editor').value = pageMarkdown(run.nodes[0], stored[0]);
    $('editor').readOnly = false;
    $('copy').hidden = false;
    const saveEditor = () => save(new Blob([$('editor').value], { type: 'text/markdown' }), `${filename}.md`);
    $('download').onclick = saveEditor;
    return saveEditor();
  }

  const paths = filePaths(run.tree);
  const report = buildReport({ workspaceName: run.workspaceName, date: new Date(), nodes: run.nodes, stored });
  const zip = new JSZip();
  run.nodes.forEach((node, i) => zip.file(paths[i], pageMarkdown(node, stored[i])));
  zip.file('_export-report.md', report);
  $('report').textContent = report;
  $('editor').value = paths.join('\n');
  show('Creating the ZIP…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  $('download').onclick = () => save(blob, `${filename}.zip`);
  return save(blob, `${filename}.zip`);
}

$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('editor').value);
  show('✓ Copied to the clipboard', 'success');
};
build().catch(error => {
  console.error('Summary page:', error);
  show(`Error: ${error.message}`, 'error');
});
