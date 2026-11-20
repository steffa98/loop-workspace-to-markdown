# Chrome Web Store listing — draft

Paste these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole) when publishing.
Upload: `dist/loop-workspace-to-markdown-<version>.zip`, built with `powershell -File package.ps1`.

## Store listing

**Name:** Loop Workspace to Markdown

**Summary** (max 132 characters):
Export a whole Microsoft Loop workspace or one page to Markdown files in a ZIP. Fast, complete, with a report of anything skipped.

**Category:** Productivity / Tools

**Language:** English

**Description:**

Export your Microsoft Loop workspaces to Markdown, for backups, documentation, or AI tools such as Copilot.

• Export Workspace: every page, including pages inside folders, becomes a .md file. You get one ZIP, with folders mirroring the sidebar, saved straight to your Downloads folder.
• Export Page: turn the page you're on into a single .md file that you can edit and copy.
• Fast: copies four pages at a time. A 137-page workspace takes about 12 minutes.
• Complete: waits until each page has finished loading, so pages aren't cut short. Anything that can't be exported is listed in _export-report.md, with the reason and a link.
• Interruptions are fine: progress is saved page by page, so you can continue an export, try failed pages again, or download the last export again.
• Private: everything happens in your browser. No servers, no analytics.

How to use: open a Loop workspace page, click the extension icon, and choose Export Workspace. Four windows open and copy the pages; leave them alone until they close.

This extension started as a fork of "Loop to Markdown Converter" and has since been completely rewritten.

Not affiliated with or endorsed by Microsoft. Microsoft Loop is a trademark of Microsoft Corporation.

**Graphic assets you need to make:**
- Icon 128×128: icons/icon128.png
- At least 1 screenshot, 1280×800 or 640×400: the popup, and the summary page after an export
- Small promo tile 440×280 (optional)

## Privacy practices tab

**Single purpose:** Export Microsoft Loop pages and workspaces to Markdown files.

**Permission justifications:**
- `scripting`: runs code inside Loop tabs to read the workspace's page list and the content of each page's print view.
- `tabs`: opens the windows that copy pages, follows their loading, and closes them when the export ends.
- `storage`: saves each copied page as soon as it's copied, so an interrupted export can continue and the last export can be downloaded again.
- `unlimitedStorage`: a large workspace's pages can exceed the default 10 MB storage limit.
- `downloads`: saves the finished ZIP or .md file to the Downloads folder without depending on pop-ups.
- Host permission `https://loop.cloud.microsoft/*`: the only site the extension reads; that's where Loop pages are.

**Remote code:** No. All code is in the package.

**Data usage:**
- Data collected: "Website content". The extension reads Loop pages, but only to convert them locally; nothing leaves the device.
- Tick all three certifications: no selling or transfer to third parties, no use for unrelated purposes, no use for creditworthiness or lending.

**Privacy policy URL:** https://github.com/steffa98/loop-workspace-to-markdown/blob/main/PRIVACY.md

## Links (Store listing tab)

- **Homepage URL:** https://github.com/steffa98/loop-workspace-to-markdown
- **Support URL:** https://github.com/steffa98/loop-workspace-to-markdown/issues

## Before submitting

- [x] License: MIT (`LICENSE`).
- [x] New icons (16, 48, 128 px).
- [ ] Screenshots.
- [ ] Developer account registered (one-time fee) in the Developer Dashboard.
