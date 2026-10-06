const $ = (selector) => document.querySelector(selector);
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
let config = {};
let driveToken = null;
let financeSyncBaseline = null;
try { financeSyncBaseline = JSON.parse(localStorage.getItem("athubFinanceBaselineV1") || "null"); } catch (_) {}
let financeSyncQueue = Promise.resolve();
let financeDirty = false;
const financeConfigKey = "athubFinanceConfigV1";
const financeDirtyKey = "athubFinancePendingV1";
financeDirty = localStorage.getItem(financeDirtyKey) === "true";

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
  if (!state.recurrenceStatusCycle) state.recurrenceStatusCycle = getFinanceCycle(state.lastSyncAt ? new Date(state.lastSyncAt) : new Date()).start;
}

async function saveState(syncDrive = true) {
  migrateState();
  localStorage.setItem(financeStateKey, JSON.stringify(state));
  localStorage.setItem(financeConfigKey, JSON.stringify(config));
  if (syncDrive) {
    financeDirty = true;
    localStorage.setItem(financeDirtyKey, "true");
  }
 if (syncDrive && state.drive.autoSync) {
    await saveFinanceStateToDrive().catch(() => { /* Error is shown by the sync queue; local changes remain pending. */ });
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
  const anchor = 15;
  const start = new Date(now.getFullYear(), now.getMonth(), anchor);
  if (now.getDate() < anchor) start.setMonth(start.getMonth() - 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, anchor - 1);
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
  })).filter(item => item.date >= cycle.start && item.date <= cycle.end);
  return { cycle, rows };
}

function expandRecurrences(cycle) {
  const items = Array.isArray(config.recurrences) ? config.recurrences : [];
  return items.filter(item => item.active !== false).flatMap((item, index) => {
    const baseId = item.id || `rec_${index}`;
    return financeRecurrenceDates(item, cycle).map(date => {
      const id = `${baseId}@${date}`;
      // Legacy booked flags belong only to the cycle in which they were saved.
      const legacyCycle = state.recurrenceStatusCycle || (state.lastSyncAt ? getFinanceCycle(new Date(state.lastSyncAt)).start : getFinanceCycle().start);
      if (legacyCycle === cycle.start && state.dueActive[id] === undefined && state.dueActive[baseId] === false) state.dueActive[id] = false;
      const rhythm = {monthly:"monatlich",quarterly:"quartalsweise",semiannual:"halbjährlich",yearly:"jährlich",fortnightly:"alle 14 Tage"}[item.interval || "monthly"] || "wiederkehrend";
      return { id, name: item.name || item.title || "Fixkosten", date,
        amount: Math.abs(Number(item.amount || 0)), note: `${rhythm}${item.estimated ? " · geschätzter Betrag" : ""}${item.note ? " · " + item.note : ""}` };
    });
  }).sort((a,b) => a.date.localeCompare(b.date));
}

function financeRecurrenceDates(item, cycle) {
  const interval = item.interval || "monthly";
  const dates = [];
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && toIsoDate(new Date(`${value}T12:00:00`)) === value;
  if (interval === "fortnightly") {
    if (!validDate(item.startDate)) return dates;
    const anchor = Date.parse(item.startDate + "T00:00:00Z");
    const start = Date.parse(cycle.start + "T00:00:00Z");
    const end = Date.parse(cycle.end + "T00:00:00Z");
    const step = 14 * 86400000;
    for (let value = anchor + Math.max(0, Math.ceil((start-anchor)/step))*step; value <= end; value += step) dates.push(new Date(value).toISOString().slice(0,10));
  } else {
    const intervals = {monthly:1,quarterly:3,semiannual:6,yearly:12};
    const step = intervals[interval];
    if (!step) return dates;
    const anchorMonth = Number(item.month || (item.startDate || "").slice(5,7));
    const explicitMonths = Array.isArray(item.months) ? item.months.map(Number) : null;
    if (step > 1 && !explicitMonths && !(anchorMonth >= 1 && anchorMonth <= 12)) return dates;
    const day = Math.min(31, Math.max(1, Math.trunc(Number(item.day || item.dueDay) || 15)));
    const cursor = new Date(cycle.start + "T12:00:00");cursor.setDate(1);
    while (toIsoDate(cursor) <= cycle.end) {
      const month = cursor.getMonth()+1;
      const allowed = explicitMonths ? explicitMonths.includes(month) : step === 1 || ((month-anchorMonth+12)%step === 0);
      if (allowed) dates.push(toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(day,new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate()))));
      cursor.setMonth(cursor.getMonth()+1);
    }
  }
  return [...new Set(dates)].filter(date => date >= cycle.start && date <= cycle.end && (!item.startDate || date >= item.startDate) && (!item.endDate || date <= item.endDate));
}

