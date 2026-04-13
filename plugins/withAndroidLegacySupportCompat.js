/**
 * Pérennise la compat AndroidX (Jetifier + fusion manifest appComponentFactory)
 * si une dépendance transitive réintroduit encore des libs Support.
 *
 * Placer en fin de liste plugins si d’autres modules touchent le manifest.
 *
 * Reconnaissance vocale (RecognizerIntent) : aucun EXTRA_SPEECH_INPUT_* n’est
 * défini dans ce projet ; le module reco vocale Expo n’ajoute pas non plus de
 * LANGUAGE_MODEL, MAX_RESULTS, PARTIAL_RESULTS et REQUEST_PERMISSIONS_AUTO —
 * rien qui impose un silence minimal avant démarrage. Pas de merge manifeste
 * à faire ici pour ces extras.
 *
 * @param {import('@expo/config-plugins').ExportedConfig} config
 */
function withAndroidLegacySupportCompat(config) {
  const {
    withGradleProperties,
    withAndroidManifest,
    AndroidConfig,
  } = require('expo/config-plugins');

  config = withGradleProperties(config, (cfg) => {
    const items = cfg.modResults;

    /**
     * @param {string} key
     * @param {string} value
     * @param {string} [comment]
     */
    const setProp = (key, value, comment) => {
      const idx = items.findIndex(
        (p) => p.type === 'property' && p.key === key,
      );
      if (idx >= 0) {
        items[idx].value = value;
        return;
      }
      items.push({ type: 'empty' });
      if (comment) {
        items.push({ type: 'comment', value: comment });
      }
      items.push({ type: 'property', key, value });
    };

    setProp(
      'android.enableJetifier',
      'true',
      'Jetifier — libs encore en com.android.support (ex. voice) → AndroidX au build. plugins/withAndroidLegacySupportCompat.js',
    );

    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const androidManifest = cfg.modResults;
    if (!androidManifest.manifest.$) {
      androidManifest.manifest.$ = {};
    }
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);

    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
    application.$['android:appComponentFactory'] =
      'androidx.core.app.CoreComponentFactory';

    const needed = 'android:appComponentFactory';
    const existing = application.$['tools:replace'];
    if (!existing) {
      application.$['tools:replace'] = needed;
    } else {
      const parts = String(existing)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.includes(needed)) {
        application.$['tools:replace'] = [...parts, needed].join(',');
      }
    }

    return cfg;
  });

  return config;
}

module.exports = withAndroidLegacySupportCompat;
