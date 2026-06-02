import i18next, { type TFunction } from 'i18next';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';
import it from '../locales/it.json';
import pt from '../locales/pt.json';
import nl from '../locales/nl.json';

const NS = 'notifications';

// One catalog per supported notification language. To add a language: drop in
// server/src/locales/<lng>.json (mirroring en.json) and add it here.
const CATALOGS = { en, es, fr, de, it, pt, nl } as const;

export const SUPPORTED_LANGUAGES = Object.keys(CATALOGS) as (keyof typeof CATALOGS)[];
export type SupportedLanguage = keyof typeof CATALOGS;

// Dedicated instance so server-side notification translations never collide
// with any other i18next usage. Catalogs are imported as modules, so they are
// emitted into dist/ and bundled into the Docker image — no extra file copy.
const i18n = i18next.createInstance();
i18n.init({
  resources: Object.fromEntries(
    Object.entries(CATALOGS).map(([lng, catalog]) => [lng, { [NS]: catalog }])
  ),
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
