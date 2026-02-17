# Métré Pro-Studio v0.10

Application professionnelle de gestion de métrés pour le BTP.

## 📁 Structure du projet

```
metre-pro-studio/
├── index.html              # Point d'entrée principal
├── manifest.json           # Configuration PWA
├── sw.js                   # Service Worker PWA
├── README.md               # Ce fichier
│
├── icons/
│   ├── icon.svg            # Icône vectorielle
│   └── generate-icons.html # Générateur d'icônes PNG
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
│   ├── app.js              # Application principale (~12000 lignes)
│   ├── config/
│   │   └── settings.js     # Configuration (si modularisation future)
│   └── core/
│       ├── utils.js        # Fonctions utilitaires (si modularisation)
│       └── storage.js      # Gestion localStorage (si modularisation)
│
└── assets/                 # Ressources (images, icônes)
```

## 🖥️ Installation comme Application (PWA)

L'application peut être installée comme un **logiciel natif** (sans barres de navigateur).

### Étape 1 : Générer les icônes

1. Ouvrez `icons/generate-icons.html` dans votre navigateur
2. Téléchargez chaque icône en cliquant sur "Télécharger"
3. Placez les fichiers PNG dans le dossier `icons/`

### Étape 2 : Héberger l'application

L'installation PWA nécessite que l'application soit servie via HTTP(S) :

```bash
# Avec Python 3
cd metre-pro-studio
python -m http.server 8000
# Puis ouvrir http://localhost:8000

# Ou avec Node.js
npx serve .

# Ou héberger sur un serveur web (Apache, Nginx, etc.)
```

### Étape 3 : Installer l'application

**Sur Chrome / Edge :**
1. Ouvrez l'application dans le navigateur
2. Cliquez sur l'icône ⊕ dans la barre d'adresse (ou menu → Installer)
3. Confirmez l'installation
4. L'application s'ouvrira désormais comme un logiciel natif !

**Sur Safari (Mac) :**
1. Ouvrez l'application
2. Fichier → Ajouter au Dock

**Sur Firefox :**
1. Firefox ne supporte pas encore l'installation PWA
2. Utilisez Chrome ou Edge pour l'installation

### Raccourci Bureau (alternative simple)

Si vous ne souhaitez pas configurer un serveur :
1. Ouvrez `index.html` dans Chrome
2. Menu (⋮) → Plus d'outils → Créer un raccourci
3. Cochez "Ouvrir dans une fenêtre"
4. Le raccourci s'ouvrira sans barres de navigateur

## 🚀 Utilisation

1. **Ouvrir l'application**
   - Double-clic sur le raccourci installé
   - Ou ouvrir `index.html` dans un navigateur

2. **Fonctionnalités principales**
   - 📁 Gestion de projets avec arborescence
   - 📊 Tableaux de métré avec calculs automatiques
   - 🔢 Système de variables L-S-V
   - 🎨 Éditeur Canvas intégré
   - 📄 Visualiseur PDF/Images
   - 💾 Sauvegarde automatique (localStorage)
   - 📤 Export JSON
   - ⚙️ Personnalisation mise en page (colonnes, lignes, titres)

## 🔧 Personnalisation des styles

Les CSS sont organisés par composant. Pour modifier l'apparence :

| Fichier | Ce qu'il contrôle |
|---------|-------------------|
| `css/main.css` | Layout général, header, footer |
| `css/components/table.css` | Tableaux de métré, cellules |
| `css/components/tree.css` | Arborescence, panneau variables |
| `css/components/dialog.css` | Modales, settings, menus contextuels |
| `css/components/canvas-editor.css` | Éditeur de dessin |
| `css/components/viewer.css` | Visualiseur PDF/Images |

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
- Support PWA (Progressive Web App)
- Personnalisation mise en page (colonnes, lignes, titres)
- Documentation ajoutée

### Versions précédentes
- Voir l'historique dans le fichier original

---

© 2024 Métré Pro-Studio
