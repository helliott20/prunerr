import { defineConfig } from 'i18next-cli';

/**
 * i18next-cli config for the Prunerr client.
 *
 * Workflow (per feature namespace):
 *   1. Wrap strings with `t('ns.key', 'English default')` — the inline default
 *      becomes the English catalog value automatically on extract.
 *   2. `npm run i18n:extract`  → updates src/locales/en|es/<ns>.json + regenerates types
 *   3. Translate the new `es` keys (they start empty), then review.
 *   4. `npm run i18n:check`    → CI guard; fails if catalogs are stale.
 *
 * Namespaces mirror the component folders (common, layout, settings, rules, …).
 * The eager glob in src/i18n/index.ts auto-discovers any new <ns>.json.
 */
export default defineConfig({
  // Keep in sync with LANGUAGES in src/i18n/languages.ts.
  locales: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'],

  extract: {
    input: ['src/**/*.{ts,tsx}'],
    output: 'src/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'common',
    primaryLanguage: 'en',
    // secondaryLanguages defaults to all locales except the primary.

    // Match how the app reads translations: the useTranslation() hook `t`,
    // and the i18n singleton `i18n.t(...)` used by non-component modules
    // (activityFormatter, shared formatters in ScheduleCadenceCard/ActivityTimeline).
    functions: ['t', '*.t'],
    transComponents: ['Trans'],
    useTranslationNames: ['useTranslation'],

    // English (primary) value comes from the inline default in `t(key, 'default')`.
    // Secondary languages start EMPTY so `i18n:status` flags untranslated keys;
    // empty values fall back to English at runtime (returnEmptyString: false).
    defaultValue: (_key, _ns, lang, value) => (lang === 'en' ? (value ?? '') : ''),

    // Keep catalogs honest: drop keys no longer used in source. `i18n:check`
    // (extract --ci) then fails the build if anyone forgets to extract.
    removeUnusedKeys: true,
    // schedule.days.* are looked up via a computed key (formatSchedule), so the
    // static analyzer can't see them — preserve them from removal.
    preservePatterns: ['common:schedule.days.*'],
    sort: true,
    indentation: 2,
  },

  types: {
    input: ['src/locales/en/*.json'],
    basePath: 'src/locales/en',
    output: 'src/@types/i18next.d.ts',
    resourcesFile: 'src/@types/resources.d.ts',
  },
});
