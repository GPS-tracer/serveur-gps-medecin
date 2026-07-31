/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./dashboard/**/*.html', './dashboard/**/*.js'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#060d1f', 900: '#0a1628', 800: '#0f1f3a', 700: '#15294d', 600: '#1c3663', 500: '#24457a' }
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
