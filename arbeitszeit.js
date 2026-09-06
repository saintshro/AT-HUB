(() => {
  const $ = (id) => document.getElementById(id);
  const storeKey = "athubWorktimeV103";
  const syncKey = "athubWorktimeSync";
  const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  let viewDate = new Date();
  let entries = readJson(storeKey, {});
  let sync = readJson(syncKey, { url: "", token: "" });

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (_) { return fallback; }
  }

  function saveLocal() {
    localStorage.setItem(storeKey, JSON.stringify(entries));
  }

  function saveSyncConfig() {
    localStorage.setItem(syncKey, JSON.stringify(sync));
  }

  function iso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseMinutes(value) {
    if (!value || !value.includes(":")) return null;
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  function hours(entry) {
    const start = parseMinutes(entry.start);
    const end = parseMinutes(entry.end);
    if (start == null || end == null || end <= start) return 0;
    return Math.max(0, (end - start - Number(entry.pause || 0)) / 60);
  }

  function schoolHours(entry) {
    const start = parseMinutes(entry.schoolStart);
    const end = parseMinutes(entry.schoolEnd);
    if (start == null || end == null || end <= start) return 0;
    return (end - start) / 60;
  }

  function monthEntries() {
    const prefix = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}`;
    return Object.values(entries).filter((entry) => entry.date?.startsWith(prefix));
  }

  function renderCalendar() {
    const calendar = $("wtCalendar");
    if (!calendar) return;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const pad = (first.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < pad; i += 1) cells.push("<span></span>");
    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(year, month, day);
      const key = iso(date);
      const entry = entries[key] || {};
      const title = entry.task || entry.workplace || entry.status || "Noch kein Eintrag";
      const detail = [entry.start && entry.end ? `${entry.start}-${entry.end}` : "", entry.box ? `Box ${entry.box}` : "", entry.externalLocation || ""].filter(Boolean).join(" · ");
      cells.push(`<button type="button" class="wt-day" data-date="${key}">
        <strong>${day}</strong>
        <span class="wt-status">${escapeHtml(entry.status || "")}</span>
        <small>${escapeHtml(title)}</small>
        <small>${escapeHtml(detail)}</small>
      </button>`);
    }
    calendar.innerHTML = cells.join("");
    calendar.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.date)));
    const label = $("wtMonthLabel");
    if (label) label.textContent = viewDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    renderKpis();
    renderTax();
    renderYear();
  }

  function renderKpis() {
    const target = $("wtKpis");
    if (!target) return;
    const list = monthEntries();
    const work = list.filter((entry) => entry.status === "A" || entry.status === "E");
    const totalHours = work.reduce((sum, entry) => sum + hours(entry), 0);
    const external = list.filter((entry) => entry.status === "E" || entry.businessTrip).length;
    const nights = list.filter((entry) => entry.overnight).length;
    target.innerHTML = [
      ["Arbeitstage", work.length],
      ["Stunden", totalHours.toFixed(2).replace(".", ",")],
      ["Auswärts", external],
      ["Übernachtungen", nights]
    ].map(([label, value]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>aktueller Monat</small></article>`).join("");
  }

  function renderTax() {
    const target = $("wtTaxPanel");
    if (!target) return;
    const list = monthEntries();
    const officeDays = list.filter((entry) => entry.workplace === "Büro" || entry.workplace === "Box").length;
    const externalDays = list.filter((entry) => entry.status === "E" || entry.businessTrip).length;
    const trainingDays = list.filter((entry) => entry.training || schoolHours(entry) > 0).length;
    const nights = list.filter((entry) => entry.overnight).length;
    const commuteKm = list.reduce((sum, entry) => sum + Number(entry.distanceKm || 0), 0);
    const businessKm = list.reduce((sum, entry) => sum + Number(entry.businessKm || 0), 0);
    target.innerHTML = `
      <div class="section-title"><div><h2>Steuerreiter</h2><p>Automatisch aus den Tagesdaten berechnet. Rohdaten und steuerliche Bewertung bleiben getrennt.</p></div></div>
      <div class="kpi-grid">
        <article class="kpi"><span>Büro / Box</span><strong>${officeDays}</strong><small>Tage mit 16 km einfacher Entfernung, wenn gepflegt.</small></article>
        <article class="kpi"><span>Auswärtstage</span><strong>${externalDays}</strong><small>Extern oder Dienstreise markiert.</small></article>
        <article class="kpi"><span>Meisterschule</span><strong>${trainingDays}</strong><small>Fortbildung oder Schulzeiten erfasst.</small></article>
        <article class="kpi"><span>Übernachtungen</span><strong>${nights}</strong><small>Für spätere Auslöseprüfung.</small></article>
      </div>
      <div class="check-list">
        <div><strong>Entfernung Arbeitsstätte</strong><span>${commuteKm.toFixed(1).replace(".", ",")} km im Monat erfasst.</span></div>
        <div><strong>Dienstliche Kilometer</strong><span>${businessKm.toFixed(1).replace(".", ",")} km im Monat erfasst.</span></div>
        <div><strong>Drive-Regel</strong><span>Die Tabelle bleibt Speicher. Diese Ansicht rechnet nur aus den geladenen oder lokal gemerkten Tagen.</span></div>
      </div>`;
  }

  function renderYear() {
    const table = $("wtYearTable");
    if (!table) return;
    const year = viewDate.getFullYear();
    const rows = Array.from({ length: 12 }, (_, index) => {
      const prefix = `${year}-${String(index + 1).padStart(2, "0")}`;
      const list = Object.values(entries).filter((entry) => entry.date?.startsWith(prefix));
      return `<tr><td>${new Date(year, index, 1).toLocaleDateString("de-DE", { month: "long" })}</td><td>${list.length}</td><td>${list.reduce((sum, entry) => sum + hours(entry), 0).toFixed(2).replace(".", ",")} h</td><td>${list.filter((entry) => entry.overnight).length}</td><td>${list.filter((entry) => entry.status === "E" || entry.businessTrip).length}</td></tr>`;
    }).join("");
    table.innerHTML = `<thead><tr><th>Monat</th><th>Einträge</th><th>Arbeitszeit</th><th>Übernachtungen</th><th>Auswärts</th></tr></thead><tbody>${rows}</tbody>`;
    const title = $("wtYearTitle");
    if (title) title.textContent = year;
  }

  function openModal(date) {
    const entry = entries[date] || { date };
    $("wtDate").value = date;
    $("wtDateText").textContent = dateFmt.format(new Date(date));
    set("wtStatus", entry.status || "");
    set("wtWorkplace", entry.workplace || "");
    set("wtBox", entry.box || "");
    set("wtExternalLocation", entry.externalLocation || "");
    set("wtStart", entry.start || "");
    set("wtEnd", entry.end || "");
    set("wtPause", entry.pause ?? 0);
    set("wtTask", entry.task || "");
    set("wtDescription", entry.description || "");
    set("wtSchoolStart", entry.schoolStart || "");
    set("wtSchoolEnd", entry.schoolEnd || "");
    set("wtDistanceKm", entry.distanceKm || "");
    set("wtBusinessKm", entry.businessKm || "");
    check("wtOvernight", entry.overnight);
    check("wtBusinessTrip", entry.businessTrip);
    check("wtTraining", entry.training);
    $("wtModal").hidden = false;
  }

  function set(id, value) { const el = $(id); if (el) el.value = value; }
  function check(id, value) { const el = $(id); if (el) el.checked = Boolean(value); }

  function collectEntry() {
    return {
      id: $("wtDate").value,
      date: $("wtDate").value,
      datum: $("wtDate").value,
      status: $("wtStatus").value,
      workplace: $("wtWorkplace").value,
      box: $("wtBox").value.trim(),
      externalLocation: $("wtExternalLocation").value.trim(),
      start: $("wtStart").value,
      kommt: $("wtStart").value,
      end: $("wtEnd").value,
      geht: $("wtEnd").value,
      pause: $("wtPause").value || "0",
      task: $("wtTask").value.trim(),
      kategorie: $("wtStatus").value || "Arbeit",
      description: $("wtDescription").value.trim(),
      ort: $("wtExternalLocation").value.trim() || $("wtWorkplace").value,
      notiz: $("wtDescription").value.trim(),
      schoolStart: $("wtSchoolStart").value,
      schoolEnd: $("wtSchoolEnd").value,
      overnight: $("wtOvernight").checked,
      uebernachtung: $("wtOvernight").checked ? "Übernachtung" : "Keine Übernachtung",
      businessTrip: $("wtBusinessTrip").checked,
      training: $("wtTraining").checked,
      distanceKm: $("wtDistanceKm").value,
      businessKm: $("wtBusinessKm").value
    };
  }

  async function saveEntry(event) {
    event.preventDefault();
    const entry = collectEntry();
    if (!entry.date) return;
    entries[entry.date] = entry;
    saveLocal();
    $("wtModal").hidden = true;
    renderCalendar();
    await syncEntry(entry);
    setFormMessage("Gespeichert. Kalender und Steuerreiter sind aktualisiert.");
  }

  function clearEntry() {
    const date = $("wtDate").value;
    if (date) {
      delete entries[date];
      saveLocal();
      $("wtModal").hidden = true;
      renderCalendar();
    }
  }

  async function syncEntry(entry) {
    if (!sync.url) {
      setSyncStatus("Drive-Sync vorbereitet", "open");
      return;
    }
    setSyncStatus("Speichere in Drive ...", "sync");
    try {
      const response = await fetch(sync.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: sync.token, entry })
      });
      if (!response.ok) throw new Error("Sync fehlgeschlagen");
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus("Drive gespeichert", "ok");
    } catch (_) {
      setSyncStatus("Lokal gespeichert, Drive offen", "open");
    }
  }

  async function loadFromDrive() {
    if (!sync.url) return;
    setSyncStatus("Lade aus Drive ...", "sync");
    try {
      const url = new URL(sync.url);
      if (sync.token) url.searchParams.set("token", sync.token);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error("Laden fehlgeschlagen");
      const data = await response.json();
      if (Array.isArray(data.entries)) {
        data.entries.forEach((entry) => {
          const date = entry.date || entry.datum;
          if (date) entries[date] = normalizeDriveEntry(entry, date);
        });
        saveLocal();
        renderCalendar();
      }
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus("Drive geladen", "ok");
    } catch (_) {
      setSyncStatus("Drive nicht erreichbar", "open");
    }
  }

  function normalizeDriveEntry(entry, date) {
    return { ...entry, date, start: entry.start || entry.kommt || "", end: entry.end || entry.geht || "", workplace: entry.workplace || entry.ort || "", task: entry.task || entry.kategorie || "", description: entry.description || entry.notiz || "" };
  }

  function configureSync() {
    const url = prompt("Apps-Script-Web-App-URL für den Arbeitszeitkalender:", sync.url || "");
    if (url === null) return;
    const token = prompt("Sync-Token:", sync.token || "");
    if (token === null) return;
    sync = { url: url.trim(), token: token.trim() };
    saveSyncConfig();
    setSyncStatus(sync.url ? "Drive verbunden" : "Drive-Sync vorbereitet", sync.url ? "ok" : "open");
  }

  function setSyncStatus(text, tone) {
    const status = document.querySelector("[data-athub-sync-status]");
    if (status) status.textContent = text;
    const last = document.querySelector("[data-athub-last-sync]");
    const lastValue = localStorage.getItem("athubWorktimeLastSync");
    if (last) last.textContent = lastValue ? new Date(lastValue).toLocaleString("de-DE") : "-";
    const badge = $("wtFormMessage");
    if (badge) badge.textContent = text;
  }

  function setFormMessage(text) {
    const target = $("wtFormMessage");
    if (target) target.textContent = text;
  }

  function injectTaxTabs() {
    if ($("wtTaxPanel")) return;
    const calendarPanel = document.querySelector(".wt-panel");
    const tabs = document.createElement("section");
    tabs.className = "section-tabs wt-span2";
    tabs.innerHTML = `<button type="button" class="active" data-wt-panel="calendar">Kalender</button><button type="button" data-wt-panel="tax">Steuerreiter</button><button type="button" data-wt-panel="year">Jahresübersicht</button>`;
    calendarPanel?.before(tabs);
    const tax = document.createElement("section");
    tax.id = "wtTaxPanel";
    tax.className = "wt-panel";
    tax.hidden = true;
    calendarPanel?.after(tax);
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-wt-panel]");
      if (!button) return;
      tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      if (calendarPanel) calendarPanel.hidden = button.dataset.wtPanel !== "calendar";
      if (tax) tax.hidden = button.dataset.wtPanel !== "tax";
      const year = $("wtYearPanel");
      if (year) year.hidden = button.dataset.wtPanel !== "year";
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function init() {
    injectTaxTabs();
    $("wtPrevMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
    $("wtNextMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });
    $("wtTodayBtn")?.addEventListener("click", () => { viewDate = new Date(); renderCalendar(); });
    $("wtYearBtn")?.addEventListener("click", () => document.querySelector('[data-wt-panel="year"]')?.click());
    $("wtConnectBtn")?.addEventListener("click", configureSync);
    $("wtSyncBtn")?.addEventListener("click", loadFromDrive);
    $("wtForm")?.addEventListener("submit", saveEntry);
    $("wtCloseBtn")?.addEventListener("click", () => { $("wtModal").hidden = true; });
    $("wtCancelBtn")?.addEventListener("click", () => { $("wtModal").hidden = true; });
    $("wtClearBtn")?.addEventListener("click", clearEntry);
    setSyncStatus(sync.url ? "Drive verbunden" : "Drive-Sync vorbereitet", sync.url ? "ok" : "open");
    loadFromDrive().finally(renderCalendar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
