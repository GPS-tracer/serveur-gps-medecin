/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './dashboard/**/*.html',
    './dashboard/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#060d1f',
          900: '#0b1628',
          800: '#0f1e35',
          700: '#162540',
          600: '#1e3254',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
