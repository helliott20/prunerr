/// <reference types="vite/client" />
import i18n, { type Resource, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { setDateLocale } from '@/lib/utils';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Eagerly bundle every locale namespace at build time. Vite inlines the JSON
 * into the JS bundle, so nothing extra needs to reach the Docker runtime image
 * (no static route, no fetch round-trip). New `locales/<lng>/<ns>.json` files
 * are auto-discovered — just drop them in.
 */
const modules = import.meta.glob('../locales/*/*.json', { eager: true });

const resources: Resource = {};
for (const path in modules) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, lng, ns] = match;
  (resources[lng] ??= {})[ns] = (modules[path] as { default: ResourceKey }).default;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: Object.keys(resources.en ?? {}),
    defaultNS: 'common',
    // Untranslated secondary-language keys are stored empty; treat empty as
    // "missing" so they fall back to the English value instead of rendering blank.
    returnEmptyString: false,
    interpolation: {
      // React already escapes values, so i18next must not double-escape.
      escapeValue: false,
    },
    detection: {
      // Only seeds the very first load before saved settings arrive. The
      // language setting in DisplayPreferences owns persistence afterwards,
      // so the detector must not cache (would fight the settings source).
      order: ['localStorage', 'navigator'],
      caches: [],
    },
  });

// Keep date-fns formatting in sync with the active language.
setDateLocale(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', setDateLocale);

export default i18n;
