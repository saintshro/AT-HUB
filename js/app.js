document.addEventListener("DOMContentLoaded", () => {

    function aktualisiereZeit() {
        const jetzt = new Date();

        const datum = jetzt.toLocaleDateString("de-DE", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
        });

        const uhrzeit = jetzt.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        document.getElementById("datum").innerText = datum;
        document.getElementById("uhrzeit").innerText = uhrzeit;
        document.getElementById("wetter").innerText = "Rostock · Wetter wird später verbunden";
    }

    aktualisiereZeit();
    setInterval(aktualisiereZeit, 1000);

});