function dueDateForCycle(day, cycle) {
  const [year, month] = cycle.start.split("-").map(Number);
  const dueDay = Math.min(31, Math.max(1, Math.trunc(Number(day) || 15)));
  const targetMonth = month - 1 + (dueDay < 15 ? 1 : 0);
  const lastDay = new Date(year, targetMonth + 1, 0).getDate();
  const date = new Date(year, targetMonth, Math.min(dueDay, lastDay));
  return toIsoDate(date);
}

function reserveRows() {
  const plan = config.plan || {};
  return [
    ["emergencyBuffer", "Allgemeines Sparen", Number(plan.emergencyBuffer || 0), "monatliche Rücklage"],
    ["vacationSavings", "Urlaubssparen", Number(plan.vacationSavings || 0), "privat geplant"],
    ["plannedPaydown", "Dispoabbau-Ziel", Number(plan.plannedPaydown || 0), plan.paydownOnlyIfPossible ? "nur bei ausreichendem verfügbarem Budget" : "Konto entlasten"]
  ].filter((row) => row[2] > 0);
}

function activeReserveSum() {
  const active = reserveRows().filter(row => state.planActive[row[0]] !== false);
  const regular = active.filter(row => row[0] !== "plannedPaydown").reduce((sum, row) => sum + row[2], 0);
  const paydown = active.filter(row => row[0] === "plannedPaydown").reduce((sum, row) => sum + row[2], 0);
  if (!config.plan?.paydownOnlyIfPossible) return regular + paydown;
  const open = ensureCycleState().rows.filter(row => state.dueActive[row.id] !== false)
    .reduce((sum, row) => sum + row.amount, 0);
  const available = state.balance == null ? null : finance881Round(state.balance + Number(config.overdraftLimit || 0) - open - regular);
  return regular + (available != null && available >= paydown ? paydown : 0);
}

function finance881RecalculateBalance() {
  const dateInput=$("#balanceDate");
  if(dateInput && document.activeElement!==dateInput) dateInput.value=state.balanceCoverageEnd || state.balanceAnchor?.date || "";
  if($("#balanceBasis")) $("#balanceBasis").textContent=state.balanceAnchor ? `Ausgangspunkt ${euro.format(state.balanceAnchor.amount)} nach allen Buchungen bis ${state.balanceAnchor.date}. Durch Auszüge abgedeckt bis ${state.balanceCoverageEnd || state.balanceAnchor.date}.` : "Für die automatische Fortschreibung bitte einen bestätigten Ausgangsstand und Stichtag speichern.";
  if (state.balance == null && config.currentSnapshot?.balance !== undefined) {
    const value = Number(config.currentSnapshot.balance);
    state.balance = Number.isNaN(value) ? null : value;
  }
}

function toggleDue(id) {
  if (!financeSyncBaseline) return setDriveMessage("Bitte zuerst den zentralen Finanzstand laden.");
  state.dueActive[id] = state.dueActive[id] === false;
  saveState();
  render();
}

