/**
 * Métré Pro-Studio - Module de stockage
 * Gestion de la persistance des données (localStorage)
 */

window.MetrePro = window.MetrePro || {};
MetrePro.Storage = {};

// ===== CLÉS DE STOCKAGE =====
MetrePro.Storage.KEYS = {
    SETTINGS: 'metreProSettings',
    PROJECTS: 'metreProProjects',
    LAST_PROJECT: 'metreProLastProject'
};

// ===== CHARGER LES PARAMÈTRES =====
MetrePro.Storage.loadSettings = function() {
    let stored = localStorage.getItem(MetrePro.Storage.KEYS.SETTINGS);
    if (stored) {
        try {
            let loadedSettings = JSON.parse(stored);
            // Deep merge pour préserver les valeurs par défaut
            MetrePro.appSettings = MetrePro.Utils.deepMerge(MetrePro.defaultSettings, loadedSettings);
            
            // S'assurer que les tableaux critiques existent
            if (!MetrePro.appSettings.units.customUnits || !Array.isArray(MetrePro.appSettings.units.customUnits)) {
                MetrePro.appSettings.units.customUnits = ['Ml', 'M²', 'M³', 'M³f', 'Kg', 'U', 'Ens.', 'For.', 'Sac.'];
            }
            if (!MetrePro.appSettings.tags.tagUnits || !Array.isArray(MetrePro.appSettings.tags.tagUnits)) {
                MetrePro.appSettings.tags.tagUnits = [];
            }
            
            console.log('[STORAGE] Paramètres chargés depuis localStorage');
        } catch (e) {
            console.error('[STORAGE] Erreur lors du chargement des paramètres:', e);
            console.log('[STORAGE] Utilisation des paramètres par défaut');
            MetrePro.appSettings = JSON.parse(JSON.stringify(MetrePro.defaultSettings));
        }
    } else {
        console.log('[STORAGE] Aucun paramètre sauvegardé, utilisation des valeurs par défaut');
    }
};

// ===== SAUVEGARDER LES PARAMÈTRES =====
MetrePro.Storage.saveSettings = function() {
    try {
        localStorage.setItem(MetrePro.Storage.KEYS.SETTINGS, JSON.stringify(MetrePro.appSettings));
        console.log('[STORAGE] Paramètres sauvegardés');
    } catch (e) {
        console.error('[STORAGE] Erreur lors de la sauvegarde des paramètres:', e);
    }
};

// ===== SAUVEGARDER TOUS LES PROJETS =====
MetrePro.Storage.saveProjects = function(projects) {
    try {
        localStorage.setItem(MetrePro.Storage.KEYS.PROJECTS, JSON.stringify(projects));
        console.log('[STORAGE] Projets sauvegardés');
    } catch (e) {
        console.error('[STORAGE] Erreur lors de la sauvegarde des projets:', e);
        if (e.name === 'QuotaExceededError') {
            alert('⚠️ Espace de stockage insuffisant. Veuillez exporter vos projets et vider le stockage.');
        }
    }
};

// ===== CHARGER TOUS LES PROJETS =====
MetrePro.Storage.loadProjects = function() {
    let stored = localStorage.getItem(MetrePro.Storage.KEYS.PROJECTS);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('[STORAGE] Erreur lors du chargement des projets:', e);
            return {};
        }
    }
    return {};
};

// ===== SAUVEGARDER DANS UN FICHIER JSON =====
MetrePro.Storage.exportToFile = function(project, filename) {
    let dataStr = JSON.stringify(project, null, 2);
    let blob = new Blob([dataStr], { type: 'application/json' });
    let url = URL.createObjectURL(blob);
    
    let a = document.createElement('a');
    a.href = url;
    a.download = filename || 'projet.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('[STORAGE] Projet exporté:', filename);
};

// ===== IMPORTER DEPUIS UN FICHIER JSON =====
MetrePro.Storage.importFromFile = function(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onload = function(e) {
            try {
                let data = JSON.parse(e.target.result);
                console.log('[STORAGE] Projet importé depuis fichier');
                resolve(data);
            } catch (err) {
                console.error('[STORAGE] Erreur lors de l\'import:', err);
                reject(err);
            }
        };
        reader.onerror = function() {
            reject(new Error('Erreur de lecture du fichier'));
        };
        reader.readAsText(file);
    });
};

// ===== TOUT SAUVEGARDER (settings + projets) =====
MetrePro.Storage.saveAll = function() {
    MetrePro.Storage.saveSettings();
    if (window.projects) {
        MetrePro.Storage.saveProjects(window.projects);
    }
};

// ===== AUTO-SAVE =====
MetrePro.Storage.startAutoSave = function(intervalMinutes) {
    if (MetrePro.Storage._autoSaveInterval) {
        clearInterval(MetrePro.Storage._autoSaveInterval);
    }
    
    MetrePro.Storage._autoSaveInterval = setInterval(function() {
        if (MetrePro.appSettings.general.autoSave) {
            MetrePro.Storage.saveAll();
            console.log('[STORAGE] Auto-save effectué');
        }
    }, intervalMinutes * 60 * 1000);
};

// ===== COMPATIBILITÉ - Exposer globalement =====
window.saveToLocalStorage = MetrePro.Storage.saveAll;
window.saveSettingsToStorage = MetrePro.Storage.saveSettings;
window.loadSettingsFromStorage = MetrePro.Storage.loadSettings;

console.log('[STORAGE] Module de stockage chargé');
