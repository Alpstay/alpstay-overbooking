import { esc } from "./util";

declare const XLSX: {
  utils: { aoa_to_sheet(a: unknown[][]): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void };
  write(wb: unknown, o: Record<string, unknown>): ArrayBuffer;
};

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null;     // per ordinamento, filtro, export
  render?: (row: T) => string;                   // HTML cella
  filter?: boolean;                              // filtro a tendina
  align?: "right" | "center";
  width?: string;
}

export interface TableState {
  q: string;
  sortKey: string | null;
  sortDir: 1 | -1;
  page: number;
  filters: Record<string, string>;
}

const states = new Map<string, TableState>();

export function tableState(id: string, defaultSort: string | null = null, dir: 1 | -1 = 1): TableState {
  let s = states.get(id);
  if (!s) { s = { q: "", sortKey: defaultSort, sortDir: dir, page: 0, filters: {} }; states.set(id, s); }
  return s;
}

export interface TableDef<T> {
  id: string;
  columns: Column<T>[];
  rows: T[];
  pageSize?: number;
  exportName: string;
  rowClass?: (row: T) => string;
  empty: string;
}

const registry = new Map<string, TableDef<unknown>>();

function filtered<T>(def: TableDef<T>): T[] {
  const st = tableState(def.id);
  const q = st.q.trim().toLowerCase();
  let rows = def.rows.filter((r) => {
    for (const [k, v] of Object.entries(st.filters)) {
      if (!v) continue;
      const col = def.columns.find((c) => c.key === k);
      if (col && String(col.value(r) ?? "") !== v) return false;
    }
    if (!q) return true;
    return def.columns.some((c) => String(c.value(r) ?? "").toLowerCase().includes(q));
  });
  if (st.sortKey) {
    const col = def.columns.find((c) => c.key === st.sortKey);
    if (col) {
      rows = [...rows].sort((a, b) => {
        const x = col.value(a), y = col.value(b);
        if (x === y) return 0;
        if (x === null || x === "") return 1;
        if (y === null || y === "") return -1;
        return (x < y ? -1 : 1) * st.sortDir;
      });
    }
  }
  return rows;
}

export function renderTable<T>(def: TableDef<T>): string {
  registry.set(def.id, def as TableDef<unknown>);
  const st = tableState(def.id);
  const size = def.pageSize ?? 25;
  const rows = filtered(def);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  if (st.page >= pages) st.page = pages - 1;
  const slice = rows.slice(st.page * size, (st.page + 1) * size);

  const filterCols = def.columns.filter((c) => c.filter);
  const filters = filterCols
    .map((c) => {
      const vals = [...new Set(def.rows.map((r) => String(c.value(r) ?? "")))].filter(Boolean).sort();
      const cur = st.filters[c.key] ?? "";
      return `<label class="tf"><span>${esc(c.label)}</span><select data-tfilter="${def.id}" data-col="${c.key}"><option value="">Tutti</option>${vals
        .map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`)
        .join("")}</select></label>`;
    })
    .join("");

  const head = def.columns
    .map((c) => {
      const on = st.sortKey === c.key;
      return `<th class="${c.align ?? ""}" ${c.width ? `style="width:${c.width}"` : ""}><button class="th" data-tsort="${def.id}" data-col="${c.key}" aria-sort="${on ? (st.sortDir > 0 ? "ascending" : "descending") : "none"}">${esc(c.label)}<i>${on ? (st.sortDir > 0 ? "▲" : "▼") : ""}</i></button></th>`;
    })
    .join("");

  const body = slice.length
    ? slice
        .map((r) => `<tr class="${def.rowClass ? def.rowClass(r) : ""}">${def.columns.map((c) => `<td class="${c.align ?? ""}" data-label="${esc(c.label)}">${c.render ? c.render(r) : esc(c.value(r) ?? "")}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td class="empty" colspan="${def.columns.length}">${esc(def.empty)}</td></tr>`;

  return `<div class="tbl" id="tbl-${def.id}">
    <div class="tbar">
      <input type="search" placeholder="Cerca" value="${esc(st.q)}" data-tsearch="${def.id}" aria-label="Cerca nella tabella">
      ${filters}
      <span class="grow"></span>
      <span class="muted">${rows.length} righe</span>
      <button class="btn ghost sm" data-texport="${def.id}" data-fmt="xlsx">Excel</button>
      <button class="btn ghost sm" data-texport="${def.id}" data-fmt="csv">CSV</button>
    </div>
    <div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${pages > 1 ? `<div class="pager"><button class="btn ghost sm" data-tpage="${def.id}" data-to="${st.page - 1}" ${st.page === 0 ? "disabled" : ""}>Precedente</button><span>Pagina ${st.page + 1} di ${pages}</span><button class="btn ghost sm" data-tpage="${def.id}" data-to="${st.page + 1}" ${st.page >= pages - 1 ? "disabled" : ""}>Successiva</button></div>` : ""}
  </div>`;
}

export function rerenderTable(id: string): void {
  const def = registry.get(id);
  const el = document.getElementById(`tbl-${id}`);
  if (!def || !el) return;
  const focusSearch = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.tsearch === id;
  const pos = focusSearch ? (document.activeElement as HTMLInputElement).selectionStart : null;
  el.outerHTML = renderTable(def);
  if (focusSearch) {
    const inp = document.querySelector<HTMLInputElement>(`[data-tsearch="${id}"]`);
    if (inp) { inp.focus(); if (pos !== null) inp.setSelectionRange(pos, pos); }
  }
}

export function exportTable(id: string, fmt: "csv" | "xlsx"): { name: string; blob: Blob } | null {
  const def = registry.get(id);
  if (!def) return null;
  const rows = filtered(def);
  const aoa: unknown[][] = [def.columns.map((c) => c.label), ...rows.map((r) => def.columns.map((c) => c.value(r) ?? ""))];
  if (fmt === "csv") {
    const csv = aoa.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    return { name: `${def.exportName}.csv`, blob: new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }) };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Dati");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return { name: `${def.exportName}.xlsx`, blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
}

/** Collega gli eventi delle tabelle (delegation sul root). */
export function bindTables(root: HTMLElement, onExport: (id: string, fmt: "csv" | "xlsx") => void): void {
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.dataset.tsearch) {
      const st = tableState(t.dataset.tsearch);
      st.q = t.value;
      st.page = 0;
      rerenderTable(t.dataset.tsearch);
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement && t.dataset.tfilter) {
      const st = tableState(t.dataset.tfilter);
      st.filters[t.dataset.col!] = t.value;
      st.page = 0;
      rerenderTable(t.dataset.tfilter);
    }
  });
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tsort],[data-tpage],[data-texport]");
    if (!b) return;
    if (b.dataset.tsort) {
      const st = tableState(b.dataset.tsort);
      if (st.sortKey === b.dataset.col) st.sortDir = st.sortDir > 0 ? -1 : 1;
      else { st.sortKey = b.dataset.col!; st.sortDir = 1; }
      rerenderTable(b.dataset.tsort);
    } else if (b.dataset.tpage) {
      tableState(b.dataset.tpage).page = Number(b.dataset.to);
      rerenderTable(b.dataset.tpage);
    } else if (b.dataset.texport) {
      onExport(b.dataset.texport, b.dataset.fmt as "csv" | "xlsx");
    }
  });
}
