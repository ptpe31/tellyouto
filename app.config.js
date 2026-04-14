/**
 * Charge `.env` puis `env` (sans point) pour que la clé Gemini soit disponible
 * au prébuild / Gradle même si seul le fichier `env` est présent.
 * Les valeurs sont aussi exposées dans `expo.extra` pour le runtime (expo-constants).
 */
const fs = require('fs');
const path = require('path');

/** @param {string} mode fill = si absent ou vide ; override = écrase (fichier env après .env). */
function loadEnvFile(relPath, mode = 'fill') {
  const p = path.join(__dirname, relPath);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.replace(/\r$/, '').trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (mode === 'override' && val === '') {
      continue;
    }
    const shouldSet =
      mode === 'override' ||
      process.env[key] === undefined ||
      process.env[key] === '';
    if (shouldSet) {
      process.env[key] = val;
    }
  }
}

loadEnvFile('.env', 'fill');
loadEnvFile('env', 'override');

const appJson = require('./app.json');

module.exports = () => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
      geminiModel: process.env.EXPO_PUBLIC_GEMINI_MODEL ?? '',
    },
  },
});
