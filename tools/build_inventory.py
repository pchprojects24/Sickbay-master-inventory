#!/usr/bin/env python3
"""Rebuild every derived inventory file from the source workbooks.

Source of truth : Data/source/*.xlsx  (one workbook per kit, as issued)
Generated       : Data/inventory.json
                  Data/kit_items.csv
                  Data/master_inventory.csv
                  Data/kits/<slug>.csv

Run after replacing or adding a workbook:

    python3 tools/build_inventory.py

Requires openpyxl (pip install openpyxl).
"""

import csv
import json
import os
import re
import sys
import unicodedata
from collections import OrderedDict

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(ROOT, "Data", "source")
DATA_DIR = os.path.join(ROOT, "Data")
KIT_DIR = os.path.join(DATA_DIR, "kits")

# Column order in every source workbook.
COLUMNS = ["kit_nsn", "item_nsn", "qty", "uom", "description",
           "source", "price", "accountability_code"]

NSN_RE = re.compile(r"^\d{4}-[0-9A-Z]{2}-[0-9A-Z]{3}-[0-9A-Z]{4}$")

# The top of the tree is never listed as a component of anything else, so it has
# no issued description to borrow. Name it explicitly rather than leave it blank.
ROOT_KIT_NAMES = {
    "6545-CF-005-1238": "MASTER KIT LIST, SICKBAY (ALL HOLDINGS)",
}


