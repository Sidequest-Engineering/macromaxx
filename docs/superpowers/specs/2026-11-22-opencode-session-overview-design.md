# OpenCode-Deck: Rückfragen und ruhende Sessions

## Ziel

Die Startansicht zeigt auf einen Blick, welche OpenCode-Sessions Aufmerksamkeit brauchen, welche gerade arbeiten und welche zuletzt benutzt wurden. Eine Session soll nicht aus der Übersicht verschwinden, nur weil OpenCode gerade keinen Auftrag darin ausführt.

## Ansätze

- **Gewählt: eine gemeinsame Startansicht.** Sie zeigt alle erkannten Arbeits- und Eingabestatus sowie die zuletzt verwendeten, nicht archivierten Sessions des verbundenen lokalen OpenCode-Dienstes. Die API führt keine verlässliche Liste geöffneter Tabs, daher ist die Liste nicht mit den Tabs in OpenCode identisch.
- **Alternative: getrennte Ansichten beibehalten.** Die Startansicht bliebe kürzer, ruhende Sessions wären aber weiterhin erst nach einem Tastendruck sichtbar. Das behebt das gemeldete Problem nicht.

## Verhalten

- Offene strukturierte Rückfragen und Freigaben werden deutlich markiert und kommen zuerst. Danach folgen Retry, laufende Arbeit mit Spinner und die übrigen zuletzt genutzten Sessions, sortiert nach letzter Aktivität. Bestehende Endzustände bleiben erkennbar.
- Die bestehende Verlaufstaste zeigt weiterhin nur die zuletzt genutzten Sessions ohne laufende Arbeit oder offene Eingabe. Die Startansicht blättert wie bisher; der bestehende Hinweis auf begrenzte Ergebnisse bleibt sichtbar.
- MacroMaxx erfasst strukturierte Eingabe-Anfragen als Status, nicht als Frageinhalt. Neue offene Anfragen sollen auch sichtbar werden, wenn die Session nicht mehr in der Arbeitsliste steht. Unterstützung für bestehende Anfragen und für das Entfernen der Markierung nach Antwort oder Abbruch wird getestet.
- Keine Textanalyse von Chatnachrichten. Die Ansicht bleibt lesend: keine Antworten, keine Freigaben und keine Änderungen an OpenCode aus dem Deck.
