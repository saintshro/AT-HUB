console.log("AT HUB Version 1.0 gestartet");

document.addEventListener("DOMContentLoaded", () => {
    console.log("Willkommen im AT HUB");

    const kacheln = document.querySelectorAll(".kachel");

    kacheln.forEach(kachel => {
        kachel.addEventListener("click", () => {
            alert("Dieser Bereich wird in einer späteren Version erweitert.");
        });
    });
});
