const $ = (selector) => document.querySelector(selector);
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
let config = {};
let driveToken = null;

const financeStateKey = "athubFinanceSafeStateV881";
const financeDefaults = {
  balance: null,
  transactions: [],
  dueActive: {},
  planActive: { emergencyBuffer: true, vacationSavings: true, plannedPaydown: true },
  drive: { clientId: "", autoSync: true },
  lastSyncAt: ""
};

let state = readFinanceState();

function readFinanceState() {
  try {
    return { ...financeDefaults, ...(JSON.parse(localStorage.getItem(financeStateKey) || "{}")) };
  } catch (_) {
    return { ...financeDefaults };
  }
}

function migrateState() {
  state.drive = { ...financeDefaults.drive, ...(state.drive || {}) };
  state.planActive = { ...financeDefaults.planActive, ...(state.planActive || {}) };
  state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
  state.dueActive = state.dueActive || {};
}

async function saveState(syncDrive = true) {
  migrateState();
  localStorage.setItem(financeStateKey, JSON.stringify(state));
  if (syncDrive && state.drive.autoSync && driveToken) {
    await saveFinanceStateToDrive().catch(() => {});
  }
}

function finance881Round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function fmt(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("de-DE");
}

function getFinanceCycle(now = new Date()) {
  const anchor = Number(config.financeCycle?.anchorDay || config.financialMonthStartDay || 15);
  const start = new Date(now.getFullYear(), now.getMonth(), anchor);
  if (now.getDate() < anchor) start.setMonth(start.getMonth() - 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, anchor);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureCycleState() {
  const cycle = getFinanceCycle();
  const dueRows = Array.isArray(config.dues) ? config.dues : [];
  const recurrenceRows = expandRecurrences(cycle);
  const rows = dueRows.concat(recurrenceRows).map((item, index) => ({
    id: item.id || `due_${index}_${item.name || item.title || "item"}`,
    name: item.name || item.title || "Erwartete Abbuchung",
    date: item.date || item.dueDate || cycle.end,
    amount: Math.abs(Number(item.amount || 0)),
    note: item.note || item.category || ""
  }));
  return { cycle, rows };
}

function expandRecurrences(cycle) {
  const items = Array.isArray(config.recurrences) ? config.recurrences : [];
  return items
    .filter((item) => item.active !== false)
    .map((item, index) => ({
      id: item.id || `rec_${index}`,
      name: item.name || item.title || "Fixkosten",
      date: dueDateForCycle(item.day || item.dueDay || 15, cycle),
      amount: Math.abs(Number(item.amount || 0)),
      note: item.note || "wiederkehrend"
    }));
}

function dueDateForCycle(day, cycle) {
  const start = new Date(cycle.start);
  const date = new Date(start.getFullYear(), start.getMonth(), Number(day) || 15);
  if (date < start) date.setMonth(date.getMonth() + 1);
  return toIsoDate(date);
}

function reserveRows() {
  const plan = config.plan || {};
  return [
    ["emergencyBuffer", "Rücklage", Number(plan.emergencyBuffer || 0), "Sicherheitspuffer"],
    ["vacationSavings", "Urlaubssparen", Number(plan.vacationSavings || 0), "privat geplant"],
    ["plannedPaydown", "Dispoabbau-Ziel", Number(plan.plannedPaydown || 0), "Konto entlasten"]
  ].filter((row) => row[2] > 0);
}

function activeReserveSum() {
  return reserveRows().reduce((sum, row) => state.planActive[row[0]] !== false ? sum + row[2] : sum, 0);
}

function finance881RecalculateBalance() {
  if (state.balance == null && config.currentSnapshot?.balance !== undefined) {
    const value = Number(config.currentSnapshot.balance);
    state.balance = Number.isNaN(value) ? null : value;
  }
}

function toggleDue(id) {
  state.dueActive[id] = state.dueActive[id] === false;
  saveState(false);
  render();
}

function togglePlan(id) {
  state.planActive[id] = state.planActive[id] === false ? true : false;
  saveState();
  render();
}

function showTab(id) {
  document.querySelectorAll(".pane").forEach((pane) => pane.classList.toggle("active", pane.id === id));
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
}

function wireFinanceCore() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
  $("#saveBal")?.addEventListener("click", () => {
    const value = Number($("#bal")?.value || 0);
    state.balance = Number.isNaN(value) ? null : finance881Round(value);
    saveState();
    render();
  });
  $("#saveClient")?.addEventListener("click", () => {
    state.drive.clientId = $("#clientId")?.value.trim() || "";
    saveState(false);
    setDriveMessage("Client-ID lokal gespeichert.");
    render();
  });
  $("#connect")?.addEventListener("click", connectDrive);
  $("#sync")?.addEventListener("click", () => saveFinanceStateToDrive().then(() => render()).catch((err) => setDriveMessage(err.message)));
  $("#autoSync")?.addEventListener("change", (event) => {
    state.drive.autoSync = event.target.checked;
    saveState(false);
    render();
  });
  $("#pdf")?.addEventListener("change", () => setPdfMessage("PDF-Import bleibt lokal vorbereitet. Bitte das finale GH-Modul mit dem bestehenden PDF-Kern nutzen, sobald dieser im Zielstand vorhanden ist."));
}

