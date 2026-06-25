document.addEventListener("DOMContentLoaded", () => {

    const heute = new Date();

    const datum = heute.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });

    document.getElementById("datum").innerText = datum;

});