def slugify(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return re.sub(r"-{2,}", "-", value)


def clean(value):
    """Normalise a cell to a trimmed string ('' for blanks)."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return " ".join(str(value).split())


def parse_number(value):
    """Parse a quantity/price cell. Returns None when not numeric."""
    text = clean(value).replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


EXPECTED_HEADER = ["kit nsn", "kit item nsn", "qty", "uom", "description",
                   "source", "price", "d kit accountability code"]


def check_header(sheet, filename):
    """Cells map to COLUMNS by position, so a reordered workbook would be parsed
    wrongly and silently. Refuse to guess."""
    raw = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), ())
    got = [clean(cell).lower() for cell in raw][:len(EXPECTED_HEADER)]
    if got != EXPECTED_HEADER:
        sys.exit("%s: unexpected column layout.\n  expected: %s\n  found:    %s"
                 % (filename, EXPECTED_HEADER, got))


def read_rows():
    """Read every workbook into a flat list of kit-item line dicts."""
    files = sorted(f for f in os.listdir(SOURCE_DIR) if f.endswith(".xlsx")
                   and not f.startswith("~$"))
    if not files:
        sys.exit("no workbooks found in %s" % SOURCE_DIR)

    rows = []
    for filename in files:
        path = os.path.join(SOURCE_DIR, filename)
        book = openpyxl.load_workbook(path, data_only=True)
        if len(book.worksheets) > 1:
            sys.exit("%s: expected one sheet, found %s"
                     % (filename, book.sheetnames))
        sheet = book.worksheets[0]
        check_header(sheet, filename)
        for excel_row, raw in enumerate(sheet.iter_rows(min_row=2, values_only=True),
                                        start=2):
            values = [clean(cell) for cell in raw][:len(COLUMNS)]
            values += [""] * (len(COLUMNS) - len(values))
            row = dict(zip(COLUMNS, values))
            if not row["kit_nsn"] and not row["item_nsn"]:
                continue

            # NSNs are case-insensitive identifiers; a few cells arrive lowercase.
            row["kit_nsn"] = row["kit_nsn"].upper()
            row["item_nsn"] = row["item_nsn"].upper()
            row["uom"] = row["uom"].upper()
            row["accountability_code"] = row["accountability_code"].upper()

            qty = parse_number(row["qty"])
            price = parse_number(row["price"])
            row["qty"] = qty
            row["price"] = price
            row["extended_price"] = (round(qty * price, 2)
                                     if qty is not None and price is not None else None)
            row["is_nsn"] = bool(NSN_RE.match(row["item_nsn"]))
            row["source_file"] = filename
            row["source_row"] = excel_row
            rows.append(row)
    return rows


def build_kits(rows):
    """Resolve kit names and parent/child links from the component lines."""
    kit_nsns = OrderedDict()
    for row in rows:
        kit_nsns.setdefault(row["kit_nsn"], row["source_file"])

    # A kit's proper name is the description used where it appears as a component.
    names, parents = {}, {}
    for row in rows:
        if row["item_nsn"] in kit_nsns:
            names.setdefault(row["item_nsn"], row["description"])
            parents.setdefault(row["item_nsn"], row["kit_nsn"])

    kits = OrderedDict()
    used_slugs = {}
    for nsn, filename in kit_nsns.items():
        lines = [r for r in rows if r["kit_nsn"] == nsn]
        name = names.get(nsn) or ROOT_KIT_NAMES.get(nsn) or os.path.splitext(filename)[0]
        total = sum(r["extended_price"] for r in lines
                    if r["extended_price"] is not None)
        # One workbook can carry lines for more than one kit, so a filename-derived
        # slug is not guaranteed unique. The slug names a generated CSV and the
        # app's download URL, so a collision would serve the wrong kit's contents.
        slug = slugify(os.path.splitext(filename)[0])
        if used_slugs.get(slug, nsn) != nsn:
            slug = "%s-%s" % (slug, nsn.lower())
        used_slugs[slug] = nsn
        kits[nsn] = {
            "nsn": nsn,
            "name": name,
            "slug": slug,
            "parent_nsn": parents.get(nsn),
            "source_file": filename,
            "line_count": len(lines),
            "total_value": round(total, 2),
            "sub_kits": [r["item_nsn"] for r in lines if r["item_nsn"] in kit_nsns],
        }

    # Depth: 0 for the kit with no parent, +1 for each step down the tree.
    def depth_of(nsn, seen=None):
        seen = seen or set()
        parent = kits[nsn]["parent_nsn"]
        if not parent or parent not in kits or parent in seen:
            return 0
        return 1 + depth_of(parent, seen | {nsn})

    for nsn in kits:
        kits[nsn]["depth"] = depth_of(nsn)
    return kits


def build_items(rows, kits):
    """Collapse the line rows into one record per distinct item."""
    items = OrderedDict()
    for row in rows:
        item = items.get(row["item_nsn"])
        if item is None:
            item = items[row["item_nsn"]] = {
                "nsn": row["item_nsn"],
                "description": row["description"],
                "uom": row["uom"],
                "source": row["source"],
                "accountability_code": row["accountability_code"],
                "is_nsn": row["is_nsn"],
                "is_kit": row["item_nsn"] in kits,
                "prices": [],
                "sources": [],
                "memberships": [],
            }
        if row["price"] is not None:
            item["prices"].append(row["price"])
        item["sources"].append(row["source"])
        item["memberships"].append({
            "kit_nsn": row["kit_nsn"],
            "qty": row["qty"],
            "price": row["price"],
            "extended_price": row["extended_price"],
        })

    for item in items.values():
        prices = item.pop("prices")
        # A few items differ between kits on price or on where they are drawn
        # from. The rollup has to pick one, so flag that it did.
        item["price"] = round(prices[0], 2) if prices else None
        item["price_varies"] = len(set(prices)) > 1
        item["source_varies"] = len(set(item.pop("sources"))) > 1
        item["total_qty"] = round(sum(m["qty"] for m in item["memberships"]
                                      if m["qty"] is not None), 4)
        item["kit_count"] = len(item["memberships"])
    return items


def write_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def fmt(value):
    """Format a number for CSV: integers without a decimal tail."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def main():
    rows = read_rows()
    kits = build_kits(rows)
    items = build_items(rows, kits)

    def sort_key(row):
        return (kits[row["kit_nsn"]]["name"], row["item_nsn"])

    ordered = sorted(rows, key=sort_key)

    # 1. Every kit-item line, the canonical flat table.
    write_csv(
        os.path.join(DATA_DIR, "kit_items.csv"),
        ["Kit NSN", "Kit Name", "Item NSN", "Description", "Quantity", "Unit of Measure",
         "Source", "Unit Price", "Extended Price", "Accountability Code", "Is Sub-Kit"],
        [[r["kit_nsn"], kits[r["kit_nsn"]]["name"], r["item_nsn"], r["description"],
          fmt(r["qty"]), r["uom"], r["source"], fmt(r["price"]), fmt(r["extended_price"]),
          r["accountability_code"], "Y" if r["item_nsn"] in kits else ""]
         for r in ordered],
    )

    # 2. One pick list per kit. Remove any left over from a renamed or deleted
    #    workbook first: an orphan is indistinguishable from current data.
    os.makedirs(KIT_DIR, exist_ok=True)
    current = {kit["slug"] + ".csv" for kit in kits.values()}
    for stale in sorted(set(os.listdir(KIT_DIR)) - current):
        if stale.endswith(".csv"):
            os.remove(os.path.join(KIT_DIR, stale))
            print("removed stale %s" % stale)

    for kit in kits.values():
        lines = [r for r in ordered if r["kit_nsn"] == kit["nsn"]]
        write_csv(
            os.path.join(KIT_DIR, kit["slug"] + ".csv"),
            ["Item NSN", "Description", "Quantity", "Unit of Measure", "Source",
             "Unit Price", "Extended Price", "Accountability Code", "Is Sub-Kit"],
            [[r["item_nsn"], r["description"], fmt(r["qty"]), r["uom"], r["source"],
              fmt(r["price"]), fmt(r["extended_price"]), r["accountability_code"],
              "Y" if r["item_nsn"] in kits else ""] for r in lines],
        )

    # 3. Item-level rollup, one row per distinct item across all kits.
    #    "Is Kit" marks the 28 containers that have contents of their own. They
    #    are listed because they are real line items inside their parent, but
    #    their value is already the sum of their contents, so anyone counting
    #    stock or money should filter them out. Items merely *named* "KIT ..."
    #    with no contents of their own (pediatric resus, OPA set, the two sexual
    #    assault kits) are ordinary stock and stay unmarked.
    write_csv(
        os.path.join(DATA_DIR, "master_inventory.csv"),
        ["NSN", "Description", "Unit of Measure", "Total Quantity", "Kit Count",
         "Unit Price", "Accountability Code", "Source", "Is Kit", "Kit Membership"],
        [[item["nsn"], item["description"], item["uom"], fmt(item["total_qty"]),
          item["kit_count"], fmt(item["price"]), item["accountability_code"],
          item["source"], "Y" if item["is_kit"] else "",
          "; ".join("%s (%s) x%s" % (kits[m["kit_nsn"]]["name"], m["kit_nsn"],
                                     fmt(m["qty"]))
                    for m in item["memberships"])]
         for item in sorted(items.values(), key=lambda i: i["nsn"])],
    )

    # 4. Structured data for the browser app.
    payload = {
        "generated_from": "Data/source/*.xlsx",
        "kit_count": len(kits),
        "item_count": len(items),
        "line_count": len(rows),
        "kits": list(kits.values()),
        "items": sorted(items.values(), key=lambda i: i["nsn"]),
    }
    with open(os.path.join(DATA_DIR, "inventory.json"), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=False)
        handle.write("\n")

    print("kits: %d  items: %d  lines: %d" % (len(kits), len(items), len(rows)))


if __name__ == "__main__":
    main()
