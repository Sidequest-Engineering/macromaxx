# OpenCode auf dem MacroMaxx-Deck

## Ziel

Der belegbare Button **OpenCode** öffnet eine temporäre Vollansicht auf dem physischen LCD-Stream-Deck. Sie zeigt Sessions des lokalen OpenCode-V2-Hintergrunddienstes, damit laufende Arbeit und nötige Eingaben ohne Fensterwechsel erkennbar sind. Das Plugin lebt im Geschwisterordner `../mm-opencode-plugin` und baut mit dem MacroMaxx-SDK ein `.mmxp` für die Registry.

## Ansätze

Gewählt: Eine allgemeine, deklarative Deck-Ansicht und ein davon getrennter, lesender OpenCode-Zugriff. Das Plugin gestaltet Tasten, Statusfarben, Sortierung und Seitennavigation selbst. Andere Plugins können die Deck-Ansicht nutzen, ohne OpenCode-Zugriff zu erhalten.

Verworfen: Eine fest eingebaute OpenCode-Ansicht mit einem Trigger-Plugin wäre schneller zu bauen, würde aber jede Layoutänderung an ein MacroMaxx-Release binden. Ein privilegiertes lokales Legacy-Plugin wäre nicht als reguläres Store-Paket installierbar und würde die bestehende Isolation umgehen.

## Bedienung und Status

- **Aktiv** ist die Startansicht. Offene Rückfragen (`? Rückfrage`) und Berechtigungen (`! Freigabe`) stehen zuerst, dann `Erneuter Versuch`, `Läuft` und nicht sicher bestimmbare aktive Zustände (`Unbekannt`). Bei mehreren Signalen für dieselbe Session gilt diese Reihenfolge. Tasten zeigen Titel und Status; Farbe ist nie das einzige Signal.
- **Zuletzt** zeigt die bis zu 50 zuletzt aktualisierten, nicht archivierten, inaktiven Sessions: `Erfolgreich`, `Fehler`, `Abgebrochen`, `Inaktiv` (kein Ausgang) oder `Unbekannt` (nicht interpretierbarer Status). Aktive Sessions und offene Eingaben stehen in **Aktiv**, nicht doppelt in **Zuletzt**.
- Die Session-Tasten sind reine Anzeigen. **Zurück** ist immer erreichbar, bei regulärem Raster unten links; Seitenwechsel und **Aktiv/Zuletzt** passen sich der Anzahl und Anordnung der LCD-Tasten an. Ein Deck mit weniger als fünf LCD-Tasten oder ohne LCD hat keine Full-Deck-Ansicht. Eine leere Liste, initiales Laden, fehlender Dienst und nicht lesbare Statusdaten sind verschiedene Zustände; nie einen Verbindungsfehler als „keine Sessions“ darstellen.
- Der Ring rotiert nur bei **Läuft**; Rückfragen, Freigaben und ein anstehender Retry bleiben statisch. Der Host animiert nur sichtbare Tasten, mit höchstens sechs Frames pro Sekunde und einer einzigen anstehenden Render-Arbeit; bei deaktivierter Plugin-Animation bleibt der Ring statisch. Die Ansicht ist nicht persistent. Verlassen, Gerätewechsel, Disconnect, Suspend, Sperren, Profil-/Ordnerwechsel, Deaktivierung und Revocation beenden sie. Ausstehende Ergebnisse dürfen sie nicht wieder öffnen.

## Schnittstellen und Grenzen

- SDK und Runtime bleiben rückwärtskompatibel zu bestehenden Protokoll-1-Plugins. Zwei neue, einzeln genehmigte Berechtigungen: `deck:write` und `opencode:sessions:read`. Die bestehende Signatur-, Review- und Installationskette bleibt erhalten. Capability-APIs haben keine Host-Callbacks mit frei wählbaren Parametern: reine, größenbegrenzte JSON-Eingabe und -Ausgabe je Worker-Aufruf.
- Die Host-Ansicht ist in der Electron-Hauptinstanz gerätegebunden und nutzt die vorhandene USB-Warteschlange. Sie erlaubt nur Slots, zwei kurze Textzeilen, Farbe, einen Host-Spinner und kurze, plugininterne Navigations-IDs. Keine Gastbilder, Skripte, SVGs, Hotkeys oder Workspace-Änderungen. Der Host erzwingt den Zurück-Slot und verhindert, dass ein verdrahteter Tastendruck unter der Ansicht eine normale Aktion auslöst. Kein Renderer- oder IPC-Zugriff auf OpenCode; die App muss nicht im Vordergrund sein.
- OpenCode-Integration: `@opencode/client` **2.3.2**, ausschließlich automatische Erkennung des bereits laufenden, registrierten lokalen V2-Dienstes (`Service.discover`, nicht `ensure`). Nur Loopback; keine Gast-URLs, Redirects, Shell-Aufrufe, Serverstarts, schreibenden Routen oder Remote-/Standalone-Server. Der Host fragt begrenzte Metadaten ab und kombiniert die Liste aktiver Sessions, Session-Ausgänge, offene Forms/Freigaben pro Session und Live-Statusereignisse. Für einen bereits vor dem Öffnen geplanten Retry darf der Host, wenn nötig, höchstens die neueste Assistant-Projektion der betreffenden aktiven Session lesen, begrenzen und sofort auf Retry-/Zeit-Metadaten reduzieren. Ohne belastbaren Status kein Spinner. Keine Prompts, Antworttexte, Fehlerdetails, Zugangsdaten, Pfade oder Freigabeinhalte im Plugin-Payload, in Plugin-Einstellungen, im Renderer oder in Logs.
- Datenabruf und Live-Stream laufen nur, während die OpenCode-Ansicht geöffnet ist. Abbrechen und erneutes Öffnen erzeugen eine neue Generation; die Host-Ansicht darf auch bei vollem Worker, Abbruch und fehlendem Dienst immer verlassen werden. Wiederverbindung synchronisiert den Stand neu statt alte Daten als aktuell darzustellen.
- Erstes Ziel: Linux-LCD, OpenCode ≥2.3.2, MacroMaxx ≥0.2.0 <0.3.0. Weitere Systeme erst deklarieren, wenn verifiziert. Paket und Registry-PR benötigen echten Publisher, unveränderlichen Quellcommit, Tag und öffentlich abrufbare exakte Release-Datei. Ein alter MacroMaxx-Client verwirft einen Katalog mit unbekannter Berechtigung als Ganzes: keine Live-Registry-Veröffentlichung, solange für alte Clients kein passender kompatibler Katalog bzw. kein betreiberseitig freigegebener Übergang vorliegt. Die lokale Prüfung benutzt temporäre Schlüssel und kann vorher vollständig stattfinden.

## Nicht im ersten Release

Sessions in OpenCode öffnen, steuern, starten oder abbrechen; Rückfragen beantworten oder Rechte erteilen; Remote-/Standalone-Dienste; beliebige Plugin-Oberflächen; Änderung von Profilen oder Arbeitsbereichen.
