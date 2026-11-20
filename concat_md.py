"""Concatenate Markdown notes into one file for Copilot, keeping each note's metadata.

Each note is wrapped in <file path="..." title="..." modified="..."> so headings inside
notes can't be confused with note boundaries. Embedded images are kept as they are.
If the result would be over 50 MB (Copilot's upload limit), it is split at note
boundaries into combined_part1.md, combined_part2.md, ...; every part repeats the
full file tree, marking which part each note is in.

Usage: python concat_md.py [root_dir] [output_file]
Defaults: root_dir = current folder, output_file = combined.md
For a UI to pick files and the output location: python concat_md_ui.py
"""
import html
import os
import re
import sys
from datetime import datetime
from pathlib import Path

MAX_BYTES = 50_000_000  # Copilot's 50 MB limit, in decimal MB to stay safely under it
HEADER_RESERVE = 2_000  # room for each part's title and intro lines


def find_md(root):
    """All .md files under root, sorted, skipping hidden folders."""
    root = Path(root).resolve()
    return sorted(p for p in root.rglob("*.md") if not any(part.startswith(".") for part in p.relative_to(root).parts))


def combine(files, out, max_bytes=MAX_BYTES):
    """Write files into out, split into parts if over max_bytes. Returns a summary line."""
    out = Path(out).resolve()
    # Never feed a previous run's output (out or out_partN) back in as a note.
    own = re.compile(re.escape(out.stem) + r"(_part\d+)?" + re.escape(out.suffix), re.IGNORECASE)
    files = sorted(p for p in {Path(f).resolve() for f in files} if not (p.parent == out.parent and own.fullmatch(p.name)))
    if not files:
        raise ValueError("No .md files to combine")
    root = Path(os.path.commonpath([p.parent for p in files]))

    notes = []  # (relative path, block)
    for p in files:
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace").strip()
        heading = re.search(r"^#\s+(.+?)\s*#*\s*$", text, re.MULTILINE)  # Loop exports start with "# Page title"
        title = heading.group(1) if heading else p.stem
        modified = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        attrs = f'path="{html.escape(rel)}" title="{html.escape(title)}" modified="{modified}"'
        notes.append((rel, f"<file {attrs}>\n{text}\n</file>\n\n"))

    # Fill each part with whole notes; a note is never cut in half.
    tree_bytes = sum(len(rel.encode("utf-8")) + 14 for rel, _ in notes)  # full tree is repeated in every part
    parts, size = [[]], HEADER_RESERVE + tree_bytes
    for note in notes:
        cost = len(note[1].encode("utf-8"))
        if parts[-1] and size + cost > max_bytes:
            parts.append([])
            size = HEADER_RESERVE + tree_bytes
        parts[-1].append(note)
        size += cost

    multi = len(parts) > 1
    part_of = {rel: i for i, part in enumerate(parts, 1) for rel, _ in part}
    paths = [out.with_name(f"{out.stem}_part{i}{out.suffix}") for i in range(1, len(parts) + 1)] if multi else [out]
    for old in out.parent.iterdir():  # a previous run's extra parts would otherwise be mistaken for current ones
        if own.fullmatch(old.name) and old not in paths:
            old.unlink()
    oversized = []
    for i, (path, part) in enumerate(zip(paths, parts), 1):
        with path.open("w", encoding="utf-8", newline="\n") as f:
            f.write(f"# Combined notes from `{root.name}` ({len(notes)} notes)\n\n")
            if multi:
                f.write(f"This is part {i} of {len(parts)}; it holds {len(part)} of the notes. "
                        "The file tree lists every note and the part it is in.\n\n")
            f.write("Each note is inside a `<file>` tag with its path, title and last-modified date.\n\n")
            # File tree first so the model sees the structure before the content.
            f.write("## File tree\n\n```\n")
            f.writelines(f"{rel}  (part {part_of[rel]})\n" if multi else f"{rel}\n" for rel, _ in notes)
            f.write("```\n\n")
            f.writelines(block for _, block in part)
        if path.stat().st_size > max_bytes:
            oversized.append(path.name)  # only possible when one note alone is over the limit

    if multi:
        summary = f"Combined {len(notes)} notes into {len(paths)} parts in {out.parent}: {', '.join(p.name for p in paths)}."
    else:
        summary = f"Combined {len(notes)} notes into {out}."
    if oversized:
        summary += f" Still over {max_bytes // 1_000_000} MB because one note alone is that big: {', '.join(oversized)}."
    return summary


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    out = sys.argv[2] if len(sys.argv) > 2 else "combined.md"
    try:
        print(combine(find_md(root), out))
    except ValueError as e:  # no notes found, or notes on different drives
        sys.exit(f"{e} (looked under {Path(root).resolve()})")
