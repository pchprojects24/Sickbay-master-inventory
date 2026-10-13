# Data

## Where the numbers come from

Two inputs, one authoritative:

- **`Data/source/` — the current list.** A single workbook exported from the
  SharePoint kit catalogue (`Sickbay kit from Sharepoint.xlsx`): one flat sheet
  covering the whole set, `6545-CF-005-1238`. **This is the source of truth** for
  every item it lists — NSN, description, unit of measure, quantity and price.
- **`Data/legacy/` — the previous list.** The 29 per-kit workbooks the app was
  first built from. The build reads them for two things only: to find items that
  are no longer on the current list (kept as **inactive**), and to carry an item's
  *Source* and *Accountability Code* across, since the export has neither.

Every other file in this directory is generated from them by
`tools/build_inventory.py` and should never be hand-edited.

### What is read from the SharePoint export

The export has 21 columns; the build reads these and ignores the rest:

| Export column | Used for |
| --- | --- |
| Kit NSN / Kit Name | The top-level set (the root of the tree) |
| Item NSN | Item NSN |
| Item Name | Description |
| UOM | Unit of measure |
| Qty per Sub-Kit | Quantity of the item **in one copy of its sub-kit** — text such as `70 EA`; the number is used |
| Total Qty | The quantity when *Qty per Sub-Kit* is blank (the sub-kit is held once) |
| # Sub-Kits Req | How many copies of the sub-kit the set holds |
| Total Value | Price: unit price = Total Value ÷ Total Qty |
| Sub-Kit NSN / Sub-Kit Name | The kit the line belongs to (blank = directly in the set) |
| Full Sub-Kit Path | The kit's parents, for the tree |

Quantities stay **per kit**, as before: a line in the Maritime MASCAL kit says
how many are in one MASCAL kit, not in all four. The four appears once, as the
quantity of the MASCAL kit's own line inside the set.

The export filters out kit definitions, so it never lists a sub-kit as an item of
its parent. The build adds those container lines itself from the path, with
quantity = copies of the child ÷ copies of the parent (eight IV injection sets in
a set holding four MASCAL kits is 2 per MASCAL kit) and price = the child's total
value.

**Prices.** The unit price is pooled per item (sum of Total Value ÷ sum of Total
Qty) so cent-level rounding can't make one item look differently priced in two
kits. 21 items show `$0` in the export but had a price on the previous list —
mostly pamphlets and labels, plus the Rochester-Pean forceps and the Coleman
cooler; for those the previous price is kept. The build prints the list.

**Source and Accountability Code** come from the previous list: from the same kit
line if there was one, else from the item's first line anywhere. The 127 items
that are new on the SharePoint list have them blank.

### Current and inactive

An item is **inactive** when its NSN appears in the previous list but nowhere on
the current one. It keeps its previous kit lines — quantity, description, price,
source and code exactly as they were — each marked inactive. A kit is inactive
when it has no place in the current list at all (the Med Tech Bag
`6545-CF-002-1002` and its medications kit `6545-CF-002-8529`).

An item that is still current is **not** carried into a kit it was dropped from;
only its current kit lines exist. So an inactive kit shows just the items from it
that are gone entirely, and its `former_line_count` says how many lines it had,
so the app can say how many of the others are still current elsewhere.

Inactive lines never count: a kit's `line_count` and `total_value` are its
current lines only, and `inactive_line_count` is reported separately.

## Generated files

| File | One row per | Use it for |
| --- | --- | --- |
| `kit_items.csv` | kit + item (1,329 current + 120 inactive) | The full picture. Per-kit quantities are preserved here. |
| `master_inventory.csv` | distinct item (1,003 current + 97 inactive) | "How much of this do we hold in total, and where does it live?" |
| `kits/<slug>.csv` | item within one kit | Printing or issuing a single kit. |
| `inventory.json` | — | What the browser app loads. |

Every CSV ends with a `Status` column, `Current` or `Inactive`.

### Which file answers which question

`kit_items.csv` is the canonical table: an item that appears in three kits appears
as three rows, each with that kit's own quantity. If you are counting anything,
count it here.

