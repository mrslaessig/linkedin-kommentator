# LinkedIn Kommentator (Vorlage)

Chrome-Erweiterung, die dir auf LinkedIn zwei Kommentar-Vorschläge in **deinem eigenen Stil** zeigt, sobald du in ein Kommentarfeld klickst:

1. **Reflektiert**: geht auf den Post ein und denkt einen Schritt weiter
2. **Kurz & witzig**: knackig, gern mit Wortspiel

Die Erweiterung postet **nie** selbst. „Einfügen“ schreibt den Text nur ins Feld, absenden tust du.
Die Vorschläge laufen über **dein Claude-Abo** mithilfe von Claude Code. Ein API-Key ist nicht nötig.

Dieses Repository ist eine Vorlage. Stil und Profil sind leer und werden nur lokal bei dir gespeichert.

```
linkedin-kommentator/
├── extension/          Chrome-Erweiterung  ← diesen Ordner in Chrome laden
├── server/             lokaler Node-Server
├── skill.example.md    Vorlage für deinen Stil   → kopieren nach skill.md
├── profil.example.md   Vorlage für dein Profil   → kopieren nach profil.md
└── README.md
```

## 1. Projekt holen und Stil anlegen

Auf GitHub **„Use this template“** klicken (oder das Repo klonen). Dann im Projektordner:

```bash
cp skill.example.md skill.md && cp profil.example.md profil.md
```

`skill.md` und `profil.md` mit deinem Stil und deinem Hintergrund füllen. Am stärksten wirken 5–10 echte Kommentare von dir unter „Beispiele meines Stils“. Beide Dateien stehen in `.gitignore` und landen nie auf GitHub.

## 2. Claude Code installieren und anmelden

Voraussetzung: Node.js 20 oder neuer (`node --version`).

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
claude
```

Im Programm `/login` eingeben und mit deinem **Claude-Konto (Abo)** anmelden, nicht mit „API Key“. Danach `/exit`.

## 3. Server starten

Im Projektordner:

```bash
cd server && npm start
```

Das Terminal-Fenster muss offen bleiben, solange du die Erweiterung nutzt. Beenden mit `Ctrl+C`.

## 4. Erweiterung in Chrome laden

1. `chrome://extensions` öffnen
2. Oben rechts den **Entwicklermodus** einschalten
3. **„Entpackte Erweiterung laden“** klicken und den Unterordner `extension` wählen (darin liegt `manifest.json`)
4. Offene LinkedIn-Tabs neu laden

Nach Änderungen in `extension/` auf der Erweiterungsseite ↻ klicken und LinkedIn neu laden.

## 5. Nutzung

- In ein Kommentarfeld klicken (unter einem Post oder „Antworten“ bei einem Kommentar). Unten rechts erscheint das Panel.
- **Einfügen** setzt den Text ins Feld (hinter eine @Erwähnung), **Kopieren** in die Zwischenablage.
- **Auto · DE · EN** oben: Sprache der Vorschläge. Auto = Sprache des Posts bzw. Kommentars. Die Wahl bleibt gespeichert.
- **Gelesener Post** / **Kommentar von …** aufklappen, um zu sehen, was gelesen wurde.
- **Neu generieren** ignoriert den Cache. **Schließen** oder `Esc` blendet das Panel aus, ein Klick ins Kommentarfeld holt es zurück.
- Vorschläge werden pro Post 3 Tage gespeichert („Aus dem Cache“) und verbrauchen dann kein Kontingent.

## 6. Stil und Profil anpassen

Der Server liest `skill.md` und `profil.md` bei **jeder** Anfrage neu, ein Neustart ist nicht nötig. Nach einer Änderung „Neu generieren“ klicken.

Optionale Einstellungen in `server/.env` (Vorlage: `server/.env.example`): `MODEL` (z. B. `opus`), `EFFORT` (`low`/`medium`/`high`), `BACKEND=api` mit `ANTHROPIC_API_KEY`, `CLAUDE_BIN`, `PORT`. Nach Änderungen den Server neu starten.

## 7. Fehlerbehebung

| Meldung im Panel | Lösung |
|---|---|
| Server nicht erreichbar | Server starten (Schritt 3) |
| skill.md fehlt / profil.md fehlt | Schritt 1 |
| Claude Code ist nicht installiert | Schritt 2, oder `CLAUDE_BIN` in `server/.env` setzen |
| Claude Code ist nicht angemeldet | Im Terminal `claude` starten, `/login` |
| Abo-Limit erreicht | Später nochmal versuchen |
| Modell nicht verfügbar | `MODEL` in `server/.env` leer lassen oder ändern |
| Timeout | Nochmal versuchen, ggf. `EFFORT=low` |
| Kein Post-Text gefunden | Post mit „…mehr“ aufklappen, erneut ins Feld klicken |
| Versionen passen nicht zusammen | Server neu starten und Erweiterung neu laden |
| Die Erweiterung wurde neu geladen | LinkedIn-Tab neu laden |
| Port 8787 belegt (im Terminal) | Läuft schon ein Server? Alten mit `Ctrl+C` beenden |

Liest das Panel den falschen Text oder erscheint gar nicht, hat LinkedIn vermutlich das Layout geändert. Dann im Panel **„Diagnose kopieren“** klicken. Die Klassen-Selektoren stehen oben in `extension/content.js` im Objekt `SEL`, darunter liegt eine strukturelle Erkennung ohne Klassennamen.

## Datenschutz

Post-Text, Autor:in und ggf. der Kommentar, auf den du antwortest, gehen über deinen lokalen Server und Claude Code an Claude. Der Server lauscht nur auf `127.0.0.1` und nimmt nur Anfragen der Erweiterung an. Der Cache liegt lokal in Chrome.
