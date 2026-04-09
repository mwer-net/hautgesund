# Hautgesund Kochen

Webanwendung fuer antientzuendliche Ernaehrung bei Akne. Generiert wöchentliche Essensplaene mit 134 wissenschaftlich recherchierten Rezepten, erstellt automatische Einkaufslisten und bietet Wissen rund um Hautgesundheit.

## Features

- **Wochenplan** — 7 Fruehstuecke + 7 Abendessen, jede Woche neu generiert
- **Gewichteter Zufall** — Kuerzlich gekochte Rezepte werden seltener vorgeschlagen, Favoriten haeufiger
- **Zutatenueberlappung** — Der Algorithmus bevorzugt Rezepte mit gemeinsamen Zutaten, damit die Einkaufsliste kuerzer wird
- **Rezepte tauschen** — Einzelne Gerichte im Plan austauschen
- **Einkaufsliste** — Automatisch generiert, Mengen zusammengefasst, nach Kategorien sortiert, abhakbar
- **Favoriten & Ausschliessen** — Lieblingsrezepte markieren, ungeliebte dauerhaft entfernen
- **Tipp des Tages** — 79 evidenzbasierte Tipps zur Hautgesundheit
- **Lernen** — Ausfuehrliche Informationen zu Supplements, Hautpflege, Hormonen, Lifestyle und Darmmikrobiom
- **Passwort-Schutz** — Einfacher Login
- **Mobil-optimiert** — Fuer Smartphone-Nutzung ausgelegt

## Rezepte

| Typ | Anzahl | Max. Zubereitungszeit |
|-----|--------|----------------------|
| Fruehstueck | 57 | 5 Minuten |
| Abendessen | 77 | 45 Minuten |

Alle Rezepte: 3 Portionen, kein Fisch, Milchprodukte stark reduziert, niedrig-glykaemisch, reich an antientzuendlichen Inhaltsstoffen.

## Installation

```bash
npm install
```

## Starten

```bash
node server.js
```

Die App laeuft auf **http://localhost:3000**. Beim ersten Aufruf wird ein Passwort festgelegt.

### Zugriff vom Smartphone (gleiches WLAN)

1. IP-Adresse des PCs herausfinden: `ipconfig` (Windows) / `ip addr` (Linux)
2. Auf dem Handy oeffnen: `http://<IP-ADRESSE>:3000`

## Deployment mit PM2

```bash
npm install -g pm2
pm2 start ./ecosystem.config.cjs --time
```

Logs: `./logs/pm2.log` und `./logs/error.log`

## Rezepte bearbeiten

Die Rezepte liegen direkt in `data/recipes.json`. Neue Rezepte oder Aenderungen koennen dort direkt vorgenommen werden.

## Projektstruktur

```
server.js              Server und API
public/
  index.html           HTML-Grundgeruest
  style.css            Styles
  app.js               Frontend-Logik
data/
  recipes.json         134 Rezepte
  tips.json            79 Tipp-des-Tages-Eintraege
  learn.json           Lerninhalte
  userdata.json        Nutzerdaten (wird automatisch erstellt)
ecosystem.config.cjs   PM2-Konfiguration
```

## Daten zuruecksetzen

Nutzerdaten (Passwort, Wochenplan, Favoriten, Historie) zuruecksetzen:

```bash
rm data/userdata.json
```

Beim naechsten Serverstart wird alles neu erstellt.

## Tech Stack

- Node.js + Express 5
- Vanilla HTML/CSS/JS (kein Framework)
- JSON-Dateien als Datenspeicher
- bcryptjs fuer Passwort-Hashing
