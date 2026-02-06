# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble du projet

**Métré Pro-Studio v0.10** - Application professionnelle de gestion de métrés pour le secteur du BTP (construction). Application web monopage (SPA) permettant de gérer des projets de métré avec un système unique de variables L-S-V (Longueur-Surface-Volume), éditeur canvas intégré, et visualiseur PDF/Images.

**⚠️ LANGUE DU PROJET**: Ce projet est entièrement en **français**. Toutes les communications avec l'utilisateur doivent être en français. Le code contient des commentaires et variables en français.

## Démarrage rapide

L'application est statique (HTML/CSS/JavaScript pur) sans processus de build.

### Option 1 : Ouverture directe (rapide)
```bash
# Ouvrir directement index.html dans un navigateur
open metre-pro-studio/index.html
```

### Option 2 : Serveur local (recommandé pour certaines fonctionnalités)
```bash
cd metre-pro-studio
python -m http.server 8000
# OU
npx serve .
# Puis ouvrir http://localhost:8000
```

**Note** : Un serveur local est recommandé si vous utilisez :
- Le visualiseur PDF (PDF.js fonctionne mieux avec un serveur)
- Des ressources externes qui nécessitent CORS

Pour un usage de base (tableaux métré, variables L-S-V, canvas), l'ouverture directe fonctionne parfaitement.

## Architecture du projet

### Structure des fichiers

```
metre-pro-studio/
├── index.html                    # Point d'entrée principal (255 lignes)
├── css/
│   ├── main.css                  # Styles de base (header, footer, layout)
│   └── components/               # Styles par composant
│       ├── table.css             # Tableaux de métré
│       ├── tree.css              # Arborescence et panneau variables
│       ├── dialog.css            # Dialogues et fenêtre de réglages
│       ├── canvas-editor.css     # Éditeur de dessin
│       └── viewer.css            # Visualiseur PDF/Images
└── js/
    ├── app.js                    # ⚠️ APPLICATION PRINCIPALE (11 392 lignes - MONOLITHIQUE)
    ├── config/
    │   └── settings.js           # Configuration et thèmes (155 lignes)
    └── core/
        ├── utils.js              # Fonctions utilitaires (136 lignes)
        └── storage.js            # Gestion localStorage (146 lignes)
```

### ⚠️ PROBLÈME ARCHITECTURAL CRITIQUE

**app.js = 11 392 lignes dans un seul fichier**

C'est le problème majeur du projet. Tout le code métier est dans ce fichier géant :

**Sections dans app.js** (lignes approximatives) :
- **56-234** : Données globales (`projects`, `currentProjectId`, `appSettings`)
- **296-412** : Gestion des projets (nouveau, ouvrir, sauvegarder)
- **466-552** : Initialisation de projet
- **554-701** : Gestion des onglets projets
- **1078-1545** : Viewer PDF/Image
- **1649-2569** : Arborescence (tree)
- **2588-4840** : Tableaux métré (rendering, calculs)
- **~6000-6900** : Système de variables L-S-V ⭐ (fonctionnalité clé)
- **~8000+** : Canvas Editor
- **~7211+** : Paramètres et UI

**Implications** :
- Difficile à maintenir et déboguer
- Risque élevé de régressions
- Duplication de code avec les modules (utils, storage)
- Variables globales partout

### Architecture modulaire (partielle)

Début de modularisation avec namespace `window.MetrePro` :

```javascript
// Fichiers modulaires
MetrePro.defaultSettings    // settings.js - Configuration par défaut
MetrePro.themePresets       // settings.js - Thèmes prédéfinis
MetrePro.Storage            // storage.js - Persistance localStorage
MetrePro.Utils              // utils.js - Fonctions utilitaires
```

## Structure des données

### Objet Project

```javascript
project = {
    id: "project_1738...",           // ID unique
    metadata: {
        client: "Nom du client",
        projet: "Nom du projet",
        lot: "Nom du lot",
        dateCreation: "YYYY-MM-DD",
        dateFin: "YYYY-MM-DD",
        autre: "Autres infos"
    },
    treeData: [...],                  // Arborescence hiérarchique
    variables: {...},                 // Dictionnaire des variables L-S-V
    currentPoste: {...},              // Poste actuellement édité
    selectedTreeNode: "nodeId",       // ID du nœud sélectionné
    copiedRow: {...}                  // Ligne copiée pour copier/coller
}
```

### Arborescence (treeData)

Structure hiérarchique à 3 niveaux : **Client → Projet → Lot → Postes**

