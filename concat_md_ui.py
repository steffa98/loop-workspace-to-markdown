"""Small window to pick .md notes and where to save the combined file. Run: python concat_md_ui.py"""
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

sys.dont_write_bytecode = True  # a __pycache__ folder here stops Chrome loading the extension from this folder
from concat_md import combine, find_md

BG, CARD, TEXT, MUTED, ACCENT, ACCENT_HOVER, BORDER = (
    "#f5f6f8", "#ffffff", "#1f2328", "#6b7280", "#2563eb", "#1d4ed8", "#e5e7eb")
FONT = ("Segoe UI", 10)

try:  # sharp text on high-DPI Windows screens instead of blurry bitmap scaling
    import ctypes
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except (AttributeError, OSError):
    pass  # not Windows

root = tk.Tk()
root.title("Combine Markdown files")
dpi = root.winfo_fpixels("1i") / 96  # sizes below are written for a 100% scaled screen
root.geometry(f"{int(760 * dpi)}x{int(480 * dpi)}")
root.minsize(int(560 * dpi), int(320 * dpi))
root.configure(bg=BG)

style = ttk.Style(root)
style.theme_use("clam")  # the only built-in theme whose colors can be fully restyled
style.configure(".", background=BG, foreground=TEXT, font=FONT)
style.configure("TButton", padding=(12, 6), background=CARD, bordercolor=BORDER, relief="flat")
style.map("TButton", background=[("active", "#eef0f3")])
style.configure("Accent.TButton", background=ACCENT, foreground="white", bordercolor=ACCENT)
style.map("Accent.TButton", background=[("active", ACCENT_HOVER), ("disabled", "#93b4f5")])
style.configure("Title.TLabel", font=("Segoe UI Semibold", 14))
style.configure("Muted.TLabel", foreground=MUTED)
style.configure("Treeview", background=CARD, fieldbackground=CARD,
                rowheight=int(30 * dpi), bordercolor=BORDER, borderwidth=1)
style.configure("Treeview.Heading", background=BG, foreground=MUTED, relief="flat", font=("Segoe UI Semibold", 9),
                padding=(6, 4))
style.map("Treeview.Heading", background=[("active", BG)])
style.map("Treeview", background=[("selected", "#dbeafe")], foreground=[("selected", TEXT)])
style.configure("Vertical.TScrollbar", background=BORDER, troughcolor=CARD, bordercolor=CARD,
                arrowcolor=MUTED, relief="flat")
style.map("Vertical.TScrollbar", background=[("active", "#d1d5db")])


def refresh():
    n = len(tree.get_children())
    status.set(f"{n} file{'s' * (n != 1)} selected")
    combine_btn.state(["!disabled"] if n else ["disabled"])
    remove_btn.state(["!disabled"] if tree.selection() else ["disabled"])


def add(paths):
    for p in map(str, paths):
        if not tree.exists(p):  # the full path is the row id, so duplicates are skipped
            tree.insert("", "end", iid=p, values=(Path(p).name, str(Path(p).parent)))
    refresh()


def add_files():
    add(filedialog.askopenfilenames(title="Pick .md files", filetypes=[("Markdown", "*.md"), ("All files", "*.*")]))


def add_folder():
    folder = filedialog.askdirectory(title="Pick a folder (all .md files inside are added)")
    if folder:
        add(find_md(folder))


def remove_selected(_event=None):
    tree.delete(*tree.selection())
    refresh()


def save():
    out = filedialog.asksaveasfilename(title="Save combined file as", defaultextension=".md",
                                       initialfile="combined.md", filetypes=[("Markdown", "*.md")])
    if not out:
        return
    status.set("Combining…")
    root.config(cursor="watch")
    root.update()  # show the busy state before the window blocks on large notes
    try:
        summary = combine(tree.get_children(), out)
    except (OSError, ValueError) as e:  # ValueError: nothing left to combine, or notes on different drives
        messagebox.showerror("Failed", str(e))
        return
    finally:
        root.config(cursor="")
        refresh()
    messagebox.showinfo("Done", summary)


main = ttk.Frame(root, padding=20)
main.pack(fill="both", expand=True)

ttk.Label(main, text="Combine Markdown files", style="Title.TLabel").pack(anchor="w")
ttk.Label(main, text="Add the notes to merge, then choose where to save. Over 50 MB is split into parts.",
          style="Muted.TLabel").pack(anchor="w", pady=(2, 14))

toolbar = ttk.Frame(main)
toolbar.pack(fill="x", pady=(0, 10))
ttk.Button(toolbar, text="＋  Add files", command=add_files).pack(side="left")
ttk.Button(toolbar, text="＋  Add folder", command=add_folder).pack(side="left", padx=8)
remove_btn = ttk.Button(toolbar, text="Remove", command=remove_selected)
remove_btn.pack(side="left")

footer = ttk.Frame(main)
footer.pack(side="bottom", fill="x", pady=(14, 0))  # packed before the table so it never gets squeezed out
status = tk.StringVar()
ttk.Label(footer, textvariable=status, style="Muted.TLabel").pack(side="left")
combine_btn = ttk.Button(footer, text="Combine and save…", style="Accent.TButton", command=save)
combine_btn.pack(side="right")

table = ttk.Frame(main)
table.pack(fill="both", expand=True)
tree = ttk.Treeview(table, columns=("name", "folder"), show="headings", selectmode="extended")
tree.heading("name", text="FILE", anchor="w")
tree.heading("folder", text="FOLDER", anchor="w")
tree.column("name", width=int(200 * dpi), stretch=False)
tree.column("folder", width=int(400 * dpi))
scroll = ttk.Scrollbar(table, orient="vertical", command=tree.yview)
tree.configure(yscrollcommand=scroll.set)
tree.pack(side="left", fill="both", expand=True)
scroll.pack(side="right", fill="y")
tree.bind("<<TreeviewSelect>>", lambda _e: refresh())
tree.bind("<Delete>", remove_selected)

refresh()
root.mainloop()
