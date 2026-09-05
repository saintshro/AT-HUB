(() => {
  const $ = (id) => document.getElementById(id);

  function fire(el, type = "change") {
    if (!el) return;
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function setValue(id, value, overwrite = true) {
    const el = $(id);
    if (!el) return;
    if (overwrite || !el.value) {
      el.value = value;
      fire(el);
    }
  }

  function setChecked(id, value) {
    const el = $(id);
    if (!el) return;
    el.checked = Boolean(value);
    fire(el);
  }

  function applyPresenceDefaults() {
    const status = $("wtStatus")?.value;
    const workplace = $("wtWorkplace")?.value;
    if (status === "A" && (workplace === "Büro" || workplace === "Box")) {
      setValue("wtStart", "06:30", false);
      setValue("wtEnd", "16:30", false);
      setValue("wtPause", $("wtPause")?.value || "0", false);
      setValue("wtDistanceKm", "16", true);
      setChecked("wtBusinessTrip", false);
      if (!$("wtTask")?.value) setValue("wtTask", workplace, true);
      if (workplace === "Box") setValue("wtBox", $("wtBox")?.value || "658", false);
    }
    if (status === "E" || workplace === "Extern") {
      setValue("wtStatus", "E", true);
      setValue("wtWorkplace", "Extern", true);
      setChecked("wtBusinessTrip", true);
      setValue("wtDistanceKm", "", true);
      if (!$("wtTask")?.value) setValue("wtTask", "Extern", true);
    }
  }

  function clearWorkFields(label) {
    setValue("wtTask", label, true);
    ["wtStart", "wtEnd", "wtSchoolStart", "wtSchoolEnd", "wtDistanceKm", "wtBusinessKm"].forEach((id) => setValue(id, "", true));
    setChecked("wtBusinessTrip", false);
    setChecked("wtTraining", false);
    setChecked("wtOvernight", false);
  }

  function applyQuick(type) {
    if (type === "buero") {
      setValue("wtStatus", "A");
      setValue("wtWorkplace", "Büro");
      setValue("wtTask", "Büro", false);
      applyPresenceDefaults();
    }
    if (type === "box") {
      setValue("wtStatus", "A");
      setValue("wtWorkplace", "Box");
      setValue("wtBox", $("wtBox")?.value || "658", false);
      setValue("wtTask", "Box", false);
      applyPresenceDefaults();
    }
    if (type === "extern") {
      setValue("wtStatus", "E");
      setValue("wtWorkplace", "Extern");
      setChecked("wtBusinessTrip", true);
      setValue("wtDistanceKm", "");
      if (!$("wtTask")?.value) setValue("wtTask", "Extern");
    }
    if (type === "urlaub") {
      setValue("wtStatus", "U");
      clearWorkFields("Urlaub");
    }
    if (type === "frei") {
      setValue("wtStatus", "F");
      clearWorkFields("Frei");
    }
    if (type === "krank") {
      setValue("wtStatus", "K");
      clearWorkFields("Krank");
    }
  }

  function ensureQuickbar() {
    const form = $("wtForm");
    if (!form || $("wtQuickbar")) return;
    const bar = document.createElement("div");
    bar.id = "wtQuickbar";
    bar.className = "wt-quickbar wt-span2";
    bar.innerHTML = `
      <button type="button" data-wt-quick="buero">Büro</button>
      <button type="button" data-wt-quick="box">Box</button>
      <button type="button" data-wt-quick="extern">Extern</button>
      <button type="button" data-wt-quick="urlaub">Urlaub</button>
      <button type="button" data-wt-quick="frei">Frei</button>
      <button type="button" data-wt-quick="krank">Krank</button>
    `;
    form.insertBefore(bar, form.querySelector("label"));
    bar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-wt-quick]");
      if (btn) applyQuick(btn.dataset.wtQuick);
    });
    ["wtStatus", "wtWorkplace"].forEach((id) => $(id)?.addEventListener("change", applyPresenceDefaults));
  }

  function daySummary(button) {
    const date = button.dataset.date || "";
    const status = button.dataset.status || button.querySelector(".wt-status")?.textContent?.trim() || "";
    const title = button.querySelector("strong")?.textContent?.trim() || button.getAttribute("aria-label") || date;
    const detail = button.querySelector("small")?.textContent?.trim() || "";
    const number = date.slice(-2).replace(/^0/, "") || title.match(/\d+/)?.[0] || "";
    return { date, status, title, detail, number };
  }

  function updateAgenda() {
    const calendar = $("wtCalendar");
    const agenda = $("wtAgenda");
    if (!calendar || !agenda) return;
    const days = [...calendar.querySelectorAll(".wt-day[data-date]")].map(daySummary).filter((day) => day.date);
    const filled = days.filter((day) => day.status || day.detail || !/nicht/i.test(day.title));
    const rows = (filled.length ? filled : days).map((day) => `
      <button type="button" class="wt-agenda-row" data-date="${day.date}">
        <span class="wt-agenda-date">${day.number}</span>
        <span><strong>${day.title}</strong><small>${day.detail || "Noch kein Eintrag"}</small></span>
        <span class="wt-agenda-status">${day.status || "–"}</span>
      </button>
    `).join("");
    agenda.innerHTML = rows || "<p class=\"subtle\">Fuer diesen Monat sind noch keine Tage vorhanden.</p>";
    agenda.querySelectorAll("[data-date]").forEach((row) => {
      row.addEventListener("click", () => {
        calendar.querySelector(`.wt-day[data-date="${row.dataset.date}"]`)?.click();
      });
    });
  }

  function ensureMonthTools() {
    const toolbar = document.querySelector(".wt-toolbar");
    if (!toolbar || $("wtFocusbar")) return;
    const focusbar = document.createElement("section");
    focusbar.id = "wtFocusbar";
    focusbar.className = "wt-focusbar";
    focusbar.innerHTML = `
      <div>
        <strong>Monatsliste</strong>
        <span class="subtle">Schneller lesen, schneller erfassen, gleiche Datenbasis.</span>
      </div>
      <button type="button" class="secondary-btn" id="wtOpenToday">Heute öffnen</button>
    `;
    toolbar.after(focusbar);
    $("wtOpenToday")?.addEventListener("click", () => {
      const today = new Date().toISOString().slice(0, 10);
      $("wtCalendar")?.querySelector(`.wt-day[data-date="${today}"]`)?.click();
    });

    const panel = document.querySelector(".wt-panel");
    if (panel && !$("wtAgenda")) {
      const agendaWrap = document.createElement("section");
      agendaWrap.className = "wt-panel wt-agenda-panel";
      agendaWrap.innerHTML = `
        <div class="section-title"><div><h2>Monatsliste</h2><p>Alle gepflegten Tage auf einen Blick.</p></div></div>
        <div class="wt-agenda" id="wtAgenda"></div>
      `;
      panel.after(agendaWrap);
    }
  }

  function addStyles() {
    if ($("wtUi103Styles")) return;
    const style = document.createElement("style");
    style.id = "wtUi103Styles";
    style.textContent = `
      .wt-focusbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 16px;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.04)}
      .wt-focusbar strong{display:block;margin-bottom:3px}
      .wt-agenda-panel{margin-top:16px}
      .wt-agenda{display:grid;gap:8px}
      .wt-agenda-row{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:12px;width:100%;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.035);color:inherit;text-align:left;cursor:pointer}
      .wt-agenda-row:hover{border-color:rgba(94,234,212,.32);background:rgba(94,234,212,.07)}
      .wt-agenda-date{display:grid;place-items:center;min-height:36px;border-radius:8px;background:rgba(255,255,255,.07);font-weight:800}
      .wt-agenda-row small{display:block;color:var(--muted,#9ca3af);font-size:13px;margin-top:2px}
      .wt-agenda-status{font-weight:800;color:#8ee7cf}
      .wt-quickbar{display:flex;flex-wrap:wrap;gap:8px;padding:10px;border-radius:10px;background:rgba(94,234,212,.06);border:1px solid rgba(94,234,212,.18)}
      .wt-quickbar button{border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.06);color:inherit;padding:9px 11px;font-weight:700;cursor:pointer}
      .wt-quickbar button:hover{border-color:rgba(94,234,212,.42);background:rgba(94,234,212,.12)}
      @media (max-width:720px){
        .wt-focusbar{align-items:flex-start;flex-direction:column}
        .wt-agenda-row{grid-template-columns:38px 1fr;align-items:flex-start}
        .wt-agenda-status{grid-column:2}
      }
    `;
    document.head.appendChild(style);
  }

  function init() {
    addStyles();
    ensureMonthTools();
    ensureQuickbar();
    updateAgenda();
    const calendar = $("wtCalendar");
    if (calendar) new MutationObserver(updateAgenda).observe(calendar, { childList: true, subtree: true, attributes: true });
    const modal = $("wtModal");
    if (modal) new MutationObserver(ensureQuickbar).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
