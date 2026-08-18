// ---------- Supabase client ----------
const { url, anonKey } = window.SUPABASE_CONFIG || {};
let sb = null;
if (url && anonKey && url !== "YOUR_SUPABASE_PROJECT_URL") {
  sb = window.supabase.createClient(url, anonKey);
} else {
  console.warn("Supabase not configured yet — edit config.js with your project URL and anon key.");
}

const saveDot = document.getElementById("saveDot");
const saveText = document.getElementById("saveText");

function setSaveState(state) {
  saveDot.className = "save-dot" + (state === "saving" ? " saving" : state === "error" ? " error" : "");
  saveText.textContent =
    state === "saving" ? "Saving…" :
    state === "error" ? "Couldn't save — check connection" :
    "Synced";
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- Goal rings ----------
const GOAL_DEFS = [
  { id: "lives", label: "Lives", format: (v) => Math.round(v).toLocaleString() },
  { id: "new_clients", label: "New Clients", format: (v) => Math.round(v).toLocaleString() },
  { id: "premium", label: "Premium", format: (v) => "$" + Math.round(v).toLocaleString() },
  { id: "points", label: "Points", format: (v) => Math.round(v).toLocaleString() },
];

let goalsState = {}; // id -> { current_value, goal_value }

function renderRings() {
  const container = document.getElementById("rings");
  container.innerHTML = "";
  GOAL_DEFS.forEach((def) => {
    const g = goalsState[def.id] || { current_value: 0, goal_value: 0 };
    const pct = g.goal_value > 0 ? Math.min(g.current_value / g.goal_value, 1) : 0;
    const r = 54;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - pct);
    const complete = pct >= 1;

    const card = document.createElement("div");
    card.className = "ring-card";
    card.innerHTML = `
      <div class="ring-label">${def.label}</div>
      <svg class="ring-svg" viewBox="0 0 128 128">
        <circle class="ring-track" cx="64" cy="64" r="${r}"></circle>
        <circle class="ring-progress${complete ? " complete" : ""}" cx="64" cy="64" r="${r}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
        <text x="64" y="60" text-anchor="middle" class="ring-center" fill="var(--ink)"
          font-family="Fraunces, serif" font-size="20" font-weight="600">${Math.round(pct * 100)}%</text>
        <text x="64" y="76" text-anchor="middle" class="ring-center-sub" fill="#8A968F" font-size="10">OF GOAL</text>
      </svg>
      <div class="ring-inputs">
        <input type="number" step="any" value="${g.current_value}" data-goal="${def.id}" data-field="current_value" aria-label="${def.label} current">
        <span>/</span>
        <input type="number" step="any" value="${g.goal_value}" data-goal="${def.id}" data-field="goal_value" aria-label="${def.label} goal">
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const id = e.target.dataset.goal;
      const field = e.target.dataset.field;
      const value = parseFloat(e.target.value) || 0;
      goalsState[id][field] = value;
      renderRings();
      renderConversion();
      await saveGoal(id);
    });
  });
}

async function saveGoal(id) {
  if (!sb) return;
  setSaveState("saving");
  const g = goalsState[id];
  const { error } = await sb.from("goals").upsert({
    id, current_value: g.current_value, goal_value: g.goal_value, updated_at: new Date().toISOString(),
  });
  setSaveState(error ? "error" : "idle");
}

// ---------- Generic editable table ----------
// config: { tableName, containerId, columns: [{key, label, type, numeric}], computeTotals? }
function makeTableController(config) {
  let rows = [];

  function totalsRow() {
    if (!config.totals) return null;
    const totals = {};
    config.totals.forEach((key) => {
      totals[key] = rows.reduce((sum, r) => sum + (parseFloat(r[key]) || 0), 0);
    });
    return totals;
  }

  function render() {
    const tbody = document.querySelector(`#${config.containerId} tbody`);
    tbody.innerHTML = "";

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      tr.innerHTML = `<td colspan="${config.columns.length + 1}">No rows yet — click "Add row" to start tracking.</td>`;
      tbody.appendChild(tr);
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      const cells = config.columns.map((col) => {
        const val = row[col.key] ?? (col.numeric ? 0 : "");
        if (col.type === "textarea") {
          return `<td><textarea data-key="${col.key}" placeholder="${col.label}">${escapeHtml(val)}</textarea></td>`;
        }
        return `<td class="${col.numeric ? "num" : ""}"><input type="${col.type || "text"}" data-key="${col.key}" value="${escapeAttr(val)}" placeholder="${col.label}"></td>`;
      }).join("");
      tr.innerHTML = cells + `<td class="rowdel"><button class="icon-del" title="Delete row" data-del="${row.id}">✕</button></td>`;
      tbody.appendChild(tr);
    });

    if (config.totals) {
      const t = totalsRow();
      const tfoot = document.querySelector(`#${config.containerId} tfoot`);
      tfoot.innerHTML = "";
      const tr = document.createElement("tr");
      let cells = "";
      config.columns.forEach((col, i) => {
        if (i === 0) cells += `<td>Totals</td>`;
        else if (config.totals.includes(col.key)) cells += `<td class="num">${(t[col.key] || 0).toLocaleString()}</td>`;
        else cells += `<td></td>`;
      });
      tr.innerHTML = cells + `<td></td>`;
      tfoot.appendChild(tr);
    }

    document.querySelector(`#${config.containerId} .count`).textContent = `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`;

    tbody.querySelectorAll("input, textarea").forEach((el) => {
      el.addEventListener("input", debounce(async (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.id;
        const key = e.target.dataset.key;
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        row[key] = e.target.value;
        if (config.totals && config.totals.includes(key)) render();
        if (config.onChange) config.onChange();
        await saveRow(id);
      }, 500));
    });

    tbody.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        rows = rows.filter((r) => r.id !== id);
        render();
        if (config.onChange) config.onChange();
        if (sb) {
          setSaveState("saving");
          const { error } = await sb.from(config.tableName).delete().eq("id", id);
          setSaveState(error ? "error" : "idle");
        }
      });
    });
  }

  async function saveRow(id) {
    if (!sb) return;
    setSaveState("saving");
    const row = rows.find((r) => r.id === id);
    const payload = { id, updated_at: new Date().toISOString() };
    config.columns.forEach((col) => {
      payload[col.key] = col.numeric ? (parseFloat(row[col.key]) || 0) : (row[col.key] || null);
    });
    const { error } = await sb.from(config.tableName).upsert(payload);
    setSaveState(error ? "error" : "idle");
  }

  async function addRow() {
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "id-" + Date.now() + Math.random();
    const blank = { id };
    config.columns.forEach((col) => { blank[col.key] = col.numeric ? 0 : ""; });
    rows.push(blank);
    render();
    if (sb) {
      setSaveState("saving");
      const payload = { id };
      config.columns.forEach((col) => { payload[col.key] = col.numeric ? 0 : ""; });
      const { error } = await sb.from(config.tableName).insert(payload);
      setSaveState(error ? "error" : "idle");
    }
  }

  async function load() {
    if (!sb) { render(); return; }
    const { data, error } = await sb.from(config.tableName).select("*").order("created_at", { ascending: true });
    if (!error && data) rows = data;
    render();
  }

  document.getElementById(config.addBtnId).addEventListener("click", addRow);

  return { load, render, getRows: () => rows };
}

