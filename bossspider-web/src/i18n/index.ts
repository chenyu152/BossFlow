import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useTranslation } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

i18n.use(LanguageDetector).init({
  resources: {
    en: { common: en },
    zh: { common: zh },
  },
  fallbackLng: 'zh',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
  detection: {
    order: ['localStorage', 'navigator'],
    caches: ['localStorage'],
    lookupLocalStorage: 'i18nextLng',
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(['./locales/en.json', './locales/zh.json'], ([nextEn, nextZh]) => {
    const replaceBundle = (language: 'en' | 'zh', localeModule: unknown) => {
      if (!localeModule || typeof localeModule !== 'object') return;
      const bundle = 'default' in localeModule
        ? (localeModule as { default?: unknown }).default
        : localeModule;
      if (!bundle || typeof bundle !== 'object') return;
      i18n.addResourceBundle(language, 'common', bundle, true, true);
    };

    replaceBundle('en', nextEn);
    replaceBundle('zh', nextZh);
    void i18n.changeLanguage(i18n.resolvedLanguage || i18n.language);
  });
}

export default i18n;

export function useAppTranslation() {
  return useTranslation('common');
}
