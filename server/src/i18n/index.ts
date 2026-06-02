import i18next, { type TFunction } from 'i18next';
import en from '../locales/en.json';
import es from '../locales/es.json';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const NS = 'notifications';

// Dedicated instance so server-side notification translations never collide
// with any other i18next usage. Catalogs are imported as modules, so they are
// emitted into dist/ and bundled into the Docker image — no extra file copy.
const i18n = i18next.createInstance();
i18n.init({
  resources: {
    en: { [NS]: en },
    es: { [NS]: es },
  },
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  defaultNS: NS,
  ns: [NS],
  interpolation: {
    // Notification text is plain string / Markdown, never HTML.
    escapeValue: false,
  },
});

/**
 * Translation function bound to a language and the notifications namespace.
 * Unknown / undefined languages fall back to English via i18next.
 */
export function getFixedT(lng: string | null | undefined): TFunction {
  return i18n.getFixedT(lng ?? 'en', NS);
}

export default i18n;
