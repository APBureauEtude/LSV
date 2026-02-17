/**
 * Métré Pro-Studio - Configuration et Paramètres
 * Ce fichier contient toutes les configurations de l'application
 */

// Namespace global
window.MetrePro = window.MetrePro || {};

// ===== PARAMÈTRES PAR DÉFAUT =====
MetrePro.defaultSettings = {
    general: {
        autoSave: true,
        autoSaveInterval: 5,
        language: 'fr',
        startupAction: 'empty'
    },
    display: {
        showGrid: true,
        fontSize: 10,
        compactMode: false,
        highlightEdited: true
    },
    theme: {
        preset: 'default',
        customTable: {
            headerBg: '#f0f0f0',
            headerColor: '#333',
            headerFont: 'Segoe UI',
            cellWidth: 'auto',
            cellHeight: 22,
            lockWidth: false,
            lockHeight: false,
            columns: {
                designation: { bg: '#ffffff', color: '#000000' },
                n: { bg: '#ffffff', color: '#000000' },
                op: { bg: '#ffffff', color: '#000000' },
                l: { bg: '#ffffff', color: '#000000' },
                totalL: { bg: '#f9f9f9', color: '#000000' },
                larg: { bg: '#ffffff', color: '#000000' },
                h: { bg: '#ffffff', color: '#000000' },
                ens: { bg: '#ffffff', color: '#000000' },
                valPlus: { bg: '#ffffff', color: '#27ae60' },
                valMoins: { bg: '#ffffff', color: '#e74c3c' },
                unit: { bg: '#ffffff', color: '#000000' },
                qteTotal: { bg: '#f9f9f9', color: '#000000' },
                pu: { bg: '#ffffff', color: '#000000' },
                totalHT: { bg: '#f9f9f9', color: '#000000' }
            }
        },
        badges: {
            shape: 'rounded',
            L: { 
                varBorder: '#2980b9', varBg: '#e8f4fd', varColor: '#2980b9', 
                refBorder: '#2980b9', refBg: '#ffffff', refColor: '#2980b9' 
            },
            S: { 
                varBorder: '#2980b9', varBg: '#e8f4fd', varColor: '#2980b9', 
                refBorder: '#2980b9', refBg: '#ffffff', refColor: '#2980b9' 
            },
            V: { 
                varBorder: '#2980b9', varBg: '#e8f4fd', varColor: '#2980b9', 
                refBorder: '#2980b9', refBg: '#ffffff', refColor: '#2980b9' 
            }
        }
    },
    tags: {
        enableTags: false,
        tagUnits: []
    },
    units: {
        defaultCurrency: '€',
        customUnits: ['Ml', 'M²', 'M³', 'M³f', 'Kg', 'U', 'Ens.', 'For.', 'Sac.']
    },
    format: {
        decimalPlaces: 2,
        decimalSeparator: '.',
        dateFormat: 'DD/MM/YYYY'
    },
    ai: {
        enableAI: false,
        aiProvider: 'none',
        autoSuggest: false
    },
    export: {
        defaultFormat: 'pdf',
        includeMetadata: true,
        pageSize: 'A4',
        orientation: 'portrait'
    },
    advanced: {
        enableDebug: false,
        maxUndoSteps: 50,
        cacheSize: 100
    },
    shortcuts: {
        newFolder: 'Ctrl+Shift+F',
        newFile: 'Ctrl+Shift+N',
        newPoste: 'Ctrl+Shift+P',
        newTable: 'Ctrl+Shift+T',
        newCanvas: 'Ctrl+Shift+C',
        newImage: 'Ctrl+Shift+I'
    }
};

// ===== THÈMES PRÉDÉFINIS =====
MetrePro.themePresets = {
    default: {
        name: 'Défaut',
        headerBg: '#f0f0f0',
        headerColor: '#333',
        valPlusColor: '#27ae60',
        valMoinsColor: '#e74c3c'
    },
    blue: {
        name: 'Bleu Professionnel',
        headerBg: '#2c3e50',
        headerColor: '#ecf0f1',
        valPlusColor: '#3498db',
        valMoinsColor: '#e74c3c'
    },
    green: {
        name: 'Vert Nature',
        headerBg: '#27ae60',
        headerColor: '#ffffff',
        valPlusColor: '#2ecc71',
        valMoinsColor: '#e67e22'
    },
    dark: {
        name: 'Sombre',
        headerBg: '#34495e',
        headerColor: '#ecf0f1',
        valPlusColor: '#1abc9c',
        valMoinsColor: '#e74c3c'
    },
    modern: {
        name: 'Moderne',
        headerBg: '#9b59b6',
        headerColor: '#ffffff',
        valPlusColor: '#3498db',
        valMoinsColor: '#e74c3c'
    },
    pastel: {
        name: 'Pastel',
        headerBg: '#dfe6e9',
        headerColor: '#2d3436',
        valPlusColor: '#00b894',
        valMoinsColor: '#d63031'
    }
};

// ===== PARAMÈTRES ACTIFS =====
// Cette variable sera initialisée au chargement depuis localStorage
MetrePro.appSettings = JSON.parse(JSON.stringify(MetrePro.defaultSettings));

console.log('[CONFIG] Module settings chargé');
