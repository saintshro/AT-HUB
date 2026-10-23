(() => {
  const $ = (id) => document.getElementById(id);
  const storeKey = "athubWorktimeV103";
  const syncKey = "athubWorktimeSync";
  const appVersion = "1.0.9";
  const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  let viewDate = new Date();
  let entries = readJson(storeKey, {});
  let sync = readJson(syncKey, { url: "", token: "" });
  let recoveryCandidate = null;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (_) { return fallback; }
  }

  function saveLocal() {
    localStorage.setItem(storeKey, JSON.stringify(entries));
  }

  function saveSyncConfig() {
    localStorage.setItem(syncKey, JSON.stringify(sync));
  }

  async function loadCentralSyncConfig() {
    try {
      const response = await fetch("data/worktime-sync.private.json", { cache: "no-store" });
      if (!response.ok) return;
      const config = await response.json();
      if (!config?.url || !config?.token) return;
      sync = { url: String(config.url).trim(), token: String(config.token).trim() };
      saveSyncConfig();
    } catch (_) {
      // The local configuration remains usable while the central config is unavailable.
    }
  }

  async function loadSeedData() {
    const sources = ["data/AT_HUB_Daten_v1.private.json"];
    for (const source of sources) {
      try {
        const response = await fetch(source, { cache: "no-store" });
        if (!response.ok) continue;
        const data = await response.json();
        const seedEntries = Array.isArray(data.entries)
          ? data.entries
          : Array.isArray(data.worktime?.entries)
            ? data.worktime.entries
            : [];
        if (!seedEntries.length) continue;

        let imported = 0;
        let updated = 0;
        seedEntries.forEach((entry) => {
          const date = entry.date || entry.datum || entry.id;
          if (date) {
            const canOverwrite = !entries[date] || entries[date].source;
            if (canOverwrite) {
              const existed = Boolean(entries[date]);
              entries[date] = normalizeDriveEntry(entry, date);
              if (existed) updated += 1;
              else imported += 1;
            }
          }
        });

        if (imported || updated) {
          saveLocal();
          localStorage.setItem("athubWorktimeSeedSource", data.meta?.source || source);
          const text = [imported ? `${imported} geladen` : "", updated ? `${updated} aktualisiert` : ""].filter(Boolean).join(", ");
          setSyncStatus(`${text} aus lokaler Datei`, "ok");
        }
      } catch (_) {
        // The next private fallback source is tried when one source is unavailable.
      }
    }
  }

  function iso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseMinutes(value) {
    const text = normalizeTimeValue(value);
    if (!text || !text.includes(":")) return null;
    const [h, m] = text.split(":").map(Number);
    return h * 60 + m;
  }

  function hours(entry) {
    const start = parseMinutes(entry.start);
    let end = parseMinutes(entry.end);
    if (start == null || end == null) return 0;
    if (end <= start && entry.endNextDay) end += 24 * 60;
    if (end <= start) return 0;
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
      const statusText = statusLabel(entry.status);
      const title = displayTitle(entry, statusText);
      const detail = [entry.start && entry.end ? `${entry.start}-${entry.end}` : "", entry.box ? `Box ${entry.box}` : "", entry.externalLocation || ""].filter(Boolean).join(" · ");
      cells.push(`<button type="button" class="wt-day" data-date="${key}">
        <strong>${day}</strong>
        <span class="wt-status">${escapeHtml(statusText)}</span>
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
    const work = list.filter(isWorkEntry);
    const totalHours = work.reduce((sum, entry) => sum + hours(entry), 0);
    const external = list.filter(isExternalEntry).length;
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
    const officeDays = list.filter((entry) => commuteRoundTripKm(entry) > 0).length;
    const externalDays = list.filter(isExternalEntry).length;
    const trainingDays = list.filter((entry) => entry.training || schoolHours(entry) > 0).length;
    const nights = list.filter((entry) => entry.overnight).length;
    const nightPlaces = [...new Set(list.filter((entry) => entry.overnight).map((entry) => entry.overnightPlace || entry.ort).filter(Boolean))];
    const externalMissingDistance = list.filter((entry) => isExternalEntry(entry) && businessTravelKm(entry) === 0 && commuteRoundTripKm(entry) === 0).length;
    const companyVehicleDays = list.filter((entry) => entry.companyVehicle || entry.vehicleType === "Dienstfahrzeug").length;
    const breakfastNights = list.filter((entry) => entry.overnight && entry.breakfastIncluded).length;
    const employerAllowanceNights = list.filter((entry) => entry.overnight && entry.employerAllowance).length;
    const commuteKm = list.reduce((sum, entry) => sum + commuteRoundTripKm(entry), 0);
    const businessKm = list.reduce((sum, entry) => sum + businessTravelKm(entry), 0);
    const taxRows = list
      .filter((entry) => isWorkEntry(entry) || entry.overnight || commuteRoundTripKm(entry) > 0 || businessTravelKm(entry) > 0)
      .map((entry) => {
        const commute = commuteRoundTripKm(entry);
        const business = businessTravelKm(entry);
        const totalKm = commute + business;
        return `<tr>
          <td>${formatDateShort(entry.date)}</td>
          <td>${escapeHtml(statusLabel(entry.status) || "-")}</td>
          <td>${escapeHtml(taxEntryType(entry))}</td>
          <td>${escapeHtml(taxPlace(entry))}</td>
          <td>${formatKm(commute)}</td>
          <td>${formatKm(business)}</td>
          <td>${formatKm(totalKm)}</td>
          <td>${entry.companyVehicle || entry.vehicleType === "Dienstfahrzeug" ? "Ja" : ""}</td>
          <td>${escapeHtml(taxHint(entry))}</td>
        </tr>`;
      }).join("");
    target.innerHTML = `
      <div class="section-title"><div><h2>Steuerreiter</h2><p>Automatisch aus den Tagesdaten berechnet. Rohdaten und steuerliche Bewertung bleiben getrennt.</p></div></div>
      <div class="kpi-grid">
        <article class="kpi"><span>Büro / Box</span><strong>${officeDays}</strong><small>Tage mit 16 km Hinweg und 16 km Rückweg.</small></article>
        <article class="kpi"><span>Auswärtstage</span><strong>${externalDays}</strong><small>Extern oder Dienstreise markiert.</small></article>
        <article class="kpi"><span>Meisterschule</span><strong>${trainingDays}</strong><small>Fortbildung oder Schulzeiten erfasst.</small></article>
        <article class="kpi"><span>Übernachtungen</span><strong>${nights}</strong><small>Für spätere Auslöseprüfung.</small></article>
      </div>
      <div class="check-list">
        <div><strong>Arbeitsstätte hin/zurück</strong><span>${commuteKm.toFixed(1).replace(".", ",")} km im Monat erfasst.</span></div>
        <div><strong>Dienstliche Kilometer</strong><span>${businessKm.toFixed(1).replace(".", ",")} km im Monat erfasst.</span></div>
        <div><strong>Dienstfahrzeug</strong><span>${companyVehicleDays} Tag(e) markiert. Keine automatische Werbungskostenberechnung.</span></div>
        <div><strong>Übernachtungsorte</strong><span>${nightPlaces.length ? escapeHtml(nightPlaces.join(", ")) : "Keine Übernachtung im Monat erfasst."}</span></div>
        <div><strong>Frühstück / Auslöse</strong><span>${breakfastNights} Nacht/Nächte mit Frühstück, ${employerAllowanceNights} mit Arbeitgeber-Auslöse/Jahresmeldung.</span></div>
        <div><strong>Steuer-Prüfung</strong><span>${externalMissingDistance ? externalMissingDistance + " Auswärtstag(e) ohne Kilometer/Entfernung." : "Keine offenen Kilometerhinweise im Monat."}</span></div>
        <div><strong>Drive-Regel</strong><span>Die Tabelle bleibt Speicher. Diese Ansicht rechnet nur aus den geladenen oder lokal gemerkten Tagen.</span></div>
      </div>
      <div class="wt-tax-table-wrap">
        <table class="wt-tax-table">
          <thead><tr><th>Datum</th><th>Status</th><th>Einsatz</th><th>Ort</th><th>Arbeitsweg km</th><th>Dienst km</th><th>Gesamt km</th><th>Dienstfahrzeug</th><th>Hinweis</th></tr></thead>
          <tbody>${taxRows || `<tr><td colspan="9">Für diesen Monat sind noch keine steuerrelevanten Arbeitszeitdaten geladen.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function renderYear() {
    const table = $("wtYearTable");
    if (!table) return;
    const year = viewDate.getFullYear();
    const rows = Array.from({ length: 12 }, (_, index) => {
      const prefix = `${year}-${String(index + 1).padStart(2, "0")}`;
      const list = Object.values(entries).filter((entry) => entry.date?.startsWith(prefix));
      return `<tr><td>${new Date(year, index, 1).toLocaleDateString("de-DE", { month: "long" })}</td><td>${list.length}</td><td>${list.reduce((sum, entry) => sum + hours(entry), 0).toFixed(2).replace(".", ",")} h</td><td>${list.filter((entry) => entry.overnight).length}</td><td>${list.filter(isExternalEntry).length}</td></tr>`;
    }).join("");
    table.innerHTML = `<thead><tr><th>Monat</th><th>Einträge</th><th>Arbeitszeit</th><th>Übernachtungen</th><th>Auswärts</th></tr></thead><tbody>${rows}</tbody>`;
    const title = $("wtYearTitle");
    if (title) title.textContent = year;
  }

  function openModal(date) {
    const entry = applyTaxDefaults(entries[date] || { date });
    const commute = commuteRoundTripKm(entry);
    const business = businessTravelKm(entry);
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
    set("wtDistanceKm", entry.distanceKm || entry.commuteRoundTripKm || (commute ? String(commute) : ""));
    set("wtCommuteOneWayKm", entry.commuteOneWayKm || (commute ? "16" : ""));
    set("wtBusinessKm", entry.businessKm || entry.businessRoundTripKm || (business ? String(business) : ""));
    set("wtOvernightPlace", entry.overnightPlace || entry.ort || "");
    set("wtTravelRoute", entry.travelRoute || "");
    check("wtOvernight", entry.overnight);
    check("wtBusinessTrip", entry.businessTrip);
    check("wtTraining", entry.training);
    check("wtCompanyVehicle", entry.companyVehicle || entry.vehicleType === "Dienstfahrzeug");
    check("wtBreakfastIncluded", entry.breakfastIncluded);
    check("wtEmployerAllowance", entry.employerAllowance || entry.employerReportsAllowanceToTaxOffice);
    $("wtModal").hidden = false;
  }

  function set(id, value) { const el = $(id); if (el) el.value = value; }
  function check(id, value) { const el = $(id); if (el) el.checked = Boolean(value); }
  function value(id) { return $(id)?.value || ""; }
  function checked(id) { return Boolean($(id)?.checked); }

  function collectEntry() {
    const date = value("wtDate");
    return applyTaxDefaults({
      id: date,
      date: date,
      datum: date,
      status: value("wtStatus"),
      workplace: value("wtWorkplace"),
      box: value("wtBox").trim(),
      externalLocation: value("wtExternalLocation").trim(),
      start: value("wtStart"),
      kommt: value("wtStart"),
      end: value("wtEnd"),
      geht: value("wtEnd"),
      pause: value("wtPause") || "0",
      task: value("wtTask").trim(),
      kategorie: value("wtStatus") || "Arbeit",
      description: value("wtDescription").trim(),
      ort: value("wtOvernightPlace").trim() || value("wtExternalLocation").trim() || value("wtWorkplace"),
      notiz: value("wtDescription").trim(),
      schoolStart: value("wtSchoolStart"),
      schoolEnd: value("wtSchoolEnd"),
      overnight: checked("wtOvernight"),
      uebernachtung: checked("wtOvernight") ? "Übernachtung" : "Keine Übernachtung",
      businessTrip: checked("wtBusinessTrip"),
      training: checked("wtTraining"),
      companyVehicle: checked("wtCompanyVehicle"),
      vehicleType: checked("wtCompanyVehicle") ? "Dienstfahrzeug" : "",
      breakfastIncluded: checked("wtBreakfastIncluded"),
      employerAllowance: checked("wtEmployerAllowance"),
      employerReportsAllowanceToTaxOffice: checked("wtEmployerAllowance"),
      distanceKm: value("wtDistanceKm"),
      commuteOneWayKm: value("wtCommuteOneWayKm"),
      businessKm: value("wtBusinessKm"),
      overnightPlace: value("wtOvernightPlace").trim(),
      travelRoute: value("wtTravelRoute").trim()
    });
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

  async function clearEntry() {
    const date = $("wtDate").value;
    if (date) {
      delete entries[date];
      saveLocal();
      $("wtModal").hidden = true;
      renderCalendar();
      await syncEntry({ id: date, date, datum: date, status: "", workplace: "", start: "", end: "", pause: "", task: "", description: "", overnight: false, businessTrip: false, training: false });
    }
  }

  async function syncEntry(entry) {
    if (window.ATHubDrive?.isConnected()) {
      return saveWorktimeToPrivateDrive();
    }
    if (!sync.url) {
      setSyncStatus("Google Drive verbinden, um sicher zu speichern", "open");
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
      const data = await response.json().catch(() => ({}));
      if (data.ok === false) throw new Error(data.error || "Sync abgelehnt");
      const updated = data.entry || (Array.isArray(data.entries) ? data.entries.find((item) => item.date === entry.date) : null);
      if (updated?.date) {
        entries[updated.date] = normalizeDriveEntry(updated, updated.date);
        saveLocal();
        renderCalendar();
      }
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus("Drive gespeichert", "ok");
    } catch (_) {
      setSyncStatus("Lokal gespeichert, Drive offen", "open");
    }
  }

  async function loadFromDrive() {
    if (window.ATHubDrive?.isConnected()) {
      return loadFromPrivateDrive();
    }
    if (!sync.url) return;
    setSyncStatus("Lade aus Drive ...", "sync");
    try {
      const url = new URL(sync.url);
      if (sync.token) url.searchParams.set("token", sync.token);
      url.searchParams.set("_athub", `${appVersion}-${Date.now()}`);
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("Laden fehlgeschlagen");
      const data = await response.json();
      if (Array.isArray(data.entries)) {
        data.entries.forEach((entry) => {
          const date = entry.date || entry.datum;
          if (date) entries[date] = normalizeDriveEntry(entry, date);
        });
        normalizeStoredEntries(false);
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
    const sourceEntry = expandEmbeddedEntry(entry);
    const normalizedDate = date || getField(sourceEntry, "date", "datum", "id", "Datum");
    const textRange = extractTimeRange(firstValue(
      getField(sourceEntry, "time", "zeit", "arbeitszeit", "Arbeitszeit"),
      getField(sourceEntry, "description", "notiz", "note", "bemerkung", "Bemerkung")
    ));
    const rawStart = firstValue(
      getField(sourceEntry, "start", "kommt", "komme", "Kommt", "Beginn", "beginn", "Arbeitsbeginn", "arbeitsbeginn", "von", "Von", "startTime", "start_time"),
      textRange.start
    );
    const rawEnd = firstValue(
      getField(sourceEntry, "end", "geht", "Geht", "Ende", "ende", "Arbeitsende", "arbeitsende", "bis", "Bis", "endTime", "end_time"),
      textRange.end
    );
    const start = normalizeTimeValue(rawStart);
    const end = normalizeTimeValue(rawEnd);
    const schoolStart = normalizeTimeValue(getField(sourceEntry, "schoolStart", "school_start", "schulbeginn", "Schulbeginn", "MeisterschuleBeginn", "beginnMeisterschule"));
    const schoolEnd = normalizeTimeValue(getField(sourceEntry, "schoolEnd", "school_end", "schulende", "Schulende", "MeisterschuleEnde", "endeMeisterschule"));
    const status = normalizeStatus(getField(sourceEntry, "status", "kategorie", "Kategorie"), sourceEntry);
    const rawBox = getField(sourceEntry, "box", "boxNumber", "boxNr", "Box", "BoxNr");
    const task = cleanStatusDuplicate(getField(sourceEntry, "task", "aufgabe", "Aufgabe", "kategorie", "Kategorie"), status);
    const description = getField(sourceEntry, "description", "notiz", "note", "bemerkung", "Bemerkung");
    const rawNoteText = [task, description, getField(sourceEntry, "ort", "Ort"), getField(sourceEntry, "overnightPlace", "Übernachtung Notiz")].join(" ");
    const boxFromText = extractBoxFromText(rawNoteText);
    const boxValue = typeof rawBox === "boolean" ? boxFromText : String(rawBox || boxFromText || "").trim();
    let workplace = normalizeWorkplace(getField(sourceEntry, "workplace", "arbeitsort", "Arbeitsort", "ort", "Ort"));
    if (!workplace) workplace = inferWorkplaceFromText(rawNoteText);
    if (!workplace && (boxValue || toBoolean(rawBox))) workplace = "Box";
    const overnightPlace = getField(
      sourceEntry,
      "overnightPlace",
      "overnight_place",
      "overnightNote",
      "overnight_note",
      "uebernachtungNotiz",
      "übernachtungNotiz",
      "Übernachtung Notiz"
    );

    return applyTaxDefaults({
      ...sourceEntry,
      id: normalizedDate,
      date: normalizedDate,
      datum: normalizedDate,
      status,
      workplace,
      box: boxValue,
      externalLocation: getField(sourceEntry, "externalLocation", "external_location", "auswaertsort", "auswärtsort", "Auswärtsort", "Ort / Anlass") || inferExternalLocationFromText(rawNoteText),
      start,
      kommt: start,
      end,
      geht: end,
      pause: normalizeNumberString(getField(sourceEntry, "pause", "Pause", "pausenzeit", "Pausenzeit", "break", "breakMinutes", "pauseMinutes")),
      task,
      kategorie: status,
      description,
      ort: firstValue(getField(sourceEntry, "ort", "Ort"), workplace),
      notiz: description,
      overnightPlace,
      schoolStart,
      schoolEnd,
      overnight: toBoolean(getField(sourceEntry, "overnight", "uebernachtung", "übernachtung", "Übernachtung")),
      breakfastIncluded: toBoolean(getField(sourceEntry, "breakfastIncluded", "fruehstueck", "frühstück", "Frühstück")),
      businessTrip: toBoolean(getField(sourceEntry, "businessTrip", "dienstreise", "Dienstreise")),
      commuteOneWayKm: normalizeNumberString(getField(sourceEntry, "commuteOneWayKm", "einfacheFahrtKm", "Einfache Fahrt Arbeitsstätte (km)")),
      distanceKm: normalizeNumberString(getField(sourceEntry, "distanceKm", "commuteRoundTripKm", "Gesamt km", "gesamtKm")),
      businessKm: normalizeNumberString(getField(sourceEntry, "businessKm", "dienstlicheKilometer", "Dienstliche Kilometer")),
      training: toBoolean(getField(sourceEntry, "training", "fortbildung", "meisterschule", "Meisterschule")),
      source: sourceEntry.source || "drive-calendar-2026"
    });
  }

  function applyTaxDefaults(entry) {
    const next = { ...entry };
    next.status = normalizeStatus(next.status, next);
    const text = [next.workplace, next.externalLocation, next.task, next.description, next.ort, next.overnightPlace, next.travelRoute].join(" ");
    const status = next.status;
    const fromDrive = next.source === "drive-calendar-2026" || next.source === "drive";

    if (status === "A" && !next.start && !next.end && (!fromDrive || shouldUseHistoricalDefaultTime(next.date))) {
      next.start = "06:30";
      next.kommt = "06:30";
      next.end = "16:30";
      next.geht = "16:30";
    }

    if (status === "A" || status === "E" || next.businessTrip) {
      next.companyVehicle = next.companyVehicle !== false;
      next.vehicleType = next.vehicleType || "Dienstfahrzeug";
      next.taxAutoDeduction = false;
      next.taxReviewNote = next.taxReviewNote || "Fahrt mit Dienstfahrzeug: keine automatische Werbungskostenberechnung.";
    }

    if (next.overnight) {
      next.status = "E";
      next.workplace = "Extern";
      next.businessTrip = true;
      next.externalLocation = next.externalLocation || next.overnightPlace || next.ort || "";
      next.companyVehicle = true;
      next.vehicleType = next.vehicleType || "Dienstfahrzeug";
      next.taxAutoDeduction = false;
    }

    if ((next.workplace === "Büro" || next.workplace === "Box") && (next.start || next.end || hours(next) > 0)) {
      next.commuteOneWayKm = next.commuteOneWayKm || "16";
      next.commuteReturnKm = next.commuteReturnKm || "16";
      next.commuteRoundTripKm = next.commuteRoundTripKm || "32";
      next.distanceKm = next.distanceKm || "32";
      next.taxDistanceLabel = next.taxDistanceLabel || "Arbeitsstätte: 16 km Hinweg + 16 km Rückweg";
    }

    if (/gargnano/i.test(text)) {
      const travelDay = /anreise|abreise|hinfahrt|rückfahrt|rueckfahrt|rückreise|rueckreise|heimfahrt/i.test(text) || !next.overnight;
      next.status = "E";
      next.workplace = "Extern";
      next.businessTrip = true;
      next.externalLocation = next.externalLocation || "Gargnano";
      next.ort = next.ort || "Gargnano";
      next.overnightPlace = next.overnightPlace || "Gargnano";
      next.country = next.country || "Italien";
      next.foreignTravel = true;
      next.travelAbroad = true;
      next.companyVehicle = true;
      next.vehicleType = "Dienstfahrzeug";
      if (travelDay) {
        next.businessOneWayKm = next.businessOneWayKm || "1000";
        next.businessRoundTripKm = next.businessRoundTripKm || "";
        next.businessKm = next.businessKm || "1000";
        if (!next.travelRoute && /abreise|rückreise|rueckreise|rückfahrt|rueckfahrt|heimfahrt/i.test(text)) next.travelRoute = "Gargnano-Berlin";
        if (!next.travelRoute) next.travelRoute = "Berlin-Gargnano";
      }
      if (!next.taxDistanceLabel) next.taxDistanceLabel = travelDay
        ? "Gargnano/Italien: 1000 km je An- oder Abreisetag, Dienstfahrzeug"
        : "Gargnano/Italien: Übernachtung, keine Fahrt an diesem Tag";
    }

    if (/betriebsrat|waltersdorf|schönefeld|schoenefeld/i.test(text)) {
      next.status = "E";
      next.workplace = "Extern";
      next.businessTrip = true;
      next.externalLocation = next.externalLocation || "Waltersdorf";
      next.ort = next.ort || "Waltersdorf";
      next.businessOneWayKm = next.businessOneWayKm || "295";
      next.businessReturnKm = next.businessReturnKm || "295";
      next.businessRoundTripKm = next.businessRoundTripKm || "590";
      next.businessKm = next.businessKm || "590";
      next.travelRoute = next.travelRoute || "Wohnort-Waltersdorf-Wohnort";
      next.taxDistanceLabel = next.taxDistanceLabel || "Betriebsrat/Waltersdorf: 295 km Hinweg + 295 km Rückweg";
    }

    const berlinOvernightTravel = /berlin/i.test(text)
      && !/gargnano|betriebsrat|waltersdorf|schönefeld|schoenefeld/i.test(text)
      && next.overnight
      && (/extern|dienstreise|anreise|abreise|hinfahrt|rückfahrt|rueckfahrt|rückreise|rueckreise|heimfahrt|fahrt/i.test(text) || next.businessTrip);
    if (berlinOvernightTravel) {
      const travelDay = /anreise|abreise|hinfahrt|rückfahrt|rueckfahrt|rückreise|rueckreise|heimfahrt/i.test(text);
      next.status = "E";
      next.workplace = "Extern";
      next.businessTrip = true;
      next.externalLocation = next.externalLocation || "Berlin";
      next.ort = next.ort || "Berlin";
      next.overnightPlace = next.overnightPlace || "Berlin";
      if (travelDay) {
        next.businessOneWayKm = next.businessOneWayKm || "295";
        next.businessRoundTripKm = next.businessRoundTripKm || "";
        next.businessKm = next.businessKm || "295";
        next.travelRoute = next.travelRoute || (/abreise|rückreise|rueckreise|rückfahrt|rueckfahrt|heimfahrt/i.test(text) ? "Berlin-Wohnort" : "Wohnort-Berlin");
      }
      next.taxDistanceLabel = next.taxDistanceLabel || (travelDay
        ? "Berlin mit Übernachtung: 295 km je An- oder Abreisetag"
        : "Berlin: Übernachtung, keine Fahrt an diesem Tag");
    }

    if (next.overnight) {
      next.breakfastIncluded = next.breakfastIncluded !== false;
      next.employerAllowance = next.employerAllowance !== false;
      next.employerReportsAllowanceToTaxOffice = next.employerReportsAllowanceToTaxOffice !== false;
      next.uebernachtung = "Übernachtung";
    } else {
      next.uebernachtung = next.uebernachtung || "Keine Übernachtung";
    }

    next.kommt = next.start || next.kommt || "";
    next.geht = next.end || next.geht || "";
    next.id = next.date || next.id || next.datum;
    next.datum = next.date || next.datum || next.id;
    return next;
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
  }

  function expandEmbeddedEntry(entry) {
    const embedded = firstValue(entry.hubJson, entry.hubJSON, entry.hub_json, entry.json, entry.payload);
    if (!embedded || typeof embedded !== "string") return entry;
    try {
      const parsed = JSON.parse(embedded);
      return parsed && typeof parsed === "object" ? { ...parsed, ...entry } : entry;
    } catch (_) {
      return entry;
    }
  }

  function normalizedKey(key) {
    return String(key || "")
      .toLowerCase()
      .replace(/[ä]/g, "ae")
      .replace(/[ö]/g, "oe")
      .replace(/[ü]/g, "ue")
      .replace(/[ß]/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function getField(entry, ...names) {
    for (const name of names) {
      if (entry[name] !== undefined && entry[name] !== null && entry[name] !== "") return entry[name];
    }
    const wanted = names.map(normalizedKey);
    const found = Object.keys(entry || {}).find((key) => wanted.includes(normalizedKey(key)));
    return found ? entry[found] : "";
  }

  function normalizeStatus(value, entry = {}) {
    const text = String(value || "").trim();
    const upper = text.toUpperCase();
    if (["A", "E", "U", "F", "FT", "K"].includes(upper)) return upper;
    if (/^(ANWESEND|ARBEITSSAMSTAG|ARBEIT|BÜRO|BUERO|BOX)$/i.test(text)) return "A";
    if (/^(EXTERN|MEISTERSCHULE|FORTBILDUNG|WEITERBILDUNG)$/i.test(text)) return "E";
    if (/^URLAUB$/i.test(text)) return "U";
    if (/^(FREI|ABWESEND)$/i.test(text)) return "F";
    if (/^FEIERTAG$/i.test(text)) return "FT";
    if (/^KRANK/i.test(text)) return "K";
    if (entry.training || entry.schoolStart || entry.schoolEnd) return "E";
    if (entry.businessTrip) return "E";
    return text ? upper : "";
  }

  function statusLabel(value) {
    return ({
      A: "Anwesend",
      E: "Extern",
      U: "Urlaub",
      F: "Frei",
      FT: "Feiertag",
      K: "Krank"
    })[normalizeStatus(value)] || "";
  }

  function cleanStatusDuplicate(value, status) {
    const text = String(value || "").trim();
    if (!text) return "";
    const label = statusLabel(status);
    if (label && text.toLowerCase() === label.toLowerCase()) return "";
    if (text.toUpperCase() === status) return "";
    return text;
  }

  function displayTitle(entry, statusText) {
    const candidates = [entry.task, entry.workplace, entry.externalLocation, entry.description]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => value.toLowerCase() !== String(statusText || "").toLowerCase());
    return candidates[0] || (statusText ? "" : "Noch kein Eintrag");
  }

  function normalizeTimeValue(value) {
    if (value === undefined || value === null || value === "") return "";
    if (value instanceof Date) {
      return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const dayFraction = value >= 1 ? value - Math.floor(value) : value;
      const minutes = Math.round(dayFraction * 24 * 60);
      return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
    const text = String(value).trim();
    const timeMatch = text.match(/(\d{1,2})[:.](\d{2})/);
    if (timeMatch) return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
    return "";
  }

  function extractTimeRange(value) {
    const text = String(value || "");
    const match = text.match(/(\d{1,2})[:.](\d{2})\s*(?:-|–|bis|to)\s*(\d{1,2})[:.](\d{2})/i);
    if (!match) return { start: "", end: "" };
    return {
      start: `${match[1].padStart(2, "0")}:${match[2]}`,
      end: `${match[3].padStart(2, "0")}:${match[4]}`
    };
  }

  function shouldUseHistoricalDefaultTime(date) {
    return /^2026-(0[1-8])-\d{2}$/.test(String(date || ""));
  }

  function normalizeNumberString(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const text = String(value).trim().replace(",", ".");
    return text && !Number.isNaN(Number(text)) ? text : "";
  }

  function normalizeWorkplace(value) {
    const text = String(value || "").trim();
    if (/^büro$|^buero$/i.test(text)) return "Büro";
    if (/^box$/i.test(text)) return "Box";
    if (/^extern$/i.test(text)) return "Extern";
    return text;
  }

  function inferWorkplaceFromText(value) {
    const text = String(value || "");
    if (/box/i.test(text)) return "Box";
    if (/extern|bochum|berlin|gargnano|waltersdorf|betriebsrat|schoenefeld|schönefeld|übernachtung|uebernachtung/i.test(text)) return "Extern";
    if (/buero|büro/i.test(text)) return "Büro";
    return "";
  }

  function extractBoxFromText(value) {
    const match = String(value || "").match(/\bbox\s*([0-9A-Za-z-]+)/i);
    return match ? match[1].trim() : "";
  }

  function inferExternalLocationFromText(value) {
    const parts = String(value || "").split("|").map((part) => part.trim()).filter(Boolean);
    if (/gargnano/i.test(value)) return "Gargnano";
    if (/berlin/i.test(value)) return "Berlin";
    if (/waltersdorf|betriebsrat|schoenefeld|schönefeld/i.test(value)) return "Waltersdorf / Betriebsrat";
    return parts.find((part) => /extern|bochum|gargnano|berlin|waltersdorf|betriebsrat|schoenefeld|schönefeld/i.test(part)) || "";
  }

  function toBoolean(value) {
    if (value === true || value === false) return value;
    if (typeof value === "number") return value !== 0;
    return /^(true|ja|yes|1|übernachtung)$/i.test(String(value || "").trim());
  }

  function isWorkEntry(entry) {
    const status = normalizeStatus(entry.status, entry);
    return status === "A" || status === "E" || hours(entry) > 0;
  }

  function isExternalEntry(entry) {
    return normalizeStatus(entry.status, entry) === "E" || entry.businessTrip === true;
  }

  function numericKm(value) {
    if (value === undefined || value === null || value === "") return 0;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : 0;
  }

  function commuteRoundTripKm(entry) {
    if (!(entry.workplace === "Büro" || entry.workplace === "Box")) return 0;
    if (!entry.start && !entry.end && hours(entry) === 0) return 0;
    return numericKm(entry.commuteRoundTripKm) || numericKm(entry.commuteKm) || numericKm(entry.distanceKm) || (numericKm(entry.commuteOneWayKm) + numericKm(entry.commuteReturnKm));
  }

  function businessTravelKm(entry) {
    return numericKm(entry.businessRoundTripKm) || numericKm(entry.businessKm) || (numericKm(entry.businessOneWayKm) + numericKm(entry.businessReturnKm));
  }

  function taxEntryType(entry) {
    if (isExternalEntry(entry)) return entry.foreignTravel || entry.travelAbroad ? "Extern Ausland" : "Extern";
    if (entry.workplace === "Box") return "Box";
    if (entry.workplace === "Büro") return "Büro";
    if (entry.training || schoolHours(entry) > 0) return "Meisterschule";
    return statusLabel(entry.status) || "-";
  }

  function taxPlace(entry) {
    return firstValue(entry.externalLocation, entry.overnightPlace, entry.ort, entry.workplace, entry.travelRoute, "");
  }

  function taxHint(entry) {
    if (entry.taxDistanceLabel) return entry.taxDistanceLabel;
    if (entry.companyVehicle || entry.vehicleType === "Dienstfahrzeug") return "Dienstfahrzeug; keine automatische Entfernungspauschale.";
    return "";
  }

  function formatKm(value) {
    const number = numericKm(value);
    return number ? number.toFixed(0).replace(".", ",") : "";
  }

  function formatDateShort(value) {
    if (!value) return "";
    const [year, month, day] = String(value).split("-");
    return day && month ? `${day}.${month}.` : String(value);
  }

  function normalizeLocalEntry(entry, date) {
    const status = normalizeStatus(firstValue(entry.status, entry.kategorie), entry);
    const start = normalizeTimeValue(firstValue(getField(entry, "start", "kommt", "Kommt", "Beginn", "Arbeitsbeginn"), entry.start, entry.kommt));
    const end = normalizeTimeValue(firstValue(getField(entry, "end", "geht", "Geht", "Ende", "Arbeitsende"), entry.end, entry.geht));
    const rawBox = firstValue(entry.box, entry.boxNumber, entry.boxNr);
    const boxValue = typeof rawBox === "boolean" ? "" : String(rawBox || "").trim();
    let workplace = normalizeWorkplace(firstValue(entry.workplace, entry.ort));
    if (!workplace && (boxValue || toBoolean(rawBox))) workplace = "Box";

    return applyTaxDefaults({
      ...entry,
      id: date,
      date,
      datum: date,
      status,
      workplace,
      box: boxValue,
      start,
      kommt: start,
      end,
      geht: end,
      pause: normalizeNumberString(entry.pause),
      task: cleanStatusDuplicate(firstValue(entry.task, entry.kategorie), status),
      description: firstValue(entry.description, entry.notiz),
      schoolStart: normalizeTimeValue(entry.schoolStart),
      schoolEnd: normalizeTimeValue(entry.schoolEnd),
      overnight: toBoolean(entry.overnight),
      breakfastIncluded: toBoolean(entry.breakfastIncluded),
      businessTrip: toBoolean(entry.businessTrip),
      training: toBoolean(entry.training)
    });
  }

  function normalizeStoredEntries(shouldSave = true) {
    const normalized = {};
    let changed = false;
    Object.entries(entries || {}).forEach(([key, entry]) => {
      if (!entry || typeof entry !== "object") return;
      const date = entry.date || entry.datum || entry.id || key;
      if (!date) return;
      const fromDrive = entry.source === "drive-calendar-2026" || entry.source === "drive" || entry.rowNumber;
      const next = fromDrive ? normalizeDriveEntry(entry, date) : normalizeLocalEntry(entry, date);
      const nextKey = next.date || date;
      normalized[nextKey] = next;
      if (nextKey !== key || JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
    });
    entries = normalized;
    if (changed && shouldSave) saveLocal();
  }

  async function pushAllLocalToDrive() {
    if (window.ATHubDrive?.isConnected()) {
      return saveWorktimeToPrivateDrive(true);
    }
    if (!sync.url) {
      configureSync();
      if (!sync.url) return;
    }

    const list = Object.values(entries)
      .filter((entry) => entry.date || entry.datum || entry.id)
      .map((entry) => applyTaxDefaults(entry))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!list.length) {
      setSyncStatus("Keine lokalen Daten zum Hochladen", "open");
      return;
    }
    const confirmed = confirm(`${list.length} lokale Kalendertage nach Drive hochladen und dort aktualisieren?`);
    if (!confirmed) return;

    setSyncStatus("Lade lokale Daten nach Drive hoch ...", "sync");
    try {
      const response = await fetch(sync.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: sync.token, entries: list })
      });
      if (!response.ok) throw new Error("Upload fehlgeschlagen");
      const data = await response.json();
      if (data.ok === false) throw new Error(data.error || "Upload abgelehnt");
      if (Array.isArray(data.entries)) {
        data.entries.forEach((entry) => {
          if (entry.date) entries[entry.date] = normalizeDriveEntry(entry, entry.date);
        });
        saveLocal();
        renderCalendar();
      }
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus(`${data.count || list.length} Tag(e) in Drive gespeichert`, "ok");
    } catch (_) {
      setSyncStatus("Upload nicht erfolgreich, lokal bleibt alles erhalten", "open");
    }
  }

  function configureSync() {
    if (window.ATHubDrive) {
      connectPrivateDrive();
      return;
    }
    const url = prompt("Apps-Script-Web-App-URL für den Arbeitszeitkalender:", sync.url || "");
    if (url === null) return;
    const token = prompt("Sync-Token:", sync.token || "");
    if (token === null) return;
    sync = { url: url.trim(), token: token.trim() };
    saveSyncConfig();
    setSyncStatus(sync.url ? "Drive verbunden" : "Drive-Sync vorbereitet", sync.url ? "ok" : "open");
    if (sync.url) loadFromDrive();
  }

  function worktimePayload() {
    return {
      year: viewDate.getFullYear(),
      entries: Object.values(entries)
        .filter((entry) => entry.date || entry.datum || entry.id)
        .map((entry) => applyTaxDefaults(entry))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
      updatedAt: new Date().toISOString(),
      source: "AT HUB Arbeitszeitkalender"
    };
  }

  function extractPrivateWorktime(data) {
    const section = window.ATHubDrive.sectionValue(data, "translogistik") || data;
    return section.worktime || section.arbeitszeit || data.worktime || data.arbeitszeit || {};
  }

  async function connectPrivateDrive() {
    setSyncStatus("Google-Anmeldung wird geöffnet ...", "sync");
    try {
      await window.ATHubDrive.connect();
      setSyncStatus("Google Drive verbunden", "ok");
      await loadFromPrivateDrive();
    } catch (_) {
      setSyncStatus("Google Drive wurde nicht verbunden", "open");
    }
  }

  async function loadFromPrivateDrive() {
    setSyncStatus("Lade private Hub-Daten ...", "sync");
    try {
      const data = await window.ATHubDrive.readData();
      const worktime = extractPrivateWorktime(data);
      const list = Array.isArray(worktime.entries) ? worktime.entries : [];
      list.forEach((entry) => {
        const date = entry.date || entry.datum || entry.id;
        if (date) entries[date] = normalizeDriveEntry(entry, date);
      });
      normalizeStoredEntries(false);
      saveLocal();
      renderCalendar();
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus(`Private Daten geladen (${list.length} Tage)`, "ok");
    } catch (_) {
      setSyncStatus("Private Daten konnten nicht geladen werden", "open");
    }
  }

  async function saveWorktimeToPrivateDrive(confirmUpload = false) {
    const payload = worktimePayload();
    if (confirmUpload && !confirm(`${payload.entries.length} lokale Kalendertage in deine private AT-HUB-Datei speichern?`)) return;
    setSyncStatus("Speichere in privatem Google Drive ...", "sync");
    try {
      const data = await window.ATHubDrive.readData();
      const remoteWorktime = extractPrivateWorktime(data);
      const remoteEntries = Array.isArray(remoteWorktime.entries) ? remoteWorktime.entries : [];
      if (!payload.entries.length && remoteEntries.length) {
        setSyncStatus("Schutz aktiv: Leerer lokaler Kalender wurde nicht gespeichert", "open");
        return;
      }
      const current = window.ATHubDrive.sectionValue(data, "translogistik") || {};
      await window.ATHubDrive.updateSection("translogistik", { ...current, arbeitszeit: payload });
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus("Private Hub-Daten gespeichert", "ok");
    } catch (_) {
      setSyncStatus("Lokal gespeichert, privater Drive-Sync offen", "open");
    }
  }

  async function restoreCalendarMaster() {
    if (!window.ATHubDrive?.isConnected()) {
      setSyncStatus("Bitte zuerst mit Google Drive verbinden", "open");
      return;
    }
    setSyncStatus("Prüfe Arbeitskalender-Master ...", "sync");
    try {
      const response = await fetch("/api/calendar-master-2026", { cache: "no-store" });
      if (!response.ok) throw new Error("Kalender-Master nicht erreichbar");
      const master = await response.json();
      const list = Array.isArray(master.entries) ? master.entries : [];
      if (list.length !== 365) throw new Error("Kalender-Master ist unvollständig");
      if (!confirm(`Der Arbeitskalender-Master enthält ${list.length} Tage. Die derzeitige private Kalendersektion wird durch diese Wiederherstellung ersetzt. Fortfahren?`)) return;

      setSyncStatus("Stelle ${list.length} Kalendertage wieder her ...", "sync");
      const data = await window.ATHubDrive.readData();
      const current = window.ATHubDrive.sectionValue(data, "translogistik") || {};
      const payload = {
        source: "Arbeitszeitkalender-Master-2026",
        restoredAt: new Date().toISOString(),
        entries: list
      };
      await window.ATHubDrive.updateSection("translogistik", { ...current, arbeitszeit: payload });

      entries = {};
      list.forEach((entry) => {
        const date = entry.date || entry.datum || entry.id;
        if (date) entries[date] = normalizeDriveEntry(entry, date);
      });
      normalizeStoredEntries(false);
      saveLocal();
      renderCalendar();
      localStorage.setItem("athubWorktimeLastSync", new Date().toISOString());
      setSyncStatus(`${list.length} Kalendertage aus dem Master wiederhergestellt`, "ok");
    } catch (error) {
      const detail = String(error?.message || "unbekannter Fehler").replace(/[<>]/g, "");
      setSyncStatus(`Kalender-Master konnte nicht wiederhergestellt werden: ${detail}`, "open");
    }
  }

  function countWorktimeEntries(data) {
    const worktime = extractPrivateWorktime(data);
    return Array.isArray(worktime.entries) ? worktime.entries.length : 0;
  }

  async function checkDriveRecovery() {
    if (!window.ATHubDrive?.isConnected()) {
      setSyncStatus("Bitte zuerst mit Google Drive verbinden", "open");
      return;
    }
    setSyncStatus("Prüfe frühere Drive-Versionen ...", "sync");
    try {
      const revisions = await window.ATHubDrive.listRevisions();
      const candidates = [];
      const newestFirst = revisions
        .slice()
        .sort((left, right) => String(right.modifiedTime).localeCompare(String(left.modifiedTime)))
        .slice(0, 10);
      for (const revision of newestFirst) {
        const data = await window.ATHubDrive.readRevision(revision.id);
        const count = countWorktimeEntries(data);
        if (count) candidates.push({ ...revision, count, data });
      }
      recoveryCandidate = candidates[0] || null;
      if (!recoveryCandidate) {
        setSyncStatus("Keine frühere Drive-Version mit Arbeitszeitdaten gefunden", "open");
        return;
      }
      const stamp = new Date(recoveryCandidate.modifiedTime).toLocaleString("de-DE");
      setSyncStatus(`${candidates.length} Sicherung(en) gefunden: ${recoveryCandidate.count} Tage vom ${stamp}`, "ok");
      if (confirm(`Eine frühere Drive-Version vom ${stamp} enthält ${recoveryCandidate.count} Arbeitszeittage. Diese Version wiederherstellen?`)) {
        await window.ATHubDrive.writeData(recoveryCandidate.data);
        await loadFromPrivateDrive();
        setSyncStatus(`${recoveryCandidate.count} Arbeitszeittage wiederhergestellt`, "ok");
      }
    } catch (error) {
      const detail = String(error?.message || "unbekannter Fehler").replace(/[<>]/g, "");
      if (detail.includes("cannotDownloadRevision")) {
        setSyncStatus("Google Drive sperrt den automatischen Download alter Versionen. Künftige Änderungen erhalten zusätzlich eine private Tages-Sicherung.", "open");
        return;
      }
      setSyncStatus(`Drive-Versionen konnten nicht geprüft werden: ${detail}`, "open");
    }
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
    normalizeStoredEntries();
    injectTaxTabs();
    const masterRestoreButton = $("wtImportMasterBtn");
    if (masterRestoreButton && !["127.0.0.1", "localhost"].includes(location.hostname)) {
      masterRestoreButton.hidden = true;
    }
    $("wtPrevMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCalendar(); });
    $("wtNextMonth")?.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCalendar(); });
    $("wtTodayBtn")?.addEventListener("click", () => { viewDate = new Date(); renderCalendar(); });
    $("wtYearBtn")?.addEventListener("click", () => document.querySelector('[data-wt-panel="year"]')?.click());
    $("wtConnectBtn")?.addEventListener("click", configureSync);
    $("wtSyncBtn")?.addEventListener("click", loadFromDrive);
    $("wtPushAllBtn")?.addEventListener("click", pushAllLocalToDrive);
    masterRestoreButton?.addEventListener("click", restoreCalendarMaster);
    $("wtRecoveryBtn")?.addEventListener("click", checkDriveRecovery);
    $("wtForm")?.addEventListener("submit", saveEntry);
    $("wtCloseBtn")?.addEventListener("click", () => { $("wtModal").hidden = true; });
    $("wtCancelBtn")?.addEventListener("click", () => { $("wtModal").hidden = true; });
    $("wtClearBtn")?.addEventListener("click", clearEntry);
    setSyncStatus("Google Drive kann bei Bedarf verbunden werden", "open");
    loadCentralSyncConfig()
      .then(loadSeedData)
      .then(() => sync.url ? loadFromDrive() : null)
      .finally(renderCalendar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
