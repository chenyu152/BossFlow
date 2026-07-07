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

export default i18n;

export function useAppTranslation() {
  return useTranslation('common');
}
