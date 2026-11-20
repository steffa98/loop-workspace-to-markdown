"""Self-check for concat_md: python test_concat_md.py"""
import re
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # a __pycache__ folder here stops Chrome loading the extension from this folder
from concat_md import combine, find_md

IMAGE = "![Image has no description](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC)"

with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    (d / "Wave 9").mkdir()
    (d / "Wave 9" / "Gate 2.md").write_text(f"# Gate 2 & \"GO\"\n\nDecision ünïcode\n{IMAGE}\n", encoding="utf-8")
    (d / "Big.md").write_text("# Big\n\n" + "x" * 3000, encoding="utf-8")
    (d / "Plain.md").write_text("no heading", encoding="utf-8")

    # One file: images kept byte for byte, metadata on every note.
    print(combine(find_md(d), d / "combined.md"))
    out = (d / "combined.md").read_text(encoding="utf-8")
    assert IMAGE in out
    assert re.search(r'<file path="Wave 9/Gate 2.md" title="Gate 2 &amp; &quot;GO&quot;" modified="\d{4}-\d\d-\d\d \d\d:\d\d">', out)
    assert '<file path="Plain.md" title="Plain" ' in out, "no heading: title falls back to the file name"

    # Rerun with a tiny limit: split into parts, old output not swallowed as a note.
    summary = combine(find_md(d), d / "combined.md", max_bytes=3500)
    print(summary)
    parts = sorted(d.glob("combined_part*.md"))
    assert len(parts) == 2, parts
    texts = [p.read_text(encoding="utf-8") for p in parts]
    notes = [re.findall(r'<file path="([^"]+)"', t) for t in texts]
    assert notes == [["Big.md"], ["Plain.md", "Wave 9/Gate 2.md"]], notes
    assert all("Big.md  (part 1)" in t and "Wave 9/Gate 2.md  (part 2)" in t for t in texts), "full tree in every part"
    assert IMAGE in texts[1] and "Still over" not in summary

    # A single note bigger than the limit gets its own part and a warning, never cut in half.
    summary = combine(find_md(d), d / "combined.md", max_bytes=1000)
    print(summary)
    assert len(list(d.glob("combined_part*.md"))) == 3 and "Still over" in summary and "combined_part1.md" in summary

    # Back to one file: the old parts are removed so they can't be uploaded by mistake.
    combine(find_md(d), d / "combined.md")
    assert sorted(p.name for p in d.glob("combined*.md")) == ["combined.md"]
    print("ok")
