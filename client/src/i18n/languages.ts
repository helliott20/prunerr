// Single source of truth for supported UI languages.
//
// Keys are the i18next language codes; values are the language's AUTONYM
// (its own name), shown in the language pickers and never translated. To add
// a language: add one entry here, drop in the translated locale JSON, and add
// its date-fns locale in `@/lib/utils` (setDateLocale). No other wiring needed.
//
// This module has no imports so it can be shared by the i18n init, the types,
// and components without creating an import cycle.
export const LANGUAGES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
} as const;

export type SupportedLanguage = keyof typeof LANGUAGES;

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES) as SupportedLanguage[];
