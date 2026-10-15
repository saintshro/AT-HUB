(() => {
  const current = document.querySelector("[data-page].active")?.dataset.page;
  document.querySelectorAll("[data-page]").forEach((link) => {
    if (current && link.dataset.page === current) link.classList.add("active");
  });

  function updateClock() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = document.getElementById("greeting");
    if (greeting) {
      let text = "Willkommen, Alex";
      if (hour >= 5 && hour < 11) text = "Guten Morgen, Alex";
      else if (hour >= 11 && hour < 17) text = "Guten Tag, Alex";
      else if (hour >= 17 && hour < 22) text = "Guten Abend, Alex";
      else text = "Gute Nacht, Alex";
      greeting.textContent = text;
    }

    const dateText = document.getElementById("dateText");
    if (dateText) {
      dateText.textContent = now.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
    }

    const timeText = document.getElementById("timeText");
    if (timeText) timeText.textContent = now.toLocaleTimeString("de-DE");
  }

  updateClock();
  setInterval(updateClock, 1000);

  const focusInput = document.getElementById("dailyFocus");
  const focusSave = document.getElementById("saveDailyFocus");
  const focusState = document.getElementById("dailyFocusState");
  if (focusInput && focusSave) {
    const key = "athub.dailyFocus";
    try { focusInput.value = localStorage.getItem(key) || ""; } catch (_) {}
    focusSave.addEventListener("click", () => {
      try {
        localStorage.setItem(key, focusInput.value.trim());
        if (focusState) focusState.textContent = "Tagesnotiz lokal gespeichert.";
      } catch (_) {
        if (focusState) focusState.textContent = "Lokales Speichern ist in diesem Browser nicht verfügbar.";
      }
    });
  }

  async function loadHubStatus() {
    try {
      const response = await fetch("hub-status.json", { cache: "no-store" });
      if (!response.ok) return;
      const status = await response.json();

      const bkfStatus = document.getElementById("bkfDailyStatus");
      const bkfDetail = document.getElementById("bkfDailyDetail");
      if (bkfStatus && status.bkf) {
        bkfStatus.textContent = status.bkf.action_needed + " Fälle mit Handlungsbedarf";
      }
      if (bkfDetail && status.bkf) {
        bkfDetail.textContent =
          status.bkf.red + " ROT · " +
          status.bkf.orange + " ORANGE · " +
          status.bkf.yellow + " GELB · " +
          status.bkf.review + " PRÜFEN ›";
      }

      const schoolStatus = document.getElementById("schoolDailyStatus");
      const schoolDetail = document.getElementById("schoolDailyDetail");
      if (schoolStatus && status.calendar) {
        schoolStatus.textContent = status.calendar.meisterschule_today
          ? "Meisterschule heute"
          : "Heute kein Meisterschul-Termin";
      }
      if (schoolDetail && status.calendar) {
        schoolDetail.textContent = status.calendar.label + " ›";
      }

      const vehicleStatus = document.getElementById("vehicleDailyStatus");
      const vehicleDetail = document.getElementById("vehicleDailyDetail");
      if (vehicleStatus && status.vehicles) {
        vehicleStatus.textContent = status.vehicles.available
          ? status.vehicles.label
          : "Fahrzeugstatus noch nicht live";
      }
      if (vehicleDetail && status.vehicles) {
        vehicleDetail.textContent = status.vehicles.label + " ›";
      }
    } catch (_) {}
  }

  loadHubStatus();

  const calendarStatus = document.getElementById("calendarDailyStatus");
  const calendarDetail = document.getElementById("calendarDailyDetail");
  if (calendarStatus && calendarDetail) {
    const today = new Date();
    calendarStatus.textContent = "Termine heute";
    calendarDetail.textContent = today.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit"
    }) + " · Google Kalender öffnen ›";
  }

  function normaliseCalendarEmbed(value) {
    const raw = (value || "").trim();
    if (!raw) return "";
    const srcMatch = raw.match(/src=["']([^"']+)["']/i);
    const candidate = srcMatch ? srcMatch[1] : raw;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || url.hostname !== "calendar.google.com") return "";
      if (!url.pathname.includes("/calendar/embed")) return "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function initCalendarWidget() {
    const setup = document.getElementById("calendarWidgetSetup");
    const wrap = document.getElementById("calendarWidgetFrameWrap");
    const frame = document.getElementById("hubCalendarFrame");
    const input = document.getElementById("calendarEmbedInput");
    const save = document.getElementById("calendarEmbedSave");
    const reset = document.getElementById("calendarWidgetReset");
    const state = document.getElementById("calendarWidgetState");
    if (!setup || !wrap || !frame || !input || !save || !reset) return;

    const key = "athub.googleCalendarEmbedUrl.v2";
    const defaultUrl = "https://calendar.google.com/calendar/embed?ctz=Europe%2FBerlin&src=herrthiel.hro%40gmail.com&src=cdb8c99375b360422bc8a344f9bdb71446cf6476c334ffee094ffdbfc3828a7a%40group.calendar.google.com&src=de.german%23holiday%40group.v.calendar.google.com";

    const render = () => {
      let url = "";
      try { url = localStorage.getItem(key) || defaultUrl; } catch (_) { url = defaultUrl; }
      url = normaliseCalendarEmbed(url);
      if (url) {
        frame.src = url;
        wrap.hidden = false;
        setup.hidden = true;
        if (state) state.textContent = "Kalender-Widget verbunden · Hauptkalender + Familie + Feiertage.";
      } else {
        frame.removeAttribute("src");
        wrap.hidden = true;
        setup.hidden = false;
        if (state) state.textContent = "Kalender noch nicht mit diesem Browser verbunden.";
      }
    };

    save.addEventListener("click", () => {
      const url = normaliseCalendarEmbed(input.value);
      if (!url) {
        if (state) state.textContent = "Bitte eine gültige Google-Kalender-Einbettungsadresse einfügen.";
        return;
      }
      try { localStorage.setItem(key, url); } catch (_) {}
      input.value = "";
      render();
    });

    reset.addEventListener("click", () => {
      try { localStorage.removeItem(key); } catch (_) {}
      render();
    });

    render();
  }

  initCalendarWidget();
})();
