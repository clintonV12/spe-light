import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import pt from './locales/pt.json'
import es from './locales/es.json'
import zu from './locales/zu.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    pt: { translation: pt },
    es: { translation: es },
    zu: { translation: zu },
  },
  lng: localStorage.getItem('stratplan-locale') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n