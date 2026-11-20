# Loop Workspace to Markdown

A Chrome extension that exports a whole Microsoft Loop workspace, or a single page, to Markdown files. Workspace exports come as a ZIP that keeps the page hierarchy as folders.

If it saved you time, you can buy me a coffee: [![Buy me a coffee with Revolut](https://img.shields.io/badge/Buy_me_a_coffee-Revolut-0666EB?logo=revolut&logoColor=white)](https://revolut.me/andreao2ej)

> **Credit.** This project started as a fork of
> [Loop to Markdown Converter](https://chromewebstore.google.com/detail/loop-to-markdown-converte/bfbjkakiekjknegllmpndnjaggaidged)
> by its original author. That extension had the idea of exporting through Loop's print view.
> Since then, every part has been rewritten here to make big workspaces faster and complete:
> how pages are found, copied, saved and converted, plus the pages and the icons. No code from the original remains.

## What it does

- **Export Workspace:** every page in the workspace, including pages inside folders, becomes one `.md` file. The files are zipped in folders that mirror the sidebar and saved straight to your Downloads folder.
- **Export Page:** the page you're on becomes a single `.md` file, which you can also edit and copy before saving.
- **Export report:** each ZIP includes `_export-report.md`, listing any page that couldn't be exported, the reason, and a link to open it in Loop.
- **Nothing lost:** each page is saved as soon as it's copied. If the export is interrupted, the popup offers **Continue export**. If some pages failed, it lists them and offers **Try these pages again**. **Download last export again** saves the last export again at any time.

## How it works

1. **Finding the pages.** The popup reads the page list and the workspace name from the data behind Loop's sidebar, after opening any collapsed folders. It doesn't click through every page.
2. **Copying the pages.** Each page is opened in Loop's own print view (`loop.cloud.microsoft/print/…`) at an address built from the page's link, so no menus need clicking. Four browser windows, tiled over your screen, copy four pages at a time. A page counts as finished once its text hasn't changed for 4 seconds. Each page has a time limit and one automatic retry. A one-line script stops Loop opening the print dialog.
3. **Saving progress.** Every copied page is stored in the extension's local storage straight away, so an interrupted export can continue where it stopped.
4. **Converting to Markdown.** `loop-markdown.js` reads Loop's page HTML. Loop's editor builds headings from `div`s with a heading role, sets bold and italic as inline styles, makes each list item its own one-item list, and puts tables inside real `table`s. The converter turns those into Markdown headings, bold and italic, links, nested bulleted, numbered and check lists, tables and dividers. The summary page zips the files and saves them through Chrome's downloads feature, so pop-up and download blockers don't get in the way.

### Measured on a 137-page workspace (November 2026)

| | Original extension | This version |
|---|---|---|
| Time for the whole workspace | 30+ min | about 12 min |
| Pages cut short or missing (20-page sample) | 4 of 20 | 0 |

The original read each page 1.5 seconds after it opened, but Loop often needs up to 5 seconds to fill a page in. That cut some pages short.

## Install

The extension isn't in the Chrome Web Store yet. To install it from this folder:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.

## Use

1. Open any page of a Loop workspace with the sidebar showing.
2. Click the extension's icon, then **Export Workspace** (or **Export Page**).
3. Four windows open and copy the pages; leave them alone until they close. A 137-page workspace takes about 12 minutes.
4. A summary window opens and the file is saved to your Downloads folder.

## Limits

- It depends on how Loop works inside: its sidebar data, its print view address and its editor's HTML. If Microsoft changes these, the export stops with a message that the extension needs an update, or the Markdown loses some formatting.
- Pages stored in a personal OneDrive (`-my.sharepoint.com/personal/…`) can't be exported once you lose access, for example when their owner leaves the company. They're listed in the export report.
- Characters such as `*` and `_` in page text aren't escaped, so they can occasionally show up as formatting.
- Checklist ticks have been checked only against made-up test pages so far.
- During a workspace export, the four windows cover your screen.

## Privacy

Everything happens in your browser. The extension sends nothing anywhere: no analytics, no servers. Page content is kept in the extension's local storage until you start the next export, so you can download it again. See [PRIVACY.md](PRIVACY.md).

| Permission | Why |
|---|---|
| `https://loop.cloud.microsoft/*` | Read the sidebar's page list and copy each page's print view |
| `scripting` | Run the page-list and page-copy code inside Loop tabs |
| `tabs` | Open, track and close the export windows |
| `storage`, `unlimitedStorage` | Keep copied pages, so an export can continue and be downloaded again |
| `downloads` | Save the ZIP or `.md` file to your Downloads folder |

## Files

| File | What it does |
|---|---|
| `popup.html`, `popup-simple.js` | The toolbar popup: reads the page list, starts, continues and retries exports |
| `background.js` | Copies pages in the export windows, with time limits, retry and saved progress |
| `export-core.js` | Shared logic: print addresses, page tree, file names, progress, the report |
| `loop-markdown.js` | Loop page HTML to Markdown |
| `markdown-generator.html`, `.js` | The summary page: builds the Markdown and the ZIP, and saves them |
| `print-blocker.js` | Stops Loop opening the print dialog in the export windows |
| `jszip.min.js` | [JSZip](https://github.com/Stuk/jszip) 3.10.1, which makes the ZIP |

## Development

- Logic tests: `node --test tests/` (Node 20 or later).
- Converter tests: serve the folder (`python -m http.server 8765`) and open `http://127.0.0.1:8765/tests/loop-markdown.test.html`. The page title shows PASS or FAIL.
- Package for the Chrome Web Store: `powershell -File package.ps1`, which writes `dist/loop-workspace-to-markdown-<version>.zip` containing only the extension's files.

## Also in this folder: Markdown note combiner

`concat_md.py` combines exported `.md` files into one file for Copilot, splitting it at 50 MB. Run `python concat_md_ui.py` for a small window, or `python concat_md.py [folder] [output]`. Check: `python test_concat_md.py`. It isn't part of the extension package.

## License

[MIT](LICENSE).

Third-party: [JSZip](https://github.com/Stuk/jszip) 3.10.1 (MIT or GPLv3), which includes [pako](https://github.com/nodeca/pako) (MIT). Its copyright notice is kept at the top of `jszip.min.js`.
