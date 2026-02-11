(function () {
  "use strict";

  /* ── State ── */
  var allItems = [];
  var filteredItems = [];
  var kitList = [];
  var sortKey = "nsn";
  var sortAsc = true;
  var searchTerm = "";
  var kitFilter = "";
  var isDesktop = window.matchMedia("(min-width: 768px)").matches;
  var selectedItems = []; // session-only selection list

  /* ── DOM refs ── */
  var searchInput = document.getElementById("search");
  var kitSelect = document.getElementById("kit-filter");
  var sortSelect = document.getElementById("sort-select");
  var statusBar = document.getElementById("status-bar");
  var listEl = document.getElementById("item-list");
  var selectedBtn = document.getElementById("selected-btn");
  var selOverlay = document.getElementById("sel-overlay");
  var selDrawer = document.getElementById("sel-drawer");
  var selTitle = document.getElementById("sel-title");
  var selList = document.getElementById("sel-list");
  var selClose = document.getElementById("sel-close");
  var selExport = document.getElementById("sel-export");
  var selClear = document.getElementById("sel-clear");

  /* ── CSV Parsing ── */
  function parseCSVRows(text) {
    var rows = [];
    var i = 0;
    var len = text.length;

    while (i < len) {
      var row = [];
      while (i < len) {
        var field = "";
        // skip leading whitespace? no, preserve it
        if (i < len && text[i] === '"') {
          // quoted field
          i++; // skip opening quote
          while (i < len) {
            if (text[i] === '"') {
              if (i + 1 < len && text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                i++; // skip closing quote
                break;
              }
            } else {
              field += text[i];
              i++;
            }
          }
          // skip to comma or line end
          while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
            i++;
          }
        } else {
          // unquoted field
          while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
            field += text[i];
            i++;
          }
        }
        row.push(field);

        if (i < len && text[i] === ",") {
          i++; // skip comma, continue to next field
        } else {
          break; // end of row
        }
      }
      // skip line endings
      if (i < len && text[i] === "\r") i++;
      if (i < len && text[i] === "\n") i++;

      // skip empty trailing rows
      if (row.length === 1 && row[0] === "" && i >= len) break;
      rows.push(row);
    }
    return rows;
  }

  function loadData() {
    listEl.innerHTML = '<div class="loading">Loading inventory\u2026</div>';

    fetch("Data/master_inventory.csv")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSVRows(text);
        if (rows.length < 2) {
          listEl.innerHTML = '<div class="loading">No data found in CSV.</div>';
          return;
        }
        // first row is header
        var kitsSet = {};
        for (var r = 1; r < rows.length; r++) {
          var cols = rows[r];
          if (cols.length < 5) {
            // pad
            while (cols.length < 5) cols.push("");
          }
          var item = {
            nsn: cols[0].trim(),
            description: cols[1].trim(),
            uom: cols[2].trim(),
            qty: cols[3].trim(),
            kits: cols[4].trim(),
          };
          // skip entirely blank rows
          if (!item.nsn && !item.description) continue;

          item.qtyNum = parseFloat(item.qty) || 0;
          item.kitArr = item.kits
            ? item.kits.split(";").map(function (k) { return k.trim(); }).filter(Boolean)
            : [];
          item.searchText = (
            item.nsn + " " + item.description + " " + item.uom + " " + item.qty + " " + item.kits
          ).toLowerCase();

          allItems.push(item);

          for (var k = 0; k < item.kitArr.length; k++) {
            kitsSet[item.kitArr[k]] = true;
          }
        }

        kitList = Object.keys(kitsSet).sort();
        buildKitSelect();
        applyFilters();
      })
      .catch(function (err) {
        listEl.innerHTML =
          '<div class="loading">Error loading data: ' + escapeHtml(err.message) + "</div>";
      });
  }

  /* ── Kit dropdown ── */
  function buildKitSelect() {
    var html = '<option value="">All Kits</option>';
    for (var i = 0; i < kitList.length; i++) {
      html += '<option value="' + escapeAttr(kitList[i]) + '">' + escapeHtml(kitList[i]) + "</option>";
    }
    kitSelect.innerHTML = html;
  }

  /* ── Filtering & Sorting ── */
  function applyFilters() {
    var term = searchTerm.toLowerCase();
    filteredItems = allItems.filter(function (item) {
      if (term && item.searchText.indexOf(term) === -1) return false;
      if (kitFilter && item.kitArr.indexOf(kitFilter) === -1) return false;
      return true;
    });
    sortItems();
    render();
  }

  function sortItems() {
    var key = sortKey;
    var asc = sortAsc;
    filteredItems.sort(function (a, b) {
      var va, vb;
      if (key === "qty") {
        va = a.qtyNum;
        vb = b.qtyNum;
      } else if (key === "nsn") {
        va = a.nsn;
        vb = b.nsn;
      } else {
        va = a.description;
        vb = b.description;
      }
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });
  }

  /* ── Rendering ── */
  function render() {
    statusBar.textContent = "Showing " + filteredItems.length + " of " + allItems.length + " items";

    if (filteredItems.length === 0) {
      listEl.innerHTML =
        '<div class="no-results"><p>No items match your search.</p>' +
        '<button id="reset-btn">Reset Filters</button></div>';
      document.getElementById("reset-btn").addEventListener("click", resetFilters);
      return;
    }

    if (isDesktop) {
      renderTable();
    } else {
      renderCards();
    }
  }

  function renderCards() {
    var html = "";
    for (var i = 0; i < filteredItems.length; i++) {
      var it = filteredItems[i];
      var isSel = isSelected(it);
      html += '<div class="card">';
      html += '<div class="card-top"><div class="card-top-left">';
      html += '<div class="nsn">' + escapeHtml(it.nsn) + "</div>";
      html += '</div>';
      html += '<button class="sel-add-btn' + (isSel ? " added" : "") + '" data-nsn="' + escapeAttr(it.nsn) + '">' + (isSel ? "Added \u2713" : "Add") + '</button>';
      html += '</div>';
      html += '<div class="desc">' + escapeHtml(it.description || "\u2014") + "</div>";
      html += '<div class="meta">';
      html += "<span><span class=\"label\">UoM:</span> " + escapeHtml(it.uom || "\u2014") + "</span>";
      html += "<span><span class=\"label\">Qty:</span> " + escapeHtml(it.qty || "\u2014") + "</span>";
      html += "</div>";
      if (it.kits) {
        var needsTruncate = it.kits.length > 100;
        html += '<div class="kits"><span class="label">Kits:</span> ';
        html +=
          '<span class="kits-text' + (needsTruncate ? " truncated" : "") + '">' +
          escapeHtml(it.kits) +
          "</span>";
        if (needsTruncate) {
          html += ' <button class="kits-toggle" data-idx="' + i + '">more</button>';
        }
        html += "</div>";
      }
      html += "</div>";
    }
    listEl.innerHTML = html;
  }

  function renderTable() {
    var html = '<table class="inv-table"><thead><tr>';
    html += "<th></th><th>NSN</th><th>Description</th><th>UoM</th><th>Qty</th><th>Kit Membership</th>";
    html += "</tr></thead><tbody>";
    for (var i = 0; i < filteredItems.length; i++) {
      var it = filteredItems[i];
      var needsTruncate = it.kits.length > 120;
      var isSel = isSelected(it);
      html += "<tr>";
      html += '<td class="sel-cell"><button class="sel-add-btn' + (isSel ? " added" : "") + '" data-nsn="' + escapeAttr(it.nsn) + '">' + (isSel ? "Added \u2713" : "Add") + '</button></td>';
      html += "<td>" + escapeHtml(it.nsn) + "</td>";
      html += "<td>" + escapeHtml(it.description || "\u2014") + "</td>";
      html += "<td>" + escapeHtml(it.uom || "\u2014") + "</td>";
      html += "<td>" + escapeHtml(it.qty || "\u2014") + "</td>";
      html += '<td class="kit-cell">';
      html +=
        '<span class="kits-text' + (needsTruncate ? " truncated" : "") + '">' +
        escapeHtml(it.kits || "\u2014") +
        "</span>";
      if (needsTruncate) {
        html += ' <button class="kits-toggle" data-idx="' + i + '">more</button>';
      }
      html += "</td></tr>";
    }
    html += "</tbody></table>";
    listEl.innerHTML = html;
  }

  /* ── Toggle kits expand/collapse ── */
  listEl.addEventListener("click", function (e) {
    if (e.target.classList.contains("kits-toggle")) {
      var textEl = e.target.previousElementSibling;
      if (!textEl) return;
      var expanded = !textEl.classList.contains("truncated");
      if (expanded) {
        textEl.classList.add("truncated");
        e.target.textContent = "more";
      } else {
        textEl.classList.remove("truncated");
        e.target.textContent = "less";
      }
    }
  });

  /* ── Reset ── */
  function resetFilters() {
    searchInput.value = "";
    kitSelect.value = "";
    sortSelect.value = "nsn-asc";
    searchTerm = "";
    kitFilter = "";
    sortKey = "nsn";
    sortAsc = true;
    applyFilters();
  }

  /* ── Event Listeners ── */
  var debounceTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      searchTerm = searchInput.value.trim();
      applyFilters();
    }, 200);
  });

  kitSelect.addEventListener("change", function () {
    kitFilter = kitSelect.value;
    applyFilters();
  });

  sortSelect.addEventListener("change", function () {
    var val = sortSelect.value;
    var parts = val.split("-");
    sortAsc = parts[parts.length - 1] === "asc";
    sortKey = parts.slice(0, parts.length - 1).join("-");
    applyFilters();
  });

  window.matchMedia("(min-width: 768px)").addEventListener("change", function (e) {
    isDesktop = e.matches;
    if (filteredItems.length > 0) render();
  });

  /* ── Helpers ── */
  function escapeHtml(s) {
    if (!s) return "";
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  /* ── Selection Feature ── */
  function isSelected(item) {
    for (var i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i].nsn === item.nsn && selectedItems[i].description === item.description) return true;
    }
    return false;
  }

  function toggleSelect(nsn) {
    // find item in allItems
    var item = null;
    for (var i = 0; i < allItems.length; i++) {
      if (allItems[i].nsn === nsn) { item = allItems[i]; break; }
    }
    if (!item) return;

    var idx = -1;
    for (var i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i].nsn === item.nsn && selectedItems[i].description === item.description) { idx = i; break; }
    }
    if (idx >= 0) {
      selectedItems.splice(idx, 1);
    } else {
      selectedItems.push(item);
    }
    updateSelectedCount();
    render();
  }

  function removeSelected(nsn, desc) {
    for (var i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i].nsn === nsn && selectedItems[i].description === desc) {
        selectedItems.splice(i, 1);
        break;
      }
    }
    updateSelectedCount();
    renderDrawer();
  }

  function updateSelectedCount() {
    var n = selectedItems.length;
    selectedBtn.textContent = "Selected (" + n + ")";
    selTitle.textContent = "Selected (" + n + ")";
  }

  function openDrawer() {
    renderDrawer();
    selDrawer.classList.remove("hidden");
    selOverlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    selDrawer.classList.add("hidden");
    selOverlay.classList.add("hidden");
    document.body.style.overflow = "";
  }

  function renderDrawer() {
    updateSelectedCount();
    if (selectedItems.length === 0) {
      selList.innerHTML = '<div class="sel-empty">No items selected.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < selectedItems.length; i++) {
      var it = selectedItems[i];
      html += '<div class="sel-card">';
      html += '<div class="sel-card-top">';
      html += '<div class="nsn">' + escapeHtml(it.nsn) + '</div>';
      html += '<button class="sel-remove-btn" data-nsn="' + escapeAttr(it.nsn) + '" data-desc="' + escapeAttr(it.description) + '">Remove</button>';
      html += '</div>';
      html += '<div class="desc">' + escapeHtml(it.description || "\u2014") + '</div>';
      html += '<div class="meta">';
      html += '<span><span class="label">UoM:</span> ' + escapeHtml(it.uom || "\u2014") + '</span>';
      html += '<span><span class="label">Qty:</span> ' + escapeHtml(it.qty || "\u2014") + '</span>';
      html += '</div>';
      if (it.kits) {
        html += '<div class="kits"><span class="label">Kits:</span> ' + escapeHtml(it.kits) + '</div>';
      }
      html += '</div>';
    }
    selList.innerHTML = html;
  }

  function csvField(val) {
    if (!val) return '""';
    if (val.indexOf(",") !== -1 || val.indexOf('"') !== -1 || val.indexOf(";") !== -1 || val.indexOf("\n") !== -1) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  function exportCSV() {
    if (selectedItems.length === 0) return;
    var lines = ["NSN,Description,Unit of Measure,Quantity Required,Kit Membership"];
    for (var i = 0; i < selectedItems.length; i++) {
      var it = selectedItems[i];
      lines.push(
        csvField(it.nsn) + "," +
        csvField(it.description) + "," +
        csvField(it.uom) + "," +
        csvField(it.qty) + "," +
        csvField(it.kits)
      );
    }
    var csv = lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    var fname = "selected_items_" +
      now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
      "_" + pad(now.getHours()) + pad(now.getMinutes()) + ".csv";
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* Selection event: Add/Added buttons in main list */
  listEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".sel-add-btn");
    if (btn) {
      e.stopPropagation();
      toggleSelect(btn.getAttribute("data-nsn"));
    }
  });

  /* Drawer events */
  selectedBtn.addEventListener("click", openDrawer);
  selClose.addEventListener("click", closeDrawer);
  selOverlay.addEventListener("click", closeDrawer);
  selExport.addEventListener("click", exportCSV);
  selClear.addEventListener("click", function () {
    selectedItems = [];
    updateSelectedCount();
    renderDrawer();
    render();
  });
  selList.addEventListener("click", function (e) {
    var btn = e.target.closest(".sel-remove-btn");
    if (btn) {
      removeSelected(btn.getAttribute("data-nsn"), btn.getAttribute("data-desc"));
      render(); // refresh main list button states
    }
  });

  /* ── Init ── */
  loadData();
})();
