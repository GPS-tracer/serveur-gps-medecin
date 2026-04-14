const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Service worker avec headers spéciaux
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Servir les fichiers statiques
app.use(express.static('.', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') && !filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.listen(PORT, () => {
  console.log(`GPS Tracker server running on port ${PORT}`);
});
