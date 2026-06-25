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

        document.getElementById("datum").innerText = datum + " · " + uhrzeit;
    }

    aktualisiereZeit();
    setInterval(aktualisiereZeit, 1000);

});