`master_inventory.csv` collapses each item to one row. `Total Quantity` is the sum
across every kit, and the `Kit Membership` column spells out the split, e.g.

    KIT, MARITIME R1 MTF… (6545-CF-005-0438) x10; KIT, MEDIC BAG, SECOND LINE… (6545-CF-005-0844) x1

For an inactive item both columns describe the previous list.

**Counting stock or money means keeping `Status = Current` and excluding
`Is Kit = Y`.** 35 current rows are kit *containers* rather than stock. They
belong in the file — a container is a real line item inside its parent — but a
container's price already equals the sum of its contents, so counting it as well
double-counts. The remaining 968 current rows are countable stock. Items merely
named "KIT …" that have no contents of their own (the pediatric resus kit, the
OPA set, the sealed sexual assault kits) are ordinary stock and are not marked.

## Kit structure

The 36 current kits form a tree up to four levels deep, read from each export
row's *Full Sub-Kit Path*:

    SET, MAJOR NAVAL WARSHIPS & AOPS                 6545-CF-005-1238
    ├── TREATMENT, SET, CORE, MAJOR NAVAL WARSHIP    6545-20-A0U-8722
    │   ├── TREATMENT KIT, MEDICATIONS               6545-20-A0U-8754
    │   └── … 14 more core treatment kits
    ├── SET, MEDIC BAG, PARAMEDIC                    6545-CF-005-0850
    │   ├── KIT, MEDIC BAG, SECOND LINE…             6545-CF-005-0844
    │   │   └── PACK, ENT DIAGNOSTIC FIELD KIT       6545-CF-005-1823
    │   └── … 4 more medic bag kits
    ├── KIT, MARITIME R1 MTF, MASCAL…                6545-CF-005-0438
    │   └── INJECTION SET I.V. (FIELD USE)           6545-CF-002-0552
    └── … 9 more kits

Kit names come from the export's *Sub-Kit Name*. The core treatment set only ever
appears as a step in a path, where its name is truncated, so its full name is
taken from the previous list.

The two inactive kits sit under the set, where they were on the previous list.

Each kit keeps the CSV slug it had before (from its old workbook's file name), so
existing download links still work; new kits get a slug from their name.

## Known quirks in the source data

These are left as-is rather than silently corrected — fix them at the source if
they are wrong, then re-run the build.

- **20 current items have no unit of measure** in the export: the pamphlets,
  booklets, labels and cards.
- **18 current and 3 inactive lines are documents, not stock.** They carry
  placeholder identifiers (`PAMPHLET1`, `CARD2`, `BOOK40`, …) instead of NSNs.
  They are kept; `is_nsn` is `false` for them.
- **Some NSNs in the previous list arrive lowercase** (`6515-cf-002-8554`). The
  build uppercases them, which is why that scalpel matches its current line
  instead of showing as inactive.
- **Totals are line sums.** A kit's `total_value` is the sum of its own current
  lines. A parent kit lists each child kit as a single priced line, so summing a
  parent's lines does not double-count its children's contents. The set's total
  ($438,524) is within $15 of the export's own Total Value sum once the 21 kept
  prices are added back; the gap is the rounding of unit prices to cents.

## Scope: a reference catalogue, not a tracking system

This answers "what is in the sickbay, and what are the stock numbers" — the
authorised contents of each kit, with NSNs, descriptions, units of measure,
quantities, prices and accountability codes.

It deliberately does **not** track consumption: no quantity on hand, no expiry
dates, no stowage locations, no count dates. The legacy master workbook has
columns for those four, all empty in all 933 of its rows, and they are not
carried forward. Their absence is the intended scope, not an omission to fix.

Quantities here are therefore *required* holdings — what a kit is supposed to
contain — not counted ones.

## Rebuilding

    pip install openpyxl
    python3 tools/build_inventory.py

Expected output:

    current   kits: 36  items: 1003  lines: 1329
    inactive  kits: 2  items: 97  lines: 120

followed by the list of items whose previous price was kept.
