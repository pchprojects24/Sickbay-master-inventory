(function () {
  "use strict";

  /* ── State ── */
  var kits = [];            // every kit, ordered as generated
  var items = [];           // one record per distinct item NSN
  var kitByNsn = {};
  var itemByNsn = {};
  var childKits = {};       // parent NSN -> [kit, …]
  var rootKits = [];

  var view = "items";       // "items" | "kits"
  var openKit = "";         // NSN of the kit being drilled into, "" for the tree
  var filteredItems = [];
  var sortKey = "nsn";
  var sortAsc = true;
  var searchTerm = "";
  var kitFilter = "";
  var groupByKit = false;
  var collapsedKits = {};
  var expandedItems = {};
  var isDesktop = window.matchMedia("(min-width: 768px)").matches;
  var selected = [];        // [{nsn, qty}]
  var STORAGE_KEY = "sickbay.picklist.v1";

  /* ── DOM refs ── */
  var searchInput = document.getElementById("search");
  var searchClearBtn = document.getElementById("search-clear");
  var kitSelect = document.getElementById("kit-filter");
  var sortSelect = document.getElementById("sort-select");
  var itemControls = document.getElementById("item-controls");
  var statusBar = document.getElementById("status-bar");
  var listEl = document.getElementById("item-list");
  var groupBtn = document.getElementById("group-btn");
  var tabItems = document.getElementById("tab-items");
  var tabKits = document.getElementById("tab-kits");
  var selectedBtn = document.getElementById("selected-btn");
  var selOverlay = document.getElementById("sel-overlay");
  var selDrawer = document.getElementById("sel-drawer");
  var selTitle = document.getElementById("sel-title");
  var selList = document.getElementById("sel-list");
  var selClose = document.getElementById("sel-close");
  var selExport = document.getElementById("sel-export");
  var selPrint = document.getElementById("sel-print");
  var selClear = document.getElementById("sel-clear");

  /* ── Helpers ── */
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function num(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return String(Math.round(Number(n) * 10000) / 10000);
  }

  function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function kitName(nsn) {
    return kitByNsn[nsn] ? kitByNsn[nsn].name : nsn;
  }

  /* ── Load ── */
  function loadData() {
    listEl.innerHTML = '<div class="loading">Loading inventory…</div>';

    fetch("Data/inventory.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        kits = data.kits || [];
        items = data.items || [];

        kits.forEach(function (kit) {
          kitByNsn[kit.nsn] = kit;
        });
        kits.forEach(function (kit) {
          if (kit.parent_nsn && kitByNsn[kit.parent_nsn]) {
            (childKits[kit.parent_nsn] = childKits[kit.parent_nsn] || []).push(kit);
          } else {
            rootKits.push(kit);
          }
        });

        items.forEach(function (item) {
          item.kitNsns = item.memberships.map(function (m) { return m.kit_nsn; });
          item.kitNames = item.kitNsns.map(kitName);
          item.searchText = [
            item.nsn, item.description, item.uom, item.source,
            item.accountability_code, item.kitNames.join(" "), item.kitNsns.join(" "),
          ].join(" ").toLowerCase();
        });

        restoreSelection();
        buildKitSelect();
        updateSelectedCount();
        applyRoute();
      })
      .catch(function (err) {
        listEl.innerHTML =
          '<div class="loading">Error loading data: ' + escapeHtml(err.message) + "</div>";
        statusBar.textContent = "Failed to load";
      });
  }

  function buildKitSelect() {
    var html = '<option value="">All Kits</option>';
    kits.slice().sort(function (a, b) { return compareText(a.name, b.name); })
      .forEach(function (kit) {
        html += '<option value="' + escapeHtml(kit.nsn) + '">' +
          escapeHtml(kit.name) + "</option>";
      });
    kitSelect.innerHTML = html;
    kitSelect.value = kitFilter;
  }

  /* ── Routing (so a kit can be linked and the back button works) ── */
  function applyRoute() {
    var hash = window.location.hash.replace(/^#\/?/, "");
    var nsn = hash.indexOf("kit/") === 0
      ? decodeURIComponent(hash.slice(4)).toUpperCase()
      : "";
    if (nsn && kitByNsn[nsn]) {
      view = "kits";
      openKit = nsn;
    } else if (hash === "kits" || nsn) {
      view = "kits";
      openKit = "";
    } else {
      view = "items";
      openKit = "";
    }
    syncTabs();
    render();
  }

  function navigate(hash) {
    if (window.location.hash === hash) applyRoute();
    else window.location.hash = hash;
  }

  function syncTabs() {
    tabItems.classList.toggle("active", view === "items");
    tabKits.classList.toggle("active", view === "kits");
    tabItems.setAttribute("aria-selected", view === "items" ? "true" : "false");
    tabKits.setAttribute("aria-selected", view === "kits" ? "true" : "false");
    itemControls.classList.toggle("hidden", view !== "items");
    searchInput.placeholder = view === "items"
      ? "Search NSN, description, kit…"
      : "Search kits…";
    syncTopBarHeight();
  }

  /* ── Items view ── */
  function applyFilters() {
    var term = searchTerm.toLowerCase();
    filteredItems = items.filter(function (item) {
      if (term && item.searchText.indexOf(term) === -1) return false;
      if (kitFilter && item.kitNsns.indexOf(kitFilter) === -1) return false;
      return true;
    });
    sortList(filteredItems);
  }

  function sortList(list, kitNsn) {
    list.sort(function (a, b) {
      var cmp;
      if (sortKey === "qty") cmp = qtyFor(a, kitNsn) - qtyFor(b, kitNsn);
      else if (sortKey === "price") cmp = (a.price || 0) - (b.price || 0);
      else if (sortKey === "nsn") cmp = compareText(a.nsn, b.nsn);
      else cmp = compareText(a.description, b.description);
      if (cmp < 0) return sortAsc ? -1 : 1;
      if (cmp > 0) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }

  /* Quantity in the kit being filtered on, else the total across all kits. */
  function qtyFor(item, kitNsn) {
    var target = kitNsn || kitFilter;
    if (target) {
      for (var i = 0; i < item.memberships.length; i++) {
        if (item.memberships[i].kit_nsn === target) return item.memberships[i].qty || 0;
      }
      return 0;
    }
    return item.total_qty || 0;
  }

  function render() {
    if (view === "kits") return openKit ? renderKitDetail() : renderKitTree();
    applyFilters();
    renderItems();
  }

  function renderItems() {
    var msg = "Showing " + filteredItems.length + " of " + items.length + " items";
    var isFiltering = searchTerm || kitFilter;
    statusBar.classList.toggle("filtering", !!isFiltering);
    if (isFiltering) msg += " (filtered)";
    if (groupByKit) msg += " — grouped by kit";
    statusBar.textContent = msg;

    if (filteredItems.length === 0) return renderNoResults();
    if (groupByKit) return renderGrouped();
    listEl.innerHTML = isDesktop ? itemTable(filteredItems) : itemCards(filteredItems);
  }

  function renderNoResults() {
    var html = '<div class="no-results"><p>No items match';
    if (searchTerm) html += ' search "' + escapeHtml(searchTerm) + '"';
    if (kitFilter) html += ' in kit "' + escapeHtml(kitName(kitFilter)) + '"';
    html += '.</p><button id="reset-btn">Reset Filters</button></div>';
    listEl.innerHTML = html;
    document.getElementById("reset-btn").addEventListener("click", resetFilters);
  }

  function addBtn(item, kitNsn) {
    var on = isSelected(item.nsn);
    return '<button class="sel-add-btn' + (on ? " added" : "") +
      '" data-nsn="' + escapeHtml(item.nsn) +
      '" data-qty="' + escapeHtml(qtyFor(item, kitNsn)) + '">' +
      (on ? "Added ✓" : "Add") + "</button>";
  }

  function itemCards(list, kitNsn) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var open = !!expandedItems[it.nsn];
      html += '<div class="card' + (it.is_kit ? " card-kit" : "") + '">';
      html += '<div class="card-top"><div class="card-top-left">';
      html += '<div class="nsn">' + escapeHtml(it.nsn) + "</div>";
      if (it.is_kit) html += '<span class="badge badge-kit">Kit</span>';
      html += "</div>" + addBtn(it, kitNsn) + "</div>";
      html += '<div class="desc">' + escapeHtml(it.description || "—") + "</div>";
      html += '<div class="meta">';
      html += '<span><span class="label">Qty:</span> ' + num(qtyFor(it, kitNsn)) + "</span>";
      html += '<span><span class="label">UoM:</span> ' + escapeHtml(it.uom || "—") + "</span>";
      html += '<span><span class="label">Unit:</span> ' + money(it.price) + "</span>";
      html += '<span><span class="label">Acct:</span> ' + escapeHtml(it.accountability_code || "—") + "</span>";
      html += "</div>";
      if (!kitNsn) {
        html += '<button class="detail-toggle" data-nsn="' + escapeHtml(it.nsn) +
          '" aria-expanded="' + open + '">' +
          (open ? "Hide" : "In " + it.kit_count + " kit" + (it.kit_count !== 1 ? "s" : "")) +
          "</button>";
        if (open) html += membershipTable(it);
      }
      html += "</div>";
    }
    return html;
  }

  function itemTable(list, kitNsn) {
    var html = '<table class="inv-table"><thead><tr>';
    html += "<th></th><th>NSN</th><th>Description</th><th>Qty</th><th>UoM</th>" +
      "<th>Unit Price</th><th>Source</th><th>Acct</th><th>" +
      (kitNsn ? "Ext. Price" : "Kits") + "</th></tr></thead><tbody>";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var open = !!expandedItems[it.nsn];
      html += '<tr class="' + (it.is_kit ? "row-kit" : "") + '">';
      html += '<td class="sel-cell">' + addBtn(it, kitNsn) + "</td>";
      html += "<td>" + escapeHtml(it.nsn) +
        (it.is_kit ? ' <span class="badge badge-kit">Kit</span>' : "") + "</td>";
      html += "<td>" + escapeHtml(it.description || "—") + "</td>";
      html += '<td class="num">' + num(qtyFor(it, kitNsn)) + "</td>";
      html += "<td>" + escapeHtml(it.uom || "—") + "</td>";
      html += '<td class="num">' + money(it.price) +
        (it.price_varies ? ' <span class="badge badge-warn" title="Priced differently in different kits">varies</span>' : "") + "</td>";
      html += "<td>" + escapeHtml(it.source || "—") + "</td>";
      html += "<td>" + escapeHtml(it.accountability_code || "—") + "</td>";
      if (kitNsn) {
        html += '<td class="num">' + money(qtyFor(it, kitNsn) * (it.price || 0)) + "</td>";
      } else {
        html += '<td><button class="detail-toggle" data-nsn="' + escapeHtml(it.nsn) +
          '" aria-expanded="' + open + '">' + it.kit_count + "</button></td>";
      }
      html += "</tr>";
      if (open && !kitNsn) {
        html += '<tr class="detail-row"><td></td><td colspan="8">' +
          membershipTable(it) + "</td></tr>";
      }
    }
    return html + "</tbody></table>";
  }

  function membershipTable(item) {
    var html = '<div class="memberships"><div class="memberships-title">Held in</div>';
    for (var i = 0; i < item.memberships.length; i++) {
      var m = item.memberships[i];
      html += '<a class="membership" href="#kit/' + encodeURIComponent(m.kit_nsn) + '">';
      html += '<span class="membership-name">' + escapeHtml(kitName(m.kit_nsn)) + "</span>";
      html += '<span class="membership-nsn">' + escapeHtml(m.kit_nsn) + "</span>";
      html += '<span class="membership-qty">' + num(m.qty) + " " +
        escapeHtml(item.uom || "") + " · " + money(m.extended_price) + "</span>";
      html += "</a>";
    }
    return html + "</div>";
  }

  function renderGrouped() {
    var shown = kitFilter ? [kitByNsn[kitFilter]] :
      kits.slice().sort(function (a, b) { return compareText(a.name, b.name); });
    var html = "";
    var any = false;

    for (var k = 0; k < shown.length; k++) {
      var kit = shown[k];
      if (!kit) continue;
      var kitItems = filteredItems.filter(function (it) {
        return it.kitNsns.indexOf(kit.nsn) !== -1;
      });
      if (!kitItems.length) continue;
      any = true;
      sortList(kitItems, kit.nsn);

      var collapsed = !!collapsedKits[kit.nsn];
      html += '<div class="kit-group">';
      html += '<button class="kit-group-header" data-kit="' + escapeHtml(kit.nsn) +
        '" aria-expanded="' + !collapsed + '">';
      html += '<span class="kit-group-chevron">' + (collapsed ? "&#9654;" : "&#9660;") + "</span>";
      html += '<span class="kit-group-name">' + escapeHtml(kit.name) + "</span>";
      html += '<span class="kit-group-count">' + kitItems.length + " item" +
        (kitItems.length !== 1 ? "s" : "") + "</span></button>";
      if (!collapsed) {
        html += '<div class="kit-group-body">' +
          (isDesktop ? itemTable(kitItems, kit.nsn) : itemCards(kitItems, kit.nsn)) +
          "</div>";
      }
      html += "</div>";
    }

    if (!any) return renderNoResults();
    listEl.innerHTML = html;
  }

  /* ── Kits view ── */
  function kitMatches(kit, term) {
    if (!term) return true;
    if ((kit.name + " " + kit.nsn).toLowerCase().indexOf(term) !== -1) return true;
    // Also match a kit by anything it contains.
    return items.some(function (it) {
      return it.kitNsns.indexOf(kit.nsn) !== -1 && it.searchText.indexOf(term) !== -1;
    });
  }

  function renderKitTree() {
    var term = searchTerm.toLowerCase();
    var matching = {};
    kits.forEach(function (kit) {
      if (kitMatches(kit, term)) matching[kit.nsn] = true;
    });
    // Keep ancestors of a match visible so the tree stays navigable.
    kits.forEach(function (kit) {
      if (!matching[kit.nsn]) return;
      var parent = kit.parent_nsn;
      while (parent && kitByNsn[parent]) {
        matching[parent] = true;
        parent = kitByNsn[parent].parent_nsn;
      }
    });

    var count = kits.filter(function (k) { return matching[k.nsn]; }).length;
    statusBar.classList.toggle("filtering", !!term);
    statusBar.textContent = term
      ? "Showing " + count + " of " + kits.length + " kits (filtered)"
      : kits.length + " kits · " + items.length + " distinct items";

    if (!count) {
      listEl.innerHTML = '<div class="no-results"><p>No kits match "' +
        escapeHtml(searchTerm) + '".</p><button id="reset-btn">Reset Filters</button></div>';
      document.getElementById("reset-btn").addEventListener("click", resetFilters);
      return;
    }

    var html = '<div class="kit-tree">';
    function walk(list, depth) {
      list.slice().sort(function (a, b) { return compareText(a.name, b.name); })
        .forEach(function (kit) {
          if (!matching[kit.nsn]) return;
          html += '<a class="kit-row" href="#kit/' + encodeURIComponent(kit.nsn) +
            '" style="padding-left:' + (12 + depth * 18) + 'px">';
          html += '<div class="kit-row-main">';
          html += '<div class="kit-row-name">' + escapeHtml(kit.name) + "</div>";
          html += '<div class="kit-row-nsn">' + escapeHtml(kit.nsn) + "</div></div>";
          html += '<div class="kit-row-stats"><span>' + kit.line_count + " lines</span>" +
            "<span>" + money(kit.total_value) + "</span></div>";
          html += "</a>";
          walk(childKits[kit.nsn] || [], depth + 1);
        });
    }
    walk(rootKits, 0);
    listEl.innerHTML = html + "</div>";
  }

  function renderKitDetail() {
    var kit = kitByNsn[openKit];
    if (!kit) return navigate("#kits");

    var contents = items.filter(function (it) {
      return it.kitNsns.indexOf(kit.nsn) !== -1;
    });
    var term = searchTerm.toLowerCase();
    if (term) {
      contents = contents.filter(function (it) {
        return it.searchText.indexOf(term) !== -1;
      });
    }
    sortList(contents, kit.nsn);

    statusBar.classList.toggle("filtering", !!term);
    statusBar.textContent = kit.line_count + " lines · " + money(kit.total_value) +
      (term ? " · showing " + contents.length + " matching" : "");

    var html = '<div class="kit-detail">';
    html += '<a class="back-link" href="#kits">&#8592; All kits</a>';
    html += '<h1 class="kit-title">' + escapeHtml(kit.name) + "</h1>";
    html += '<div class="kit-sub">' + escapeHtml(kit.nsn) + "</div>";

    if (kit.parent_nsn && kitByNsn[kit.parent_nsn]) {
      html += '<div class="kit-parent">Component of <a href="#kit/' +
        encodeURIComponent(kit.parent_nsn) + '">' +
        escapeHtml(kitName(kit.parent_nsn)) + "</a></div>";
    }

    html += '<div class="kit-stats">';
    html += '<div class="stat"><div class="stat-value">' + kit.line_count +
      '</div><div class="stat-label">Lines</div></div>';
    html += '<div class="stat"><div class="stat-value">' + money(kit.total_value) +
      '</div><div class="stat-label">Total value</div></div>';
    html += '<div class="stat"><div class="stat-value">' + kit.sub_kits.length +
      '</div><div class="stat-label">Sub-kits</div></div>';
    html += "</div>";

    html += '<div class="kit-actions">';
    html += '<button id="kit-add-all" class="sel-action-btn">Add all to pick list</button>';
    html += '<a class="sel-action-btn" href="Data/kits/' + encodeHtmlAttr(kit.slug) +
      '.csv" download>Download CSV</a>';
    html += "</div>";

    if (!contents.length) {
      html += '<div class="no-results"><p>Nothing in this kit matches "' +
        escapeHtml(searchTerm) + '".</p><button id="reset-btn">Clear search</button></div>';
    } else {
      html += (isDesktop ? itemTable(contents, kit.nsn) : itemCards(contents, kit.nsn));
    }
    listEl.innerHTML = html + "</div>";

    var reset = document.getElementById("reset-btn");
    if (reset) reset.addEventListener("click", resetFilters);

    var addAll = document.getElementById("kit-add-all");
    if (addAll) {
      addAll.disabled = !contents.length;
      addAll.addEventListener("click", function () {
        contents.forEach(function (it) {
          if (!isSelected(it.nsn)) {
            selected.push({ nsn: it.nsn, qty: qtyFor(it, kit.nsn) });
          }
        });
        persistSelection();
        updateSelectedCount();
        render();
      });
    }
  }

  function encodeHtmlAttr(s) {
    return escapeHtml(encodeURIComponent(s).replace(/%2F/gi, "/"));
  }

  /* ── Pick list ── */
  function isSelected(nsn) {
    return selected.some(function (s) { return s.nsn === nsn; });
  }

  function toggleSelect(nsn, qty) {
    var idx = -1;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nsn === nsn) { idx = i; break; }
    }
    if (idx >= 0) selected.splice(idx, 1);
    else if (itemByNsnLookup(nsn)) selected.push({ nsn: nsn, qty: qty });
    persistSelection();
    updateSelectedCount();
    render();
  }

  function itemByNsnLookup(nsn) {
    if (!itemByNsn[nsn]) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].nsn === nsn) { itemByNsn[nsn] = items[i]; break; }
      }
    }
    return itemByNsn[nsn];
  }

  function persistSelection() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch (e) { /* private mode or blocked storage — the list stays in memory */ }
  }

  function restoreSelection() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var saved = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(saved) === "[object Array]") {
        selected = saved.filter(function (s) {
          return s && s.nsn && itemByNsnLookup(s.nsn);
        });
      }
    } catch (e) { selected = []; }
  }

  function updateSelectedCount() {
    selectedBtn.textContent = "List (" + selected.length + ")";
    selTitle.textContent = "Pick list (" + selected.length + ")";
  }

  function renderDrawer() {
    updateSelectedCount();
    if (!selected.length) {
      selList.innerHTML = '<div class="sel-empty">Nothing on the pick list yet.</div>';
      return;
    }
    var total = 0;
    var html = "";
    for (var i = 0; i < selected.length; i++) {
      var it = itemByNsnLookup(selected[i].nsn);
      if (!it) continue;
      var qty = selected[i].qty || 0;
      total += qty * (it.price || 0);
      html += '<div class="sel-card">';
      html += '<div class="sel-card-top"><div class="nsn">' + escapeHtml(it.nsn) + "</div>";
      html += '<button class="sel-remove-btn" data-nsn="' + escapeHtml(it.nsn) +
        '">Remove</button></div>';
      html += '<div class="desc">' + escapeHtml(it.description || "—") + "</div>";
      html += '<div class="meta"><span><span class="label">Qty:</span> ';
      html += '<input class="qty-input" type="number" min="0" step="any" value="' +
        escapeHtml(qty) + '" data-nsn="' + escapeHtml(it.nsn) + '" aria-label="Quantity for ' +
        escapeHtml(it.nsn) + '"></span>';
      html += '<span><span class="label">UoM:</span> ' + escapeHtml(it.uom || "—") + "</span>";
      html += '<span><span class="label">Ext:</span> ' + money(qty * (it.price || 0)) + "</span>";
      html += "</div></div>";
    }
    selList.innerHTML = '<div class="sel-total">Estimated total ' + money(total) + "</div>" + html;
  }

  function openDrawer() {
    renderDrawer();
    selDrawer.classList.remove("hidden");
    selOverlay.classList.remove("hidden");
    selDrawer.removeAttribute("aria-hidden");
    selDrawer.removeAttribute("inert");
    document.body.style.overflow = "hidden";
    setTimeout(function () { selClose.focus(); }, 100);
  }

  function closeDrawer() {
    selDrawer.classList.add("hidden");
    selOverlay.classList.add("hidden");
    selDrawer.setAttribute("aria-hidden", "true");
    selDrawer.setAttribute("inert", "");
    document.body.style.overflow = "";
    selectedBtn.focus();
  }

  function csvField(val) {
    var s = val === null || val === undefined ? "" : String(val);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv() {
    var lines = ["NSN,Description,Quantity,Unit of Measure,Unit Price,Extended Price," +
      "Source,Accountability Code,Kit Membership"];
    selected.forEach(function (sel) {
      var it = itemByNsnLookup(sel.nsn);
      if (!it) return;
      var qty = sel.qty || 0;
      lines.push([
        it.nsn, it.description, qty, it.uom,
        it.price === null ? "" : it.price,
        it.price === null ? "" : Math.round(qty * it.price * 100) / 100,
        it.source, it.accountability_code,
        it.kitNames.join("; "),
      ].map(csvField).join(","));
    });
    return lines.join("\r\n");
  }

  function exportCSV() {
    if (!selected.length) return;
    var blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    var a = document.createElement("a");
    a.href = url;
    a.download = "sickbay_picklist_" + now.getFullYear() + "-" +
      pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" +
      pad(now.getHours()) + pad(now.getMinutes()) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var original = selExport.textContent;
    selExport.textContent = "Exported ✓";
    selExport.disabled = true;
    setTimeout(function () {
      selExport.textContent = original;
      selExport.disabled = false;
    }, 2000);
  }

  /* The desktop table header sticks below the top bar, whose height changes
     with the viewport and with which control rows are showing. */
  function syncTopBarHeight() {
    var bar = document.querySelector(".top-bar");
    if (bar) {
      document.documentElement.style.setProperty(
        "--topbar-h", Math.round(bar.getBoundingClientRect().height) + "px");
    }
  }

  if (window.ResizeObserver) {
    new ResizeObserver(syncTopBarHeight).observe(document.querySelector(".top-bar"));
  } else {
    window.addEventListener("resize", syncTopBarHeight);
  }

  /* ── Events ── */
  listEl.addEventListener("click", function (e) {
    var header = e.target.closest(".kit-group-header");
    if (header) {
      var nsn = header.getAttribute("data-kit");
      if (collapsedKits[nsn]) delete collapsedKits[nsn];
      else collapsedKits[nsn] = true;
      render();
      return;
    }

    var detail = e.target.closest(".detail-toggle");
    if (detail) {
      var dn = detail.getAttribute("data-nsn");
      if (expandedItems[dn]) delete expandedItems[dn];
      else expandedItems[dn] = true;
      render();
      return;
    }

    var add = e.target.closest(".sel-add-btn");
    if (add) {
      e.preventDefault();
      e.stopPropagation();
      var addQty = parseFloat(add.getAttribute("data-qty"));
      toggleSelect(add.getAttribute("data-nsn"), isNaN(addQty) ? 0 : addQty);
    }
  });

  tabItems.addEventListener("click", function () { navigate("#items"); });
  tabKits.addEventListener("click", function () { navigate("#kits"); });
  window.addEventListener("hashchange", applyRoute);

  var debounceTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      searchTerm = searchInput.value.trim();
      searchClearBtn.classList.toggle("hidden", !searchTerm);
      render();
    }, 200);
  });

  searchClearBtn.addEventListener("click", function () {
    searchInput.value = "";
    searchTerm = "";
    searchClearBtn.classList.add("hidden");
    render();
    searchInput.focus();
  });

  kitSelect.addEventListener("change", function () {
    kitFilter = kitSelect.value;
    render();
  });

  sortSelect.addEventListener("change", function () {
    var parts = sortSelect.value.split("-");
    sortAsc = parts[parts.length - 1] === "asc";
    sortKey = parts.slice(0, -1).join("-");
    render();
  });

  groupBtn.addEventListener("click", function () {
    groupByKit = !groupByKit;
    collapsedKits = {};
    groupBtn.setAttribute("aria-pressed", groupByKit ? "true" : "false");
    groupBtn.classList.toggle("active", groupByKit);
    render();
  });

  function resetFilters() {
    searchInput.value = "";
    kitSelect.value = "";
    sortSelect.value = "nsn-asc";
    searchTerm = "";
    kitFilter = "";
    sortKey = "nsn";
    sortAsc = true;
    searchClearBtn.classList.add("hidden");
    render();
  }

  window.matchMedia("(min-width: 768px)").addEventListener("change", function (e) {
    isDesktop = e.matches;
    render();
  });

  selectedBtn.addEventListener("click", openDrawer);
  selClose.addEventListener("click", closeDrawer);
  selOverlay.addEventListener("click", closeDrawer);
  selExport.addEventListener("click", exportCSV);
  selPrint.addEventListener("click", function () { window.print(); });
  selClear.addEventListener("click", function () {
    selected = [];
    persistSelection();
    renderDrawer();
    render();
  });

  selList.addEventListener("click", function (e) {
    var btn = e.target.closest(".sel-remove-btn");
    if (!btn) return;
    var nsn = btn.getAttribute("data-nsn");
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nsn === nsn) { selected.splice(i, 1); break; }
    }
    persistSelection();
    renderDrawer();
    render();
  });

  selList.addEventListener("change", function (e) {
    if (!e.target.classList.contains("qty-input")) return;
    var nsn = e.target.getAttribute("data-nsn");
    var qty = parseFloat(e.target.value);
    selected.forEach(function (s) {
      if (s.nsn === nsn) s.qty = isNaN(qty) || qty < 0 ? 0 : qty;
    });
    persistSelection();
    renderDrawer();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!selDrawer.classList.contains("hidden")) return closeDrawer();
    if (document.activeElement === searchInput && searchInput.value) {
      searchInput.value = "";
      searchTerm = "";
      searchClearBtn.classList.add("hidden");
      render();
    }
  });

  loadData();
})();
