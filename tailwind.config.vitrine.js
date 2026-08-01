/** @type {import('tailwindcss').Config} */
// Config dédiée à la page d'accueil publique (index.html à la racine).
// Distincte de tailwind.config.js (dashboard) car cette page désactive
// le "preflight" (reset CSS) de Tailwind pour garder son propre reset
// minimal déjà en place — les fusionner casserait l'un des deux.
module.exports = {
  content: [
    './index.html',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
