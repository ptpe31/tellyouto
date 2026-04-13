/**
 * Complète expo-build-properties : JVM Gradle, Kotlin daemon, KSP, et désactivation
 * lintVital / checkReleaseBuilds release (OOM Metaspace sur gros projets Expo).
 *
 * @param {import('@expo/config-plugins').ExportedConfig} config
 */
function withAndroidReleaseBuildStability(config) {
  const {
    withGradleProperties,
    withProjectBuildGradle,
    withAppBuildGradle,
  } = require('expo/config-plugins');

  const MARKER_ROOT = '// @generated withAndroidReleaseBuildStability-root';
  const MARKER_APP = '// @generated withAndroidReleaseBuildStability-app-lint';

  config = withGradleProperties(config, (cfg) => {
    const items = cfg.modResults;
    /**
     * @param {string} key
     * @param {string} value
     */
    const setProp = (key, value) => {
      const idx = items.findIndex(
        (p) => p.type === 'property' && p.key === key,
      );
      if (idx >= 0) {
        items[idx].value = value;
      } else {
        items.push({ type: 'empty' });
        items.push({
          type: 'comment',
          value:
            'Android release build stability (JVM / Kotlin daemon / KSP) — plugins/withAndroidReleaseBuildStability.js',
        });
        items.push({ type: 'property', key, value });
      }
    };

    setProp(
      'org.gradle.jvmargs',
      '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError',
    );
    setProp(
      'kotlin.daemon.jvmargs',
      '-Xmx2048m -XX:MaxMetaspaceSize=512m',
    );
    setProp('ksp.incremental', 'false');

    return cfg;
  });

  config = withProjectBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER_ROOT)) {
      return cfg;
    }
    const injection = `

${MARKER_ROOT}
/** Désactive les tâches lintVital* (OOM Metaspace sur les modules Expo). */
gradle.projectsLoaded {
  rootProject.subprojects { sub ->
    sub.tasks.configureEach { task ->
      if (task.name.contains('lintVital')) {
        task.enabled = false
      }
    }
  }
}
`;
    cfg.modResults.contents = contents.trimEnd() + injection + '\n';
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER_APP) || contents.includes('checkReleaseBuilds')) {
      return cfg;
    }
    const block = `
    ${MARKER_APP}
    lint {
        checkReleaseBuilds false
        abortOnError false
    }
`;
    const re = /(\n    androidResources \{[\s\S]*?\n    \})\n(?=\})/;
    if (re.test(contents)) {
      contents = contents.replace(re, `$1${block}\n`);
    } else {
      console.warn(
        '[withAndroidReleaseBuildStability] androidResources block not found; skip app lint {} block',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  return config;
}

module.exports = withAndroidReleaseBuildStability;
