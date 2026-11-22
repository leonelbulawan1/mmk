/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: { 50: '#FFFDF8', 100: '#FBF7EF', 200: '#F4ECDD', 300: '#E9DCC4' },
        ink: { 400: '#4A5674', 500: '#34405E', 600: '#26314D', 700: '#1F2A44', 800: '#161E33' },
        bark: { 300: '#C4A486', 400: '#A47E5C', 500: '#7A5638', 600: '#5E4029' },
        gold: { 400: '#C9A86A', 500: '#B08D57' },
        sage: { 100: '#E7EFE4', 600: '#4F6B4A' },
        rose: { 100: '#F6E3E0', 600: '#9A3B32' },
      },
      fontFamily: {
        // One plain typeface across the whole system.
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: { paper: '0 1px 2px rgba(31,42,68,.06), 0 8px 24px -12px rgba(31,42,68,.18)' },
    },
  },
  plugins: [],
}