function togglePlan(id) {
  if (!financeSyncBaseline) return setDriveMessage("Bitte zuerst den zentralen Finanzstand laden.");
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
    if (!financeSyncBaseline) return setDriveMessage("Bitte zuerst den zentralen Finanzstand laden.");
    const raw=$("#bal")?.value.trim() || "";
    const value = Number(raw),date=$("#balanceDate")?.value || "";
    if(!raw || !Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(new Date(date+"T12:00:00"))!==date || date>toIsoDate(new Date())) return setDriveMessage("Bitte Kontostand und gültigen Abschlussstichtag angeben. Der Stand muss alle Buchungen bis einschließlich dieses Tages enthalten.");
    localStorage.setItem("athubFinanceBeforeBalanceAnchorV1",JSON.stringify({state,config,savedAt:new Date().toISOString()}));
    state.balance = finance881Round(value);
    state.balanceAsOf = date;
    state.balanceAnchor={amount:state.balance,date,kind:"closed-day"};
    state.balanceCoverageEnd=date;
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
$("#sync")?.addEventListener("click", () => synchronizeFinance().catch(() => {}));
  $("#loadCentral")?.addEventListener("click", () => {
    if (financeDirty && !confirm("Den zentralen Stand vom Rechner auf dieses Gerät übernehmen? Offene lokale Änderungen werden vorher auf diesem Gerät gesichert und anschließend durch den zentralen Stand ersetzt.")) return;
    loadFinanceStateFromDrive(true).catch(() => {});
  });
  $("#autoSync")?.addEventListener("change", (event) => {
    state.drive.autoSync = event.target.checked;
    saveState(false);
    render();
  });
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

function financeConnection() {
  let sync;
  try { sync = JSON.parse(localStorage.getItem("athubWorktimeSync") || "{}"); }
  catch (_) { throw new Error("AT HUB Verbindung ist ungültig."); }
  if (!sync.url || !sync.token) throw new Error("AT HUB Verbindung fehlt.");
  const url = new URL(sync.url);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("Bitte die bereitgestellte Apps-Script-Web-App verwenden.");
  }
  return sync;
}

function financeComparable(finance) {
  // Sync time and device-specific preferences are not financial data.
  const value = JSON.parse(JSON.stringify(finance));
  delete value.meta;
  if (value.state) {
    value.state.transactions = Array.isArray(value.state.transactions) ? value.state.transactions : [];
    value.state.financeImportLog = Array.isArray(value.state.financeImportLog) ? value.state.financeImportLog : [];
    value.state.dueActive = value.state.dueActive || {};
    value.state.planActive = value.state.planActive || {};
  }
  if (value.config) {
    value.config.dues = Array.isArray(value.config.dues) ? value.config.dues : [];
    value.config.recurrences = Array.isArray(value.config.recurrences) ? value.config.recurrences : [];
  }
  if (value.state) {
    delete value.state.lastSyncAt;
    delete value.state.drive;
  }
  const canonical = (item) => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]))
      : item;
  return JSON.stringify(canonical(value));
}

async function fetchCentralFinance(sync) {
  const url = new URL(sync.url);
  url.searchParams.set("token", sync.token);
  url.searchParams.set("module", "finance");
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("Zentrale Finanzdaten sind nicht erreichbar.");
  const result = await response.json();
  if (!result.ok) throw new Error("AT HUB hat die Finanzanfrage abgelehnt.");
  const finance = result.finance || result.state;
  if (!finance || typeof finance !== "object" || Array.isArray(finance)) {
    throw new Error("Keine Finanzdaten im AT HUB gefunden.");
  }
  return { finance, updatedAt: result.updatedAt || "" };
}

function financeSerial(operation) {
  const task = financeSyncQueue.then(operation);
  financeSyncQueue = task.catch(() => {});
  return task.catch(error => {
    setDriveMessage(error.message + " Lokale Änderungen bleiben erhalten.");
    if ($("#driveStatus")) $("#driveStatus").textContent = "Sync offen";
    throw error;
  });
}