function setPdfMessage(text) {
  const msg = $("#pdfMsg");
  if (msg) msg.textContent = text;
}

function setDriveMessage(text) {
  const msg = $("#driveMsg");
  if (msg) msg.textContent = text;
}

async function connectDrive() {
  if (!state.drive.clientId && $("#clientId")?.value) state.drive.clientId = $("#clientId").value.trim();
  if (!state.drive.clientId) {
    setDriveMessage("Bitte zuerst die Google OAuth Client-ID eintragen.");
    return;
  }
  setDriveMessage("Drive-Zugriff ist vorbereitet. Der Finanz-Tresor nutzt deine private Drive-Datei, sobald der Google-Zugriff im Zielstand verbunden ist.");
  await saveState(false);
  render();
}

async function dfetch(url, options = {}) {
  if (!driveToken) throw new Error("Drive ist noch nicht verbunden.");
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${driveToken}` }
  });
  if (!response.ok) throw new Error("Drive-Anfrage fehlgeschlagen.");
  return response.json();
}

async function saveFinanceStateToDrive() {
  if (!driveToken) throw new Error("Drive ist noch nicht verbunden.");
  state.lastSyncAt = new Date().toISOString();
  await saveState(false);
  setDriveMessage("Finanzdaten wurden lokal gesichert. Drive-Sync ist vorbereitet.");
}

function render() {
  const { cycle, rows } = ensureCycleState();
  finance881RecalculateBalance();
  const open = rows.filter((d) => state.dueActive[d.id] !== false);
  const openSum = open.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reserves = activeReserveSum();
  const forecast = state.balance == null ? null : finance881Round(state.balance - openSum - reserves);

  if ($("#period")) $("#period").textContent = `Finanzmonat ${fmt(cycle.start)} → ${fmt(cycle.end)}`;
  if ($("#current")) $("#current").textContent = state.balance == null ? "fehlt" : euro.format(state.balance);
  if ($("#futureSum")) $("#futureSum").textContent = euro.format(openSum);
  if ($("#reserveSum")) $("#reserveSum").textContent = euro.format(reserves);
  if ($("#forecast")) $("#forecast").textContent = forecast == null ? "Kontostand eingeben" : euro.format(forecast);
  if ($("#forecastText")) $("#forecastText").textContent = forecast == null ? "Bitte aktuellen Kontostand eintragen." : `Kontostand ${euro.format(state.balance)} minus offen ${euro.format(openSum)} minus reserviert ${euro.format(reserves)}.`;
  if ($("#dispoLeft")) $("#dispoLeft").textContent = forecast == null ? "-" : euro.format(Math.max(0, forecast + Number(config.overdraftLimit || 0)));
  if ($("#saveGoal")) $("#saveGoal").textContent = euro.format(config.plan?.plannedPaydown || 0);
  if ($("#vacationValue")) $("#vacationValue").textContent = euro.format(config.plan?.vacationSavings || 0);
  if ($("#planRows")) $("#planRows").innerHTML = reserveRows().map(([k, label, val, note]) => `<div class="due"><div><b>${esc(label)}</b><small>${euro.format(val)} · ${esc(note)}</small></div><div class="right"><button class="toggle ${state.planActive[k] ? "on" : ""}" onclick="togglePlan('${k}')">${state.planActive[k] ? "aktiv ✓" : "aus"}</button></div></div>`).join("") || "<p class=\"muted\">Keine privaten Planwerte in der öffentlichen Konfiguration.</p>";
  if ($("#dues")) $("#dues").innerHTML = rows.length ? open.map((item) => `<div class="due"><div><b>${esc(item.name)}</b><small>${fmt(item.date)} · ${esc(item.note)}</small></div><b>${euro.format(item.amount)}</b></div>`).join("") : "<p class=\"muted\">Keine privaten Abbuchungen in der öffentlichen Konfiguration.</p>";
  if ($("#txList")) $("#txList").innerHTML = state.transactions.length ? state.transactions.map((item) => `<div class="tx"><div><b>${esc(item.name || item.merchant)}</b><small>${esc(item.date || item.iso || "")}</small></div><b>${euro.format(item.amount || 0)}</b></div>`).join("") : "<p class=\"muted\">Noch keine lokal gespeicherten Buchungen.</p>";
  if ($("#bal")) $("#bal").value = state.balance ?? "";
  if ($("#clientId")) $("#clientId").value = state.drive.clientId || "";
  if ($("#autoSync")) $("#autoSync").checked = state.drive.autoSync !== false;
  if ($("#autoSyncState")) $("#autoSyncState").textContent = state.drive.autoSync !== false ? "aktiv" : "aus";
  if ($("#lastSync")) $("#lastSync").textContent = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("de-DE") : "-";
  if ($("#driveStatus")) $("#driveStatus").textContent = driveToken ? "verbunden" : "nicht verbunden";
}

async function initFinanceCore() {
  migrateState();
  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (response.ok) config = await response.json();
  } catch (_) {}
  wireFinanceCore();
  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFinanceCore);
else initFinanceCore();
