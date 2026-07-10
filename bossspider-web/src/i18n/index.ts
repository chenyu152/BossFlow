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
    if (nextEn) i18n.addResourceBundle('en', 'common', nextEn.default, true, true);
    if (nextZh) i18n.addResourceBundle('zh', 'common', nextZh.default, true, true);
    void i18n.changeLanguage(i18n.resolvedLanguage || i18n.language);
  });
}

export default i18n;

export function useAppTranslation() {
  return useTranslation('common');
}
