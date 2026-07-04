# AT HUB - Genesis

Persoenlicher Hub fuer Alex als Browser-App.

## Start

Die Datei `index.html` im Browser oeffnen.

## Zweck

- Dashboard fuer Arbeit, Privatbereich, Projekte und Wissen
- zentrale Arbeitsmodule fuer Translogistik
- eingepflegte Drive-Struktur fuer Arbeit und Privat
- Links zu Kalender, WEBFLEET und Drive-Bereichen
- lokale Arbeitszeit-Erfassung im Browser
- vorbereiteter Google-Tabellen-Sync fuer Arbeitszeiten
- klare Trennung von Google Kalender und Arbeitszeitmodul
- Vorbereitung fuer spaetere GitHub-Pages-Nutzung

## Architektur

Der verbindliche Projektbauplan liegt in `MASTERPLAN.md`.

Die Hauptbereiche sind:

- Dashboard
- Arbeit
- Privat
- Projekte & Wissen
- Siggi KI
- Einstellungen

## Status

Version 3.2 ist eine bereinigte Startversion fuer GitHub Pages.

Die alte Genesis-Alpha-Idee bleibt erhalten, aber die Struktur ist jetzt klarer:

- GitHub enthaelt die App und Startoberflaeche.
- Google Drive bleibt der Speicher fuer echte Daten und Unterlagen.
- Sensible Daten werden nicht im GitHub-Repository abgelegt.

## Hinweis

Sensible Daten bleiben in Google Drive. Diese App zeigt nur Uebersichten, Links, Status und lokal gespeicherte Eingaben.

## Sync

Die Anleitung fuer den gemeinsamen Arbeitszeit-Speicher liegt in `SYNC.md`.

## Drive-Daten

Die sichtbaren Drive-Links und Statusangaben liegen in `data/drive-data.js`.

GitHub speichert nur Struktur, Links und Status. Echte Unterlagen bleiben in Google Drive.