function saveFinanceStateToDrive() {
  return financeSerial(async () => {
    const sync = financeConnection();
    if (!financeSyncBaseline || financeSyncBaseline.url !== sync.url) {
      throw new Error("Vor dem Speichern zuerst den zentralen Finanzstand laden.");
    }
    const before = await fetchCentralFinance(sync);
    // Metadata-only writes do not change the financial basis. Use the freshly
    // read timestamp for the server's atomic check, but conflict on actual data.
    if (financeComparable(before.finance) !== financeSyncBaseline.content) {
      throw new Error("Zentrale Daten wurden auf einem anderen Gerät geändert. Konflikt vor dem Speichern klären.");
    }
    const finance = JSON.parse(JSON.stringify({ state, config }));
    const sentContent = financeComparable(finance);
    const requestId = crypto.randomUUID();
    setDriveMessage("Finanzdaten werden gespeichert und anschließend zentral geprüft …");
    // Apps Script ContentService redirects. The opaque POST is transport only,
    // never a success signal. Only authenticated GET readback confirms persistence.
    await fetch(sync.url, {
      method: "POST", mode: "no-cors", redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: sync.token, module: "finance", finance, requestId, expectedUpdatedAt: before.updatedAt })
    });
    let confirmed;
    for (let attempt = 0; attempt < 5; attempt++) {
      const readback = await fetchCentralFinance(sync);
      if (financeComparable(readback.finance) === sentContent &&
          readback.updatedAt && readback.finance.meta?.syncRequestId === requestId) {
        confirmed = readback;
        break;
      }
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    }
    if (!confirmed) throw new Error("Speicherung nicht bestätigt: zentraler Zeitstempel oder Daten stimmen nicht überein.");
    financeSyncBaseline = { url: sync.url, content: sentContent, updatedAt: confirmed.updatedAt };
    state.lastSyncAt = confirmed.updatedAt;
    localStorage.setItem("athubFinanceBaselineV1", JSON.stringify(financeSyncBaseline));
    // An edit made during the request must remain queued/pending.
    financeDirty = financeComparable({ state, config }) !== sentContent;
    localStorage.setItem(financeDirtyKey, String(financeDirty));
    await saveState(false);
    setDriveMessage(financeDirty ? "Stand gespeichert; weitere lokale Änderungen sind noch offen."
      : "Finanzdaten zentral gespeichert und durch Rücklesen bestätigt.");
    render();
  });
}

function loadFinanceStateFromDrive(replaceLocal = false) {
  return financeSerial(async () => {
    if (financeDirty && !replaceLocal) throw new Error("Ungespeicherte lokale Änderungen vorhanden. Bitte „Zentralen Stand übernehmen“ wählen, um den Rechnerstand mit lokaler Sicherung zu laden.");
    const localBasis = financeComparable({ state, config });
    const sync = financeConnection();
    const result = await fetchCentralFinance(sync);
    if (financeComparable({ state, config }) !== localBasis) throw new Error("Während des Ladens wurden lokale Daten geändert. Bitte erneut laden.");
    if (replaceLocal) localStorage.setItem("athubFinanceBeforeCentralLoadV1", JSON.stringify({ state, config, baseline: financeSyncBaseline, savedAt: new Date().toISOString() }));
    const finance = result.finance;
    const preferences = { ...state.drive };
    if (finance.state && typeof finance.state === "object") state = { ...state, ...finance.state };
    else state = { ...state, ...finance };
    if (finance.config && typeof finance.config === "object") config = { ...config, ...finance.config };
    state.drive = preferences;
    state.lastSyncAt = result.updatedAt || "";
    financeDirty = false;
    localStorage.setItem(financeDirtyKey, "false");
    financeSyncBaseline = {
      url: sync.url, content: financeComparable(finance), updatedAt: result.updatedAt
    };
    await saveState(false);
    setDriveMessage("Finanzdaten erfolgreich aus AT HUB geladen.");
    localStorage.setItem("athubFinanceBaselineV1", JSON.stringify(financeSyncBaseline));
    render();
  });
}

async function synchronizeFinance() {
  if (financeDirty) await saveFinanceStateToDrive();
  await loadFinanceStateFromDrive();
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
  if ($("#driveStatus")) $("#driveStatus").textContent = financeSyncBaseline ? (financeDirty ? "Änderungen offen" : "zentral geladen") : "zuerst zentral laden";
}

async function initFinanceCore() {
  migrateState();
  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (response.ok) config = await response.json();
    const localConfig = JSON.parse(localStorage.getItem(financeConfigKey) || "null");
    if (localConfig && typeof localConfig === "object") config = localConfig;
  } catch (_) {}
  wireFinanceCore();
  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFinanceCore);
else initFinanceCore();
