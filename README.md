# Métré Pro-Studio v0.10

Application professionnelle de gestion de métrés pour le BTP.

## 📁 Structure du projet

```
metre-pro-studio/
├── index.html              # Point d'entrée principal
├── README.md               # Ce fichier
├── original.html           # Fichier original (backup)
│
├── css/
│   ├── main.css            # Styles principaux (header, footer, base)
│   └── components/
│       ├── table.css       # Styles des tableaux de métré
│       ├── tree.css        # Styles de l'arborescence
│       ├── dialog.css      # Styles des dialogues et modales
│       ├── canvas-editor.css  # Styles de l'éditeur Canvas
│       └── viewer.css      # Styles du visualiseur PDF/Images
│
├── js/
│   ├── app.js              # Application principale (~11000 lignes)
│   ├── config/
│   │   └── settings.js     # Configuration (si modularisation future)
│   └── core/
│       ├── utils.js        # Fonctions utilitaires (si modularisation)
│       └── storage.js      # Gestion localStorage (si modularisation)
│
└── assets/                 # Ressources (images, icônes)
```

## 🚀 Utilisation

1. **Ouvrir l'application**
   - Ouvrir `index.html` dans un navigateur web moderne
   - ⚠️ Pour un fonctionnement optimal, utiliser un serveur local (voir ci-dessous)

2. **Serveur local recommandé**
   ```bash
   # Avec Python 3
   cd metre-pro-studio
   python -m http.server 8000
   # Puis ouvrir http://localhost:8000

   # Ou avec Node.js
   npx serve .
   ```

3. **Fonctionnalités principales**
   - 📁 Gestion de projets avec arborescence
   - 📊 Tableaux de métré avec calculs automatiques
   - 🔢 Système de variables L-S-V
   - 🎨 Éditeur Canvas intégré
   - 📄 Visualiseur PDF/Images
   - 💾 Sauvegarde automatique (localStorage)
   - 📤 Export JSON

## 🔧 Personnalisation des styles

Les CSS sont organisés par composant. Pour modifier l'apparence :

| Fichier                            | Ce qu'il contrôle                      |
|------------------------------------|----------------------------------------|
| `css/main.css`                     | Layout général, header, footer         |
| `css/components/table.css`         | Tableaux de métré, cellules            |
| `css/components/tree.css`          | Arborescence, panneau variables        |
| `css/components/dialog.css`        | Modales, settings, menus contextuels   |
| `css/components/canvas-editor.css` | Éditeur de dessin                      |
| `css/components/viewer.css`        | Visualiseur PDF/Images                 |

## 📝 Notes pour le développement futur

### Modularisation JavaScript (optionnel)

Le fichier `js/app.js` est actuellement monolithique mais bien commenté.
Pour le modulariser progressivement :

1. **Étape 1** - Extraire les constantes et configuration
   - Les `themePresets` et `defaultSettings` → `js/config/settings.js`

2. **Étape 2** - Extraire les utilitaires
   - `formatNumber`, `deepMerge`, `positionContextMenu` → `js/core/utils.js`

3. **Étape 3** - Extraire le stockage
   - `saveToLocalStorage`, `loadSettingsFromStorage` → `js/core/storage.js`

4. **Étape 4** - Créer des modules par fonctionnalité
   - `js/components/table-renderer.js`
   - `js/components/tree.js`
   - `js/components/viewer.js`
   - etc.

### Dépendances

L'application utilise ces bibliothèques externes (chargées via CDN) :
- **jQuery 3.6.0** - Manipulation DOM
- **Golden Layout** - Gestion des panneaux
- **PDF.js 3.11.174** - Rendu PDF

## 🐛 Débogage

- Appuyer sur `F12` pour ouvrir la console développeur
- L'application affiche des logs `[DEBUG]`, `[INFO]`, `[ERROR]`
- Paramètre debug dans les réglages avancés

## 📋 Changelog

### Version 0.10
- Réorganisation en fichiers multiples
- Séparation CSS/JS/HTML
- Documentation ajoutée

### Versions précédentes
- Voir l'historique dans le fichier original

---

© 2024 Métré Pro-Studio
