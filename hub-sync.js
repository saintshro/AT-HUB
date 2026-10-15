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
})();
