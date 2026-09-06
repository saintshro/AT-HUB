# AT HUB Public Hub Patch 2026-09-06

Ziel: bestehende GitHub-Pages-Seite nicht neu bauen, sondern modular absichern, den Arbeitszeitkalender verbessern und Main-Hub plus GitHub-Pages-Stand zu einem gemeinsamen Public-Hub zusammenlegen.

## Dateien fuer den Branch `gh--pages`

Diese Dateien ersetzen vorhandene Dateien:

- `index.html`
- `hub.css`
- `hub-sync.js`
- `config.json`
- `finanzen.html`
- `arbeitszeit.html`
- `sw.js`
- `app-version.json`
- `manifest.webmanifest`
- `translogistik.html`

Diese Dateien sind neu oder als Public-Unterseiten zu ergaenzen:

- `privat.html`
- `projekte-wissen.html`
- `siggi.html`
- `backup-sicherheit.html`
- `einstellungen-hub.html`
- `finance-vault.js`
- `arbeitszeit-ui-v1.0.3.js`

## Wirkung

- `index.html` ist jetzt der gemeinsame AT-HUB: umfangreich wie die Main Page, aber im GitHub-Pages-Stil mit Sidebar, Modulrastern und Public-Safe-Grenzen.
- Arbeit, Privat, Projekte & Wissen, Siggi KI, Backup & Sicherheit und Einstellungen sind als eigene oeffentliche Hub-Seiten vorbereitet.
- `hub.css` vereinheitlicht die GitHub-Pages-Optik fuer Dashboard, Translogistik und Arbeitszeitkalender.
- `config.json` enthaelt keine privaten Finanzwerte mehr. GitHub Pages liefert nur eine sichere Grundkonfiguration.
- `finance-vault.js` ergaenzt im Finanzcockpit einen Bereich `Finanz-Tresor`.
- Private Finanz-Konfiguration kann lokal importiert und nach Google Drive gesichert oder von dort geladen werden.
- Der Zugriff auf Drive laeuft ueber das Google-Konto. Wenn dort 2-Faktor-Anmeldung aktiv ist, ist der Zugriff entsprechend geschuetzt.
- Der bestehende Finanzkern `finance-core-v8.8.1.js` und die Oberflaeche `finance-ui-v8.9.js` bleiben erhalten.
- `arbeitszeit-ui-v1.0.3.js` ergaenzt den Arbeitszeitkalender um Monatsliste, Schnellknoepfe und Regeln.
- `sw.js` cached vorhandene Dateien fehlertolerant, damit ein fehlender optionaler Altbestand die Installation nicht blockiert.

## Arbeitszeitregeln

- Buero: Status `A`, Standardzeit `06:30-16:30`, Entfernung `16 km`.
- Box: Status `A`, Standardzeit `06:30-16:30`, Entfernung `16 km`, Box-Vorschlag `658`.
- Extern: Status `E`, Arbeitsort `Extern`, Dienstreise aktiv, Entfernung leer.
- Urlaub/Frei/Krank: Status wird gesetzt, Arbeits- und Steuerfelder werden fuer den Tag geleert.

## Hinweis zur Sicherheit

Das ersetzt die aktuelle oeffentliche Datei, entfernt aber keine frueheren Git-History-Versionen. Wenn alte Finanzwerte bereits in der Repository-Historie liegen, sollte das Repository spaeter bereinigt oder neu privat aufgebaut werden.

## Stand

Die Dateien wurden lokal im Patch-Ordner vorbereitet. Der Ordner kann in den Branch `gh--pages` uebernommen werden.
