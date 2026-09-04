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
    const complete = pct >= 1;

    let arcSvg;
    if (def.id === "premium") {
      // 3-segment arc: DI, Life, LTC — each sized by its share of the total,
      // scaled so the combined arc still represents current/goal overall.
      const placed = placedSums();
      const total = placed.di_premium + placed.life_premium + placed.ltc_premium;
      const propDI = total > 0 ? placed.di_premium / total : 0;
      const propLife = total > 0 ? placed.life_premium / total : 0;
      const propLTC = total > 0 ? placed.ltc_premium / total : 0;
      const lenDI = pct * propDI * circumference;
      const lenLife = pct * propLife * circumference;
      const lenLTC = pct * propLTC * circumference;
      arcSvg = `
        <circle class="ring-track" cx="64" cy="64" r="${r}"></circle>
        <circle cx="64" cy="64" r="${r}" fill="none" stroke="#1F6F5C" stroke-width="10" stroke-linecap="round"
          transform="rotate(-90 64 64)"
          stroke-dasharray="${lenDI} ${circumference - lenDI}" stroke-dashoffset="0"></circle>
        <circle cx="64" cy="64" r="${r}" fill="none" stroke="#C9A227" stroke-width="10" stroke-linecap="round"
          transform="rotate(-90 64 64)"
          stroke-dasharray="${lenLife} ${circumference - lenLife}" stroke-dashoffset="${-lenDI}"></circle>
        <circle cx="64" cy="64" r="${r}" fill="none" stroke="#C0432D" stroke-width="10" stroke-linecap="round"
          transform="rotate(-90 64 64)"
          stroke-dasharray="${lenLTC} ${circumference - lenLTC}" stroke-dashoffset="${-(lenDI + lenLife)}"></circle>
      `;
    } else {
      const offset = circumference * (1 - pct);
      arcSvg = `
        <circle class="ring-track" cx="64" cy="64" r="${r}"></circle>
        <circle class="ring-progress${complete ? " complete" : ""}" cx="64" cy="64" r="${r}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
      `;
    }

    const card = document.createElement("div");
    card.className = "ring-card";
    card.innerHTML = `
      <div class="ring-label">${def.label}</div>
      <svg class="ring-svg" viewBox="0 0 128 128">
        ${arcSvg}
        <text x="64" y="60" text-anchor="middle" class="ring-center" fill="var(--ink)"
          font-family="Fraunces, serif" font-size="20" font-weight="600">${Math.round(pct * 100)}%</text>
        <text x="64" y="76" text-anchor="middle" class="ring-center-sub" fill="#8A968F" font-size="10">OF GOAL</text>
      </svg>
      <div class="ring-inputs">
        <input type="number" step="any" value="${g.current_value}" data-goal="${def.id}" data-field="current_value" aria-label="${def.label} current">
        <span>/</span>
        <input type="number" step="any" value="${g.goal_value}" data-goal="${def.id}" data-field="goal_value" aria-label="${def.label} goal">
      </div>
      ${def.id === "premium" ? `<div class="premium-subtotals" id="premiumSubtotals"></div>` : ""}
    `;
    container.appendChild(card);
  });

  renderPremiumSubtotals();

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
  const def = GOAL_DEFS.find((d) => d.id === id);
  const { error } = await sb.from("goals").upsert({
    id, label: def ? def.label : id, current_value: g.current_value, goal_value: g.goal_value, updated_at: new Date().toISOString(),
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

// Sums Lives/New Clients/DI/Life/LTC/AUM for a set of client rows, plus a
// combined "premium" = DI + Life + LTC (used everywhere premium totals show).
function sumClientRows(rows) {
  const diSum = sumBy(rows, "di_premium");
  const lifeSum = sumBy(rows, "life_premium");
  const ltcSum = sumBy(rows, "ltc_premium");
  return {
    lives: sumBy(rows, "lives"),
    new_clients: sumBy(rows, "new_clients"),
    di_premium: diSum,
    life_premium: lifeSum,
    ltc_premium: ltcSum,
    premium: diSum + lifeSum + ltcSum,
    aum: sumBy(rows, "aum"),
  };
}

function clientStatusSums(status) {
  const rows = clientsTable ? clientsTable.getRows().filter((r) => r.status === status) : [];
  return sumClientRows(rows);
}
function placedSums() { return clientStatusSums("In Force"); }

function renderPremiumSubtotals() {
  const el = document.getElementById("premiumSubtotals");
  if (!el) return;
  const p = placedSums();
  el.innerHTML = `
    <span><span class="swatch" style="background:#1F6F5C"></span>DI: <b>$${Math.round(p.di_premium).toLocaleString()}</b></span>
    <span><span class="swatch" style="background:#C9A227"></span>Life: <b>$${Math.round(p.life_premium).toLocaleString()}</b></span>
    <span><span class="swatch" style="background:#C0432D"></span>LTC: <b>$${Math.round(p.ltc_premium).toLocaleString()}</b></span>
  `;
}

// Sums clients across several statuses at once — used for the "Submitted an
// App" stat card, which should include anyone who's gotten at least that far
// (Submitted an App, Waiting for Medical, In Underwriting) even if they've
// since moved further along, right up until In Force or Approved as Other.
function clientStatusSumsAny(statuses) {
  const rows = clientsTable ? clientsTable.getRows().filter((r) => statuses.includes(r.status)) : [];
  return sumClientRows(rows);
}

function renderStatCards() {
  const yes = clientStatusSums('Said "Yes"');
  const app = clientStatusSumsAny(["Submitted an App", "Waiting for Medical", "In Underwriting"]);
  setText("stat-said-yes-lives", Math.round(yes.lives).toLocaleString());
  setText("stat-said-yes-new_clients", Math.round(yes.new_clients).toLocaleString());
  setText("stat-said-yes-premium", "$" + Math.round(yes.premium).toLocaleString());
  setText("stat-submitted-app-lives", Math.round(app.lives).toLocaleString());
  setText("stat-submitted-app-new_clients", Math.round(app.new_clients).toLocaleString());
  setText("stat-submitted-app-premium", "$" + Math.round(app.premium).toLocaleString());
}

function renderConversion() {
  // Each stage counts everyone who reached AT LEAST that point in the
  // pipeline, not just clients sitting at that exact status today — so
  // someone who has since moved to Waiting for Medical or In Force still
  // counts toward "Said Yes" and "Submitted an App" totals. "Approved as
  // Other" is a separate outcome and is excluded from this funnel entirely.
  const open = clientStatusSumsAny(['Said "Yes"', "Submitted an App", "Waiting for Medical", "In Underwriting", "In Force"]);
  const applied = clientStatusSumsAny(["Submitted an App", "Waiting for Medical", "In Underwriting", "In Force"]);
  const placed = placedSums();             // status === "In Force"

  ["lives", "new_clients", "premium"].forEach((key) => {
    const openSum = open[key];
    const appliedSum = applied[key];
    const placedSum = placed[key];

    // Stage 1: Said Yes -> Submitted
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
  renderStatCards();
  if (sb) {
    setSaveState("saving");
    const rows = ["lives", "new_clients", "premium"].map((key) => {
      const def = GOAL_DEFS.find((d) => d.id === key);
      return {
        id: key, label: def ? def.label : key,
        current_value: goalsState[key].current_value, goal_value: goalsState[key].goal_value,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await sb.from("goals").upsert(rows);
    setSaveState(error ? "error" : "idle");
  }
}

// ---------- Source options (editable, color-coded) ----------
// Shared palette + picker for any editable color-coded list (Source,
// Advisory Accounts, Investments). Always returns a color not already in
// use by that list, so deleting and re-adding options never causes a repeat
// — and if the whole palette is ever exhausted, it generates a new distinct
// color instead of wrapping back to the start.
const COLOR_PALETTE = [
  "#0A66C2", "#C9A227", "#1F6F5C", "#C0432D", "#7C5CBF", "#3D8FB0",
  "#E08E45", "#5B8DEF", "#2E9E83", "#B5507C", "#6B8E23", "#8E6B4F",
];
function pickDistinctColor(existingList) {
  const used = new Set(existingList.map((o) => o.color));
  const free = COLOR_PALETTE.find((c) => !used.has(c));
  if (free) return free;
  const hue = (existingList.length * 137.508) % 360; // golden-angle rotation — stays visually distinct indefinitely
  return `hsl(${hue.toFixed(0)}, 60%, 45%)`;
}

const DEFAULT_SOURCE_COLORS = COLOR_PALETTE;
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
    const color = pickDistinctColor(sourceOptions);
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

// ---------- Multi-select option lists (Advisory Accounts / Investments) ----------

let advisoryOptions = [
  { id: "roth-ira", label: "Roth IRA", color: "#0A66C2" },
  { id: "trad-ira", label: "Traditional IRA", color: "#C9A227" },
  { id: "brokerage", label: "Brokerage", color: "#1F6F5C" },
];
let investmentOptions = [
  { id: "mutual-funds", label: "Mutual Funds", color: "#7C5CBF" },
  { id: "stocks", label: "Stocks", color: "#3D8FB0" },
  { id: "bonds", label: "Bonds", color: "#C0432D" },
  { id: "annuities", label: "Annuities", color: "#C9A227" },
];

async function loadMultiOptions() {
  if (!sb) return;
  const { data: adv } = await sb.from("advisory_account_options").select("*").order("sort_order", { ascending: true });
  if (adv && adv.length) advisoryOptions = adv;
  const { data: inv } = await sb.from("investment_options").select("*").order("sort_order", { ascending: true });
  if (inv && inv.length) investmentOptions = inv;
}

function multiColor(list, label) {
  const found = list.find((o) => o.label === label);
  return found ? found.color : "#8A968F";
}

// Renders a <details>-based multi-select cell. `list` is the current option
// array (advisoryOptions or investmentOptions), `selected` is the row's
// current array of labels, `tableName` is the Supabase table for new options.
function renderMultiCell(list, selected, key, rowId, tableName) {
  const tags = (selected || []).map((label) =>
    `<span class="multi-tag" style="background:${multiColor(list, label)}">${escapeHtml(label)}</span>`
  ).join("");
  const checkboxes = list.map((o) => `
    <label>
      <input type="checkbox" data-multi-key="${key}" data-multi-value="${escapeAttr(o.label)}" ${(selected || []).includes(o.label) ? "checked" : ""}>
      ${escapeHtml(o.label)}
    </label>
  `).join("");
  return `
    <details class="multi-picker" data-row="${rowId}" data-key="${key}" data-table="${tableName}">
      <summary>${tags || `<span class="multi-placeholder">— select —</span>`}</summary>
      <div class="multi-panel">
        ${checkboxes}
        <button type="button" class="multi-panel-add" data-multi-add="${key}">+ Add option</button>
      </div>
    </details>
  `;
}

function reopenPicker(rowId, key) {
  const details = document.querySelector(`details.multi-picker[data-row="${rowId}"][data-key="${key}"]`);
  if (details) details.open = true;
}

// Close any open multi-select picker when clicking outside it. Uses
// mousedown (fires before our click handlers re-render the row) so the
// element references here are still attached to the DOM and accurate.
document.addEventListener("mousedown", (e) => {
  document.querySelectorAll("details.multi-picker[open]").forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});

// ---------- Status stages (fixed pipeline, color-coded) ----------
const STATUS_STAGES = [
  { id: "Fact Finder Complete", color: "#8A968F" },
  { id: 'Said "Yes"', color: "#5B8DEF" },
  { id: "Submitted an App", color: "#C9A227" },
  { id: "Waiting for Medical", color: "#E08E45" },
  { id: "In Underwriting", color: "#1F6F5C" },
  { id: "In Force", color: "#16413B" },
  { id: "Approved as Other", color: "#7C5CBF" },
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
      tbody.innerHTML = `<tr class="empty-row"><td colspan="16">No clients yet — click "Add client" to start tracking.</td></tr>`;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      tr.draggable = true;
      const sourceOpts = sourceOptions.map((s) =>
        `<option value="${escapeAttr(s.label)}" ${row.source === s.label ? "selected" : ""}>${escapeHtml(s.label)}</option>`
      ).join("");
      const statusOpts = STATUS_STAGES.map((s) =>
        `<option value="${escapeAttr(s.id)}" ${row.status === s.id ? "selected" : ""}>${escapeHtml(s.id)}</option>`
      ).join("");

      tr.innerHTML = `
        <td class="drag-cell" title="Drag to reorder">⠿</td>
        <td><input type="date" data-key="date_added" value="${escapeAttr(row.date_added || "")}"></td>
        <td><input type="text" data-key="client_name" value="${escapeAttr(row.client_name)}" placeholder="Client name"></td>
        <td><input type="text" data-key="joint_work" value="${escapeAttr(row.joint_work)}" placeholder="Joint work with"></td>
        <td class="source-cell"><div class="badge-select-wrap"><select class="badge-select" data-key="source" style="background-color:${sourceColor(row.source)}">
          <option value="" ${!row.source ? "selected" : ""}>—</option>${sourceOpts}
        </select></div></td>
        <td class="status-cell"><div class="badge-select-wrap"><select class="badge-select" data-key="status" style="background-color:${statusColor(row.status)}">
          ${statusOpts}
        </select></div></td>
        <td class="notes-cell"><textarea data-key="notes" placeholder="Notes">${escapeHtml(row.notes)}</textarea></td>
        <td class="num"><input type="number" step="any" data-key="lives" value="${escapeAttr(row.lives)}"></td>
        <td class="num"><input type="number" step="any" data-key="new_clients" value="${escapeAttr(row.new_clients)}"></td>
        <td class="num"><input type="number" step="any" data-key="life_premium" value="${escapeAttr(row.life_premium)}"></td>
        <td class="num"><input type="number" step="any" data-key="di_premium" value="${escapeAttr(row.di_premium)}"></td>
        <td class="num"><input type="number" step="any" data-key="ltc_premium" value="${escapeAttr(row.ltc_premium)}"></td>
        <td class="num"><input type="number" step="any" data-key="aum" value="${escapeAttr(row.aum)}"></td>
        <td class="multi-cell">${renderMultiCell(advisoryOptions, row.advisory_accounts, "advisory_accounts", row.id, "advisory_account_options")}</td>
        <td class="multi-cell">${renderMultiCell(investmentOptions, row.investments, "investments", row.id, "investment_options")}</td>
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
        if (["lives", "new_clients", "di_premium", "life_premium"].includes(key)) await recalcFromClients();
      }, 500));
    });

    // Multi-select checkboxes (Advisory Accounts / Investments)
    tbody.querySelectorAll("input[data-multi-key]").forEach((el) => {
      el.addEventListener("change", async (e) => {
        const details = e.target.closest("details");
        const id = details.dataset.row;
        const key = details.dataset.key;
        const value = e.target.dataset.multiValue;
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        const current = new Set(row[key] || []);
        if (e.target.checked) current.add(value); else current.delete(value);
        row[key] = Array.from(current);
        render();
        reopenPicker(id, key);
        await saveClientRow(id);
      });
    });

    // "+ Add option" inside a multi-select picker
    tbody.querySelectorAll("[data-multi-add]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const details = e.target.closest("details");
        const id = details.dataset.row;
        const key = details.dataset.key;
        const tableName = details.dataset.table;
        const label = prompt("New option name:");
        if (!label) return;
        const optId = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || ("opt-" + Date.now());
        const list = key === "advisory_accounts" ? advisoryOptions : investmentOptions;
        const color = pickDistinctColor(list);
        list.push({ id: optId, label, color, sort_order: list.length + 1 });
        // auto-select the new option for this row
        const row = rows.find((r) => r.id === id);
        if (row) {
          const current = new Set(row[key] || []);
          current.add(label);
          row[key] = Array.from(current);
        }
        render();
        reopenPicker(id, key);
        await saveClientRow(id);
        if (sb) {
          setSaveState("saving");
          const { error } = await sb.from(tableName).upsert({ id: optId, label, color, sort_order: list.length });
          setSaveState(error ? "error" : "idle");
        }
      });
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

    // Drag-and-drop reordering
    let draggedId = null;
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("dragstart", (e) => {
        draggedId = tr.dataset.id;
        tr.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      tr.addEventListener("dragend", () => {
        tr.classList.remove("dragging");
        tbody.querySelectorAll("tr").forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
      });
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedId || tr.dataset.id === draggedId) return;
        const rect = tr.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        tr.classList.toggle("drag-over-top", before);
        tr.classList.toggle("drag-over-bottom", !before);
      });
      tr.addEventListener("dragleave", () => {
        tr.classList.remove("drag-over-top", "drag-over-bottom");
      });
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        const targetId = tr.dataset.id;
        const before = tr.classList.contains("drag-over-top");
        tr.classList.remove("drag-over-top", "drag-over-bottom");
        if (!draggedId || draggedId === targetId) return;
        const fromIdx = rows.findIndex((r) => r.id === draggedId);
        let toIdx = rows.findIndex((r) => r.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = rows.splice(fromIdx, 1);
        toIdx = rows.findIndex((r) => r.id === targetId); // recompute after removal
        rows.splice(before ? toIdx : toIdx + 1, 0, moved);
        render();
        await persistOrder();
      });
    });
  }

  async function persistOrder() {
    rows.forEach((row, i) => { row.sort_order = i; });
    if (!sb) return;
    setSaveState("saving");
    const results = await Promise.all(
      rows.map((row, i) => sb.from("clients").update({ sort_order: i }).eq("id", row.id))
    );
    const hadError = results.some((r) => r.error);
    setSaveState(hadError ? "error" : "idle");
  }

  async function saveClientRow(id) {
    if (!sb) return;
    setSaveState("saving");
    const row = rows.find((r) => r.id === id);
    const payload = {
      id,
      client_name: row.client_name || "",
      source: row.source || "",
      joint_work: row.joint_work || "",
      lives: parseFloat(row.lives) || 0,
      new_clients: parseFloat(row.new_clients) || 0,
      di_premium: parseFloat(row.di_premium) || 0,
      life_premium: parseFloat(row.life_premium) || 0,
      ltc_premium: parseFloat(row.ltc_premium) || 0,
      aum: parseFloat(row.aum) || 0,
      advisory_accounts: row.advisory_accounts || [],
      investments: row.investments || [],
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
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order || 0)) + 1 : 0;
    const blank = {
      id, client_name: "", source: "", joint_work: "", lives: 1, new_clients: 1,
      di_premium: 0, life_premium: 0, ltc_premium: 0, aum: 0,
      advisory_accounts: [], investments: [],
      status: "Fact Finder Complete", notes: "", date_added: today,
      sort_order: nextOrder,
    };
    rows.push(blank);
    render();
    if (sb) {
      setSaveState("saving");
      const { error } = await sb.from("clients").insert(blank);
      setSaveState(error ? "error" : "idle");
    }
  }

  async function load() {
    if (!sb) { render(); return; }
    const { data, error } = await sb.from("clients").select("*").order("sort_order", { ascending: true, nullsFirst: false });
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
  await hotListTable.load();
  await loadSourceOptions();
  await loadMultiOptions();
  clientsTable = makeClientsController();
  await clientsTable.load();
  await recalcFromClients(); // sets Lives/New Clients/Premium, stat cards, and conversion panel from Current Clients
  renderConversion();
  setSaveState(sb ? "idle" : "error");
  if (!sb) saveText.textContent = "Not connected — add your Supabase details in config.js";
}

init();
