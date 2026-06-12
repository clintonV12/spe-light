/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#0F1117',
          50:  '#F4F5F7',
          100: '#E8EAF0',
          200: '#C9CDD8',
          300: '#A2A9BC',
          400: '#6B758F',
          500: '#3F4863',
          600: '#2A3050',
          700: '#1C2240',
          800: '#141930',
          900: '#0F1117',
        },
        accent: {
          DEFAULT: '#4B6BFB',
          50:  '#EEF1FF',
          100: '#E0E5FF',
          200: '#C2CCFF',
          300: '#92A3FD',
          400: '#6B85FC',
          500: '#4B6BFB',
          600: '#2F50F0',
          700: '#2040DC',
          800: '#1A34B8',
          900: '#162C90',
        },
        p1: {
          DEFAULT: '#F59E0B',
          light: '#FEF3C7',
          dark:  '#D97706',
        },
        p2: {
          DEFAULT: '#10B981',
          light: '#D1FAE5',
          dark:  '#059669',
        },
        p3: {
          DEFAULT: '#8B5CF6',
          light: '#EDE9FE',
          dark:  '#7C3AED',
        },
      },
    },
  },
  plugins: [],
}
