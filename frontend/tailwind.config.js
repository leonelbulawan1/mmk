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
      // Bootstrap 5 metrics: radius .375rem (sm .25rem, lg .5rem); .shadow-sm for cards, .shadow for menus and windows.
      borderRadius: { sm: '.25rem', DEFAULT: '.25rem', md: '.375rem', lg: '.375rem', xl: '.375rem', '2xl': '.375rem', '3xl': '.5rem' },
      boxShadow: { paper: '0 .125rem .25rem rgba(31,42,68,.075)', pop: '0 .5rem 1rem rgba(31,42,68,.15)' },
    },
  },
  plugins: [],
}
