# Sickbay Master Inventory

A searchable browser for the sickbay's kits and the items in them. No build step,
no server-side anything, no dependencies.

Serve the folder over HTTP (`python3 -m http.server` from the repository root, or
any static host) and open `index.html`. It reads `Data/inventory.json` with
`fetch`, which browsers block for `file://` URLs, so opening the file directly
from disk will not load the data. There is no service worker yet, so it needs the
files to be reachable — it is not offline-capable as it stands.

## The two ways in

**Items** — every distinct item (966 of them) in one searchable list. Search
matches NSN, description, unit of measure, source, accountability code, and the
names of the kits an item sits in, so "tourniquet", "6515-01-649", and "dive team"
all work. Filter to a single kit, sort by NSN / description / quantity / price, or
flip on *Group by Kit* to see everything broken out kit by kit. Tapping the kit
count on an item shows every kit that holds it, with that kit's own quantity.

**Kits** — the 29 kits as the tree they actually form, from the master list down
through the core treatment set to individual kits. Open one to get its contents,
line count, total value, a link to its parent, and a one-click CSV download.
Searching in this view matches a kit by its name *or* by anything inside it, so
"naloxone" narrows the tree to the kits that carry it.

Each kit has its own URL (`#kit/6545-20-A0U-8759`), so a specific kit can be
bookmarked or passed to someone else.

## Pick lists

*Add* on any item puts it on a pick list, pre-filled with the quantity shown in
whatever kit you were looking at. *Add all to pick list* takes a whole kit at once.
Quantities are editable, a running total is shown, and the list survives closing
the tab. Export it as CSV or print it.

## Repository layout

```
index.html                  the app
assets/                     app.js, style.css, icon.svg, manifest.webmanifest
Data/source/*.xlsx          the 29 issued workbooks — the source of truth
Data/kit_items.csv          every kit-item line (1,268 rows)
Data/master_inventory.csv   one row per distinct item (966 rows)
Data/kits/*.csv             one pick list per kit
Data/inventory.json         what the app loads
tools/build_inventory.py    regenerates everything under Data/ from the workbooks
```

`Data/README.md` is the data dictionary: what each column means, how the kit
hierarchy is derived, and the handful of quirks in the source workbooks.

## Changing the data

Edit or replace a workbook in `Data/source/`, then:

```sh
pip install openpyxl
python3 tools/build_inventory.py
```

Everything else under `Data/` is generated — don't hand-edit it, or the next
rebuild will overwrite the changes.
