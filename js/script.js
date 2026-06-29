function updateDateTime() {
    const now = new Date();

    const hour = now.getHours();
    let greeting = "Willkommen, Alex";

    if (hour >= 5 && hour < 11) {
        greeting = "Guten Morgen, Alex";
    } else if (hour >= 11 && hour < 17) {
        greeting = "Guten Tag, Alex";
    } else if (hour >= 17 && hour < 22) {
        greeting = "Guten Abend, Alex";
    } else {
        greeting = "Gute Nacht, Alex";
    }

    const greetingElement = document.getElementById("greeting");
    if (greetingElement) {
        greetingElement.textContent = greeting;
    }

    const dateElement = document.getElementById("date");
    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString("de-DE", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    const timeElement = document.getElementById("time");
    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString("de-DE") + " Uhr";
    }

    const topClock = document.getElementById("topClock");
    if (topClock) {
        topClock.textContent = now.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit"
        }) + " Uhr";
    }
}

updateDateTime();
setInterval(updateDateTime, 1000);
function openGoogleTerminForm() {
  document.getElementById("googleTerminForm").classList.remove("hidden");
}

function closeGoogleTerminForm() {
  document.getElementById("googleTerminForm").classList.add("hidden");
}

function openArbeitszeitForm() {
  document.getElementById("arbeitszeitForm").classList.remove("hidden");
}

function closeArbeitszeitForm() {
  document.getElementById("arbeitszeitForm").classList.add("hidden");
}

function createGoogleCalendarLink() {
  const titel = document.getElementById("gTitel").value;
  const datum = document.getElementById("gDatum").value;
  const start = document.getElementById("gStart").value;
  const ende = document.getElementById("gEnde").value;
  const ort = document.getElementById("gOrt").value;
  const notiz = document.getElementById("gNotiz").value;

  if (!titel || !datum || !start || !ende) {
    alert("Bitte Titel, Datum, Start und Ende eintragen.");
    return;
  }

  const startDate = datum.replaceAll("-", "") + "T" + start.replace(":", "") + "00";
  const endDate = datum.replaceAll("-", "") + "T" + ende.replace(":", "") + "00";

  const url =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(titel) +
    "&dates=" + startDate + "/" + endDate +
    "&location=" + encodeURIComponent(ort) +
    "&details=" + encodeURIComponent(notiz) +
    "&ctz=Europe/Berlin";

  window.open(url, "_blank");
}

let arbeitszeiten = JSON.parse(localStorage.getItem("atHubArbeitszeiten")) || [];

function saveArbeitszeit() {
  const eintrag = {
    datum: document.getElementById("azDatum").value,
    kommt: document.getElementById("azKommt").value,
    geht: document.getElementById("azGeht").value,
    pause: document.getElementById("azPause").value,
    kategorie: document.getElementById("azKategorie").value,
    uebernachtung: document.getElementById("azUebernachtung").value,
    ort: document.getElementById("azOrt").value,
    notiz: document.getElementById("azNotiz").value
  };

  if (!eintrag.datum) {
    alert("Bitte Datum eintragen.");
    return;
  }

  arbeitszeiten.push(eintrag);
  localStorage.setItem("atHubArbeitszeiten", JSON.stringify(arbeitszeiten));

  closeArbeitszeitForm();
  renderArbeitszeiten();
}

function renderArbeitszeiten() {
  const liste = document.getElementById("arbeitszeitListe");
  if (!liste) return;

  liste.innerHTML = "";

  arbeitszeiten.forEach((a) => {
    liste.innerHTML += `
      <div class="az-entry">
        <strong>${a.datum}</strong><br>
        ${a.kategorie}<br>
        Kommt: ${a.kommt || "-"} | Geht: ${a.geht || "-"} | Pause: ${a.pause || "0"} Min.<br>
        ${a.uebernachtung} ${a.ort ? "– " + a.ort : ""}<br>
        ${a.notiz || ""}
      </div>
    `;
  });
}

renderArbeitszeiten();
