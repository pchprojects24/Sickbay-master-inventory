# Data

## Where the numbers come from

`Data/source/*.xlsx` — 29 workbooks, one per kit, exactly as issued. **This is the
source of truth.** Every other file in this directory is generated from them by
`tools/build_inventory.py` and should never be hand-edited.

Each workbook has one sheet with the same eight columns:

| Column | Meaning |
| --- | --- |
| Kit NSN | The kit this line belongs to |
| Kit Item NSN | The item stocked in that kit |
| Qty | Quantity of the item required **in that kit** |
| UOM | Unit of measure (EA, BX, PG, …) |
| Description | Item description |
| Source | `WHSE`, `ExternalRqn`, or `Resource` |
| Price | Unit price, CAD |
| Kit Accountability Code | `A`–`D`, or blank |

## Generated files

| File | One row per | Use it for |
| --- | --- | --- |
| `kit_items.csv` | kit + item (1,268 rows) | The full picture. Per-kit quantities are preserved here. |
| `master_inventory.csv` | distinct item (966 rows) | "How much of this do we hold in total, and where does it live?" Filter out `Is Kit = Y` to count stock. |
| `kits/<slug>.csv` | item within one kit | Printing or issuing a single kit. |
| `inventory.json` | — | What the browser app loads. |

### Which file answers which question

`kit_items.csv` is the canonical table: an item that appears in three kits appears
as three rows, each with that kit's own quantity. If you are counting anything,
count it here.

`master_inventory.csv` collapses each item to one row. `Total Quantity` is the sum
across every kit, and the `Kit Membership` column spells out the split, e.g.

    KIT, MARITIME R1 MTF… (6545-CF-005-0438) x10; KIT, TREATMENT, MED TECH, BAG (6545-CF-002-1002) x2

> **Note:** the previous version of `master_inventory.csv` carried a single
> `Quantity Required` per item, which silently dropped the per-kit split — the
> survival blanket above was recorded as `2` when the ship actually holds 12.
> The current columns replace it.

**Counting stock or money means excluding `Is Kit = Y`.** 28 of the 966 rows are
kit *containers* rather than stock. They belong in the file — a container is a
real line item inside its parent — but a container's price already equals the sum
of its contents, so counting it as well double-counts. The remaining 938 rows are
countable stock. Items merely named "KIT …" that have no contents of their own
(the pediatric resus kit, the OPA set, the sealed sexual assault kits) are
ordinary stock and are not marked. See `provenance/README.md`, which also records
where this build deliberately differs from an earlier cleanup pass.

## Kit structure

The 29 kits form a three-level tree, derived from the fact that a kit shows up as
a line item inside its parent:

    MASTER KIT LIST, SICKBAY (ALL HOLDINGS)          6545-CF-005-1238
    ├── TREATMENT, SET, CORE, MAJOR NAVAL WARSHIP    6545-20-A0U-8722
    │   ├── TREATMENT KIT, MEDICATIONS               6545-20-A0U-8754
    │   └── … 14 more core treatment kits
    ├── KIT, MEDICAL, C.A.F. DIVE TEAM               6545-20-A0M-1006
    │   └── KIT, TMT, C.A.F. DIVE TEAM C-SPINE…      6545-20-A0M-1004
    └── … 10 more standalone kits

A kit's name is the description used where it appears as a component of its
parent. The master list at the top is never a component of anything, so it has no
issued description; its name is set in `ROOT_KIT_NAMES` in the build script.

## Known quirks in the source data

These are left as-is rather than silently corrected — fix them in the workbooks if
they are wrong, then re-run the build.

- **Three items are priced differently in two kits.** `7510-20-A03-9054` (Sharpie,
  $1.25 vs $0.98), `7530-21-844-6267` (label, $0.05 vs $0.13), and
  `8105-21-900-0913` (ziplock bag, $0.06 vs $2.21) each differ between the Fatal
  and Non-Fatal Accident kits. The rollup uses the first price seen and flags the
  item with `price_varies`, which the app shows as a "varies" badge. Per-kit
  views use that kit's own price, so only the item-level rollup is affected.
- **One item is drawn from two different sources.** `7690-21-883-2495` is `WHSE`
  in one kit and `ExternalRqn` in another. Same treatment: the rollup keeps the
  first and sets `source_varies`.
- **21 lines are documents, not stock.** Pamphlets, booklets, labels and cards
  carry placeholder identifiers (`PAMPHLET1`, `CARD2`, `BOOK40`, …) instead of
  NSNs. They are kept; `is_nsn` is `false` for them.
- **Some NSNs arrive lowercase** (`6515-cf-002-8554`). The build uppercases them,
  which is what merges that item's two kit lines into one record.
- **Totals are line sums.** A kit's `total_value` is the sum of its own lines. A
  parent kit lists each child kit as a single priced line, so summing a parent's
  lines does not double-count its children's contents.

## What this data is not

These are *required* holdings — what each kit is supposed to contain. There is no
quantity on hand, no expiry date, no stowage location and no count date anywhere
in this repository, and the app has nowhere to put them. The legacy master
workbook has columns for all four, but they are empty in all 933 of its rows.
Tracking them would mean storing state per item rather than regenerating from the
workbooks, which is a feature rather than a build change.

## Rebuilding

    pip install openpyxl
    python3 tools/build_inventory.py

Expected output: `kits: 29  items: 966  lines: 1268`.