function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(v) { return escapeHtml(v); }

// ---------- Table configs ----------
const caseOpenTable = makeTableController({
  tableName: "case_open",
  containerId: "caseOpenTable",
  addBtnId: "addCaseOpen",
  totals: ["lives", "new_clients", "premium", "aum"],
  onChange: () => renderConversion(),
  columns: [
    { key: "client_name", label: "Client name" },
    { key: "lives", label: "Lives", type: "number", numeric: true },
    { key: "new_clients", label: "New clients", type: "number", numeric: true },
    { key: "premium", label: "Premium", type: "number", numeric: true },
    { key: "aum", label: "AUM", type: "number", numeric: true },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
});

const applicationsTable = makeTableController({
  tableName: "applications_submitted",
  containerId: "applicationsTable",
  addBtnId: "addApplication",
  totals: ["lives", "new_clients", "premium", "aum"],
  onChange: () => renderConversion(),
  columns: [
    { key: "client_name", label: "Client name" },
    { key: "lives", label: "Lives", type: "number", numeric: true },
    { key: "new_clients", label: "New clients", type: "number", numeric: true },
    { key: "premium", label: "Premium", type: "number", numeric: true },
    { key: "aum", label: "AUM", type: "number", numeric: true },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
});

const hotListTable = makeTableController({
  tableName: "hot_list",
  containerId: "hotListTable",
  addBtnId: "addHotList",
  columns: [
    { key: "date_opened", label: "Date opened", type: "date" },
    { key: "client_name", label: "Client name" },
    { key: "ff_income", label: "FF income", type: "number", numeric: true },
    { key: "action_date", label: "Action date", type: "date" },
    { key: "lives", label: "Lives", type: "number", numeric: true },
    { key: "new_clients", label: "New clients", type: "number", numeric: true },
    { key: "premium", label: "Premium", type: "number", numeric: true },
    { key: "aum", label: "AUM", type: "number", numeric: true },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
});

// ---------- Conversion & projections (two-stage: open→submitted, submitted→placed) ----------
let overrides = {}; // e.g. 'lives__open_to_submitted' -> number|null
["lives", "new_clients", "premium"].forEach((k) => {
  overrides[`${k}__open_to_submitted`] = null;
  overrides[`${k}__submitted_to_placed`] = null;
});

function sumBy(rows, key) { return rows.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0); }

function placedSums() {
  const placedRows = clientsTable ? clientsTable.getRows().filter((r) => r.status === "In Force") : [];
  return {
    lives: sumBy(placedRows, "lives"),
    new_clients: sumBy(placedRows, "new_clients"),
    premium: sumBy(placedRows, "premium"),
    aum: sumBy(placedRows, "aum"),
  };
}

function renderConversion() {
  const open = caseOpenTable.getRows();
  const applied = applicationsTable.getRows();
  const placed = placedSums();

  ["lives", "new_clients", "premium"].forEach((key) => {
    const openSum = sumBy(open, key);
    const appliedSum = sumBy(applied, key);
    const placedSum = placed[key];

    // Stage 1: Case Open -> Submitted
    const autoRatio1 = openSum > 0 ? appliedSum / openSum : 0;
    const ov1 = overrides[`${key}__open_to_submitted`];
    const ratio1 = ov1 != null ? ov1 / 100 : autoRatio1;
    const projectedClose = openSum * ratio1;

    // Stage 2: Submitted -> Placed
    const autoRatio2 = appliedSum > 0 ? placedSum / appliedSum : 0;
    const ov2 = overrides[`${key}__submitted_to_placed`];
    const ratio2 = ov2 != null ? ov2 / 100 : autoRatio2;
    const projectedPlaced = openSum * ratio1 * ratio2;

    setText(`conv-open-${key}`, fmt(key, openSum));
    setText(`conv-applied-${key}`, fmt(key, appliedSum));
    setText(`conv-ratio-${key}`, (ratio1 * 100).toFixed(0) + "%");
    setPlaceholder(`conv-override-${key}`, ov1, autoRatio1);
    setText(`conv-projected-${key}`, fmt(key, projectedClose));

    setText(`conv-applied2-${key}`, fmt(key, appliedSum));
    setText(`conv-placed-${key}`, fmt(key, placedSum));
    setText(`conv-ratio2-${key}`, (ratio2 * 100).toFixed(0) + "%");
    setPlaceholder(`conv-override2-${key}`, ov2, autoRatio2);
    setText(`conv-projected-placed-${key}`, fmt(key, projectedPlaced));
  });
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setPlaceholder(id, overrideVal, autoRatio) {
  const el = document.getElementById(id);
  if (el && overrideVal == null && document.activeElement !== el) el.placeholder = (autoRatio * 100).toFixed(0);
}

function fmt(key, val) {
  if (key === "premium") return "$" + Math.round(val).toLocaleString();
  return Math.round(val).toLocaleString();
}

document.querySelectorAll("[data-override]").forEach((input) => {
  input.addEventListener("input", debounce(async (e) => {
    const key = e.target.dataset.override;
    const raw = e.target.value;
    overrides[key] = raw === "" ? null : parseFloat(raw);
    renderConversion();
    if (sb) {
      setSaveState("saving");
      const { error } = await sb.from("conversion_settings").upsert({
        id: key, close_rate_override: overrides[key], updated_at: new Date().toISOString(),
      });
      setSaveState(error ? "error" : "idle");
    }
  }, 500));
});

// ---------- Auto-calc goal circles from clients marked "In Force" ----------
async function recalcFromClients() {
  const placed = placedSums();
  ["lives", "new_clients", "premium"].forEach((key) => {
    if (!goalsState[key]) goalsState[key] = { current_value: 0, goal_value: 0 };
    goalsState[key].current_value = placed[key];
  });
  renderRings();
  renderConversion();
  if (sb) {
    setSaveState("saving");
    const rows = ["lives", "new_clients", "premium"].map((key) => ({
      id: key, current_value: goalsState[key].current_value, goal_value: goalsState[key].goal_value,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("goals").upsert(rows);
    setSaveState(error ? "error" : "idle");
  }
}

// ---------- Source options (editable, color-coded) ----------
const DEFAULT_SOURCE_COLORS = ["#0A66C2", "#C9A227", "#1F6F5C", "#C0432D", "#7C5CBF", "#3D8FB0"];
let sourceOptions = [
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2" },
  { id: "event", label: "Event", color: "#C9A227" },
  { id: "referral", label: "Referral", color: "#1F6F5C" },
];

function sourceColor(label) {
  const found = sourceOptions.find((s) => s.label === label);
  return found ? found.color : "#8A968F";
}

async function loadSourceOptions() {
  if (!sb) { renderSourceManager(); return; }
  const { data } = await sb.from("source_options").select("*").order("sort_order", { ascending: true });
  if (data && data.length) sourceOptions = data;
  renderSourceManager();
}

function renderSourceManager() {
  const el = document.getElementById("sourceManager");
  el.innerHTML = "";
  sourceOptions.forEach((s) => {
    const chip = document.createElement("span");
    chip.className = "source-chip";
    chip.style.background = s.color;
    chip.innerHTML = `${escapeHtml(s.label)} <button data-remove-source="${s.id}" title="Remove option">✕</button>`;
    el.appendChild(chip);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "btn-add-source";
  addBtn.textContent = "+ Add source";
  addBtn.addEventListener("click", async () => {
    const label = prompt("New source name (e.g. an event name):");
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || ("src-" + Date.now());
    const color = DEFAULT_SOURCE_COLORS[sourceOptions.length % DEFAULT_SOURCE_COLORS.length];
    sourceOptions.push({ id, label, color, sort_order: sourceOptions.length + 1 });
    renderSourceManager();
    clientsTable.render();
    if (sb) {
      setSaveState("saving");
      const { error } = await sb.from("source_options").upsert({ id, label, color, sort_order: sourceOptions.length });
      setSaveState(error ? "error" : "idle");
    }
  });
  el.appendChild(addBtn);

  el.querySelectorAll("[data-remove-source]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.removeSource;
      sourceOptions = sourceOptions.filter((s) => s.id !== id);
      renderSourceManager();
      clientsTable.render();
      if (sb) {
        setSaveState("saving");
        const { error } = await sb.from("source_options").delete().eq("id", id);
        setSaveState(error ? "error" : "idle");
      }
    });
  });
}

// ---------- Status stages (fixed pipeline, color-coded) ----------
const STATUS_STAGES = [
  { id: "Fact Finder Complete", color: "#8A968F" },
  { id: 'Said "Yes"', color: "#5B8DEF" },
  { id: "Submitted an App", color: "#C9A227" },
  { id: "Waiting for Medical", color: "#E08E45" },
  { id: "In Underwriting", color: "#1F6F5C" },
  { id: "In Force", color: "#16413B" },
];
function statusColor(status) {
  const found = STATUS_STAGES.find((s) => s.id === status);
  return found ? found.color : "#8A968F";
}

// ---------- Current Clients table (custom controller: has select dropdowns) ----------
let clientsTable = null;

function makeClientsController() {
  let rows = [];

  function render() {
    const tbody = document.getElementById("clientsTbody");
    tbody.innerHTML = "";

    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No clients yet — click "Add client" to start tracking.</td></tr>`;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      const sourceOpts = sourceOptions.map((s) =>
        `<option value="${escapeAttr(s.label)}" ${row.source === s.label ? "selected" : ""}>${escapeHtml(s.label)}</option>`
      ).join("");
      const statusOpts = STATUS_STAGES.map((s) =>
        `<option value="${escapeAttr(s.id)}" ${row.status === s.id ? "selected" : ""}>${escapeHtml(s.id)}</option>`
      ).join("");

      tr.innerHTML = `
        <td><input type="text" data-key="client_name" value="${escapeAttr(row.client_name)}" placeholder="Client name"></td>
        <td class="source-cell"><div class="badge-select-wrap"><select class="badge-select" data-key="source" style="background-color:${sourceColor(row.source)}">
          <option value="" ${!row.source ? "selected" : ""}>—</option>${sourceOpts}
        </select></div></td>
        <td class="num"><input type="number" step="any" data-key="lives" value="${escapeAttr(row.lives)}"></td>
        <td class="num"><input type="number" step="any" data-key="new_clients" value="${escapeAttr(row.new_clients)}"></td>
        <td class="num"><input type="number" step="any" data-key="premium" value="${escapeAttr(row.premium)}"></td>
        <td class="num"><input type="number" step="any" data-key="aum" value="${escapeAttr(row.aum)}"></td>
        <td class="status-cell"><div class="badge-select-wrap"><select class="badge-select" data-key="status" style="background-color:${statusColor(row.status)}">
          ${statusOpts}
        </select></div></td>
        <td><input type="date" data-key="date_added" value="${escapeAttr(row.date_added || "")}"></td>
        <td><textarea data-key="notes" placeholder="Notes">${escapeHtml(row.notes)}</textarea></td>
        <td class="rowdel"><button class="icon-del" title="Delete client" data-del="${row.id}">✕</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("clientsCount").textContent = `${rows.length} ${rows.length === 1 ? "client" : "clients"}`;

    tbody.querySelectorAll("select[data-key]").forEach((el) => {
      el.addEventListener("change", async (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.id;
        const key = e.target.dataset.key;
        const row = rows.find((r) => r.id === id);
        row[key] = e.target.value;
        render();
        await saveClientRow(id);
        await recalcFromClients();
      });
    });

    tbody.querySelectorAll("input[data-key], textarea[data-key]").forEach((el) => {
      el.addEventListener("input", debounce(async (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.id;
        const key = e.target.dataset.key;
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        row[key] = e.target.value;
        await saveClientRow(id);
        if (["lives", "new_clients", "premium"].includes(key)) await recalcFromClients();
      }, 500));
    });

    tbody.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        rows = rows.filter((r) => r.id !== id);
        render();
        await recalcFromClients();
        if (sb) {
          setSaveState("saving");
          const { error } = await sb.from("clients").delete().eq("id", id);
          setSaveState(error ? "error" : "idle");
        }
      });
    });
  }

  async function saveClientRow(id) {
    if (!sb) return;
    setSaveState("saving");
    const row = rows.find((r) => r.id === id);
    const payload = {
      id,
      client_name: row.client_name || "",
      source: row.source || "",
      lives: parseFloat(row.lives) || 0,
      new_clients: parseFloat(row.new_clients) || 0,
      premium: parseFloat(row.premium) || 0,
      aum: parseFloat(row.aum) || 0,
      status: row.status || "Fact Finder Complete",
      notes: row.notes || "",
      date_added: row.date_added || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("clients").upsert(payload);
    setSaveState(error ? "error" : "idle");
  }

  async function addClient() {
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "id-" + Date.now() + Math.random();
    const today = new Date().toISOString().slice(0, 10);
    rows.push({
      id, client_name: "", source: "", lives: 1, new_clients: 1, premium: 0, aum: 0,
      status: "Fact Finder Complete", notes: "", date_added: today,
    });
    render();
    if (sb) {
      setSaveState("saving");
      const { error } = await sb.from("clients").insert({
        id, client_name: "", source: "", lives: 1, new_clients: 1, premium: 0, aum: 0,
        status: "Fact Finder Complete", notes: "", date_added: today,
      });
      setSaveState(error ? "error" : "idle");
    }
  }

  async function load() {
    if (!sb) { render(); return; }
    const { data, error } = await sb.from("clients").select("*").order("created_at", { ascending: true });
    if (!error && data) rows = data;
    render();
  }

  document.getElementById("addClient").addEventListener("click", addClient);

  return { load, render, getRows: () => rows };
}

// ---------- Init ----------
async function init() {
  document.getElementById("lastUpdated").textContent = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // Load goals
  if (sb) {
    const { data } = await sb.from("goals").select("*");
    if (data) {
      data.forEach((g) => { goalsState[g.id] = { current_value: g.current_value, goal_value: g.goal_value }; });
    }
    const { data: convData } = await sb.from("conversion_settings").select("*");
    if (convData) {
      convData.forEach((c) => {
        overrides[c.id] = c.close_rate_override;
        const el = document.getElementById(`conv-override-${c.id.replace("__open_to_submitted", "")}`);
        const el2 = document.getElementById(`conv-override2-${c.id.replace("__submitted_to_placed", "")}`);
        if (c.id.endsWith("__open_to_submitted") && el && c.close_rate_override != null) el.value = c.close_rate_override;
        if (c.id.endsWith("__submitted_to_placed") && el2 && c.close_rate_override != null) el2.value = c.close_rate_override;
      });
    }
  }
  // Fill defaults for any goal not yet in Supabase (or when running unconfigured)
  const defaults = { lives: 75, new_clients: 48, premium: 150000, points: 250000 };
  GOAL_DEFS.forEach((def) => {
    if (!goalsState[def.id]) goalsState[def.id] = { current_value: 0, goal_value: defaults[def.id] };
  });

  renderRings();
  await caseOpenTable.load();
  await applicationsTable.load();
  await hotListTable.load();
  await loadSourceOptions();
  clientsTable = makeClientsController();
  await clientsTable.load();
  await recalcFromClients(); // sets Lives/New Clients/Premium current values from any In Force clients
  renderConversion();
  setSaveState(sb ? "idle" : "error");
  if (!sb) saveText.textContent = "Not connected — add your Supabase details in config.js";
}

init();
