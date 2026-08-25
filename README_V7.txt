AT HUB FINANZCOCKPIT v7

Was v7 kann:
- DKB-PDF im Browser einlesen
- erkannte Buchungen vor dem Speichern prüfen
- Fixkosten automatisch mit "Noch offen" abgleichen
- doppelte Importe anhand einer ID vermeiden
- Buchungen lokal in IndexedDB speichern
- Kontostand + offene Fixkosten + 500 € Dispo prognostizieren
- Sparziel bis zum nächsten 15. anzeigen
- Google Drive Sync vorbereiten und ausführen

GOOGLE DRIVE EINMALIG EINRICHTEN
1. Google Cloud Console öffnen.
2. Projekt "AT HUB Finanzcockpit" erstellen.
3. Google Drive API aktivieren.
4. OAuth-Zustimmungsbildschirm einrichten.
5. OAuth-Client-ID vom Typ "Webanwendung" erstellen.
6. Als autorisierten JavaScript-Ursprung eintragen:
   https://saintshro.github.io
7. Client-ID kopieren.
8. Im Cockpit > Drive Sync eintragen > speichern > verbinden.
9. "Jetzt synchronisieren".

Wichtig:
- KEIN Client Secret in GitHub eintragen.
- Keine Konto-PDFs ins öffentliche GitHub-Repository hochladen.
- Die Finanzdaten liegen lokal und nach Aktivierung zusätzlich als AT_HUB_Finanzdaten.json im privaten Google Drive.

GITHUB UPLOAD
Da v7 aus mehreren Dateien besteht, nicht nur index.html ersetzen.
Im Repository-Hauptverzeichnis müssen liegen:
index.html
styles.css
app.js
config.json
manifest.webmanifest
sw.js

Die alten Reiseordner können bestehen bleiben; sie werden nicht mehr genutzt.
