# Kampagnenanalyse – Webseite

Die Webseite zum Meta-Analyse-Tool. Sie enthält nur den Code der Anmeldemaske
und des Dashboards, keine Daten und keine geheimen Schlüssel.

Die Daten liegen in Supabase und werden erst nach dem Login geladen. Anmelden
können sich nur Konten, die in Supabase von Hand angelegt wurden.

`config.js` enthält die Supabase-Adresse und den „Publishable key“. Beide sind
dafür gedacht, öffentlich zu sein: Ohne Login gibt die Datenbank nichts heraus.
