# Provenance

Archival records, kept for traceability. **Nothing here is generated, and nothing
here feeds the app** — `tools/build_inventory.py` does not read this directory.

## `review-resolution-log.csv`

Extracted verbatim from the `Review Resolution Log` sheet of
`Sickbay inventory 2025-02-11(AutoRecovered).xlsx`, so the reasoning survives
outside a spreadsheet nothing else references. 56 decisions from an earlier
cleanup pass over the master workbook:

| Action | Count | What it did |
| --- | --- | --- |
| `REMOVED — Kit parent NSN` | 33 | Dropped from the item list as "not countable stock" |
| `LOCAL PLACEHOLDER` | 21 | Renamed non-standard identifiers to `LOCAL-0001`…`LOCAL-0021` |
| `REAL NSN` | 2 | Confirmed a valid NSN, left as-is |

### Where the current build deliberately differs

Both differences are visible in `Data/master_inventory.csv`; neither loses data.

- **Placeholders.** That pass renamed `CARD2` to `LOCAL-0001`, `PAMPHLET1` to
  `LOCAL-0005`, and so on. The current build keeps the identifier the source
  workbook actually uses, so every row traces back to a cell in
  `Data/source/`. All 21 items are present either way — only the identifier
  differs. The mapping is in this log if the `LOCAL-####` form is ever needed.
- **Kit parents.** That pass removed all 33 kit-shaped NSNs from the item list.
  The current build keeps them and marks the real containers with `Is Kit`, for
  two reasons. First, filtering beats deleting: a container is a genuine line
  item inside its parent, and the app's Kits view needs it. Second, the removal
  was too broad — only 28 of the 33 have contents of their own. The other five
  (`6545-CF-002-0270` pediatric resus, `6545-CF-002-0271` OPA set,
  `6545-CF-005-0858` TCCC ASM contents, `6640-20-010-9275` and
  `6640-20-010-9276` sexual assault kits) are sealed items you actually hold and
  count, so they stay as ordinary stock.

**Counting stock or money from `master_inventory.csv` means excluding
`Is Kit = Y`** — a container's price already equals the sum of its contents, so
including it double-counts.

## The two legacy workbooks

`Sickbay inventory 2025-02-11(AutoRecovered).xlsx` (repository root) is the
original master: the same 29 kit sheets now in `Data/source/`, plus the rolled-up
`Master Inventory` sheet, this log, and a `Kit NSNs (Reference)` sheet. Its 29 kit
sheets were checked line by line against `Data/source/` — 1,268 lines on both
sides, no differences — so the split lost nothing.

`Data/Copy of Sickbay inventory 2025-02-11(AutoRecovered) 2.xlsx` is a near-copy
of it with **one corrupted row**, and should not be used. On the
`Maj Med Equip Core` sheet, NSN `6515-01-505-3037` carries the description
`spACE PUMP IV SET WITH ANTI-SIPHON VALVE` while keeping the $30.80 price of the
item it overwrote. That description belongs to `6515-01-690-1463`, which costs
$6.21 and appears correctly elsewhere. The root workbook, and therefore
`Data/source/`, has the correct `ELECTRODE,ELECTROCARDIOGRAPH. DISPOSABLE`.

## Fields the master sheet had that are intentionally not carried

The legacy `Master Inventory` sheet has `Quantity On Hand`, `Expiry`, `Location`
and `Count Date` columns. **All four are empty in every one of its 933 rows**, so
nothing was lost by leaving them out, and they are out of scope by design: this
is a reference catalogue of authorised contents and stock numbers, not a
consumption or expiry tracker. Quantities here are *required* holdings, not
counted ones. Treat the absence of those columns as settled rather than as
pending work.
