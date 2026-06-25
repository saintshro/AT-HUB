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
