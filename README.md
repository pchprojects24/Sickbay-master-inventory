# Sickbay Master Inventory

A searchable browser for the sickbay's kits and the items in them: what is held,
which kit it belongs to, and its NATO stock number. No build step, no server-side
anything, no dependencies.

It is a reference catalogue, not a tracking system — there is no on-hand count,
expiry date or stowage location here, by design.

Serve the folder over HTTP (`python3 -m http.server` from the repository root, or
any static host) and open `index.html`. It reads `Data/inventory.json` with
`fetch`, which browsers block for `file://` URLs, so opening the file directly
from disk will not load the data. There is no service worker yet, so it needs the
files to be reachable — it is not offline-capable as it stands.

## Current and inactive

The current list is the kit export from SharePoint. Everything on it is
**current**: its NSNs, descriptions, units of measure, quantities and prices are
what the app shows.

Items that were on the previous list but are not on the SharePoint list at all
are still in the app, marked **Inactive** — greyed out, badged, listed after the
current items, and never counted in a kit's line count or total value. Two whole
kits (the Med Tech Bag and its medications kit) are inactive the same way. An
item that is still current somewhere is *not* kept in a kit it was dropped from;
it simply appears in the kits that hold it now.

## The two ways in

**Items** — every distinct item (1,003 current, 97 inactive) in one searchable
list. Search matches NSN, description, unit of measure, source, accountability
code, and the names of the kits an item sits in, so "tourniquet", "6515-01-649",
and "dive team" all work; "inactive" finds the inactive ones. Filter to a single
kit or to current / inactive items, sort by NSN / description / quantity / price,
or flip on *Group by Kit* to see everything broken out kit by kit. Tapping the kit
count on an item shows every kit that holds it, with that kit's own quantity.

**Kits** — the 36 current kits as the tree they actually form, from the top-level
set down through the core treatment set and the medic bag set to individual kits,
with the 2 inactive kits after them. Open one to get its contents, line count,
total value, a link to its parent, and a one-click CSV download. Searching in this
view matches a kit by its name *or* by anything inside it, so "naloxone" narrows
the tree to the kits that carry it.

Each kit has its own URL (`#kit/6545-20-A0U-8759`), so a specific kit can be
bookmarked or passed to someone else.

## Pick lists

*Add* on any item puts it on a pick list, pre-filled with the quantity shown in
whatever kit you were looking at. *Add all to pick list* takes a whole kit's
current items at once. Quantities are editable, a running total is shown, and the
list survives closing the tab. Export it as CSV or print it.

## Repository layout

```
index.html                  the app
assets/                     app.js, style.css, icon.svg, manifest.webmanifest
Data/source/*.xlsx          the SharePoint kit export — the current list
Data/legacy/*.xlsx          the previous list, one workbook per kit — only read
                            to find (and describe) the inactive items
Data/kit_items.csv          every kit-item line (1,329 current + 120 inactive)
Data/master_inventory.csv   one row per distinct item (1,003 current + 97 inactive)
Data/kits/*.csv             one pick list per kit
Data/inventory.json         what the app loads
Data/provenance/            archival records; not generated, not read by the app
tools/build_inventory.py    regenerates everything under Data/ from the workbooks
```

`Data/README.md` is the data dictionary: what each column means, how the
SharePoint export is turned into kit lines, how the kit hierarchy is derived, and
the quirks in the source data. `Data/provenance/README.md` covers the original
master workbook and the earlier cleanup decisions this build deliberately
diverges from.

Counting stock from `Data/master_inventory.csv` means keeping only rows where
`Status` is `Current` and `Is Kit` is not `Y`: kit rows are containers whose price
already includes their contents.

## Changing the data

Replace the export in `Data/source/` with a newer one from SharePoint (keep it the
only workbook in that folder), then:

```sh
pip install openpyxl
python3 tools/build_inventory.py
```

Everything else under `Data/` is generated — don't hand-edit it, or the next
rebuild will overwrite the changes.
