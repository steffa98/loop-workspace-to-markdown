// Converts the HTML of a Loop page's print view to Markdown.
// Loop renders pages with its "Scriptor" editor: paragraphs and headings are <div class="scriptor-paragraph">
// (headings carry role="heading" aria-level), bold/italic are inline styles on <span>s, links are spans whose
// title starts with the URL, each list item is its own one-item <ul>, and tables are real <table>s whose cells
// hold more Scriptor paragraphs. Checked against real pages in 2026-11.

const LOOP_UI = 'button, svg, [aria-hidden="true"], [role="toolbar"], tfoot, .scriptor-nonDisplayable-textRun';

// headingShift: page titles are "# Title", so Loop's heading level 1 becomes "##"
function loopToMarkdown(html, headingShift = 1) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(LOOP_UI).forEach(el => el.remove());
  if (!doc.querySelector('.scriptor-paragraph, .scriptor-pageFrame li')) return doc.body.textContent.trim() + '\n';
  const blocks = [];
  collectBlocks(doc.body, blocks, headingShift);
  // List items sit on consecutive lines; everything else is separated by a blank line
  return blocks.map((b, k) => (k === 0 ? '' : b.list && blocks[k - 1].list ? '\n' : '\n\n') + b.md).join('') + '\n';
}

function collectBlocks(el, blocks, headingShift) {
  for (const child of el.children) {
    if (child.tagName === 'TABLE') blocks.push({ md: tableMarkdown(child) });
    else if (child.tagName === 'LI') blocks.push({ md: listItemMarkdown(child), list: true });
    else if (child.tagName === 'HR' || child.classList.contains('scriptor-horizontal-divider')) blocks.push({ md: '---' });
    else if (child.classList.contains('scriptor-paragraph')) {
      const text = inlineMarkdown(child).trim();
      if (!text) continue;
      const level = child.getAttribute('role') === 'heading' ? Number(child.getAttribute('aria-level')) || 1 : 0;
      blocks.push({ md: level ? `${'#'.repeat(Math.min(6, level + headingShift))} ${text}` : text });
    } else collectBlocks(child, blocks, headingShift);
  }
}

function inlineMarkdown(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; continue; }
    if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === 'BR') continue;
    let text = inlineMarkdown(node);
    if (!text.trim()) { out += text; continue; }
    const style = node.getAttribute('style') || '';
    const url = node.getAttribute('href') || (node.classList.contains('scriptor-hyperlink') && (node.getAttribute('title') || '').split('\n')[0]);
    if (url) text = `[${text.trim()}](${url})`;
    const weight = /font-weight:\s*(bold|\d+)/.exec(style);
    if (weight && (weight[1] === 'bold' || Number(weight[1]) >= 600)) text = wrap(text, '**');
    if (/font-style:\s*italic/.test(style)) text = wrap(text, '*');
    if (/line-through/.test(style)) text = wrap(text, '~~');
    out += text;
  }
  // ponytail: Markdown characters in the text itself (*, _, `) are not escaped; escape them if exports show stray formatting
  return out.replace(/\*\*\*\*/g, ''); // two bold runs side by side become one
}

// Keeps spaces outside the markers: "**bold** text", not "**bold **text"
function wrap(text, marker) {
  const [, before, core, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return `${before}${marker}${core}${marker}${after}`;
}

function listItemMarkdown(li) {
  const level = Number(li.getAttribute('aria-level')) || 1;
  const markerText = (/--scriptor-list-marker-text:\s*"([^"]*)"/.exec(li.getAttribute('style') || '') || [])[1] || '';
  let marker = /^\s*[0-9a-z]+[.)]/i.test(markerText) ? `${li.getAttribute('aria-posinset') || 1}.` : '-';
  // ponytail: checklist state read from aria-checked only; no checklist was available to check against
  const box = li.hasAttribute('aria-checked') ? li : li.querySelector('[aria-checked]');
  if (box) marker = `- [${box.getAttribute('aria-checked') === 'true' ? 'x' : ' '}]`;
  return `${'    '.repeat(level - 1)}${marker} ${inlineMarkdown(li).trim()}`;
}

function tableMarkdown(table) {
  const rows = [...table.querySelectorAll('tr')]
    .filter(tr => tr.closest('table') === table) // not rows of a table nested in a cell
    .map(tr => [...tr.children].map(cell => {
      const parts = [...cell.querySelectorAll('.scriptor-paragraph, li')].map(p => inlineMarkdown(p).trim()).filter(Boolean);
      return (parts.length ? parts.join('<br>') : cell.textContent.trim()).replace(/\|/g, '\\|');
    }))
    .filter(cells => cells.length);
  if (!rows.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const line = cells => `| ${Array.from({ length: width }, (_, k) => cells[k] || '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}
