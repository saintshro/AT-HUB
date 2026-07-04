# AT HUB Sync

Ziel: Google Kalender und Arbeitszeit sollen von PC, Tablet und Telefon nutzbar sein und sich automatisch aktualisieren.

## Google Kalender

Die App erstellt einen echten Google-Kalender-Termin ueber den Google-Kalender-Link. Nach dem Oeffnen muss der Termin in Google bestaetigt werden. Danach ist er auf allen Geraeten sichtbar.

Direktes Speichern ohne Bestaetigung waere moeglich, braucht aber eine richtige Google-Anmeldung/OAuth. Das ist fuer die erste stabile Version zu schwer und unnoetig riskant.

## Arbeitszeit

Die Arbeitszeit braucht einen gemeinsamen Speicher. Dafuer ist eine Google-Tabelle mit einem kleinen Apps-Script vorgesehen.

### Ablauf

1. Google Tabelle fuer Arbeitszeiten erstellen oder vorhandene Tabelle nutzen.
2. In der Tabelle `Erweiterungen > Apps Script` oeffnen.
3. Inhalt aus `google-apps-script/arbeitszeit-sync.gs` einfuegen.
4. Im Script `BITTE_EIGENES_TOKEN_EINTRAGEN` durch ein eigenes langes Wort ersetzen.
5. Script als Web-App bereitstellen.
6. Web-App-URL in `index.html` bei `arbeitszeitSyncUrl` eintragen.
7. Dasselbe Token in `index.html` bei `syncToken` eintragen.

Solange keine URL eingetragen ist, speichert die App weiter lokal im Browser.

## Datenschutz

Die Arbeitszeitdaten liegen dann in deiner Google-Tabelle. GitHub enthaelt nur die App, keine echten Arbeitszeitdaten.