```javascript
treeData = [
    {
        id: "folder_client_...",
        name: "Client",
        type: "folder",
        collapsed: false,
        children: [
            {
                id: "folder_projet_...",
                name: "Projet",
                type: "folder",
                children: [
                    {
                        id: "folder_lot_...",
                        name: "Lot",
                        type: "folder",
                        children: [
                            {
                                id: "poste_...",
                                name: "Minute avant métré 1",
                                type: "poste",
                                collapsed: false,
                                blocks: [...]  // Voir structure blocks
                            }
                        ]
                    }
                ]
            }
        ]
    }
]
```

### Structure des Blocks

Chaque poste contient un tableau `blocks` avec différents types :

**Type "table" (Tableau Métré)** - Le plus important :
```javascript
{
    id: "block_table_1_...",
    type: "table",
    folderName: "",
    fileName: "",
    data: [
        {
            code: "",
            designation: "Description de la ligne",
            n: {type: "value", value: 1},           // Nombre d'opérations
            op: "fs",                                // Opérateur (fs|e|c)
            l: {type: "value", value: 10.5},        // Longueur
            larg: {type: "variable", name: "L1"},   // Largeur (peut être variable)
            h: null,                                 // Hauteur
            ens: null,                               // Ensemble
            unit: "M²",                              // Unité
            pu: {type: "value", value: 25.50},      // Prix unitaire
            isDeduction: false,
            isSubtotalRow: false,
            valeurForcee: null,                      // Valeur forcée (variable ou valeur)
            qteForcee: null,
            totalLForcee: null
        }
    ],
    footer: {
        ens: "Ens.",
        unit: "M²",
        pu: 0  // ou {type: "variable", name: "V1"}
    }
}
```

**Autres types** : "file", "canvas", "image", "folder"

## Système de variables L-S-V ⭐

### Concept clé

Le **système L-S-V** est la fonctionnalité unique et centrale de l'application. Il permet de déclarer des variables et de les réutiliser à travers tous les tableaux du projet.

**Types de variables** :
- **L** (Longueur) - Dimensions linéaires
- **S** (Surface) - Surfaces, aires
- **V** (Volume) - Volumes, quantités

**Fonctionnement** :
1. **Déclaration** : L'utilisateur tape "L1" dans une cellule → crée la variable
2. **Utilisation** : L'utilisateur tape à nouveau "L1" ailleurs → référence la variable
3. **Affichage** : Badges bleus affichent le nom de la variable + sa valeur calculée
4. **Tracking** : Le système trace toutes les utilisations de chaque variable

### Stockage des variables

```javascript
project.variables = {
    "L1": {
        declaration: {
            value: 10.5,                    // Valeur calculée
            posteName: "Minute 1",          // Nom du poste
            rowIndex: 2,                    // Index de ligne
            field: "l",                     // Champ (l, larg, h, etc.)
            blockId: "block_table_1_..."    // ID du bloc
        },
        calls: [                             // Toutes les utilisations
            {rowIndex: 5, field: "l", blockId: "..."},
            {isFooter: true, field: "pu", blockId: "..."}
        ],
        description: "Longueur mur principal"  // Description optionnelle
    }
}
```

### Fonctions clés du système L-S-V

**Dans app.js** (lignes ~6000-6900) :
- `isVariablePattern(text)` - Vérifie si texte match pattern L/S/V + nombre
- `getVariableType(varName)` - Extrait le type (L, S, ou V)
- `getNextVariableName(projectId, type)` - Calcule le prochain numéro disponible
- `renderVariables(projectId)` - Affiche le panneau des variables
- `renderCellWithVariable(field)` - Affiche badge variable + valeur
- `flashCellsByVariable(projectId, varName)` - Surligne toutes les cellules de la variable
- `findVariableUsages(projectId, varName)` - Liste toutes les utilisations
- `deleteVariableWithConfirmation()` - Supprime une variable

**Pattern de reconnaissance** : `^[LSV]\d+$` (ex: L1, S5, V12)

### Affichage des badges

```css
.variable-badge.var-declaration {
    /* Variable déclarée - Bleu foncé + gras */
    font-weight: bold;
}

.variable-badge.var-call {
    /* Variable utilisée - Bleu clair + normal */
    font-weight: normal;
}
```

## Dépendances externes

Toutes chargées via CDN (pas de npm/package.json) :

```html
<!-- jQuery 3.6.0 - Manipulation DOM -->
<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>

<!-- Golden Layout - Gestion des panneaux -->
<script src="https://golden-layout.com/files/latest/js/goldenlayout.min.js"></script>
<link href="https://golden-layout.com/files/latest/css/goldenlayout-base.css" />

<!-- PDF.js 3.11.174 - Rendu PDF -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
```

## Stockage des données

### localStorage

L'application utilise **localStorage** pour la persistance (pas de backend) :

