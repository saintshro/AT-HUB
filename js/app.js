const translogistikModules = [
  { id: "arbeitszeitkalender", title: "Arbeitszeitkalender", description: "Arbeitszeit, Übernachtungen, Meisterschule, Urlaub, Krankheit und Steuerübersicht." },
  { id: "mitarbeiter", title: "Mitarbeiter", description: "Stammdaten, Gruppen, Personalnummern und Einsatzdaten." },
  { id: "webfleet", title: "WEBFLEET", description: "Fahrzeiten, Standzeiten, Tourdaten und reale Auswertungen." },
  { id: "bkf", title: "BKF-Manager", description: "Module, Fahrerkarte, Führerschein und Code 95." },
  { id: "teams", title: "Teams", description: "Boxen, feste Teams, Fahrzeuge und Anhänger." },
  { id: "fahrzeuge", title: "Fahrzeuge", description: "Sprinter, LKW, Kennzeichen, Status und Zuordnung." },
  { id: "anhaenger", title: "Anhänger", description: "Kennzeichen, TÜV, Status und Einsatz." },
  { id: "tourenplanung", title: "Tourenplanung", description: "Planzeiten, Fahrzeiten, Montagezeiten und Belastung." },
  { id: "reklamation", title: "Reklamationsmanager", description: "Vorgänge, Ursachen, Kommunikation und Lösungsstatus." },
  { id: "dokumente", title: "Dokumente", description: "Verträge, Nachweise, Auswertungen und Ablage." },
  { id: "auswertungen", title: "Auswertungen", description: "Monats-, Jahres- und Themenauswertungen." },
  { id: "archiv", title: "Archiv", description: "Ehemalige Daten, abgeschlossene Vorgänge und Historie." }
];

function openMain(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add("active");
  }

  const clickedTab = [...document.querySelectorAll(".tab")]
    .find(button => button.textContent.toLowerCase().includes(getTabKeyword(pageId)));

  if (clickedTab) {
    clickedTab.classList.add("active");
  }

  if (pageId === "translogistik") {
    renderSubTabs();
  } else {
    hideSubTabs();
  }
}

function getTabKeyword(pageId) {
  const keywords = {
    dashboard: "dashboard",
    translogistik: "translogistik",
    privat: "privat",
    wissen: "projekte",
    siggi: "siggi",
    einstellungen: "einstellungen"
  };

  return keywords[pageId] || pageId;
}

function renderSubTabs() {
  const subTabs = document.getElementById("subTabs");
  subTabs.innerHTML = "";

  translogistikModules.forEach(module => {
    const button = document.createElement("button");
    button.textContent = module.title;
    button.onclick = () => openModule(module.id);
    subTabs.appendChild(button);
  });

  subTabs.classList.remove("hidden");
}

function hideSubTabs() {
  const subTabs = document.getElementById("subTabs");
  subTabs.classList.add("hidden");
  subTabs.innerHTML = "";
}

function openModule(moduleId) {
  const module = translogistikModules.find(item => item.id === moduleId);

  if (!module) return;

  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  document.getElementById("modulePage").classList.add("active");
  document.getElementById("moduleTitle").textContent = module.title;
  document.getElementById("moduleDescription").textContent = module.description;

  renderSubTabs();

  document.querySelectorAll("#subTabs button").forEach(button => {
    button.classList.toggle("active", button.textContent === module.title);
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  const translogistikTab = [...document.querySelectorAll(".tab")]
    .find(button => button.textContent.toLowerCase().includes("translogistik"));

  if (translogistikTab) {
    translogistikTab.classList.add("active");
  }
}

function updateDateTime() {
  const now = new Date();

  const dateText = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const timeText = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const dateTargets = ["todayDate", "dashboardDate"];
  const timeTargets = ["currentTime", "dashboardTime"];

  dateTargets.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = dateText;
  });

  timeTargets.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = timeText;
  });
}

updateDateTime();
setInterval(updateDateTime, 1000);
