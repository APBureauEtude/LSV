/**
 * Métré Pro-Studio - Fonctions utilitaires
 * Ce fichier contient les fonctions utilitaires partagées
 */

window.MetrePro = window.MetrePro || {};
MetrePro.Utils = {};

// ===== DEEP MERGE =====
MetrePro.Utils.isObject = function(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
};

MetrePro.Utils.deepMerge = function(target, source) {
    const output = Object.assign({}, target);
    if (MetrePro.Utils.isObject(target) && MetrePro.Utils.isObject(source)) {
        Object.keys(source).forEach(key => {
            if (MetrePro.Utils.isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = MetrePro.Utils.deepMerge(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
};

// ===== GÉNÉRATION D'IDS =====
MetrePro.Utils.generateId = function() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

// ===== FORMATAGE DES NOMBRES =====
MetrePro.Utils.formatNumber = function(num, decimals) {
    if (num === null || num === undefined || isNaN(num)) return '';
    decimals = decimals !== undefined ? decimals : MetrePro.appSettings.format.decimalPlaces;
    return parseFloat(num).toFixed(decimals);
};

// ===== PARSAGE DES NOMBRES =====
MetrePro.Utils.parseNumber = function(str) {
    if (str === null || str === undefined || str === '') return 0;
    if (typeof str === 'number') return str;
    
    // Remplacer les virgules par des points
    str = str.toString().replace(',', '.');
    
    let num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};

// ===== POSITION DU MENU CONTEXTUEL =====
MetrePro.Utils.positionContextMenu = function($menu, e) {
    $('body').append($menu);
    
    let menuHeight = $menu.outerHeight();
    let menuWidth = $menu.outerWidth();
    let windowHeight = $(window).height();
    let windowWidth = $(window).width();
    let scrollTop = $(window).scrollTop();
    let scrollLeft = $(window).scrollLeft();
    
    let top = e.pageY;
    let left = e.pageX;
    
    // Si le menu dépasse en bas, l'afficher au-dessus du clic
    if (e.pageY + menuHeight > scrollTop + windowHeight) {
        top = e.pageY - menuHeight;
        if (top < scrollTop) top = scrollTop;
    }
    
    // Si le menu dépasse à droite, ajuster à gauche
    if (e.pageX + menuWidth > scrollLeft + windowWidth) {
        left = e.pageX - menuWidth;
        if (left < scrollLeft) left = scrollLeft;
    }
    
    $menu.css({
        position: 'absolute',
        left: left + 'px',
        top: top + 'px'
    });
};

// ===== CLONAGE PROFOND =====
MetrePro.Utils.deepClone = function(obj) {
    return JSON.parse(JSON.stringify(obj));
};

// ===== DEBOUNCE =====
MetrePro.Utils.debounce = function(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// ===== ESCAPE HTML =====
MetrePro.Utils.escapeHtml = function(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
};

// ===== DATE FORMATTING =====
MetrePro.Utils.formatDate = function(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// ===== COMPATIBILITÉ - Exposer globalement =====
// Pour la rétrocompatibilité avec le code existant
window.formatNumber = MetrePro.Utils.formatNumber;
window.positionContextMenu = MetrePro.Utils.positionContextMenu;
window.deepMerge = MetrePro.Utils.deepMerge;
window.isObject = MetrePro.Utils.isObject;

console.log('[UTILS] Module utilitaires chargé');