```javascript
// Clés utilisées
MetrePro.Storage.KEYS = {
    SETTINGS: 'metreProSettings',      // Paramètres de l'application
    PROJECTS: 'metreProProjects',      // Tous les projets
    LAST_PROJECT: 'metreProLastProject' // Dernier projet ouvert
}

// Fonctions principales
MetrePro.Storage.loadSettings()          // Charge settings au démarrage
MetrePro.Storage.saveSettings()          // Sauvegarde settings
MetrePro.Storage.loadProjects()          // Charge tous les projets
MetrePro.Storage.saveProjects(projects)  // Sauvegarde tous les projets
MetrePro.Storage.startAutoSave(5)        // Auto-save toutes les 5 minutes
```

### Export/Import JSON

```javascript
// Export - Télécharge fichier JSON
MetrePro.Storage.exportToFile(project, filename)

// Import - Charge depuis fichier JSON
MetrePro.Storage.importFromFile(file)  // Retourne Promise
```

## Fonctionnalités principales

### ✅ Implémentées et fonctionnelles

1. **Gestion de projets** - Nouveau, Ouvrir, Sauvegarder (JSON), Multi-projets en onglets
2. **Arborescence** - 3 niveaux, Collapse/Expand, Renommer, CRUD, Recherche
3. **Tableaux Métré** - 14 colonnes, Édition, Insertion/Suppression lignes, Sous-totaux, Calculs
4. **Système de variables L-S-V** - Déclaration, Utilisation, Panneau dédié, Tracking
5. **Canvas Editor** - Outils de dessin, Import images, Undo/Redo
6. **Visualiseur PDF/Images** - Navigation, Zoom, Rotation
7. **Système de thèmes** - 6 thèmes prédéfinis + Personnalisation

### ❌ Non implémentées (placeholders)

- Import/Export Excel
- Gestionnaire de variables avancé
- Recherche/Remplacer
- Validation des formules
- Calculatrice intégrée
- Raccourcis clavier (déclarés mais pas actifs)
- Système de tags
- IA/Auto-suggest
- Tutoriel interactif

## Bonnes pratiques pour ce projet

### Quand modifier app.js

1. **Localiser le code** - Utiliser les commentaires de section et numéros de ligne
2. **Chercher les dépendances** - Variables globales utilisées partout
3. **Tester manuellement** - Pas de tests automatisés
4. **Documenter** - Ajouter des commentaires pour les sections modifiées

### Quand travailler avec les variables L-S-V

⚠️ **CRITIQUE** - Le système de variables est complexe et fragile :

1. **Ne jamais modifier directement** `project.variables` sans passer par les fonctions
2. **Toujours vérifier** que déclaration et appels sont cohérents
3. **Tester la suppression** - Vérifier que les références sont nettoyées
4. **Pattern strict** - Variables doivent matcher `^[LSV]\d+$`

### Quand modifier les styles

- Styles globaux → `css/main.css`
- Styles de composant → `css/components/*.css`
- **NE PAS** mettre de styles inline dans le HTML
- **NE PAS** mélanger styles de composants dans main.css

## Problèmes connus et limitations

### Architecture
- **app.js monolithique** (11 392 lignes) - Difficile à maintenir
- **Pas de tests** - Risque élevé de régressions
- **Variables globales** - État partagé fragile
- **Duplication de code** - Entre app.js et modules

### Bugs potentiels
- Gestion des blocks/treeData (confusion structurelle)
- Variables sans refactoring automatique lors de suppression
- Formules hard-codées pour colonnes spécifiques
- localStorage peut dépasser quota (5-10MB)

### Sécurité
- XSS possible (`innerHTML` sans échappement)
- localStorage non chiffré
- Validation d'input minimale

## Refactorisation recommandée

### Phase 1 - Modularisation urgente

Séparer app.js en modules indépendants pour faciliter la maintenance.

### Phase 2 - Framework moderne

Migrer vers Vue.js 3 ou React avec state management et build process.

### Phase 3 - Backend

Ajouter API REST, base de données, authentification, synchronisation cloud.

## Commandes utiles

```bash
# Ouvrir l'application
open metre-pro-studio/index.html

# Console développeur (dans le navigateur)
# F12 ou Cmd+Option+I (Mac) ou Ctrl+Shift+I (Windows)
```

**Console navigateur** :
```javascript
// Vider localStorage
localStorage.clear()

// Inspecter données
console.log(projects)
console.log(MetrePro.appSettings)
console.log(localStorage.getItem('metreProProjects'))
```

## Debug

L'application affiche des logs dans la console avec préfixes : `[DEBUG]`, `[INFO]`, `[ERROR]`, `[STORAGE]`

**Activer le mode debug** : Réglages (⚙️) → Avancé → Cocher "Activer le mode debug"

## Archive

Le dossier `/Archive` contient les versions précédentes (v0.07-v0.10) en fichiers HTML uniques. **Ne pas modifier** - conservés pour référence historique uniquement.
