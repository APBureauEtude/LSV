/**
 * ============================================================================
 * MÉTRÉ PRO-STUDIO - Application principale
 * Version: 0.10
 * ============================================================================
 * 
 * Ce fichier contient l'ensemble de la logique JavaScript de l'application.
 * 
 * STRUCTURE DU CODE:
 * ==================
 * 1. DONNÉES GLOBALES (ligne ~20)
 *    - projects, currentProjectId, contextMenu
 *    - appSettings, themePresets
 * 
 * 2. FONCTIONS UTILITAIRES (ligne ~500)
 *    - positionContextMenu, deepMerge, formatNumber
 *    - loadSettingsFromStorage, saveSettingsToStorage
 * 
 * 3. GESTION DES PROJETS (ligne ~700)
 *    - newProject, createNewProject, openProject
 *    - saveFile, openFile, importExcel, exportExcel
 * 
 * 4. GOLDEN LAYOUT (ligne ~1000)
 *    - createProjectWorkspace, setupGoldenLayout
 * 
 * 5. VIEWER PDF/IMAGE (ligne ~1400)
 *    - handleViewerFileLoad, loadPDFInViewer, loadImageInViewer
 *    - renderViewerContent, setupViewerPanning
 * 
 * 6. ARBORESCENCE (ligne ~2000)
 *    - addFolder, addPoste, deleteFolder, deletePoste
 *    - selectTreeNode, renderTreeNodes, updateTreeContent
 * 
 * 7. TABLEAUX MÉTRÉ (ligne ~3000)
 *    - renderMetreTable, renderCellWithVariable
 *    - calculateTotalL, getValue
 *    - handleCellEdit, addRow, deleteRow
 * 
 * 8. SYSTÈME DE VARIABLES L-S-V (ligne ~6000)
 *    - parseVariableInput, getVariableType
 *    - Variable panel rendering
 * 
 * 9. CANVAS EDITOR (ligne ~8000)
 *    - openCanvasEditor, closeCanvasEditor
 *    - Canvas drawing tools
 * 
 * 10. PARAMÈTRES & UI (ligne ~10000)
 *     - openSettings, saveSettings
 *     - Shortcuts, themes, dialogs
 * 
 * Pour la modularisation future, chaque section peut être extraite
 * en suivant les dépendances indiquées dans les commentaires.
 * ============================================================================
 */

// ===== DONNÉES GLOBALES =====
let projects = {}; // { projectId: { metadata, layout, data } }
let currentProjectId = null;
let contextMenu = null;

// ===== SYSTÈME DE FORMULES EXCEL-LIKE =====
// Mapping des colonnes vers des lettres Excel (A = Code, sans la colonne #)
const COLUMN_TO_LETTER = {
    'code': 'A', 'designation': 'B', 'n': 'C', 'op': 'D',
    'l': 'E', 'totall': 'F', 'larg': 'G', 'h': 'H', 'ens': 'I',
    'valplus': 'J', 'valmoins': 'K', 'unit': 'L', 'qtetotal': 'M', 'pu': 'N', 'totalht': 'O'
};
const LETTER_TO_COLUMN = {
    'A': 'code', 'B': 'designation', 'C': 'n', 'D': 'op',
    'E': 'l', 'F': 'totall', 'G': 'larg', 'H': 'h', 'I': 'ens',
    'J': 'valplus', 'K': 'valmoins', 'L': 'unit', 'M': 'qtetotal', 'N': 'pu', 'O': 'totalht'
};

// État du mode sélection de formule
let formulaSelectionMode = {
    active: false,
    projectId: null,
    blockId: null,
    inputElement: null
};

// Vérifier si une valeur est une formule
function isFormula(value) {
    return typeof value === 'string' && value.trim().startsWith('=');
}

// Parser une référence de cellule (ex: "E5" → {col: 'l', row: 4, lineNumber: 5})
function parseCellReference(ref) {
    let match = ref.toUpperCase().match(/^([A-O])(\d+)$/);
    if (!match) return null;
    
    let letter = match[1];
    let lineNum = parseInt(match[2]);
    
    if (!LETTER_TO_COLUMN[letter]) return null;
    
    return {
        col: LETTER_TO_COLUMN[letter],
        lineNumber: lineNum  // Le numéro de ligne affiché (1-based)
    };
}

// Obtenir la valeur d'une cellule par référence (utilise le numéro de ligne affiché)
function getCellValueByRef(projectId, blockId, ref) {
    let project = projects[projectId];
    if (!project || !project.currentPoste) return 0;
    
    let cellRef = parseCellReference(ref);
    if (!cellRef) return 0;
    
    // Trouver la ligne par son numéro affiché (lineNumber)
    // Reproduire le comptage de lignes comme dans renderMetreTable
    let currentLineNumber = 0;
    let targetRow = null;
    let targetBlock = null;
    let targetRowIndex = -1;
    
    for (let block of project.currentPoste.blocks) {
        // Skip folder blocks (pas de numéro de ligne)
        if (block.type === 'folder') continue;
        
        if (block.type === 'file' || block.type === 'image' || block.type === 'canvas') {
            // Ces blocs prennent 1 numéro de ligne
            currentLineNumber++;
            // On ne peut pas référencer ces lignes pour les calculs
            if (currentLineNumber === cellRef.lineNumber) {
                return 0; // Pas de valeur pour ces types de blocs
            }
            continue;
        }
        
        if (block.type === 'table' && block.data) {
            for (let i = 0; i < block.data.length; i++) {
                currentLineNumber++;
                if (currentLineNumber === cellRef.lineNumber) {
                    targetRow = block.data[i];
                    targetBlock = block;
                    targetRowIndex = i;
                    break;
                }
            }
            
            if (targetRow) break;
        }
    }
    
    if (!targetRow || !targetBlock) return 0;
    
    // Vérifier si c'est une ligne sous-total
    let isSubtotal = targetRow.isSubtotalRow === true;
    
    // Calculer la valeur du sous-total si nécessaire
    let subtotalValue = 0;
    if (isSubtotal && targetBlock.data) {
        // Trouver l'index du sous-total précédent
        let lastSubtotalIndex = -1;
        for (let j = targetRowIndex - 1; j >= 0; j--) {
            if (targetBlock.data[j].isSubtotalRow === true) {
                lastSubtotalIndex = j;
                break;
            }
        }
        
        // Sommer les Total L des lignes entre le dernier sous-total et celui-ci
        for (let j = lastSubtotalIndex + 1; j < targetRowIndex; j++) {
            let dataRow = targetBlock.data[j];
            if (dataRow.isSubtotalRow) continue;
            
            let rowTotalL;
            if (dataRow.totalLForcee) {
                rowTotalL = getValue(dataRow.totalLForcee, project.variables) || 0;
            } else {
                rowTotalL = calculateTotalL(dataRow, project.variables) || 0;
            }
            subtotalValue += rowTotalL;
        }
    }
    
    // Si c'est une colonne calculée, calculer la valeur
    if (cellRef.col === 'totall') {
        if (isSubtotal) {
            return subtotalValue;
        }
        if (targetRow.totalLForcee) {
            return getValue(targetRow.totalLForcee, project.variables) || 0;
        }
        return calculateTotalL(targetRow, project.variables) || 0;
    }
    
    if (cellRef.col === 'valplus' || cellRef.col === 'valmoins') {
        let value = 0;
        
        if (isSubtotal) {
            // Pour les sous-totaux, vérifier la chaîne larg → h
            let nextRow = targetBlock.data[targetRowIndex + 1];
            let nextNextRow = targetBlock.data[targetRowIndex + 2];
            
            value = subtotalValue;
            
            // Si la ligne suivante a une valeur larg, multiplier
            if (nextRow && !nextRow.isSubtotalRow) {
                let nextLarg = getValue(nextRow.larg, project.variables);
                if (nextLarg && nextLarg !== 0) {
                    value = subtotalValue * nextLarg;
                    
                    // Si la ligne d'après a une valeur h, multiplier aussi
                    if (nextNextRow && !nextNextRow.isSubtotalRow) {
                        let nextNextH = getValue(nextNextRow.h, project.variables);
                        if (nextNextH && nextNextH !== 0) {
                            value = subtotalValue * nextLarg * nextNextH;
                        }
                    }
                }
            }
        } else {
            // Ligne normale
            let totalL = targetRow.totalLForcee ? getValue(targetRow.totalLForcee, project.variables) : calculateTotalL(targetRow, project.variables);
            let larg = getValue(targetRow.larg, project.variables) || 1;
            let h = getValue(targetRow.h, project.variables) || 1;
            let ens = targetRow.ens === 'Ens.' ? 1 : 0;
            
            if (targetRow.valeurForcee) {
                value = getValue(targetRow.valeurForcee, project.variables) || 0;
            } else if (ens === 0) {
                value = (totalL || 0) * larg * h;
            } else {
                value = totalL || 0;
            }
        }
        
        // Retourner la valeur seulement si c'est la bonne colonne (+ ou -)
        if (cellRef.col === 'valplus') {
            return targetRow.isDeduction ? 0 : value;
        } else {
            return targetRow.isDeduction ? value : 0;
        }
    }
    
    if (cellRef.col === 'qtetotal') {
        return calculateQteTotal(targetRow, project.variables) || 0;
    }
    if (cellRef.col === 'totalht') {
        let qte = calculateQteTotal(targetRow, project.variables) || 0;
        let pu = getValue(targetRow.pu, project.variables) || 0;
        return qte * pu;
    }
    
    // Valeur normale
    let fieldValue = targetRow[cellRef.col];
    return getValue(fieldValue, project.variables) || 0;
}

// Évaluer une formule
function evaluateFormula(formula, projectId, blockId) {
    if (!formula || !formula.startsWith('=')) return formula;
    
    let expr = formula.substring(1).trim(); // Enlever le "="
    
    try {
        // Remplacer les références de CELLULES par leurs valeurs
        // Pattern: lettre A-O + chiffres (ex: E5, A1, O10)
        expr = expr.replace(/([A-Oa-o])(\d+)/g, function(match, letter, num) {
            let ref = letter.toUpperCase() + num;
            let value = getCellValueByRef(projectId, blockId, ref);
            // Pour les nombres, retourner directement
            if (typeof value === 'number') return value;
            // Pour les chaînes, les encadrer de guillemets
            if (typeof value === 'string') return '"' + value.replace(/"/g, '\\"') + '"';
            return 0;
        });
        
        // Gérer la concaténation de chaînes avec +
        // Remplacer les guillemets simples par des doubles pour uniformiser
        expr = expr.replace(/'/g, '"');
        
        // Évaluer l'expression de manière sécurisée
        // Permettre uniquement: nombres, chaînes, +, -, *, /, (, ), espaces
        if (/^[\d\s\+\-\*\/\.\(\)"A-Za-zÀ-ÿ\s,;:!?]+$/.test(expr)) {
            // Utiliser Function pour évaluer (plus sûr que eval direct)
            let result = new Function('return ' + expr)();
            return result;
        } else {
            console.warn('[FORMULA] Expression non autorisée:', expr);
            return '#ERREUR';
        }
    } catch (e) {
        console.error('[FORMULA] Erreur d\'évaluation:', e, 'Expression:', expr);
        return '#ERREUR';
    }
}

// Créer un champ formule
function createFormulaField(formula, calculatedValue) {
    return {
        type: 'formula',
        formula: formula,
        value: calculatedValue
    };
}

// Trouver toutes les cellules qui dépendent d'une référence
function findDependentCells(projectId, blockId, col, rowIndex) {
    let dependents = [];
    let project = projects[projectId];
    if (!project || !project.currentPoste) return dependents;
    
    let refLetter = COLUMN_TO_LETTER[col];
    let refString = refLetter + (rowIndex + 1);
    
    // Parcourir tous les blocs
    project.currentPoste.blocks.forEach(block => {
        if (block.type !== 'table' || !block.data) return;
        
        block.data.forEach((row, rIdx) => {
            // Vérifier chaque champ qui peut contenir une formule
            ['n', 'l', 'larg', 'h', 'valeurForcee', 'pu', 'designation', 'code'].forEach(field => {
                let cellValue = row[field];
                if (cellValue && typeof cellValue === 'object' && cellValue.type === 'formula') {
                    // Vérifier si la formule contient cette référence
                    if (cellValue.formula.toUpperCase().includes(refString)) {
                        dependents.push({
                            blockId: block.id,
                            rowIndex: rIdx,
                            field: field
                        });
                    }
                }
            });
        });
    });
    
    return dependents;
}

// Mettre à jour toutes les formules dépendantes
function updateDependentFormulas(projectId, blockId, col, rowIndex) {
    let dependents = findDependentCells(projectId, blockId, col, rowIndex);
    
    dependents.forEach(dep => {
        let project = projects[projectId];
        let block = project.currentPoste.blocks.find(b => b.id === dep.blockId);
        if (block && block.data && block.data[dep.rowIndex]) {
            let cellData = block.data[dep.rowIndex][dep.field];
            if (cellData && cellData.type === 'formula') {
                // Recalculer la valeur
                let newValue = evaluateFormula(cellData.formula, projectId, dep.blockId);
                cellData.value = newValue;
            }
        }
    });
}

// Couleurs pour les références de formule
const FORMULA_REF_COLORS = [
    { text: 'formula-text-color-0', cell: 'formula-ref-color-0' },
    { text: 'formula-text-color-1', cell: 'formula-ref-color-1' },
    { text: 'formula-text-color-2', cell: 'formula-ref-color-2' },
    { text: 'formula-text-color-3', cell: 'formula-ref-color-3' },
    { text: 'formula-text-color-4', cell: 'formula-ref-color-4' },
    { text: 'formula-text-color-5', cell: 'formula-ref-color-5' }
];

// Trouver toutes les références de cellule dans une formule
function findFormulaReferences(formula) {
    if (!formula) return [];
    let refs = [];
    let regex = /([A-Oa-o])(\d+)/g;
    let match;
    let colorIndex = 0;
    let usedRefs = {};
    
    while ((match = regex.exec(formula)) !== null) {
        let ref = match[1].toUpperCase() + match[2];
        
        // Si cette référence a déjà une couleur, réutiliser
        if (usedRefs[ref] !== undefined) {
            refs.push({
                ref: ref,
                start: match.index,
                end: match.index + match[0].length,
                colorIndex: usedRefs[ref]
            });
        } else {
            // Nouvelle référence, assigner une couleur
            usedRefs[ref] = colorIndex % FORMULA_REF_COLORS.length;
            refs.push({
                ref: ref,
                start: match.index,
                end: match.index + match[0].length,
                colorIndex: usedRefs[ref]
            });
            colorIndex++;
        }
    }
    
    return refs;
}

// Créer le HTML coloré pour le backdrop de formule
function createFormulaBackdropHtml(formula, references) {
    if (!formula || references.length === 0) return formula || '';
    
    let html = '';
    let lastEnd = 0;
    
    // Trier par position
    references.sort((a, b) => a.start - b.start);
    
    for (let ref of references) {
        // Texte avant la référence
        if (ref.start > lastEnd) {
            html += escapeHtml(formula.substring(lastEnd, ref.start));
        }
        // La référence colorée
        html += `<span class="${FORMULA_REF_COLORS[ref.colorIndex].text}">${escapeHtml(formula.substring(ref.start, ref.end))}</span>`;
        lastEnd = ref.end;
    }
    
    // Texte après la dernière référence
    if (lastEnd < formula.length) {
        html += escapeHtml(formula.substring(lastEnd));
    }
    
    return html;
}

// Mettre en surbrillance les cellules référencées dans le tableau
function highlightReferencedCells(projectId, references) {
    // Supprimer les surbrillances précédentes
    clearFormulaHighlights();
    
    if (!references || references.length === 0) return;
    
    let project = projects[projectId];
    if (!project || !project.currentPoste) return;
    
    // Trouver les cellules référencées et les colorier
    let uniqueRefs = {};
    references.forEach(r => {
        if (!uniqueRefs[r.ref]) {
            uniqueRefs[r.ref] = r.colorIndex;
        }
    });
    
    for (let ref in uniqueRefs) {
        let colorIndex = uniqueRefs[ref];
        let cellRef = parseCellReference(ref);
        if (!cellRef) continue;
        
        // Trouver la cellule dans le DOM par son numéro de ligne
        let $row = $(`#workspace-${projectId} .metre-table tr[data-line="${cellRef.lineNumber}"]`);
        if ($row.length === 0) continue;
        
        let $cell = $row.find(`td[data-field="${cellRef.col}"]`);
        if ($cell.length === 0) continue;
        
        $cell.addClass(FORMULA_REF_COLORS[colorIndex].cell);
    }
}

// Supprimer toutes les surbrillances de formule
function clearFormulaHighlights() {
    FORMULA_REF_COLORS.forEach(c => {
        $(`.${c.cell}`).removeClass(c.cell);
    });
}

// Mettre à jour le backdrop et les surbrillances pendant l'édition
function updateFormulaHighlighting(projectId, inputElement, backdropElement) {
    let formula = inputElement.value;
    let references = findFormulaReferences(formula);
    
    // Mettre à jour le backdrop avec le texte coloré
    if (backdropElement) {
        backdropElement.innerHTML = createFormulaBackdropHtml(formula, references);
    }
    
    // Mettre en surbrillance les cellules référencées
    highlightReferencedCells(projectId, references);
}

// Utility function to position context menu intelligently
function positionContextMenu($menu, e) {
    $('body').append($menu);
    
    let menuHeight = $menu.outerHeight();
    let menuWidth = $menu.outerWidth();
    let windowHeight = $(window).height();
    let windowWidth = $(window).width();
    let scrollTop = $(window).scrollTop();
    let scrollLeft = $(window).scrollLeft();
    
    let top = e.pageY;
    let left = e.pageX;
    
    // If menu would go below viewport, show it above the click point
    if (e.pageY + menuHeight > scrollTop + windowHeight) {
        top = e.pageY - menuHeight;
        if (top < scrollTop) top = scrollTop;
    }
    
    // If menu would go beyond right edge, adjust left
    if (e.pageX + menuWidth > scrollLeft + windowWidth) {
        left = e.pageX - menuWidth;
        if (left < scrollLeft) left = scrollLeft;
    }
    
    $menu.css({
        position: 'absolute',
        left: left + 'px',
        top: top + 'px'
    });
}

// Settings storage
let appSettings = {
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
            shape: 'rounded', // Bords arrondis
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
    layout: {
        defaultRowHeight: 18,
        columnWidths: {
            num: 40, code: 60, designation: 180, n: 40, op: 40,
            l: 60, totall: 70, larg: 50, h: 50, ens: 50,
            valplus: 70, valmoins: 70, unit: 50, qtetotal: 70, pu: 60, totalht: 80
        },
        columnTitles: {
            num: '#', code: 'Code', designation: 'Désignation', n: 'N', op: 'Op',
            l: 'L', totall: 'Total L', larg: 'l', h: 'h', ens: 'Ens.',
            valplus: 'Val (+)', valmoins: 'Val (-)', unit: 'Unit', qtetotal: 'Qté T.', pu: 'PU', totalht: 'Total HT'
        }
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

// Theme presets
const themePresets = {
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

// Deep merge function
function deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = deepMerge(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

// Load settings from localStorage if available
function loadSettingsFromStorage() {
    let stored = localStorage.getItem('metreProSettings');
    if (stored) {
        try {
            let loadedSettings = JSON.parse(stored);
            // Deep merge to preserve default values
            appSettings = deepMerge(appSettings, loadedSettings);
            
            // Ensure critical arrays exist
            if (!appSettings.units.customUnits || !Array.isArray(appSettings.units.customUnits)) {
                appSettings.units.customUnits = ['Ml', 'M²', 'M³', 'M³f', 'Kg', 'U', 'Ens.', 'For.', 'Sac.'];
            }
            if (!appSettings.tags.tagUnits || !Array.isArray(appSettings.tags.tagUnits)) {
                appSettings.tags.tagUnits = [];
            }
            
            // Ensure layout structure exists
            if (!appSettings.layout) {
                appSettings.layout = {
                    defaultRowHeight: 18,
                    columnWidths: {},
                    columnTitles: {}
                };
            }
            if (!appSettings.layout.columnWidths) {
                appSettings.layout.columnWidths = {
                    num: 40, code: 60, designation: 180, n: 40, op: 40,
                    l: 60, totall: 70, larg: 50, h: 50, ens: 50,
                    valplus: 70, valmoins: 70, unit: 50, qtetotal: 70, pu: 60, totalht: 80
                };
            }
            if (!appSettings.layout.columnTitles) {
                appSettings.layout.columnTitles = {
                    num: '#', code: 'Code', designation: 'Désignation', n: 'N', op: 'Op',
                    l: 'L', totall: 'Total L', larg: 'l', h: 'h', ens: 'Ens.',
                    valplus: 'Val (+)', valmoins: 'Val (-)', unit: 'Unit', qtetotal: 'Qté T.', pu: 'PU', totalht: 'Total HT'
                };
            }
            
            console.log('[INFO] Settings loaded from localStorage');
        } catch (e) {
            console.error('[ERROR] Error loading settings:', e);
            console.log('[INFO] Si vous avez des problèmes, essayez: localStorage.removeItem("metreProSettings") puis rechargez la page');
            // Keep defaults on error
            console.log('[INFO] Using default settings');
        }
    } else {
        console.log('[INFO] No saved settings found, using defaults');
    }
}

// Save settings to localStorage
function saveSettingsToStorage() {
    localStorage.setItem('metreProSettings', JSON.stringify(appSettings));
}

// Initialize settings
loadSettingsFromStorage();

// ===== NOUVEAU PROJET =====
function newProject() {
    showNewProjectDialog();
}

function showNewProjectDialog() {
    let html = `
        <div class="dialog-title">Nouveau Projet</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Client :</label>
                <input type="text" id="inputClient" placeholder="Nom du client">
            </div>
            <div class="form-group">
                <label>Projet :</label>
                <input type="text" id="inputProjet" placeholder="Nom du projet">
            </div>
            <div class="form-group">
                <label>Lot :</label>
                <input type="text" id="inputLot" placeholder="Lot">
            </div>
            <div class="form-group">
                <label>Date de création :</label>
                <input type="date" id="inputDateCreation" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>Date de fin :</label>
                <input type="date" id="inputDateFin">
            </div>
            <div class="form-group">
                <label>Autre :</label>
                <input type="text" id="inputAutre" placeholder="Informations supplémentaires">
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="createNewProject()">Créer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    $('#inputClient').focus();
}

function createNewProject() {
    console.log('[DEBUG] createNewProject: START');
    console.log('[INFO] Si le projet ne s\'ouvre pas, veuillez vérifier ces messages de debug dans la console');
    
    let client = $('#inputClient').val().trim();
    let projet = $('#inputProjet').val().trim();
    let lot = $('#inputLot').val().trim();
    let dateCreation = $('#inputDateCreation').val();
    let dateFin = $('#inputDateFin').val();
    let autre = $('#inputAutre').val().trim();
    
    console.log('[DEBUG] createNewProject: Values -', {client, projet, lot});
    
    if (!client || !projet) {
        alert('Le client et le projet sont obligatoires');
        return;
    }
    
    closeDialog();
    console.log('[DEBUG] createNewProject: Dialog closed');
    
    let projectId = 'project_' + Date.now();
    console.log('[DEBUG] createNewProject: Project ID -', projectId);
    
    // Créer la structure du projet
    let project = {
        id: projectId,
        metadata: {
            client: client,
            projet: projet,
            lot: lot,
            dateCreation: dateCreation,
            dateFin: dateFin,
            autre: autre
        },
        treeData: [],
        variables: {},
        currentPoste: null,
        selectedTreeNode: null,
        copiedRow: null
    };
    
    console.log('[DEBUG] createNewProject: Project object created');
    
    // Initialiser le projet avec dossier + poste + ligne par défaut
    initializeProjectData(project);
    console.log('[DEBUG] createNewProject: Project data initialized');
    
    projects[projectId] = project;
    console.log('[DEBUG] createNewProject: Project added to projects object');
    console.log('[DEBUG] Total projects:', Object.keys(projects).length);
    
    // Build folder blocks after project is added to projects object
    if (project.currentPoste) {
        rebuildPosteBlocksFromTree(projectId, project.currentPoste.id);
    }
    
    // Créer l'onglet et l'espace de travail
    console.log('[DEBUG] createNewProject: Calling createProjectTab');
    createProjectTab(projectId);
    console.log('[DEBUG] createNewProject: Calling switchToProject');
    switchToProject(projectId);
    console.log('[DEBUG] createNewProject: Project switched');
    
    // Apply theme and settings after project is active
    setTimeout(() => {
        console.log('[DEBUG] createNewProject: Applying settings');
        applySettings();
        console.log('[DEBUG] createNewProject: COMPLETE');
        console.log('[SUCCESS] Projet créé avec succès. Si rien ne s\'affiche, consultez les messages ci-dessus pour identifier le problème.');
    }, 200);
}

// Create a value wrapper
function createValueField(value) {
    return {
        type: 'value',
        value: parseFloat(value) || 0
    };
}

// Create a variable field
function createVariableField(name, isDeclaration) {
    return {
        type: 'variable',
        name: name.trim().toUpperCase(),
        isDeclaration: isDeclaration
    };
}

// Create an empty row with new data structure
function createEmptyRow() {
    return {
        code: "",
        designation: "",
        n: createValueField(1),
        op: "fs",
        l: createValueField(0),
        larg: null,
        h: null,
        ens: null,
        unit: "",
        pu: createValueField(0),
        isDeduction: false,
        isSubtotalRow: false
    };
}

// Create initial table data with 10 empty rows
function createInitialTableData() {
    let rows = [];
    for (let i = 0; i < 10; i++) {
        rows.push(createEmptyRow());
    }
    return rows;
}

// Create a subtotal row
function createSubtotalRow() {
    return {
        code: "",
        designation: "",
        n: null,
        op: "",
        l: "ens.",  // Special marker for subtotal
        larg: null,
        h: null,
        ens: null,
        unit: "",
        pu: null,
        isDeduction: false,
        isSubtotalRow: true
    };
}

function initializeProjectData(project) {
    console.log('[DEBUG] initializeProjectData: Initializing with blocks structure');
    
    // Generate unique IDs
    let timestamp = Date.now();
    let clientFolderId = 'folder_client_' + timestamp;
    let projetFolderId = 'folder_projet_' + (timestamp + 1);
    let lotFolderId = 'folder_lot_' + (timestamp + 2);
    let posteId = 'poste_' + (timestamp + 3);
    let table1Id = 'block_table_1_' + (timestamp + 4);
    
    // Create default poste with hierarchical block structure
    let defaultPoste = {
        id: posteId,
        name: 'Minute avant métré 1',
        type: 'poste',
        collapsed: false,  // Par défaut déplié
        blocks: [
            // Folder blocks will be built dynamically based on tree position
            // File: Lot name
            {
                id: 'block_file_lot_' + (timestamp + 3),
                type: 'file',
                folderName: '',
                fileName: project.metadata.lot || 'Lot',
                data: []
            },
            // Table with initial empty rows
            {
                id: table1Id,
                type: 'table',
                folderName: '',
                fileName: '',
                data: createInitialTableData(),
                footer: {
                    ens: 'Ens.',
                    unit: '',
                    pu: 0
                }
            }
        ],
        data: [] // Keep for backward compatibility
    };
    
    // Create nested tree structure (carlo > maison > go > Minute de Métré)
    project.treeData = [
        {
            id: clientFolderId,
            name: project.metadata.client || 'Client',
            type: 'folder',
            collapsed: false,
            children: [
                {
                    id: projetFolderId,
                    name: project.metadata.projet || 'Projet', 
                    type: 'folder',
                    collapsed: false,
                    children: [
                        {
                            id: lotFolderId,
                            name: project.metadata.lot || 'Lot',
                            type: 'folder',
                            collapsed: false,
                            children: [
                                defaultPoste
                            ]
                        }
                    ]
                }
            ]
        }
    ];
    
    // Initialize tree collapse state (all expanded by default)
    project.treeCollapsed = {
        [clientFolderId]: false,
        [projetFolderId]: false,
        [lotFolderId]: false
    };
    
    // Set current poste
    project.currentPoste = defaultPoste;
    project.selectedTreeNode = posteId; // Select the poste
    project.selectedBlockId = table1Id; // Select the table
    
    console.log('[DEBUG] initializeProjectData: Default structure created');
}

function createProjectTab(projectId) {
    console.log('[DEBUG] createProjectTab: START -', projectId);
    let project = projects[projectId];
    let tabName = `${project.metadata.client} ${project.metadata.projet}`;
    if (tabName.length > 20) {
        tabName = tabName.substring(0, 17) + '...';
    }
    console.log('[DEBUG] createProjectTab: Tab name -', tabName);
    
    let $tab = $(`
        <div class="project-tab" data-project-id="${projectId}">
            <span>${tabName}</span>
            <span class="project-tab-close" onclick="closeProject('${projectId}', event)">✖</span>
        </div>
    `);
    
    $tab.on('click', function(e) {
        if (!$(e.target).hasClass('project-tab-close')) {
            switchToProject(projectId);
        }
    });
    
    // Context menu on tab
    $tab.on('contextmenu', function(e) {
        e.preventDefault();
        showProjectTabContextMenu(projectId, e);
        return false;
    });
    
    $('#projectTabs').append($tab);
    console.log('[DEBUG] createProjectTab: Tab appended');
    
    // Créer l'espace de travail
    let $workspace = $(`<div class="project-workspace" id="workspace-${projectId}"></div>`);
    $('#projects-container').append($workspace);
    console.log('[DEBUG] createProjectTab: Workspace appended');
    
    // Initialiser GoldenLayout pour ce projet
    console.log('[DEBUG] createProjectTab: Calling initializeProjectLayout');
    initializeProjectLayout(projectId);
    console.log('[DEBUG] createProjectTab: COMPLETE');
}

function showProjectTabContextMenu(projectId, e) {
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: 'ℹ️ Informations', action: () => showProjectInfo(projectId) },
        { separator: true },
        { label: '💾 Sauvegarder', action: () => saveFile() },
        { separator: true },
        { label: '✖ Fermer', action: () => closeProject(projectId, null) }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

function showProjectInfo(projectId) {
    let project = projects[projectId];
    
    let html = `
        <div class="dialog-title">Informations du Projet</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Client :</label>
                <input type="text" id="editClient" value="${project.metadata.client}">
            </div>
            <div class="form-group">
                <label>Projet :</label>
                <input type="text" id="editProjet" value="${project.metadata.projet}">
            </div>
            <div class="form-group">
                <label>Lot :</label>
                <input type="text" id="editLot" value="${project.metadata.lot || ''}">
            </div>
            <div class="form-group">
                <label>Date de création :</label>
                <input type="date" id="editDateCreation" value="${project.metadata.dateCreation || ''}">
            </div>
            <div class="form-group">
                <label>Date de fin :</label>
                <input type="date" id="editDateFin" value="${project.metadata.dateFin || ''}">
            </div>
            <div class="form-group">
                <label>Autre :</label>
                <input type="text" id="editAutre" value="${project.metadata.autre || ''}">
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="updateProjectInfo('${projectId}')">Enregistrer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
}

function updateProjectInfo(projectId) {
    let project = projects[projectId];
    
    project.metadata.client = $('#editClient').val().trim();
    project.metadata.projet = $('#editProjet').val().trim();
    project.metadata.lot = $('#editLot').val().trim();
    project.metadata.dateCreation = $('#editDateCreation').val();
    project.metadata.dateFin = $('#editDateFin').val();
    project.metadata.endDate = $('#editDateFin').val(); // Also save as endDate for compatibility
    project.metadata.autre = $('#editAutre').val().trim();
    
    // Mettre à jour le nom de l'onglet
    let tabName = `${project.metadata.client} ${project.metadata.projet}`;
    if (tabName.length > 20) {
        tabName = tabName.substring(0, 17) + '...';
    }
    $(`.project-tab[data-project-id="${projectId}"] span:first`).text(tabName);
    
    // Update days remaining counter
    if (typeof updateDaysRemaining === 'function') {
        updateDaysRemaining();
    }
    
    closeDialog();
}

function initializeProjectLayout(projectId) {
    console.log('[DEBUG] initializeProjectLayout: START -', projectId);
    let config = {
        settings: { showPopoutIcon: false, showCloseIcon: false },
        content: [{
            type: 'row',
            content: [
                { type: 'component', componentName: 'explorateur', componentState: { projectId: projectId }, title: 'Explorateur', width: 20 },
                { type: 'component', componentName: 'metre', componentState: { projectId: projectId }, title: 'Minute de Métré' },
                { type: 'component', componentName: 'variables', componentState: { projectId: projectId }, title: 'Variables L-S-V', width: 18 }
            ]
        }]
    };
    
    console.log('[DEBUG] initializeProjectLayout: Config created');
    
    try {
        let layout = new GoldenLayout(config, `#workspace-${projectId}`);
        console.log('[DEBUG] initializeProjectLayout: GoldenLayout instance created');
        
        // Enregistrer les composants
        registerComponents(layout);
        console.log('[DEBUG] initializeProjectLayout: Components registered');
        
        layout.init();
        console.log('[DEBUG] initializeProjectLayout: Layout initialized');
        
        projects[projectId].layout = layout;
        console.log('[DEBUG] initializeProjectLayout: Layout saved to project');
        
        // Ajouter les boutons de réduction aux headers des panneaux
        layout.on('stateChanged', function() {
            addCollapseButtons(projectId);
        });
        
        // Force update after initialization
        setTimeout(() => {
            console.log('[DEBUG] initializeProjectLayout: Rendering content');
            updateTreeContent(projectId);
            renderMetreTable(projectId);
            renderVariables(projectId);
            addCollapseButtons(projectId);
            console.log('[DEBUG] initializeProjectLayout: Content rendered');
        }, 100);
        
        // Handle resize avec debounce
        let resizeTimeout;
        $(window).on('resize.layout-' + projectId, () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (currentProjectId === projectId && layout) {
                    try {
                        layout.updateSize();
                    } catch (e) {
                        console.warn('Layout resize error:', e);
                    }
                }
            }, 100);
        });
        
        console.log('[DEBUG] initializeProjectLayout: COMPLETE');
    } catch (error) {
        console.error('[ERROR] initializeProjectLayout:', error);
        alert('Erreur lors de l\'initialisation du projet: ' + error.message);
    }
}

// Ajouter les boutons de réduction aux headers des panneaux
function addCollapseButtons(projectId) {
    $(`#workspace-${projectId} .lm_header`).each(function() {
        let $header = $(this);
        
        // Ne pas ajouter si déjà présent
        if ($header.find('.panel-collapse-btn').length > 0) return;
        
        let $stack = $header.closest('.lm_stack');
        
        // Déterminer la position du panneau (gauche, centre, droite)
        let $row = $stack.closest('.lm_row');
        let $stacks = $row.children('.lm_stack, .lm_item');
        let stackIndex = $stacks.index($stack);
        let totalStacks = $stacks.length;
        
        let position = 'center';
        if (stackIndex === 0) position = 'left';
        else if (stackIndex === totalStacks - 1) position = 'right';
        
        // Créer le bouton de réduction (punaise)
        let $collapseBtn = $(`<div class="panel-collapse-btn" title="Réduire/Agrandir" data-position="${position}">📌</div>`);
        
        $collapseBtn.on('click', function(e) {
            e.stopPropagation();
            togglePanelCollapse($(this), $stack, projectId, position);
        });
        
        $header.append($collapseBtn);
    });
}

// Réduire/Agrandir un panneau
function togglePanelCollapse($btn, $stack, projectId, position) {
    let isCollapsed = $stack.hasClass('panel-collapsed');
    
    if (isCollapsed) {
        // Agrandir
        $stack.removeClass('panel-collapsed panel-collapsed-left panel-collapsed-right');
        $stack.css('width', $stack.attr('data-original-width') || '');
        $stack.css('min-width', '');
        $stack.css('max-width', '');
        $btn.removeClass('rotated');
        $btn.attr('title', 'Réduire');
    } else {
        // Réduire - sauvegarder la largeur actuelle
        $stack.attr('data-original-width', $stack[0].style.width || $stack.width() + 'px');
        $stack.addClass('panel-collapsed');
        
        // Ajouter la classe de position
        if (position === 'left') {
            $stack.addClass('panel-collapsed-left');
        } else if (position === 'right') {
            $stack.addClass('panel-collapsed-right');
        } else {
            $stack.addClass('panel-collapsed-left'); // Par défaut à gauche
        }
        
        $stack.css('width', '28px');
        $stack.css('min-width', '28px');
        $stack.css('max-width', '28px');
        $btn.addClass('rotated');
        $btn.attr('title', 'Agrandir');
    }
    
    // Mettre à jour le layout
    let project = projects[projectId];
    if (project && project.layout) {
        setTimeout(() => project.layout.updateSize(), 50);
    }
}

function registerComponents(layout) {
    console.log('[DEBUG] registerComponents: START');
    // COMPOSANT : EXPLORATEUR
    layout.registerComponent('explorateur', function(container, componentState) {
        console.log('[DEBUG] registerComponents: Registering explorateur');
        let projectId = componentState.projectId;
        let project = projects[projectId];
        
        let treeHtml = `
            <div class="tree-container">
                <div class="tree-search">
                    <input type="text" class="treeSearchInput" placeholder="🔍 Rechercher...">
                </div>
                <div class="tree-toolbar">
                    <button class="tree-btn btnAddFolder" title="Ajouter dossier">📁➕</button>
                    <button class="tree-btn btnAddPoste" title="Ajouter fichier">📄➕</button>
                    <div class="separator"></div>
                    <button class="tree-btn btnMoveUp" title="Monter">⬆️</button>
                    <button class="tree-btn btnMoveDown" title="Descendre">⬇️</button>
                </div>
                <div class="tree-content treeContent"></div>
            </div>
        `;
        
        container.getElement().html(treeHtml);
        
        // Use the correct tree rendering function
        updateTreeContent(projectId);
        
        // Attach events for add buttons
        container.getElement().find('.btnAddFolder').on('click', () => {
            addFolder(projectId);
        });
        
        container.getElement().find('.btnAddPoste').on('click', () => {
            addPoste(projectId);
        });
        
        // Attach events for up/down buttons
        container.getElement().find('.btnMoveUp').on('click', () => {
            moveNodeUp(projectId);
        });
        
        container.getElement().find('.btnMoveDown').on('click', () => {
            moveNodeDown(projectId);
        });
        
        container.getElement().find('.treeSearchInput').on('input', function() {
            filterTree(projectId, $(this).val());
        });
    });
    
    // COMPOSANT : MINUTE
    layout.registerComponent('metre', function(container, componentState) {
        let projectId = componentState.projectId;
        let project = projects[projectId];
        
        // Store container reference for later title updates
        if (!project.metreContainer) {
            project.metreContainer = container;
        }
        
        // Set initial title
        if (project.currentPoste) {
            container.setTitle(project.currentPoste.name);
        }
        
        let metreHtml = `
            <div class="tree-container">
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #f9f9f9; border-bottom: 1px solid #ddd;">
                    <!-- Block management buttons -->
                    <button class="tree-btn btnAddFileBlock" title="Insérer zone Poste" style="padding: 4px 8px; font-size: 13px;">📝➕ Poste</button>
                    <button class="tree-btn btnAddTableBlock" title="Insérer zone Tableau" style="padding: 4px 8px; font-size: 13px;">📊➕</button>
                    <button class="tree-btn btnAddCanvasBlock" title="Insérer zone Canvas" style="padding: 4px 8px; font-size: 13px;">🎨➕</button>
                    <button class="tree-btn btnAddImageBlock" title="Insérer Image" style="padding: 4px 8px; font-size: 13px;">🖼️➕</button>
                    
                    <div style="width: 1px; height: 20px; background: #ddd; margin: 0 4px;"></div>
                    
                    <!-- Move up/down buttons -->
                    <button class="tree-btn btnMoveBlockUp" title="Monter le bloc" style="padding: 4px 8px; font-size: 13px;">⬆️</button>
                    <button class="tree-btn btnMoveBlockDown" title="Descendre le bloc" style="padding: 4px 8px; font-size: 13px;">⬇️</button>
                    
                    <!-- Barre de recherche à droite -->
                    <input type="text" class="metreSearchInput" placeholder="🔍 Rechercher dans le tableau..." style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 3px; font-size: 13px;">
                </div>
                <div class="zoom-area-${projectId}" style="flex:1; overflow:auto;"></div>
            </div>
        `;
        
        container.getElement().html(metreHtml);
        renderMetreTable(projectId);
        
        // Attach block management events
        container.getElement().find('.btnAddFileBlock').on('click', () => addBlock(projectId, 'file'));
        container.getElement().find('.btnAddTableBlock').on('click', () => addBlock(projectId, 'table'));
        container.getElement().find('.btnAddCanvasBlock').on('click', () => addBlock(projectId, 'canvas'));
        container.getElement().find('.btnAddImageBlock').on('click', () => addBlock(projectId, 'image'));
        
        // Attach move events
        container.getElement().find('.btnMoveBlockUp').on('click', () => {
            let project = projects[projectId];
            if (project.selectedBlockId) {
                let blockIndex = project.currentPoste.blocks.findIndex(b => b.id === project.selectedBlockId);
                if (blockIndex !== -1) {
                    moveBlockUp(projectId, blockIndex);
                }
            }
        });
        
        container.getElement().find('.btnMoveBlockDown').on('click', () => {
            let project = projects[projectId];
            if (project.selectedBlockId) {
                let blockIndex = project.currentPoste.blocks.findIndex(b => b.id === project.selectedBlockId);
                if (blockIndex !== -1) {
                    moveBlockDown(projectId, blockIndex);
                }
            }
        });
        
        container.getElement().find('.metreSearchInput').on('input', function() {
            filterMetreTable(projectId, $(this).val());
        });
    });
    
    // COMPOSANT : VARIABLES
    layout.registerComponent('variables', function(container, componentState) {
        let projectId = componentState.projectId;
        container.getElement().html(`<div class="tree-container variables-panel-${projectId}"></div>`);
        renderVariables(projectId);
    });
    
    // Register Viewer component
    layout.registerComponent('viewer', function(container, componentState) {
        let projectId = componentState.projectId;
        
        console.log('[Viewer] Initialisation pour projet:', projectId);
        
        container.getElement().html(`
            <div class="viewer-container" id="viewer-${projectId}" style="display: flex; flex-direction: column; height: 100%; background: #2c3e50;">
                <!-- Toolbar -->
                <div class="viewer-toolbar" style="background: #34495e; padding: 8px; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid #1a252f;">
                    <input type="file" id="viewer-file-input-${projectId}" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" style="display: none;">
                    <button id="viewer-open-btn-${projectId}" class="viewer-btn" title="Ouvrir un fichier">
                        📂 Ouvrir
                    </button>
                    <div class="separator" style="width: 1px; height: 24px; background: #4a5f7f;"></div>
                    
                    <!-- Tool Selection (PDF only) - à gauche -->
                    <div id="viewer-tools-${projectId}" style="display: none; gap: 4px; align-items: center;">
                        <button id="viewer-tool-pan-${projectId}" class="viewer-btn viewer-tool-active" title="Déplacer (Main)" style="font-size: 16px; padding: 4px 8px;">✋</button>
                        <button id="viewer-tool-select-${projectId}" class="viewer-btn" title="Sélectionner du texte (Souris)" style="font-size: 16px; padding: 4px 8px;">🖱️</button>
                        <div class="separator" style="width: 1px; height: 24px; background: #4a5f7f; margin: 0 4px;"></div>
                    </div>
                    
                    <!-- PDF Navigation (hidden by default) -->
                    <div id="viewer-pdf-nav-${projectId}" style="display: none; gap: 8px; align-items: center;">
                        <button id="viewer-first-page-${projectId}" class="viewer-btn" title="Première page">⏮</button>
                        <button id="viewer-prev-page-${projectId}" class="viewer-btn" title="Page précédente">◀</button>
                        <span id="viewer-page-display-${projectId}" style="color: #ecf0f1; font-size: 12px; min-width: 60px; text-align: center;">1/1</span>
                        <button id="viewer-next-page-${projectId}" class="viewer-btn" title="Page suivante">▶</button>
                        <button id="viewer-last-page-${projectId}" class="viewer-btn" title="Dernière page">⏭</button>
                        <div class="separator" style="width: 1px; height: 24px; background: #4a5f7f; margin: 0 4px;"></div>
                        <button id="viewer-continuous-toggle-${projectId}" class="viewer-btn" title="Mode continu">📄 Page par page</button>
                        <div class="separator" style="width: 1px; height: 24px; background: #4a5f7f; margin-left: 4px;"></div>
                    </div>
                    
                    <button id="viewer-zoom-in-${projectId}" class="viewer-btn" title="Zoom avant">🔍+</button>
                    <button id="viewer-zoom-out-${projectId}" class="viewer-btn" title="Zoom arrière">🔍−</button>
                    <button id="viewer-reset-zoom-${projectId}" class="viewer-btn" title="Taille réelle">100%</button>
                    <button id="viewer-fit-${projectId}" class="viewer-btn" title="Ajuster à la fenêtre">⛶</button>
                    <span id="viewer-zoom-display-${projectId}" style="color: #ecf0f1; font-size: 12px; min-width: 60px;">100%</span>
                    <div class="separator" style="width: 1px; height: 24px; background: #4a5f7f;"></div>
                    <button id="viewer-rotate-left-${projectId}" class="viewer-btn" title="Rotation -90°">↶</button>
                    <input type="range" id="viewer-rotation-slider-${projectId}" min="0" max="360" value="0" step="1" style="width: 100px; cursor: pointer;" title="Rotation libre">
                    <span id="viewer-rotation-display-${projectId}" style="color: #ecf0f1; font-size: 11px; min-width: 40px; text-align: center;">0°</span>
                    <button id="viewer-rotate-right-${projectId}" class="viewer-btn" title="Rotation +90°">↷</button>
                    <button id="viewer-reset-rotation-${projectId}" class="viewer-btn" title="Réinitialiser la rotation" style="font-size: 10px; padding: 4px 8px;">0°</button>
                    <div style="flex: 1;"></div>
                    <span id="viewer-filename-${projectId}" style="color: #bdc3c7; font-size: 12px;"></span>
                    <button id="viewer-close-btn-${projectId}" class="viewer-btn" title="Fermer le fichier">✕</button>
                </div>
                
                <!-- Content Area -->
                <div class="viewer-content" id="viewer-content-${projectId}" style="flex: 1; overflow: hidden; position: relative; background: #1a252f; display: flex; align-items: center; justify-content: center;">
                    <div class="viewer-placeholder" style="text-align: center; color: #7f8c8d;">
                        <div style="font-size: 48px; margin-bottom: 20px;">👁️</div>
                        <div style="font-size: 16px; margin-bottom: 10px;">Visionneuse de documents</div>
                        <div style="font-size: 12px; color: #95a5a6;">Cliquez sur "📂 Ouvrir" pour charger un PDF ou une image</div>
                        <div style="font-size: 11px; color: #95a5a6; margin-top: 10px;">Formats supportés : PDF, PNG, JPG, GIF, WEBP</div>
                    </div>
                    
                    <!-- Canvas for single page mode (hidden by default) -->
                    <div class="viewer-canvas-container" id="viewer-canvas-container-${projectId}" style="display: none; position: relative; cursor: grab;">
                        <canvas id="viewer-canvas-${projectId}" style="box-shadow: 0 0 20px rgba(0,0,0,0.5);"></canvas>
                        <!-- Text layer for selection -->
                        <div id="viewer-text-layer-${projectId}" class="viewer-text-layer" style="position: absolute; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; opacity: 0.2; line-height: 1.0; pointer-events: none;"></div>
                    </div>
                    
                    <!-- Container for continuous mode (hidden by default) -->
                    <div class="viewer-continuous-container" id="viewer-continuous-container-${projectId}" style="display: none; width: 100%; height: 100%; overflow-y: auto; overflow-x: auto; padding: 20px;">
                        <div id="viewer-continuous-pages-${projectId}" style="display: flex; flex-direction: column; align-items: center; gap: 20px;"></div>
                    </div>
                </div>
            </div>
        `);
        
        console.log('[Viewer] HTML inséré');
        
        // Initialize viewer state
        if (!window.viewerStates) {
            window.viewerStates = {};
        }
        
        window.viewerStates[projectId] = {
            currentFile: null,
            fileType: null,
            zoom: 1,
            rotation: 0,
            panX: 0,
            panY: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0,
            pdfDoc: null,
            currentPage: 1,
            totalPages: 1,
            continuousMode: false,
            textSelectMode: false
        };
        
        console.log('[Viewer] État initialisé');
        
        // Wait for DOM to be ready, then attach handlers
        setTimeout(function() {
            console.log('[Viewer] Attachment des gestionnaires...');
            
            // Setup button handlers
            let $openBtn = $(`#viewer-open-btn-${projectId}`);
            console.log('[Viewer] Bouton ouvrir trouvé:', $openBtn.length);
            
            $openBtn.off('click').on('click', function() {
                console.log('[Viewer] Bouton ouvrir cliqué!');
                $(`#viewer-file-input-${projectId}`).trigger('click');
            });
            
            // PDF Navigation
            $(`#viewer-first-page-${projectId}`).off('click').on('click', function() {
                viewerGoToPage(projectId, 1);
            });
            
            $(`#viewer-prev-page-${projectId}`).off('click').on('click', function() {
                viewerPreviousPage(projectId);
            });
            
            $(`#viewer-next-page-${projectId}`).off('click').on('click', function() {
                viewerNextPage(projectId);
            });
            
            $(`#viewer-last-page-${projectId}`).off('click').on('click', function() {
                let state = window.viewerStates[projectId];
                if (state.pdfDoc) {
                    viewerGoToPage(projectId, state.totalPages);
                }
            });
            
            // Continuous mode toggle
            $(`#viewer-continuous-toggle-${projectId}`).off('click').on('click', function() {
                toggleContinuousMode(projectId);
            });
            
            $(`#viewer-zoom-in-${projectId}`).off('click').on('click', function() {
                console.log('[Viewer] Zoom in');
                viewerZoomIn(projectId);
            });
            
            $(`#viewer-zoom-out-${projectId}`).off('click').on('click', function() {
                console.log('[Viewer] Zoom out');
                viewerZoomOut(projectId);
            });
            
            $(`#viewer-reset-zoom-${projectId}`).off('click').on('click', function() {
                viewerResetZoom(projectId);
            });
            
            $(`#viewer-fit-${projectId}`).off('click').on('click', function() {
                viewerFitToWindow(projectId);
            });
            
            $(`#viewer-rotate-left-${projectId}`).off('click').on('click', function() {
                viewerRotateLeft(projectId);
            });
            
            $(`#viewer-rotate-right-${projectId}`).off('click').on('click', function() {
                viewerRotateRight(projectId);
            });
            
            // Rotation slider
            $(`#viewer-rotation-slider-${projectId}`).off('input').on('input', function() {
                let rotation = parseInt($(this).val());
                viewerSetRotation(projectId, rotation);
            });
            
            // Reset rotation button
            $(`#viewer-reset-rotation-${projectId}`).off('click').on('click', function() {
                viewerSetRotation(projectId, 0);
                $(`#viewer-rotation-slider-${projectId}`).val(0);
            });
            
            $(`#viewer-close-btn-${projectId}`).off('click').on('click', function() {
                viewerClose(projectId);
            });
            
            // Tool selection buttons (pan / select)
            $(`#viewer-tool-pan-${projectId}`).off('click').on('click', function() {
                setViewerTool(projectId, 'pan');
            });
            $(`#viewer-tool-select-${projectId}`).off('click').on('click', function() {
                setViewerTool(projectId, 'select');
            });
            
            // Setup file input handler
            $(`#viewer-file-input-${projectId}`).off('change').on('change', function(e) {
                console.log('[Viewer] Fichier sélectionné:', e.target.files);
                if (e.target.files && e.target.files[0]) {
                    handleViewerFileLoad(projectId, e.target.files[0]);
                }
            });
            
            console.log('[Viewer] Gestionnaires attachés');
            
            // Setup mouse events for panning
            setupViewerPanning(projectId);
            
            // Setup mouse wheel for zoom
            setupViewerMouseWheel(projectId);
            
        }, 100);
    });
}

// Viewer functions
function handleViewerFileLoad(projectId, file) {
    if (!file) return;
    
    let state = window.viewerStates[projectId];
    let fileType = file.type;
    
    $(`#viewer-filename-${projectId}`).text(file.name);
    
    if (fileType === 'application/pdf') {
        // Load PDF
        loadPDFInViewer(projectId, file);
    } else if (fileType.startsWith('image/')) {
        // Load image
        loadImageInViewer(projectId, file);
    } else {
        alert('Format de fichier non supporté');
    }
}

function loadImageInViewer(projectId, file) {
    let state = window.viewerStates[projectId];
    state.fileType = 'image';
    state.zoom = 1;
    state.rotation = 0;
    state.panX = 0;
    state.panY = 0;
    
    let reader = new FileReader();
    reader.onload = function(e) {
        let img = new Image();
        img.onload = function() {
            state.currentFile = img;
            
            // Show canvas container, hide placeholder
            $(`#viewer-content-${projectId} .viewer-placeholder`).hide();
            $(`#viewer-canvas-container-${projectId}`).show();
            
            renderViewerContent(projectId);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function loadPDFInViewer(projectId, file) {
    let state = window.viewerStates[projectId];
    state.fileType = 'pdf';
    state.zoom = 1;
    state.rotation = 0;
    state.panX = 0;
    state.panY = 0;
    state.currentPage = 1;
    
    let reader = new FileReader();
    reader.onload = function(e) {
        let typedarray = new Uint8Array(e.target.result);
        
        // Load PDF with PDF.js
        if (typeof pdfjsLib === 'undefined') {
            alert('PDF.js non chargé. Impossible d\'afficher le PDF.');
            return;
        }
        
        pdfjsLib.getDocument(typedarray).promise.then(function(pdf) {
            state.pdfDoc = pdf;
            state.totalPages = pdf.numPages;
            state.currentPage = 1;
            state.textSelectMode = false;
            
            console.log('[Viewer] PDF chargé:', pdf.numPages, 'pages');
            
            // Show PDF navigation controls
            $(`#viewer-pdf-nav-${projectId}`).css('display', 'flex');
            
            // Show tool selection buttons
            $(`#viewer-tools-${projectId}`).css('display', 'flex');
            
            // Update page display
            updatePageDisplay(projectId);
            
            // Show canvas container, hide placeholder
            $(`#viewer-content-${projectId} .viewer-placeholder`).hide();
            $(`#viewer-canvas-container-${projectId}`).show();
            
            renderViewerContent(projectId);
        }).catch(function(error) {
            console.error('Erreur chargement PDF:', error);
            alert('Erreur lors du chargement du PDF');
        });
    };
    reader.readAsArrayBuffer(file);
}

function updatePageDisplay(projectId) {
    let state = window.viewerStates[projectId];
    if (state.fileType === 'pdf' && state.pdfDoc) {
        $(`#viewer-page-display-${projectId}`).text(`${state.currentPage}/${state.totalPages}`);
        
        // Enable/disable navigation buttons
        $(`#viewer-first-page-${projectId}`).prop('disabled', state.currentPage === 1);
        $(`#viewer-prev-page-${projectId}`).prop('disabled', state.currentPage === 1);
        $(`#viewer-next-page-${projectId}`).prop('disabled', state.currentPage === state.totalPages);
        $(`#viewer-last-page-${projectId}`).prop('disabled', state.currentPage === state.totalPages);
    }
}

function viewerGoToPage(projectId, pageNum) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc) return;
    
    if (pageNum < 1) pageNum = 1;
    if (pageNum > state.totalPages) pageNum = state.totalPages;
    
    state.currentPage = pageNum;
    state.panX = 0;
    state.panY = 0;
    
    updatePageDisplay(projectId);
    renderViewerContent(projectId);
}

function viewerNextPage(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc) return;
    
    if (state.currentPage < state.totalPages) {
        viewerGoToPage(projectId, state.currentPage + 1);
    }
}

function viewerPreviousPage(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc) return;
    
    if (state.currentPage > 1) {
        viewerGoToPage(projectId, state.currentPage - 1);
    }
}

function toggleContinuousMode(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc) return;
    
    state.continuousMode = !state.continuousMode;
    
    // Update button text
    let $btn = $(`#viewer-continuous-toggle-${projectId}`);
    if (state.continuousMode) {
        $btn.text('📑 Continu');
        $btn.css('background', '#27ae60');
        
        // Hide single page navigation buttons
        $(`#viewer-first-page-${projectId}`).hide();
        $(`#viewer-prev-page-${projectId}`).hide();
        $(`#viewer-next-page-${projectId}`).hide();
        $(`#viewer-last-page-${projectId}`).hide();
        
        // Show continuous mode
        $(`#viewer-canvas-container-${projectId}`).hide();
        $(`#viewer-continuous-container-${projectId}`).show();
        
        // Render all pages
        renderContinuousMode(projectId);
    } else {
        $btn.text('📄 Page par page');
        $btn.css('background', '');
        
        // Show single page navigation buttons
        $(`#viewer-first-page-${projectId}`).show();
        $(`#viewer-prev-page-${projectId}`).show();
        $(`#viewer-next-page-${projectId}`).show();
        $(`#viewer-last-page-${projectId}`).show();
        
        // Show single page mode
        $(`#viewer-continuous-container-${projectId}`).hide();
        $(`#viewer-canvas-container-${projectId}`).show();
        
        // Render current page
        renderViewerContent(projectId);
    }
}

function renderContinuousMode(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc) return;
    
    let $container = $(`#viewer-continuous-pages-${projectId}`);
    $container.empty();
    
    console.log('[Viewer] Rendu mode continu:', state.totalPages, 'pages');
    
    // Render all pages
    let renderPromises = [];
    
    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        let canvasId = `viewer-continuous-page-${projectId}-${pageNum}`;
        
        $container.append(`
            <div class="continuous-page-wrapper" style="margin-bottom: 20px;">
                <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 5px; text-align: center;">Page ${pageNum}/${state.totalPages}</div>
                <canvas id="${canvasId}" style="box-shadow: 0 0 20px rgba(0,0,0,0.5); display: block;"></canvas>
            </div>
        `);
        
        // Render this page
        renderPromises.push(renderPDFPageToCanvas(projectId, pageNum, canvasId));
    }
    
    Promise.all(renderPromises).then(() => {
        console.log('[Viewer] Toutes les pages rendues en mode continu');
    });
}

function renderPDFPageToCanvas(projectId, pageNum, canvasId) {
    let state = window.viewerStates[projectId];
    
    return state.pdfDoc.getPage(pageNum).then(function(page) {
        let canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        let ctx = canvas.getContext('2d');
        let viewport = page.getViewport({ scale: state.zoom });
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        let renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        return page.render(renderContext).promise;
    });
}

function renderViewerContent(projectId) {
    let state = window.viewerStates[projectId];
    let canvas = document.getElementById(`viewer-canvas-${projectId}`);
    let ctx = canvas.getContext('2d');
    
    if (state.fileType === 'image' && state.currentFile) {
        // Render image
        let img = state.currentFile;
        
        canvas.width = img.width * state.zoom;
        canvas.height = img.height * state.zoom;
        
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Apply rotation
        if (state.rotation !== 0) {
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(state.rotation * Math.PI / 180);
            ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        
        // Update position
        $(canvas).css({
            transform: `translate(${state.panX}px, ${state.panY}px)`
        });
        
    } else if (state.fileType === 'pdf' && state.pdfDoc) {
        // Render PDF page
        state.pdfDoc.getPage(state.currentPage).then(function(page) {
            let viewport = page.getViewport({ scale: state.zoom });
            
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            let renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            
            page.render(renderContext).promise.then(function() {
                // Update position
                $(canvas).css({
                    transform: `translate(${state.panX}px, ${state.panY}px) rotate(${state.rotation}deg)`
                });
                
                // Update text layer position and size
                let $textLayer = $(`#viewer-text-layer-${projectId}`);
                $textLayer.css({
                    width: viewport.width + 'px',
                    height: viewport.height + 'px',
                    transform: `translate(${state.panX}px, ${state.panY}px) rotate(${state.rotation}deg)`
                });
                
                // Re-render text layer if in text select mode
                if (state.textSelectMode) {
                    renderTextLayer(projectId);
                }
            });
        });
    }
    
    // Update zoom display
    $(`#viewer-zoom-display-${projectId}`).text(Math.round(state.zoom * 100) + '%');
}

function setupViewerPanning(projectId) {
    let state = window.viewerStates[projectId];
    let $canvas = $(`#viewer-canvas-${projectId}`);
    
    $canvas.on('mousedown', function(e) {
        // Don't start panning if text select mode is active
        if (state.textSelectMode) return;
        
        state.isDragging = true;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        $(this).css('cursor', 'grabbing');
    });
    
    $(document).on('mousemove', function(e) {
        if (!state.isDragging) return;
        
        let deltaX = e.clientX - state.lastX;
        let deltaY = e.clientY - state.lastY;
        
        state.panX += deltaX;
        state.panY += deltaY;
        
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        
        $canvas.css({
            transform: `translate(${state.panX}px, ${state.panY}px) rotate(${state.rotation}deg)`
        });
        
        // Also move text layer
        $(`#viewer-text-layer-${projectId}`).css({
            transform: `translate(${state.panX}px, ${state.panY}px) rotate(${state.rotation}deg)`
        });
    });
    
    $(document).on('mouseup', function() {
        if (state.isDragging) {
            state.isDragging = false;
            if (!state.textSelectMode) {
                $canvas.css('cursor', 'grab');
            }
        }
    });
}

function setupViewerMouseWheel(projectId) {
    let state = window.viewerStates[projectId];
    let $container = $(`#viewer-content-${projectId}`);
    
    $container.on('wheel', function(e) {
        if (!state.currentFile && !state.pdfDoc) return;
        
        // Ctrl + molette = zoom
        if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
            e.preventDefault();
            
            if (e.originalEvent.deltaY < 0) {
                // Scroll up = zoom in
                viewerZoomIn(projectId);
            } else {
                // Scroll down = zoom out
                viewerZoomOut(projectId);
            }
        }
        // Molette seule en mode page par page = scroll manuel (pas de preventDefault)
        // Le navigateur gère le scroll naturellement
        // En mode continu, le scroll est géré par le container avec overflow-y: auto
    });
}

function viewerZoomIn(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.zoom = Math.min(state.zoom * 1.2, 10);
    
    if (state.continuousMode && state.pdfDoc) {
        renderContinuousMode(projectId);
    } else {
        renderViewerContent(projectId);
    }
}

function viewerZoomOut(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.zoom = Math.max(state.zoom / 1.2, 0.1);
    
    if (state.continuousMode && state.pdfDoc) {
        renderContinuousMode(projectId);
    } else {
        renderViewerContent(projectId);
    }
}

function viewerResetZoom(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    renderViewerContent(projectId);
}

function viewerFitToWindow(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    let $container = $(`#viewer-content-${projectId}`);
    let containerWidth = $container.width();
    let containerHeight = $container.height();
    
    let contentWidth, contentHeight;
    
    if (state.fileType === 'image') {
        contentWidth = state.currentFile.width;
        contentHeight = state.currentFile.height;
    } else if (state.fileType === 'pdf' && state.pdfDoc) {
        // Use current canvas dimensions as estimate
        let canvas = document.getElementById(`viewer-canvas-${projectId}`);
        contentWidth = canvas.width / state.zoom;
        contentHeight = canvas.height / state.zoom;
    }
    
    let scaleX = containerWidth / contentWidth;
    let scaleY = containerHeight / contentHeight;
    
    state.zoom = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some margin
    state.panX = 0;
    state.panY = 0;
    
    renderViewerContent(projectId);
}

function viewerRotateLeft(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.rotation = (state.rotation - 90) % 360;
    if (state.rotation < 0) state.rotation += 360;
    
    // Update slider
    $(`#viewer-rotation-slider-${projectId}`).val(state.rotation);
    $(`#viewer-rotation-display-${projectId}`).text(state.rotation + '°');
    
    if (state.continuousMode && state.pdfDoc) {
        renderContinuousMode(projectId);
    } else {
        renderViewerContent(projectId);
    }
}

function viewerRotateRight(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.rotation = (state.rotation + 90) % 360;
    
    // Update slider
    $(`#viewer-rotation-slider-${projectId}`).val(state.rotation);
    $(`#viewer-rotation-display-${projectId}`).text(state.rotation + '°');
    
    if (state.continuousMode && state.pdfDoc) {
        renderContinuousMode(projectId);
    } else {
        renderViewerContent(projectId);
    }
}

function viewerSetRotation(projectId, rotation) {
    let state = window.viewerStates[projectId];
    if (!state.currentFile && !state.pdfDoc) return;
    
    state.rotation = rotation % 360;
    if (state.rotation < 0) state.rotation += 360;
    
    // Update display
    $(`#viewer-rotation-display-${projectId}`).text(state.rotation + '°');
    
    if (state.continuousMode && state.pdfDoc) {
        renderContinuousMode(projectId);
    } else {
        renderViewerContent(projectId);
    }
}

function viewerClose(projectId) {
    let state = window.viewerStates[projectId];
    
    state.currentFile = null;
    state.pdfDoc = null;
    state.fileType = null;
    state.zoom = 1;
    state.rotation = 0;
    state.panX = 0;
    state.panY = 0;
    state.currentPage = 1;
    state.totalPages = 1;
    state.continuousMode = false;
    state.textSelectMode = false;
    
    $(`#viewer-canvas-container-${projectId}`).hide();
    $(`#viewer-continuous-container-${projectId}`).hide();
    $(`#viewer-content-${projectId} .viewer-placeholder`).show();
    $(`#viewer-filename-${projectId}`).text('');
    $(`#viewer-file-input-${projectId}`).val('');
    
    // Hide PDF navigation
    $(`#viewer-pdf-nav-${projectId}`).hide();
    
    // Hide tool buttons and reset
    $(`#viewer-tools-${projectId}`).hide();
    $(`#viewer-tool-pan-${projectId}`).addClass('viewer-tool-active');
    $(`#viewer-tool-select-${projectId}`).removeClass('viewer-tool-active');
    
    // Clear text layer
    $(`#viewer-text-layer-${projectId}`).empty();
    
    // Reset rotation slider
    $(`#viewer-rotation-slider-${projectId}`).val(0);
    $(`#viewer-rotation-display-${projectId}`).text('0°');
    
    // Reset continuous mode button
    $(`#viewer-continuous-toggle-${projectId}`).text('📄 Page par page').css('background', '');
}

// Set viewer tool (pan or select)
function setViewerTool(projectId, tool) {
    let state = window.viewerStates[projectId];
    let $container = $(`#viewer-canvas-container-${projectId}`);
    let $textLayer = $(`#viewer-text-layer-${projectId}`);
    let $btnPan = $(`#viewer-tool-pan-${projectId}`);
    let $btnSelect = $(`#viewer-tool-select-${projectId}`);
    
    if (tool === 'select') {
        state.textSelectMode = true;
        $btnPan.removeClass('viewer-tool-active');
        $btnSelect.addClass('viewer-tool-active');
        $container.css('cursor', 'text');
        $textLayer.css({
            'pointer-events': 'auto',
            'opacity': '0.01'
        });
        
        // Render text layer
        renderTextLayer(projectId);
    } else {
        // pan mode
        state.textSelectMode = false;
        $btnPan.addClass('viewer-tool-active');
        $btnSelect.removeClass('viewer-tool-active');
        $container.css('cursor', 'grab');
        $textLayer.css({
            'pointer-events': 'none',
            'opacity': '0'
        }).empty();
    }
}

// Render text layer for selection
function renderTextLayer(projectId) {
    let state = window.viewerStates[projectId];
    if (!state.pdfDoc || state.fileType !== 'pdf') return;
    
    let $textLayer = $(`#viewer-text-layer-${projectId}`);
    $textLayer.empty();
    
    state.pdfDoc.getPage(state.currentPage).then(function(page) {
        let viewport = page.getViewport({ scale: state.zoom });
        
        // Set text layer size to match canvas
        $textLayer.css({
            width: viewport.width + 'px',
            height: viewport.height + 'px'
        });
        
        // Get text content
        page.getTextContent().then(function(textContent) {
            // Render each text item
            textContent.items.forEach(function(item) {
                let tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                
                let fontSize = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                let fontHeight = fontSize;
                
                let $span = $('<span></span>');
                $span.text(item.str);
                $span.css({
                    'position': 'absolute',
                    'left': tx[4] + 'px',
                    'top': (viewport.height - tx[5] - fontHeight) + 'px',
                    'font-size': fontSize + 'px',
                    'font-family': 'sans-serif',
                    'transform-origin': '0% 0%',
                    'white-space': 'pre',
                    'color': 'transparent',
                    'user-select': 'text',
                    '-webkit-user-select': 'text',
                    '-moz-user-select': 'text',
                    '-ms-user-select': 'text'
                });
                
                // Handle text direction
                if (item.dir === 'rtl') {
                    $span.css('direction', 'rtl');
                }
                
                $textLayer.append($span);
            });
            
            console.log('[Viewer] Text layer rendered with', textContent.items.length, 'items');
        });
    });
}

function switchToProject(projectId) {
    console.log('[DEBUG] switchToProject: START -', projectId);
    
    // Désactiver tous les onglets et workspaces
    $('.project-tab').removeClass('active');
    $('.project-workspace').removeClass('active');
    console.log('[DEBUG] switchToProject: Cleared active states');
    
    // Activer l'onglet et workspace sélectionné
    $(`.project-tab[data-project-id="${projectId}"]`).addClass('active');
    $(`#workspace-${projectId}`).addClass('active');
    console.log('[DEBUG] switchToProject: Set active states');
    
    currentProjectId = projectId;
    console.log('[DEBUG] switchToProject: Current project ID set to', currentProjectId);
    
    // Cacher l'état vide
    $('#emptyState').hide();
    console.log('[DEBUG] switchToProject: Empty state hidden');
    
    // Update layout size
    if (projects[projectId].layout) {
        console.log('[DEBUG] switchToProject: Updating layout size');
        projects[projectId].layout.updateSize();
    } else {
        console.log('[WARNING] switchToProject: No layout found for project');
    }
    
    // Update days remaining counter
    if (typeof updateDaysRemaining === 'function') {
        updateDaysRemaining();
    }
    
    console.log('[DEBUG] switchToProject: COMPLETE');
}

function closeProject(projectId, event) {
    if (event) {
        event.stopPropagation();
    }
    
    if (confirm('Voulez-vous fermer ce projet ? Les modifications non sauvegardées seront perdues.')) {
        // Détruire le layout
        if (projects[projectId].layout) {
            projects[projectId].layout.destroy();
        }
        
        // Supprimer l'onglet et le workspace
        $(`.project-tab[data-project-id="${projectId}"]`).remove();
        $(`#workspace-${projectId}`).remove();
        
        // Supprimer le projet
        delete projects[projectId];
        
        // Si c'était le projet actif, basculer vers un autre ou afficher l'état vide
        if (currentProjectId === projectId) {
            let remainingProjects = Object.keys(projects);
            if (remainingProjects.length > 0) {
                switchToProject(remainingProjects[0]);
            } else {
                currentProjectId = null;
                $('#emptyState').show();
            }
        }
    }
}

function closeDialog() {
    $('#dialogOverlay').hide();
}

// ===== TREE FUNCTIONS =====

// Render tree from blocks structure
function renderTreeFromBlocks(projectId) {
    let project = projects[projectId];
    if (!project || !project.currentPoste || !project.currentPoste.blocks) return;
    
    let blocks = project.currentPoste.blocks;
    let html = '<div class="tree-root">';
    
    // Build hierarchical structure
    let currentFolder = null;
    let currentFile = null;
    
    blocks.forEach((block, index) => {
        let blockId = block.id;
        let isCollapsed = project.treeCollapsed && project.treeCollapsed[blockId];
        let isSelected = project.selectedBlockId === blockId;
        
        if (block.type === 'folder') {
            // Close previous file if open
            if (currentFile !== null) {
                html += '</div>'; // close file children
                html += '</div>'; // close file node
                currentFile = null;
            }
            
            // Close previous folder if open
            if (currentFolder !== null) {
                html += '</div>'; // close folder children
                html += '</div>'; // close folder node
            }
            
            // Start new folder
            html += `<div class="tree-node${isSelected ? ' selected' : ''}" data-node-id="${blockId}" data-node-type="folder" data-block-index="${index}">`;
            html += `<span class="tree-toggle" data-node-id="${blockId}">${isCollapsed ? '▶' : '▼'}</span>`;
            html += `<span class="tree-icon">📁</span>`;
            html += `<span class="tree-label">${block.folderName || 'Dossier'}</span>`;
            html += `</div>`;
            html += `<div class="tree-children" style="display: ${isCollapsed ? 'none' : 'block'};">`;
            
            currentFolder = blockId;
        }
        else if (block.type === 'file') {
            // Close previous file if open
            if (currentFile !== null) {
                html += '</div>'; // close file children
                html += '</div>'; // close file node
            }
            
            // Start new file
            html += `<div class="tree-node${isSelected ? ' selected' : ''}" data-node-id="${blockId}" data-node-type="file" data-block-index="${index}">`;
            html += `<span class="tree-toggle" data-node-id="${blockId}">${isCollapsed ? '▶' : '▼'}</span>`;
            html += `<span class="tree-icon">📝</span>`;
            html += `<span class="tree-label">${block.fileName || 'Fichier'}</span>`;
            html += `</div>`;
            html += `<div class="tree-children" style="display: ${isCollapsed ? 'none' : 'block'};">`;
            
            currentFile = blockId;
        }
        else if (block.type === 'table') {
            // Add table as child
            html += `<div class="tree-node${isSelected ? ' selected' : ''}" data-node-id="${blockId}" data-node-type="table" data-block-index="${index}">`;
            html += `<span class="tree-icon">📊</span>`;
            html += `<span class="tree-label">Tableau ${index + 1}</span>`;
            html += `</div>`;
        }
    });
    
    // Close any open file
    if (currentFile !== null) {
        html += '</div>'; // close file children
        html += '</div>'; // close file node
    }
    
    // Close any open folder
    if (currentFolder !== null) {
        html += '</div>'; // close folder children
        html += '</div>'; // close folder node
    }
    
    html += '</div>'; // close tree-root
    
    $(`#workspace-${projectId} .treeContent`).html(html);
}

// Toggle tree node collapse state
function toggleTreeNode(projectId, nodeId) {
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    
    if (node && (node.type === 'folder' || node.type === 'poste')) {
        node.collapsed = !node.collapsed;
        updateTreeContent(projectId);
    }
}

// Toggle block collapse state in tree
function toggleBlockInTree(projectId, nodeId, blockId) {
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    
    if (node && node.blocks) {
        let block = node.blocks.find(b => b.id === blockId);
        if (block) {
            block.collapsed = !block.collapsed;
            updateTreeContent(projectId);
        }
    }
}

// Start renaming a tree node (folder or poste)
function startRenamingTreeNode(projectId, nodeId, labelElement) {
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    
    if (!node) return;
    
    let $label = $(labelElement);
    let currentName = node.name;
    
    // Create input element
    let $input = $('<input type="text" class="tree-rename-input" />')
        .val(currentName)
        .css({
            'width': '150px',
            'font-size': '12px',
            'border': '1px solid #3498db',
            'padding': '1px 4px',
            'outline': 'none',
            'background': 'white'
        });
    
    // Replace label with input
    $label.html('').append($input);
    $input.focus().select();
    
    // Handle blur (save changes)
    $input.on('blur', function() {
        let newName = $(this).val().trim();
        if (newName === '') {
            newName = node.type === 'folder' ? 'Nouveau dossier' : 'Sans titre';
        }
        
        // Update node name
        node.name = newName;
        
        // Update current poste if this is the selected poste
        if (node.type === 'poste' && project.currentPoste && project.currentPoste.id === nodeId) {
            // The poste name in tree is different from the block fileName
            // So we don't update the blocks here
        }
        
        // Re-render tree
        updateTreeContent(projectId);
        saveToLocalStorage();
    });
    
    // Handle Enter key
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            $(this).blur();
        } else if (e.key === 'Escape') {
            // Cancel editing
            updateTreeContent(projectId);
        }
    });
    
    // Prevent event propagation
    $input.on('click', function(e) {
        e.stopPropagation();
    });
}

// Select tree node from blocks
function selectTreeNodeFromBlocks(projectId, blockId, nodeType) {
    let project = projects[projectId];
    if (!project || !project.currentPoste) return;
    
    project.selectedBlockId = blockId;
    
    // If table is selected, scroll to it in the minute view
    if (nodeType === 'table') {
        updateTreeContent(projectId);
        
        // Scroll to the block in the minute view
        setTimeout(() => {
            let $block = $(`#workspace-${projectId} .metre-table [data-block-id="${blockId}"]`).first();
            if ($block.length) {
                $block[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Highlight briefly
                $block.css('background', '#ffffcc');
                setTimeout(() => {
                    $block.css('background', '');
                }, 1000);
            }
        }, 100);
    } else {
        updateTreeContent(projectId);
    }
}

function updateTreeContent(projectId) {
    let project = projects[projectId];
    if (!project) return;
    
    // Get folder title if a folder is selected
    let folderTitleHtml = '';
    if (project.selectedTreeNode) {
        let selectedNode = findNodeById(project.treeData, project.selectedTreeNode);
        if (selectedNode && selectedNode.type === 'folder') {
            let folderPath = getFolderFullPath(projectId, selectedNode.id);
            folderTitleHtml = `
                <div class="folder-title-header" style="padding: 4px 10px; background: #f0f8ff; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; margin-bottom: 2px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: #666; font-weight: 500;">DOSSIER:</span>
                        <span class="folder-title-display" data-project-id="${projectId}" style="font-size: 12px; font-weight: bold; color: #2c3e50; cursor: pointer; padding: 2px 5px; border-radius: 3px; flex: 1;" title="Double-clic pour renommer">${folderPath}</span>
                        <button class="tree-btn" onclick="renameCurrentFolderFromHeader('${projectId}')" title="Renommer" style="font-size: 10px; padding: 1px 4px;">✏️</button>
                    </div>
                </div>
            `;
        }
    }
    
    let html = folderTitleHtml;
    
    if (project.treeData.length === 0) {
        html += '<div style="padding:20px; text-align:center; color:#999; font-size:11px;">Aucun dossier.<br>Cliquez sur 📁➕ pour commencer.</div>';
    } else {
        html += renderTreeNodes(project.treeData, projectId);
    }
    
    $(`#workspace-${projectId} .treeContent`).html(html);
    
    // Attach events to folder title
    $(`#workspace-${projectId} .folder-title-display`).on('dblclick', function() {
        renameCurrentFolderFromHeader(projectId);
    });
    
    $(`#workspace-${projectId} .folder-title-display`).on('contextmenu', function(e) {
        e.preventDefault();
        showFolderTitleContextMenu(projectId, e);
        return false;
    });
    
    // Attach events to tree nodes
    $(`#workspace-${projectId} .tree-node`).on('click', function(e) {
        if ($(e.target).hasClass('tree-toggle') || $(e.target).hasClass('tree-rename-input')) {
            return;
        }
        let nodeId = $(this).data('node-id');
        selectTreeNode(projectId, nodeId);
    });
    
    // Double-click on tree node label to rename
    $(`#workspace-${projectId} .tree-node-editable`).on('dblclick', function(e) {
        e.stopPropagation();
        let nodeId = $(this).data('node-id');
        startRenamingTreeNode(projectId, nodeId, this);
    });
    
    // Attach events to toggle buttons
    $(`#workspace-${projectId} .tree-toggle`).on('click', function(e) {
        e.stopPropagation();
        let nodeId = $(this).data('node-id');
        let blockId = $(this).data('block-id');
        
        // Check if this is a block toggle or node toggle
        if (blockId) {
            toggleBlockInTree(projectId, nodeId, blockId);
        } else {
            toggleTreeNode(projectId, nodeId);
        }
    });
    
    // Attach context menu to tree nodes
    $(`#workspace-${projectId} .tree-node`).on('contextmenu', function(e) {
        e.preventDefault();
        let nodeId = $(this).data('node-id');
        showTreeContextMenu(projectId, e, nodeId);
        return false;
    });
    
    // Attach click event to tree blocks
    $(`#workspace-${projectId} .tree-block`).on('click', function(e) {
        e.stopPropagation();
        let blockId = $(this).data('block-id');
        let nodeId = $(this).data('node-id');
        
        // Select the parent poste first
        selectTreeNode(projectId, nodeId);
        
        // Then scroll to and highlight the block
        setTimeout(() => {
            // Try to find block-row first (for file, canvas, image blocks)
            let $blockRow = $(`#workspace-${projectId} .block-row[data-block-id="${blockId}"]`);
            
            // If not found, try to find any tr with this block-id (for table rows)
            if (!$blockRow.length) {
                $blockRow = $(`#workspace-${projectId} tr[data-block-id="${blockId}"]`).first();
            }
            
            if ($blockRow.length) {
                $blockRow[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Highlight briefly
                $blockRow.addClass('block-selected');
                setTimeout(() => {
                    $blockRow.removeClass('block-selected');
                }, 2000);
            }
        }, 100);
    });
}

function renderTreeNodes(nodes, projectId, level = 0) {
    if (!nodes || nodes.length === 0) return '';
    
    let project = projects[projectId];
    let html = '';
    
    nodes.forEach((node) => {
        let isFolder = node.type === 'folder';
        let isPoste = node.type === 'poste';
        
        // Initialize collapsed property if it doesn't exist
        if (node.collapsed === undefined) {
            node.collapsed = false;
        }
        
        // Check if poste has blocks
        let hasBlocks = false;
        let blocks = [];
        if (isPoste && node.blocks && node.blocks.length > 0) {
            // Filter out folder blocks and get only meaningful blocks
            blocks = node.blocks.filter(b => b.type !== 'folder');
            hasBlocks = blocks.length > 0;
        }
        
        let hasChildren = (isFolder && node.children && node.children.length > 0) || hasBlocks;
        let toggle = hasChildren ? `<span class="tree-toggle" data-node-id="${node.id}">${node.collapsed ? '▶' : '▼'}</span>` : '<span style="width:12px; display:inline-block;"></span>';
        let icon = isFolder ? '📁' : '📄';
        let className = `tree-node ${isFolder ? 'folder' : 'poste'} ${project.selectedTreeNode === node.id ? 'selected' : ''}`;
        
        html += `
            <div class="${className}" data-node-id="${node.id}" data-node-type="${node.type}" style="padding-left: ${level * 20 + 5}px;">
                ${toggle}
                ${icon}
                <span class="tree-node-label tree-node-editable" data-node-id="${node.id}">${node.name}</span>
            </div>
        `;
        
        // Render folder children
        if (isFolder && node.children && node.children.length > 0 && !node.collapsed) {
            html += renderTreeNodes(node.children, projectId, level + 1);
        }
        
        // Render poste blocks as children
        if (isPoste && hasBlocks && !node.collapsed) {
            // Get all file blocks and other blocks
            let fileBlocks = blocks.filter(b => b.type === 'file');
            let otherBlocks = blocks.filter(b => b.type !== 'file');
            
            // Render each file block with its associated other blocks
            if (fileBlocks.length > 0) {
                fileBlocks.forEach((fileBlock, fileIndex) => {
                    // Initialize collapsed state for file block if not exists
                    if (fileBlock.collapsed === undefined) {
                        fileBlock.collapsed = false;
                    }
                    
                    // Determine which other blocks belong to this file block
                    // Other blocks between this file and the next file (or end)
                    let nextFileIndex = fileIndex + 1;
                    let fileBlockIndex = blocks.indexOf(fileBlock);
                    let nextFileBlockIndex = nextFileIndex < fileBlocks.length ? 
                        blocks.indexOf(fileBlocks[nextFileIndex]) : blocks.length;
                    
                    // Get other blocks that come after this file block but before the next file block
                    let associatedBlocks = [];
                    for (let i = fileBlockIndex + 1; i < nextFileBlockIndex; i++) {
                        if (blocks[i].type !== 'file') {
                            associatedBlocks.push(blocks[i]);
                        }
                    }
                    
                    let hasAssociatedBlocks = associatedBlocks.length > 0;
                    let fileToggle = hasAssociatedBlocks ? 
                        `<span class="tree-toggle tree-block-toggle" data-node-id="${node.id}" data-block-id="${fileBlock.id}">${fileBlock.collapsed ? '▶' : '▼'}</span>` : 
                        '<span style="width:12px; display:inline-block;"></span>';
                    
                    // Build display name: Code + Désignation
                    let displayName = '';
                    if (fileBlock.fileCode && fileBlock.fileName) {
                        displayName = fileBlock.fileCode + ' ' + fileBlock.fileName;
                    } else if (fileBlock.fileCode) {
                        displayName = fileBlock.fileCode;
                    } else if (fileBlock.fileName) {
                        displayName = fileBlock.fileName;
                    } else {
                        displayName = 'Poste sans titre';
                    }
                    
                    html += `
                        <div class="tree-node tree-block" data-block-id="${fileBlock.id}" data-node-id="${node.id}" style="padding-left: ${(level + 1) * 20 + 5}px; opacity: 0.8; font-size: 11px;">
                            ${fileToggle}
                            📝
                            <span class="tree-node-label">${displayName}</span>
                        </div>
                    `;
                    
                    // Render associated blocks only if file block is not collapsed
                    if (!fileBlock.collapsed) {
                        associatedBlocks.forEach(block => {
                            let blockIcon = '';
                            let blockLabel = '';
                            
                            if (block.type === 'table') {
                                blockIcon = '📊';
                                blockLabel = 'Tableau';
                            } else if (block.type === 'canvas') {
                                blockIcon = '🎨';
                                blockLabel = block.canvasData?.title || 'Canvas';
                            } else if (block.type === 'image') {
                                blockIcon = '📷';
                                blockLabel = block.imageData?.blockName || 'Images';
                            }
                            
                            html += `
                                <div class="tree-node tree-block" data-block-id="${block.id}" data-node-id="${node.id}" style="padding-left: ${(level + 2) * 20 + 5}px; opacity: 0.8; font-size: 11px;">
                                    <span style="width:12px; display:inline-block;"></span>
                                    ${blockIcon}
                                    <span class="tree-node-label">${blockLabel}</span>
                                </div>
                            `;
                        });
                    }
                });
            } else {
                // If no file block, render all blocks normally (backward compatibility)
                blocks.forEach(block => {
                    let blockIcon = '';
                    let blockLabel = '';
                    let indentLevel = level + 1;
                    
                    if (block.type === 'table') {
                        blockIcon = '📊';
                        blockLabel = 'Tableau';
                        indentLevel = level + 2;
                    } else if (block.type === 'canvas') {
                        blockIcon = '🎨';
                        blockLabel = block.canvasData?.title || 'Canvas';
                        indentLevel = level + 2;
                    } else if (block.type === 'image') {
                        blockIcon = '📷';
                        blockLabel = block.imageData?.blockName || 'Images';
                        indentLevel = level + 2;
                    }
                    
                    html += `
                        <div class="tree-node tree-block" data-block-id="${block.id}" data-node-id="${node.id}" style="padding-left: ${indentLevel * 20 + 5}px; opacity: 0.8; font-size: 11px;">
                            <span style="width:12px; display:inline-block;"></span>
                            ${blockIcon}
                            <span class="tree-node-label">${blockLabel}</span>
                        </div>
                    `;
                });
            }
        }
    });
    
    return html;
}

function findNodeById(nodes, id) {
    for (let node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            let found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function findParentNode(nodes, childId, parent = null) {
    for (let node of nodes) {
        if (node.id === childId) return parent;
        if (node.children) {
            let found = findParentNode(node.children, childId, node);
            if (found !== null) return found;
        }
    }
    return null;
}

function selectTreeNode(projectId, nodeId) {
    let project = projects[projectId];
    project.selectedTreeNode = nodeId;
    let node = findNodeById(project.treeData, nodeId);
    
    // Sauvegarder les données du poste actuel
    if (project.currentPoste && project.currentPoste.id !== nodeId) {
        project.currentPoste.data = getCurrentMetreData(projectId);
    }
    
    if (node && node.type === 'poste') {
        project.currentPoste = node;
        
        // Rebuild folder blocks based on current tree position
        rebuildPosteBlocksFromTree(projectId, nodeId);
        
        renderMetreTable(projectId);
        updateMetreTitle(projectId);
    } else {
        // No poste selected
        project.currentPoste = null;
        updateMetreTitle(projectId);
    }
    
    updateTreeContent(projectId);
}

function toggleNode(projectId, nodeId) {
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    if (node && node.type === 'folder') {
        node.collapsed = !node.collapsed;
        updateTreeContent(projectId);
    }
}

function addFolder(projectId) {
    let project = projects[projectId];
    
    if (project.currentPoste) {
        project.currentPoste.data = getCurrentMetreData(projectId);
    }
    
    let parentNode = null;
    let targetArray = project.treeData;
    
    if (project.selectedTreeNode) {
        let selectedNode = findNodeById(project.treeData, project.selectedTreeNode);
        if (selectedNode && selectedNode.type === 'folder') {
            parentNode = selectedNode;
            // Ensure children array exists
            if (!selectedNode.children) {
                selectedNode.children = [];
            }
            targetArray = selectedNode.children;
        }
    }
    
    let folderCount = targetArray.filter(n => n.type === 'folder').length;
    let nextNumber = folderCount + 1;
    
    let newFolder = {
        id: 'folder_' + Date.now(),
        name: String(nextNumber),
        type: 'folder',
        collapsed: false,
        children: []
    };
    
    targetArray.push(newFolder);
    project.selectedTreeNode = newFolder.id;
    updateTreeContent(projectId);
}

function deleteFolder(projectId) {
    let project = projects[projectId];
    
    if (!project.selectedTreeNode) {
        alert("Veuillez sélectionner un dossier");
        return;
    }
    
    let node = findNodeById(project.treeData, project.selectedTreeNode);
    if (!node || node.type !== 'folder') {
        alert("Veuillez sélectionner un dossier");
        return;
    }
    
    if (node.children && node.children.length > 0) {
        let contentMsg = `Le dossier "${node.name}" contient ${node.children.length} élément(s).`;
        if (confirm(contentMsg + '\n\nVoulez-vous vraiment tout supprimer ?')) {
            removeNode(projectId, project.selectedTreeNode);
        }
    } else {
        if (confirm(`Supprimer le dossier vide "${node.name}" ?`)) {
            removeNode(projectId, project.selectedTreeNode);
        }
    }
}

function addPoste(projectId) {
    let project = projects[projectId];
    
    if (project.currentPoste) {
        project.currentPoste.data = getCurrentMetreData(projectId);
    }
    
    if (!project.selectedTreeNode) {
        alert("Veuillez d'abord sélectionner un dossier ou créer un dossier");
        return;
    }
    
    let selectedNode = findNodeById(project.treeData, project.selectedTreeNode);
    
    if (selectedNode && selectedNode.type === 'poste') {
        selectedNode = findParentNode(project.treeData, project.selectedTreeNode);
    }
    
    if (!selectedNode || selectedNode.type !== 'folder') {
        alert("Veuillez sélectionner un dossier");
        return;
    }
    
    // Ensure children array exists
    if (!selectedNode.children) {
        selectedNode.children = [];
    }
    
    // Expand the parent folder so the new poste is visible
    selectedNode.collapsed = false;
    
    let posteCount = selectedNode.children.filter(n => n.type === 'poste').length;
    let nextNumber = posteCount + 1;
    
    let newPoste = {
        id: 'poste_' + Date.now(),
        name: String(nextNumber),
        type: 'poste',
        collapsed: false,  // Par défaut déplié
        blocks: [
            {
                id: 'block_file_' + Date.now(),
                type: 'file',
                folderName: '',
                fileName: String(nextNumber),
                data: []
            },
            {
                id: 'block_' + Date.now(),
                type: 'table',  // 'folder', 'file', or 'table'
                folderName: '',
                fileName: '',
                data: createInitialTableData(),
                footer: {
                    ens: 'Ens.',
                    unit: '',
                    pu: 0
                }
            }
        ],
        // Keep old data structure for backward compatibility
        data: []
    };
    
    selectedNode.children.push(newPoste);
    
    // Select the new poste (this will also render the table and update the tree)
    selectTreeNode(projectId, newPoste.id);
}

function deletePoste(projectId) {
    let project = projects[projectId];
    
    if (!project.selectedTreeNode) {
        alert("Veuillez sélectionner un poste");
        return;
    }
    
    let node = findNodeById(project.treeData, project.selectedTreeNode);
    if (!node || node.type !== 'poste') {
        alert("Veuillez sélectionner un poste");
        return;
    }
    
    if (confirm(`Supprimer le poste "${node.name}" et toutes ses données ?`)) {
        removeNode(projectId, project.selectedTreeNode);
        
        if (project.currentPoste && project.currentPoste.id === project.selectedTreeNode) {
            project.currentPoste = null;
            renderMetreTable(projectId);
        }
    }
}

function removeNode(projectId, nodeId) {
    let project = projects[projectId];
    
    function removeFromArray(nodes) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === nodeId) {
                nodes.splice(i, 1);
                return true;
            }
            if (nodes[i].children && removeFromArray(nodes[i].children)) {
                return true;
            }
        }
        return false;
    }
    
    removeFromArray(project.treeData);
    project.selectedTreeNode = null;
    updateTreeContent(projectId);
}

function moveNodeUp(projectId) {
    let project = projects[projectId];
    if (!project.selectedTreeNode) return;
    
    if (project.currentPoste) {
        project.currentPoste.data = getCurrentMetreData(projectId);
    }
    
    let parent = findParentNode(project.treeData, project.selectedTreeNode);
    let nodes = parent ? parent.children : project.treeData;
    
    let index = nodes.findIndex(n => n.id === project.selectedTreeNode);
    if (index > 0) {
        [nodes[index - 1], nodes[index]] = [nodes[index], nodes[index - 1]];
        updateTreeContent(projectId);
    }
}

function moveNodeDown(projectId) {
    let project = projects[projectId];
    if (!project.selectedTreeNode) return;
    
    if (project.currentPoste) {
        project.currentPoste.data = getCurrentMetreData(projectId);
    }
    
    let parent = findParentNode(project.treeData, project.selectedTreeNode);
    let nodes = parent ? parent.children : project.treeData;
    
    let index = nodes.findIndex(n => n.id === project.selectedTreeNode);
    if (index < nodes.length - 1) {
        [nodes[index], nodes[index + 1]] = [nodes[index + 1], nodes[index]];
        updateTreeContent(projectId);
    }
}

let renamingNodeId = null;

function startRenaming(projectId, nodeId) {
    if (renamingNodeId) return;
    
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    if (!node) return;
    
    renamingNodeId = nodeId;
    let currentName = node.name;
    
    updateTreeContent(projectId);
    
    setTimeout(() => {
        let $label = $(`#workspace-${projectId} .tree-node-label[data-node-id="${nodeId}"]`);
        if ($label.length === 0) {
            renamingNodeId = null;
            return;
        }
        
        let $input = $('<input type="text" class="tree-rename-input">');
        $input.val(currentName);
        $input.css({
            width: '120px',
            padding: '2px 4px',
            border: '1px solid #3498db',
            outline: 'none',
            fontSize: '12px',
            fontFamily: 'inherit'
        });
        
        $label.html($input);
        $input.focus().select();
        
        function finishRename(save) {
            if (save) {
                let newName = $input.val().trim();
                if (newName && newName !== currentName) {
                    node.name = newName;
                    
                    // BIDIRECTIONAL SYNC: Update all postes that are descendants of this folder
                    if (node.type === 'folder') {
                        updateDescendantPostesBlocks(projectId, nodeId);
                    }
                    
                    // Update metre title if this is the current poste
                    if (project.currentPoste && project.currentPoste.id === nodeId) {
                        updateMetreTitle(projectId);
                    }
                    
                    // Refresh table if current poste is affected
                    if (project.currentPoste) {
                        rebuildPosteBlocksFromTree(projectId, project.currentPoste.id);
                        renderMetreTable(projectId);
                    }
                }
            }
            renamingNodeId = null;
            updateTreeContent(projectId);
        }
        
        $input.on('blur', function() {
            setTimeout(() => finishRename(true), 100);
        });
        
        $input.on('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                finishRename(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishRename(false);
            }
        });
        
        $input.on('click', function(e) {
            e.stopPropagation();
        });
    }, 50);
}

function showTreeContextMenu(projectId, e, nodeId) {
    e.preventDefault();
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    let node = findNodeById(project.treeData, nodeId);
    if (!node) return;
    
    project.selectedTreeNode = nodeId;
    updateTreeContent(projectId);
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [];
    
    if (node.type === 'folder') {
        menuItems = [
            { label: '✏️ Renommer', action: () => startRenaming(projectId, nodeId) },
            { separator: true },
            { label: '📁➕ Nouveau sous-dossier', action: () => addFolder(projectId) },
            { label: '📄➕ Nouveau fichier', action: () => addPoste(projectId) },
            { separator: true },
            { label: '⬆️ Monter', action: () => moveNodeUp(projectId) },
            { label: '⬇️ Descendre', action: () => moveNodeDown(projectId) },
            { separator: true },
            { label: '🗑️ Supprimer dossier', action: () => deleteFolder(projectId) }
        ];
    } else {
        menuItems = [
            { label: '✏️ Renommer', action: () => startRenaming(projectId, nodeId) },
            { separator: true },
            { label: '⬆️ Monter', action: () => moveNodeUp(projectId) },
            { label: '⬇️ Descendre', action: () => moveNodeDown(projectId) },
            { separator: true },
            { label: '🗑️ Supprimer poste', action: () => deletePoste(projectId) }
        ];
    }
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

function filterTree(projectId, searchTerm) {
    searchTerm = searchTerm.toLowerCase();
    
    if (searchTerm === '') {
        $(`#workspace-${projectId} .tree-node`).show();
        return;
    }
    
    $(`#workspace-${projectId} .tree-node`).each(function() {
        let text = $(this).text().toLowerCase();
        if (text.includes(searchTerm)) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}

// ===== METRE TABLE FUNCTIONS =====
function getCurrentMetreData(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return [];
    
    // Data is now stored in individual blocks, not in currentPoste.data
    // This function is kept for backward compatibility but doesn't need to do anything
    // The data is already saved in block.data arrays
    
    return [];  // Not used anymore
}

// Render a cell value with variable badge if applicable
function renderCellWithVariable(field, variables, projectId) {
    if (!field && field !== 0) return '';
    
    // Simple number
    if (typeof field === 'number') {
        return field !== 0 ? formatNumber(field) : '';
    }
    
    // Object
    if (typeof field === 'object') {
        if (field.type === 'variable') {
            // Variable = afficher la valeur (devant) + badge (en coin, derrière)
            let varData = variables ? variables[field.name] : null;
            let varValue = varData ? (varData.value || 0) : 0;
            
            let badgeClass = field.isDeclaration ? 'var-declaration' : 'var-call';
            let varType = getVariableType(field.name);
            
            // Le texte est wrappé dans un span avec z-index élevé
            // Le badge est positionné en coin avec z-index bas (CSS)
            let valueDisplay = varValue !== 0 ? `<span class="variable-value-text">${formatNumber(varValue)}</span>` : '';
            let badgeHtml = `<span class="variable-badge ${badgeClass}" data-var-name="${field.name}" data-var-type="${varType}" data-is-declaration="${field.isDeclaration}" data-project-id="${projectId}">${field.name}</span>`;
            
            return `${valueDisplay}${badgeHtml}`;
        }
        if (field.type === 'value') {
            return field.value !== null && field.value !== 0 ? formatNumber(field.value) : '';
        }
        if (field.type === 'formula') {
            let displayValue = field.value;
            if (typeof displayValue === 'number') {
                displayValue = formatNumber(displayValue);
            } else if (displayValue === '#ERREUR') {
                return '<span class="formula-error">#ERREUR</span>';
            }
            return `<span class="formula-cell" title="${escapeHtml(field.formula)}">${displayValue}</span>`;
        }
    }
    
    return field || '';
}

// Vérifie si un champ est une variable (pour ajouter la classe has-variable)
function isVariableField(field) {
    return field && typeof field === 'object' && field.type === 'variable';
}

// Générer le HTML du badge de variable pour une cellule
function getVariableBadgeHtml(projectId, blockId, rowIndex, field) {
    let project = projects[projectId];
    if (!project || !project.variables) return '';
    
    let varName = findVariableForCell(projectId, blockId, rowIndex, field);
    if (!varName) return '';
    
    let varType = getVariableType(varName);
    return `<span class="variable-badge var-declaration" data-var-name="${varName}" data-var-type="${varType}" data-is-declaration="true" data-project-id="${projectId}">${varName}</span>`;
}

// Ajouter les badges de variables aux cellules du tableau
function addVariableBadgesToCells(projectId) {
    let project = projects[projectId];
    if (!project || !project.variables) return;
    
    // Parcourir toutes les variables et ajouter les badges
    for (let varName in project.variables) {
        let v = project.variables[varName];
        if (!v.blockId || v.rowIndex === undefined || !v.field) continue;
        
        let varType = getVariableType(varName);
        let badgeHtml = `<span class="variable-badge var-declaration" data-var-name="${varName}" data-var-type="${varType}" data-is-declaration="true" data-project-id="${projectId}">${varName}</span>`;
        
        // Trouver la cellule correspondante
        let $row;
        if (v.rowIndex === 'footer') {
            $row = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${v.blockId}"]`);
        } else {
            $row = $(`#workspace-${projectId} .metre-table tr[data-block-id="${v.blockId}"][data-row="${v.rowIndex}"]`);
        }
        
        if ($row.length > 0) {
            let $cell = $row.find(`td[data-field="${v.field}"]`);
            if ($cell.length > 0) {
                // Ajouter la classe has-variable à la cellule
                $cell.addClass('has-variable');
                
                // Si la cellule n'a pas déjà un badge, l'ajouter
                if ($cell.find('.variable-badge').length === 0) {
                    // Wrapper le texte existant dans un span
                    let existingContent = $cell.html();
                    if (existingContent && !existingContent.includes('variable-value-text')) {
                        $cell.html(`<span class="variable-value-text">${existingContent}</span>${badgeHtml}`);
                    } else {
                        $cell.append(badgeHtml);
                    }
                }
            }
        }
    }
    
    // Ajouter la classe has-variable à toutes les cellules qui contiennent un badge
    $(`#workspace-${projectId} .metre-table td`).each(function() {
        let $cell = $(this);
        if ($cell.find('.variable-badge').length > 0) {
            $cell.addClass('has-variable');
        }
    });
}

// Escape HTML for display in attributes
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// Render text cell value (for code, designation, etc.) with formula support
function renderTextCellValue(field) {
    if (!field && field !== 0) return '';
    
    // Handle object (formula)
    if (typeof field === 'object') {
        if (field.type === 'formula') {
            // Display the calculated value with formula indicator
            let displayValue = field.value;
            if (displayValue === '#ERREUR') {
                return '<span class="formula-error" title="Erreur de formule">#ERREUR</span>';
            }
            return `<span class="formula-cell" title="${escapeHtml(field.formula)}">${escapeHtml(String(displayValue || ''))}</span>`;
        }
    }
    
    return field || '';
}

// Calculate footer totals for a table block (used by both footer rendering and file block display)
function calculateTableFooterTotals(block, variables) {
    let totalValPlus = 0;
    let totalValMoins = 0;
    
    if (!block.data || block.data.length === 0) {
        return { valPlus: 0, valMoins: 0, qteTotal: 0 };
    }
    
    block.data.forEach((row, idx) => {
        // Check if this is a subtotal row
        let isRowSubtotal = row.isSubtotalRow === true;
        let rowL = row.l;
        if (typeof rowL === 'string' && rowL.toLowerCase() === 'ens.') {
            isRowSubtotal = true;
        } else if (rowL && typeof rowL === 'object' && rowL.type === 'value' && typeof rowL.value === 'string' && rowL.value.toLowerCase() === 'ens.') {
            isRowSubtotal = true;
        }
        
        if (isRowSubtotal) {
            // Find last subtotal index
            let lastSubtotalIndex = -1;
            for (let j = idx - 1; j >= 0; j--) {
                let prevRow = block.data[j];
                let prevL = prevRow.l;
                let prevIsSubtotal = prevRow.isSubtotalRow === true;
                
                if (!prevIsSubtotal) {
                    if (typeof prevL === 'string' && prevL.toLowerCase() === 'ens.') {
                        prevIsSubtotal = true;
                    } else if (prevL && typeof prevL === 'object' && prevL.type === 'value' && typeof prevL.value === 'string' && prevL.value.toLowerCase() === 'ens.') {
                        prevIsSubtotal = true;
                    }
                }
                
                if (prevIsSubtotal) {
                    lastSubtotalIndex = j;
                    break;
                }
            }
            
            // Sum Total L values in this range
            let subtotalValue = 0;
            for (let j = lastSubtotalIndex + 1; j < idx; j++) {
                let dataRow = block.data[j];
                if (dataRow.isSubtotalRow) continue;
                let dataL = dataRow.l;
                if (typeof dataL === 'string' && dataL.toLowerCase() === 'ens.') continue;
                if (dataL && typeof dataL === 'object' && dataL.type === 'value' && typeof dataL.value === 'string' && dataL.value.toLowerCase() === 'ens.') continue;
                
                let rowTotalL;
                if (dataRow.totalLForcee) {
                    rowTotalL = getValue(dataRow.totalLForcee, variables);
                } else {
                    rowTotalL = calculateTotalL(dataRow, variables);
                }
                subtotalValue += rowTotalL;
            }
            
            // Check for chain multiplication with next rows
            let nextRow = block.data[idx + 1];
            let useNextRow = false;
            let useNextNextRow = false;
            let nextLarg = 0;
            let nextNextH = 0;
            let nextNextRow = null;
            
            if (nextRow && !nextRow.isSubtotalRow) {
                let nextL = nextRow.l;
                let isNextSubtotal = (typeof nextL === 'string' && nextL.toLowerCase() === 'ens.') ||
                                     (nextL && typeof nextL === 'object' && nextL.type === 'value' && 
                                      typeof nextL.value === 'string' && nextL.value.toLowerCase() === 'ens.');
                
                if (!isNextSubtotal) {
                    nextLarg = getValue(nextRow.larg, variables);
                    if (nextLarg !== 0) {
                        useNextRow = true;
                        
                        // Check for h in next-next row
                        nextNextRow = block.data[idx + 2];
                        if (nextNextRow && !nextNextRow.isSubtotalRow) {
                            let nextNextL = nextNextRow.l;
                            let isNextNextSubtotal = (typeof nextNextL === 'string' && nextNextL.toLowerCase() === 'ens.') ||
                                                     (nextNextL && typeof nextNextL === 'object' && nextNextL.type === 'value' && 
                                                      typeof nextNextL.value === 'string' && nextNextL.value.toLowerCase() === 'ens.');
                            
                            if (!isNextNextSubtotal) {
                                nextNextH = getValue(nextNextRow.h, variables);
                                if (nextNextH !== 0) {
                                    useNextNextRow = true;
                                }
                            }
                        }
                    }
                }
            }
            
            if (useNextNextRow) {
                let resultValue = subtotalValue * nextLarg * nextNextH;
                if (nextNextRow.isDeduction) {
                    totalValMoins += resultValue;
                } else {
                    totalValPlus += resultValue;
                }
            } else if (useNextRow) {
                let resultValue = subtotalValue * nextLarg;
                if (nextRow.isDeduction) {
                    totalValMoins += resultValue;
                } else {
                    totalValPlus += resultValue;
                }
            } else {
                if (row.isDeduction) {
                    totalValMoins += subtotalValue;
                } else {
                    totalValPlus += subtotalValue;
                }
            }
        } else {
            // Normal row - calculate value
            let value;
            if (row.valeurForcee) {
                value = getValue(row.valeurForcee, variables);
                if (row.isDeduction) value = -value;
            } else {
                value = calculateValue(row, variables);
            }
            
            if (row.isDeduction || value < 0) {
                totalValMoins += Math.abs(value);
            } else {
                totalValPlus += value;
            }
        }
    });
    
    return {
        valPlus: totalValPlus,
        valMoins: totalValMoins,
        qteTotal: totalValPlus - totalValMoins
    };
}

function renderMetreTable(projectId) {
    let project = projects[projectId];
    
    if (!project.currentPoste) {
        $(`#workspace-${projectId} .zoom-area-${projectId}`).html('<div style="padding:20px; text-align:center; color:#999;">Sélectionnez un poste dans l\'arborescence.</div>');
        return;
    }
    
    // Initialize blocks if needed (convert old structure to new)
    if (!project.currentPoste.blocks && project.currentPoste.data) {
        // Get folder path and poste name from tree
        let pathInfo = getPosteFolderAndName(projectId, project.currentPoste.id);
        let folderPath = pathInfo.folders.length > 0 ? pathInfo.folders.join(' / ') : '';
        let posteName = pathInfo.posteName;
        
        // Create initial blocks structure
        project.currentPoste.blocks = [];
        
        // Add folder block if there are folders
        if (folderPath) {
            project.currentPoste.blocks.push({
                id: 'block_folder_' + Date.now(),
                type: 'folder',
                folderName: folderPath,
                fileName: '',
                data: []
            });
        }
        
        // Add file block (poste name)
        project.currentPoste.blocks.push({
            id: 'block_file_' + Date.now(),
            type: 'file',
            folderName: '',
            fileName: posteName,
            data: []
        });
        
        // Add table block with COPY of existing data
        project.currentPoste.blocks.push({
            id: 'block_table_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: JSON.parse(JSON.stringify(project.currentPoste.data))  // DEEP COPY
        });
        
        // Keep old data for backward compatibility
        // Don't remove project.currentPoste.data
    }
    
    // Ensure currentPoste.data exists for backward compatibility
    if (!project.currentPoste.data) {
        project.currentPoste.data = [];
    }
    
    // Check if we have any blocks
    if (!project.currentPoste.blocks || project.currentPoste.blocks.length === 0) {
        $(`#workspace-${projectId} .zoom-area-${projectId}`).html('<div style="padding:20px; text-align:center; color:#999;">Aucun bloc. Utilisez les boutons pour ajouter des blocs.</div>');
        return;
    }
    
    // Start building HTML with table header
    // Récupérer les largeurs de colonnes: projet > réglages globaux > valeurs par défaut
    let defaultColWidths = {
        'num': 40, 'code': 60, 'designation': 180, 'n': 40, 'op': 40,
        'l': 60, 'totall': 70, 'larg': 50, 'h': 50, 'ens': 50,
        'valplus': 70, 'valmoins': 70, 'unit': 50, 'qtetotal': 70, 'pu': 60, 'totalht': 80
    };
    let defaultColTitles = {
        num: '#', code: 'Code', designation: 'Désignation', n: 'N', op: 'Op',
        l: 'L', totall: 'Total L', larg: 'l', h: 'h', ens: 'Ens.',
        valplus: 'Val (+)', valmoins: 'Val (-)', unit: 'Unit', qtetotal: 'Qté T.', pu: 'PU', totalht: 'Total HT'
    };
    let globalColWidths = (appSettings.layout && appSettings.layout.columnWidths) ? {...defaultColWidths, ...appSettings.layout.columnWidths} : defaultColWidths;
    let globalColTitles = (appSettings.layout && appSettings.layout.columnTitles) ? {...defaultColTitles, ...appSettings.layout.columnTitles} : defaultColTitles;
    let colWidths = project.columnWidths ? {...globalColWidths, ...project.columnWidths} : globalColWidths;
    let colTitles = globalColTitles;
    
    let html = `
        <table class="metre-table" data-project-id="${projectId}">
            <thead>
                <tr class="metre-header-row">
                    <th data-col="num" style="width:${colWidths.num}px; background: #f0f0f0; color: #666; position: relative;">${colTitles.num}<div class="col-resizer" data-col="num"></div></th>
                    <th data-col="code" style="width:${colWidths.code}px; position: relative;">${colTitles.code}<div class="col-resizer" data-col="code"></div></th>
                    <th data-col="designation" style="width:${colWidths.designation}px; position: relative;">${colTitles.designation}<div class="col-resizer" data-col="designation"></div></th>
                    <th data-col="n" style="width:${colWidths.n}px; position: relative;">${colTitles.n}<div class="col-resizer" data-col="n"></div></th>
                    <th data-col="op" style="width:${colWidths.op}px; position: relative;">${colTitles.op}<div class="col-resizer" data-col="op"></div></th>
                    <th data-col="l" style="width:${colWidths.l}px; position: relative;">${colTitles.l}<div class="col-resizer" data-col="l"></div></th>
                    <th data-col="totall" style="width:${colWidths.totall}px; position: relative;">${colTitles.totall}<div class="col-resizer" data-col="totall"></div></th>
                    <th data-col="larg" style="width:${colWidths.larg}px; position: relative;">${colTitles.larg}<div class="col-resizer" data-col="larg"></div></th>
                    <th data-col="h" style="width:${colWidths.h}px; position: relative;">${colTitles.h}<div class="col-resizer" data-col="h"></div></th>
                    <th data-col="ens" style="width:${colWidths.ens}px; position: relative;">${colTitles.ens}<div class="col-resizer" data-col="ens"></div></th>
                    <th data-col="valplus" style="width:${colWidths.valplus}px; position: relative;" class="col-plus">${colTitles.valplus}<div class="col-resizer" data-col="valplus"></div></th>
                    <th data-col="valmoins" style="width:${colWidths.valmoins}px; position: relative;" class="col-moins">${colTitles.valmoins}<div class="col-resizer" data-col="valmoins"></div></th>
                    <th data-col="unit" style="width:${colWidths.unit}px; position: relative;">${colTitles.unit}<div class="col-resizer" data-col="unit"></div></th>
                    <th data-col="qtetotal" style="width:${colWidths.qtetotal}px; position: relative;">${colTitles.qtetotal}<div class="col-resizer" data-col="qtetotal"></div></th>
                    <th data-col="pu" style="width:${colWidths.pu}px; position: relative;">${colTitles.pu}<div class="col-resizer" data-col="pu"></div></th>
                    <th data-col="totalht" style="width:${colWidths.totalht}px; position: relative;">${colTitles.totalht}<div class="col-resizer" data-col="totalht"></div></th>
                </tr>
            </thead>
            <tbody>`;
    
    // Line counter for all rows
    let lineNumber = 0;
    
    // Skip folder blocks - we don't display them in the table anymore
    // The path is already visible in the tree structure
    
    // Loop through each block and render
    project.currentPoste.blocks.forEach((block, blockIndex) => {
        // Skip folder blocks
        if (block.type === 'folder') {
            return;
        }
        
        if (block.type === 'file') {
            lineNumber++;
            
            // Find the next table block to get footer values
            let nextTableBlock = null;
            let nextTableBlockIndex = -1;
            for (let i = blockIndex + 1; i < project.currentPoste.blocks.length; i++) {
                if (project.currentPoste.blocks[i].type === 'table') {
                    nextTableBlock = project.currentPoste.blocks[i];
                    nextTableBlockIndex = i;
                    break;
                } else if (project.currentPoste.blocks[i].type === 'file') {
                    // Stop if we hit another file block
                    break;
                }
            }
            
            // Get footer values from next table block - we'll fill these after the table is rendered
            let footerUnit = '';
            let footerQteTotal = '';
            
            if (nextTableBlock && nextTableBlock.footer) {
                footerUnit = nextTableBlock.footer.unit || '';
            }
            
            // Render file block with same number of cells as table but no vertical borders
            // The qtetotal will be updated via data attribute to match the footer
            html += `
                <tr class="block-row block-file" data-block-id="${block.id}" data-block-index="${blockIndex}" data-project-id="${projectId}" data-next-table-id="${nextTableBlock ? nextTableBlock.id : ''}">
                    <td style="background: #f0f0f0; color: #999; text-align: center; font-size: 11px; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; border-left: 1px solid #3498db; position: relative; padding: 4px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                            <span>${lineNumber}</span>
                            <button class="btn-delete-block" data-block-id="${block.id}" title="Supprimer ce bloc" style="background: white; border: 1px solid #666; border-radius: 50%; cursor: pointer; color: #333; font-size: 10px; width: 16px; height: 16px; padding: 0; opacity: 0.5; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;">−</button>
                        </div>
                    </td>
                    <td class="editable file-block-cell" data-field="fileCode" data-block-id="${block.id}" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; cursor: cell; text-align: left; padding: 2px 4px;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 14px;">📝</span>
                            <span class="file-block-code-text">${block.fileCode || ''}</span>
                        </div>
                    </td>
                    <td class="editable file-block-cell file-block-title-cell" data-field="fileName" data-block-id="${block.id}" colspan="10" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; cursor: cell; text-align: left; padding: 2px 4px;">
                        <span class="file-block-title-text" style="font-size: 12px; font-weight: bold; color: #2c3e50; word-wrap: break-word; overflow-wrap: break-word;">${block.fileName || ''}</span>
                    </td>
                    <td class="file-block-cell" data-field="unit" data-block-id="${block.id}" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; text-align: center; font-weight: bold;">${footerUnit}</td>
                    <td class="file-block-cell file-block-qtetotal" data-field="qtetotal" data-block-id="${block.id}" data-linked-table-id="${nextTableBlock ? nextTableBlock.id : ''}" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; text-align: center; font-weight: bold;"></td>
                    <td class="file-block-cell" data-field="pu" data-block-id="${block.id}" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db;"></td>
                    <td class="file-block-cell" data-field="totalht" data-block-id="${block.id}" style="background: #f5f5f5; border-top: 1px solid #3498db; border-bottom: 1px solid #3498db; border-right: 1px solid #3498db;"></td>
                </tr>`;
                
        } else if (block.type === 'table') {
            // Render table block without header, just with thin borders
            if (block.data && block.data.length > 0) {
                block.data.forEach((row, i) => {
                    // Check if this is a subtotal row (L contains "ens." as text OR isSubtotalRow flag)
                    let isSubtotal = false;
                    let subtotalValue = 0;
                    
                    // Check if row has isSubtotalRow flag
                    if (row.isSubtotalRow === true) {
                        isSubtotal = true;
                    }
                    
                    // Check if L field is a string "ens." (not a number)
                    let lValue = row.l;
                    let isEnsText = false;
                    
                    if (typeof lValue === 'string' && lValue.toLowerCase() === 'ens.') {
                        isEnsText = true;
                        isSubtotal = true;
                    } else if (lValue && typeof lValue === 'object' && lValue.type === 'value' && typeof lValue.value === 'string' && lValue.value.toLowerCase() === 'ens.') {
                        isEnsText = true;
                        isSubtotal = true;
                    }
                    
                    if (isSubtotal) {
                        // Find the range: from last "ens." (or start) to current line
                        let lastSubtotalIndex = -1;
                        for (let j = i - 1; j >= 0; j--) {
                            let prevRow = block.data[j];
                            let prevL = prevRow.l;
                            let prevIsSubtotal = prevRow.isSubtotalRow === true;
                            
                            if (!prevIsSubtotal) {
                                if (typeof prevL === 'string' && prevL.toLowerCase() === 'ens.') {
                                    prevIsSubtotal = true;
                                } else if (prevL && typeof prevL === 'object' && prevL.type === 'value' && typeof prevL.value === 'string' && prevL.value.toLowerCase() === 'ens.') {
                                    prevIsSubtotal = true;
                                }
                            }
                            
                            if (prevIsSubtotal) {
                                lastSubtotalIndex = j;
                                break;
                            }
                        }
                        
                        // Sum all Total L values in this range (skip subtotal rows)
                        let hasDataLines = false;
                        for (let j = lastSubtotalIndex + 1; j < i; j++) {
                            let dataRow = block.data[j];
                            // Skip other subtotal rows in calculation
                            if (dataRow.isSubtotalRow) continue;
                            let dataL = dataRow.l;
                            if (typeof dataL === 'string' && dataL.toLowerCase() === 'ens.') continue;
                            if (dataL && typeof dataL === 'object' && dataL.type === 'value' && typeof dataL.value === 'string' && dataL.value.toLowerCase() === 'ens.') continue;
                            
                            let rowTotalL;
                            if (dataRow.totalLForcee) {
                                rowTotalL = getValue(dataRow.totalLForcee, project.variables);
                            } else {
                                rowTotalL = calculateTotalL(dataRow, project.variables);
                            }
                            
                            if (rowTotalL !== 0) {
                                hasDataLines = true;
                            }
                            subtotalValue += rowTotalL;
                        }
                        
                        // Keep it as a subtotal even without data lines (the flag was set)
                        // hasDataLines check is only for auto-detection via "ens." text
                    }
                    
                    // Calculate values
                    let totalL;
                    if (isSubtotal) {
                        // For subtotal rows, Total L is the sum
                        totalL = subtotalValue;
                    } else if (row.totalLForcee) {
                        totalL = getValue(row.totalLForcee, project.variables);
                    } else {
                        totalL = calculateTotalL(row, project.variables);
                    }
                    
                    let value;
                    if (row.valeurForcee) {
                        value = getValue(row.valeurForcee, project.variables);
                        if (row.isDeduction) value = -value;
                    } else {
                        value = calculateValue(row, project.variables);
                    }
                    
                    let qteTotal;
                    if (row.qteForcee) {
                        qteTotal = getValue(row.qteForcee, project.variables);
                    } else {
                        qteTotal = value;
                    }
                    
                    let totalHT = qteTotal * getValue(row.pu, project.variables);
                    
                    // Render cells with variable support
                    let nDisplay = renderCellWithVariable(row.n, project.variables, projectId);
                    
                    // For L column: if it's a subtotal row, show "ens." in italic
                    let lDisplay;
                    if (isSubtotal) {
                        lDisplay = '<i>ens.</i>';
                    } else {
                        lDisplay = renderCellWithVariable(row.l, project.variables, projectId);
                    }
                    
                    let largDisplay = renderCellWithVariable(row.larg, project.variables, projectId);
                    let hDisplay = renderCellWithVariable(row.h, project.variables, projectId);
                    let ensDisplay = row.ens === 'Ens.' ? 'Ens.' : '';
                    let puDisplay = renderCellWithVariable(row.pu, project.variables, projectId);
                    
                    // For subtotal rows, show subtotal in Total L in bold
                    let totalLDisplay;
                    if (isSubtotal) {
                        totalLDisplay = '<strong>' + formatNumber(subtotalValue) + '</strong>';
                    } else {
                        totalLDisplay = row.totalLForcee ? renderCellWithVariable(row.totalLForcee, project.variables, projectId) : formatNumber(totalL);
                    }
                    
                    let valeurForceeDisplay = row.valeurForcee ? renderCellWithVariable(row.valeurForcee, project.variables, projectId) : formatNumber(value);
                    let qteForceeDisplay = row.qteForcee ? renderCellWithVariable(row.qteForcee, project.variables, projectId) : formatNumber(qteTotal);
                    
                    // For Designation, add "Sous-Total" in small text aligned right if isSubtotal
                    let designationDisplay = renderTextCellValue(row.designation);
                    if (isSubtotal) {
                        designationDisplay = '<div style="display: flex; justify-content: space-between; align-items: center;"><span>' + renderTextCellValue(row.designation) + '</span><span style="font-size: 10px; color: #7f8c8d; font-style: italic;">Sous-Total</span></div>';
                    }
                    
                    // Code cell with formula support
                    let codeDisplay = renderTextCellValue(row.code);
                    
                    // For subtotal rows, don't show N and Op (L already shows "ens.")
                    let showNOp = !isSubtotal && getValue(row.l, project.variables) !== 0;
                    
                    lineNumber++;
                    
                    // Add thin border to first row (top), all rows (left/right)
                    // For subtotal rows, add thicker top border and different background
                    let borderLeft = i === 0 ? 'border-left: 1px solid #bdc3c7; border-top: 1px solid #bdc3c7;' : 'border-left: 1px solid #bdc3c7;';
                    let borderRight = i === 0 ? 'border-right: 1px solid #bdc3c7; border-top: 1px solid #bdc3c7;' : 'border-right: 1px solid #bdc3c7;';
                    let borderTopOnly = i === 0 ? 'border-top: 1px solid #bdc3c7;' : '';
                    let lineNumBorder = i === 0 ? 'border-top: 1px solid #bdc3c7;' : '';
                    
                    if (isSubtotal) {
                        borderLeft = 'border-left: 1px solid #bdc3c7;';
                        borderRight = 'border-right: 1px solid #bdc3c7;';
                        borderTopOnly = '';
                        lineNumBorder = '';
                    }
                    
                    let rowClass = isSubtotal ? 'sous-total-row' : '';
                    let rowStyle = isSubtotal ? 'background: #ffffff;' : '';
                    
                    // For subtotal rows, make L cell special (clickable ens. cell)
                    let lCellHtml;
                    if (isSubtotal) {
                        lCellHtml = `<td class="ens-cell" data-field="l" data-is-subtotal="true" tabindex="0" style="${borderTopOnly}" title="Cliquer ou Espace pour insérer une ligne"><strong>ens.</strong></td>`;
                    } else {
                        lCellHtml = `<td class="editable" data-field="l" style="${borderTopOnly}">${lDisplay}</td>`;
                    }
                    
                    // For subtotal rows, Total L cell shows the sum with border top
                    let totalLCellHtml;
                    if (isSubtotal) {
                        totalLCellHtml = `<td class="col-calculated sum-cell" data-field="totall" data-row="${i}"><strong>${formatNumber(subtotalValue)}</strong></td>`;
                    } else {
                        totalLCellHtml = `<td class="col-calculated" data-field="totall" data-row="${i}" style="${borderTopOnly}">${totalLDisplay}</td>`;
                    }
                    
                    // For subtotal rows, show the subtotal value in Val(+) or Val(-) based on isDeduction
                    // Val- shows negative value
                    // Chain: subtotal → larg → h
                    // If next row has larg, don't show Val+ on subtotal
                    // If row after that has h, don't show Val+ on the larg row either
                    let subtotalValPlusDisplay = '';
                    let subtotalValMoinsDisplay = '';
                    let showSubtotalVal = true;
                    
                    if (isSubtotal) {
                        // Check if next row exists and has a value in l (larg)
                        let nextRow = block.data[i + 1];
                        if (nextRow && !nextRow.isSubtotalRow) {
                            let nextL = nextRow.l;
                            let isNextSubtotal = (typeof nextL === 'string' && nextL.toLowerCase() === 'ens.') ||
                                                 (nextL && typeof nextL === 'object' && nextL.type === 'value' && 
                                                  typeof nextL.value === 'string' && nextL.value.toLowerCase() === 'ens.');
                            
                            if (!isNextSubtotal) {
                                // Check if next row has a value in larg column
                                let nextLarg = getValue(nextRow.larg, project.variables);
                                
                                if (nextLarg !== 0) {
                                    // Next row has a larg value, don't show Val+ on subtotal
                                    showSubtotalVal = false;
                                }
                            }
                        }
                        
                        if (showSubtotalVal) {
                            if (row.isDeduction) {
                                subtotalValMoinsDisplay = `<strong>${formatNumber(-subtotalValue)}</strong>`;
                            } else {
                                subtotalValPlusDisplay = `<strong>${formatNumber(subtotalValue)}</strong>`;
                            }
                        }
                    }
                    
                    // For normal rows: check for multiplication chain
                    // Case 1: previous row is subtotal and this row has larg → show sum × larg (unless next row has h)
                    // Case 2: row before previous is subtotal, previous row has larg, this row has h → show sum × larg × h
                    let normalRowValPlusDisplay = '';
                    let normalRowValMoinsDisplay = '';
                    
                    // Get larg and h values for this row
                    let largValue = getValue(row.larg, project.variables);
                    let hValue = getValue(row.h, project.variables);
                    
                    if (!isSubtotal && i > 0) {
                        let prevRow = block.data[i - 1];
                        let prevL = prevRow.l;
                        let isPrevSubtotal = prevRow.isSubtotalRow === true ||
                                            (typeof prevL === 'string' && prevL.toLowerCase() === 'ens.') ||
                                            (prevL && typeof prevL === 'object' && prevL.type === 'value' && 
                                             typeof prevL.value === 'string' && prevL.value.toLowerCase() === 'ens.');
                        
                        // Case 1: Previous row is subtotal and this row has larg
                        if (isPrevSubtotal && largValue !== 0) {
                            // Check if next row has h value - if so, don't show Val+ here
                            let nextRow = block.data[i + 1];
                            let nextHasH = false;
                            if (nextRow && !nextRow.isSubtotalRow) {
                                let nextL = nextRow.l;
                                let isNextSubtotal = (typeof nextL === 'string' && nextL.toLowerCase() === 'ens.') ||
                                                     (nextL && typeof nextL === 'object' && nextL.type === 'value' && 
                                                      typeof nextL.value === 'string' && nextL.value.toLowerCase() === 'ens.');
                                if (!isNextSubtotal) {
                                    let nextH = getValue(nextRow.h, project.variables);
                                    if (nextH !== 0) {
                                        nextHasH = true;
                                    }
                                }
                            }
                            
                            if (!nextHasH) {
                                // Calculate the previous subtotal value
                                let prevSubtotalValue = 0;
                                let lastSubtotalBeforePrev = -1;
                                
                                // Find the subtotal before the previous one
                                for (let j = i - 2; j >= 0; j--) {
                                    let checkRow = block.data[j];
                                    let checkL = checkRow.l;
                                    let isCheckSubtotal = checkRow.isSubtotalRow === true ||
                                                         (typeof checkL === 'string' && checkL.toLowerCase() === 'ens.') ||
                                                         (checkL && typeof checkL === 'object' && checkL.type === 'value' && 
                                                          typeof checkL.value === 'string' && checkL.value.toLowerCase() === 'ens.');
                                    if (isCheckSubtotal) {
                                        lastSubtotalBeforePrev = j;
                                        break;
                                    }
                                }
                                
                                // Sum Total L values between lastSubtotalBeforePrev and i-1 (the previous subtotal)
                                for (let j = lastSubtotalBeforePrev + 1; j < i - 1; j++) {
                                    let dataRow = block.data[j];
                                    if (dataRow.isSubtotalRow) continue;
                                    let dataL = dataRow.l;
                                    if (typeof dataL === 'string' && dataL.toLowerCase() === 'ens.') continue;
                                    if (dataL && typeof dataL === 'object' && dataL.type === 'value' && typeof dataL.value === 'string' && dataL.value.toLowerCase() === 'ens.') continue;
                                    
                                    let rowTotalL;
                                    if (dataRow.totalLForcee) {
                                        rowTotalL = getValue(dataRow.totalLForcee, project.variables);
                                    } else {
                                        rowTotalL = calculateTotalL(dataRow, project.variables);
                                    }
                                    prevSubtotalValue += rowTotalL;
                                }
                                
                                // Calculate result: previous subtotal × this row's larg
                                let resultValue = prevSubtotalValue * largValue;
                                
                                if (row.isDeduction) {
                                    normalRowValMoinsDisplay = `<strong>${formatNumber(-resultValue)}</strong>`;
                                } else {
                                    normalRowValPlusDisplay = `<strong>${formatNumber(resultValue)}</strong>`;
                                }
                            }
                        }
                        
                        // Case 2: Row before previous is subtotal, previous row has larg, this row has h
                        if (i > 1 && hValue !== 0) {
                            let prevPrevRow = block.data[i - 2];
                            let prevPrevL = prevPrevRow.l;
                            let isPrevPrevSubtotal = prevPrevRow.isSubtotalRow === true ||
                                                    (typeof prevPrevL === 'string' && prevPrevL.toLowerCase() === 'ens.') ||
                                                    (prevPrevL && typeof prevPrevL === 'object' && prevPrevL.type === 'value' && 
                                                     typeof prevPrevL.value === 'string' && prevPrevL.value.toLowerCase() === 'ens.');
                            
                            let prevLarg = getValue(prevRow.larg, project.variables);
                            
                            if (isPrevPrevSubtotal && prevLarg !== 0) {
                                // Calculate the subtotal value (from row i-2)
                                let subtotalVal = 0;
                                let lastSubtotalBeforePrevPrev = -1;
                                
                                // Find the subtotal before i-2
                                for (let j = i - 3; j >= 0; j--) {
                                    let checkRow = block.data[j];
                                    let checkL = checkRow.l;
                                    let isCheckSubtotal = checkRow.isSubtotalRow === true ||
                                                         (typeof checkL === 'string' && checkL.toLowerCase() === 'ens.') ||
                                                         (checkL && typeof checkL === 'object' && checkL.type === 'value' && 
                                                          typeof checkL.value === 'string' && checkL.value.toLowerCase() === 'ens.');
                                    if (isCheckSubtotal) {
                                        lastSubtotalBeforePrevPrev = j;
                                        break;
                                    }
                                }
                                
                                // Sum Total L values between lastSubtotalBeforePrevPrev and i-2 (the subtotal)
                                for (let j = lastSubtotalBeforePrevPrev + 1; j < i - 2; j++) {
                                    let dataRow = block.data[j];
                                    if (dataRow.isSubtotalRow) continue;
                                    let dataL = dataRow.l;
                                    if (typeof dataL === 'string' && dataL.toLowerCase() === 'ens.') continue;
                                    if (dataL && typeof dataL === 'object' && dataL.type === 'value' && typeof dataL.value === 'string' && dataL.value.toLowerCase() === 'ens.') continue;
                                    
                                    let rowTotalL;
                                    if (dataRow.totalLForcee) {
                                        rowTotalL = getValue(dataRow.totalLForcee, project.variables);
                                    } else {
                                        rowTotalL = calculateTotalL(dataRow, project.variables);
                                    }
                                    subtotalVal += rowTotalL;
                                }
                                
                                // Calculate result: subtotal × previous larg × this h
                                let resultValue = subtotalVal * prevLarg * hValue;
                                
                                if (row.isDeduction) {
                                    normalRowValMoinsDisplay = `<strong>${formatNumber(-resultValue)}</strong>`;
                                } else {
                                    normalRowValPlusDisplay = `<strong>${formatNumber(resultValue)}</strong>`;
                                }
                            }
                        }
                    }
                    
                    // For subtotal rows, add special class for Val+/Val- cells to handle toggle
                    let subtotalValPlusClass = isSubtotal ? 'subtotal-val-cell' : '';
                    let subtotalValMoinsClass = isSubtotal ? 'subtotal-val-cell' : '';
                    
                    html += `<tr class="${rowClass}" data-row="${i}" data-line="${lineNumber}" data-block-id="${block.id}" data-block-index="${blockIndex}" data-project-id="${projectId}" data-is-subtotal="${isSubtotal}" style="${rowStyle}">
                        <td class="line-num-cell" data-row="${i}" data-block-id="${block.id}" style="background: #f0f0f0; color: #999; text-align: center; font-size: 11px; ${lineNumBorder}">${lineNumber}</td>
                        <td class="text-left ${isSubtotal ? '' : 'editable'}" data-field="code" style="${borderLeft}">${codeDisplay}</td>
                        <td class="text-left editable" data-field="designation" style="${borderTopOnly}">${designationDisplay}</td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="n" style="${borderTopOnly}">${showNOp ? nDisplay : ''}</td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="op" style="${borderTopOnly}">${showNOp ? (row.op || '') : ''}</td>
                        ${lCellHtml}
                        ${totalLCellHtml}
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="larg" style="${borderTopOnly}">${isSubtotal ? '' : largDisplay}</td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="h" style="${borderTopOnly}">${isSubtotal ? '' : hDisplay}</td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="ens" style="${borderTopOnly}">${isSubtotal ? '' : ensDisplay}</td>
                        <td class="${isSubtotal ? (row.isDeduction ? '' : 'col-plus') : (normalRowValPlusDisplay ? 'col-plus' : '')} ${subtotalValPlusClass} ${normalRowValPlusDisplay ? 'calculated-val-cell' : ''}" data-field="valplus" style="${borderTopOnly}">${isSubtotal ? subtotalValPlusDisplay : normalRowValPlusDisplay}</td>
                        <td class="${isSubtotal ? (row.isDeduction ? 'col-moins' : '') : (normalRowValMoinsDisplay ? 'col-moins' : '')} ${subtotalValMoinsClass} ${normalRowValMoinsDisplay ? 'calculated-val-cell' : ''}" data-field="valmoins" style="${borderTopOnly}">${isSubtotal ? subtotalValMoinsDisplay : normalRowValMoinsDisplay}</td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="unit" style="${borderTopOnly}">${isSubtotal ? '' : (row.unit || '')}</td>
                        <td class="col-calculated" data-field="qtetotal" data-row="${i}" style="${borderTopOnly}"></td>
                        <td class="${isSubtotal ? '' : 'editable'}" data-field="pu" style="${borderTopOnly}">${isSubtotal ? '' : puDisplay}</td>
                        <td class="col-calculated" data-field="totalht" style="${borderRight}">${isSubtotal ? '' : formatNumber(totalHT)}</td>
                    </tr>`;
                });
                
                lineNumber++;
                
                // Calculate totals for footer - sum ALL values in Val+ and Val- columns
                // New logic: if row after subtotal has Total L, use (subtotal × totalL) instead
                let totalValPlus = 0;
                let totalValMoins = 0;
                
                block.data.forEach((row, idx) => {
                    // Check if this is a subtotal row
                    let isRowSubtotal = row.isSubtotalRow === true;
                    let rowL = row.l;
                    if (typeof rowL === 'string' && rowL.toLowerCase() === 'ens.') {
                        isRowSubtotal = true;
                    } else if (rowL && typeof rowL === 'object' && rowL.type === 'value' && typeof rowL.value === 'string' && rowL.value.toLowerCase() === 'ens.') {
                        isRowSubtotal = true;
                    }
                    
                    if (isRowSubtotal) {
                        // For subtotal rows, calculate the subtotal value
                        let lastSubtotalIndex = -1;
                        for (let j = idx - 1; j >= 0; j--) {
                            let prevRow = block.data[j];
                            let prevL = prevRow.l;
                            let prevIsSubtotal = prevRow.isSubtotalRow === true;
                            
                            if (!prevIsSubtotal) {
                                if (typeof prevL === 'string' && prevL.toLowerCase() === 'ens.') {
                                    prevIsSubtotal = true;
                                } else if (prevL && typeof prevL === 'object' && prevL.type === 'value' && typeof prevL.value === 'string' && prevL.value.toLowerCase() === 'ens.') {
                                    prevIsSubtotal = true;
                                }
                            }
                            
                            if (prevIsSubtotal) {
                                lastSubtotalIndex = j;
                                break;
                            }
                        }
                        
                        // Sum Total L values in this range
                        let subtotalValue = 0;
                        for (let j = lastSubtotalIndex + 1; j < idx; j++) {
                            let dataRow = block.data[j];
                            if (dataRow.isSubtotalRow) continue;
                            let dataL = dataRow.l;
                            if (typeof dataL === 'string' && dataL.toLowerCase() === 'ens.') continue;
                            if (dataL && typeof dataL === 'object' && dataL.type === 'value' && typeof dataL.value === 'string' && dataL.value.toLowerCase() === 'ens.') continue;
                            
                            let rowTotalL;
                            if (dataRow.totalLForcee) {
                                rowTotalL = getValue(dataRow.totalLForcee, project.variables);
                            } else {
                                rowTotalL = calculateTotalL(dataRow, project.variables);
                            }
                            subtotalValue += rowTotalL;
                        }
                        
                        // Check chain: subtotal → larg → h
                        let nextRow = block.data[idx + 1];
                        let useNextRow = false;
                        let nextLarg = 0;
                        let useNextNextRow = false;
                        let nextNextH = 0;
                        let nextNextRow = null;
                        
                        if (nextRow && !nextRow.isSubtotalRow) {
                            let nextL = nextRow.l;
                            let isNextSubtotal = (typeof nextL === 'string' && nextL.toLowerCase() === 'ens.') ||
                                                 (nextL && typeof nextL === 'object' && nextL.type === 'value' && 
                                                  typeof nextL.value === 'string' && nextL.value.toLowerCase() === 'ens.');
                            
                            if (!isNextSubtotal) {
                                // Check if next row has a value in larg column
                                nextLarg = getValue(nextRow.larg, project.variables);
                                
                                if (nextLarg !== 0) {
                                    useNextRow = true;
                                    
                                    // Check if row after next has h value
                                    nextNextRow = block.data[idx + 2];
                                    if (nextNextRow && !nextNextRow.isSubtotalRow) {
                                        let nextNextL = nextNextRow.l;
                                        let isNextNextSubtotal = (typeof nextNextL === 'string' && nextNextL.toLowerCase() === 'ens.') ||
                                                                 (nextNextL && typeof nextNextL === 'object' && nextNextL.type === 'value' && 
                                                                  typeof nextNextL.value === 'string' && nextNextL.value.toLowerCase() === 'ens.');
                                        
                                        if (!isNextNextSubtotal) {
                                            nextNextH = getValue(nextNextRow.h, project.variables);
                                            if (nextNextH !== 0) {
                                                useNextNextRow = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        if (useNextNextRow) {
                            // Use subtotal × nextLarg × nextNextH, attributed to nextNextRow's isDeduction
                            let resultValue = subtotalValue * nextLarg * nextNextH;
                            if (nextNextRow.isDeduction) {
                                totalValMoins += resultValue;
                            } else {
                                totalValPlus += resultValue;
                            }
                        } else if (useNextRow) {
                            // Use subtotal × nextLarg, attributed to next row's isDeduction
                            let resultValue = subtotalValue * nextLarg;
                            if (nextRow.isDeduction) {
                                totalValMoins += resultValue;
                            } else {
                                totalValPlus += resultValue;
                            }
                        } else {
                            // Use subtotal value directly
                            if (row.isDeduction) {
                                totalValMoins += subtotalValue;
                            } else {
                                totalValPlus += subtotalValue;
                            }
                        }
                    }
                });
                
                // Get footer data from block (or initialize)
                if (!block.footer) {
                    block.footer = {
                        ens: 'Ens.',
                        unit: "",
                        pu: 0
                    };
                }
                
                // Calculate Qté T. = Val+ + Val- (Val- is negative, so effectively Val+ - Val-)
                let footerQteTotal = 0;
                if (block.footer.ens && block.footer.ens.trim() !== '') {
                    footerQteTotal = totalValPlus - totalValMoins;
                }
                
                let footerPU = getValue(block.footer.pu, project.variables);
                let footerTotalHT = footerQteTotal * footerPU;
                
                // Render footer with totals
                html += `
                    <tr class="block-table-footer" data-block-id="${block.id}" data-block-index="${blockIndex}" style="background: #f0f0f0; font-weight: bold;">
                        <td style="background: #f0f0f0; color: #666; text-align: center; font-size: 11px; border-bottom: 1px solid #ccc; border-left: 1px solid #ccc; padding: 4px; position: relative;">
                            <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                                <span>${lineNumber}</span>
                                <button class="btn-delete-block" data-block-id="${block.id}" title="Supprimer ce bloc" style="background: white; border: 1px solid #666; border-radius: 50%; cursor: pointer; color: #333; font-size: 10px; width: 16px; height: 16px; padding: 0; opacity: 0.5; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;">−</button>
                            </div>
                        </td>
                        <td data-field="code" style="background: #f0f0f0; border-bottom: 1px solid #ccc; border-left: 1px solid #ccc;"></td>
                        <td data-field="designation" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="n" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="op" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="l" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="totall" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="larg" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td data-field="h" style="background: #f0f0f0; border-bottom: 1px solid #ccc;"></td>
                        <td class="editable-footer-ens" data-field="ens" data-block-id="${block.id}" style="background: #f0f0f0; text-align: center; border-bottom: 1px solid #ccc; cursor: pointer; position: relative;">${block.footer.ens || ''}</td>
                        <td class="col-plus footer-calculated" data-field="valplus" style="background: #f0f0f0; border-top: 1.5px solid #000; border-bottom: 1px solid #ccc; cursor: pointer;">${formatNumber(totalValPlus)}</td>
                        <td class="col-moins footer-calculated" data-field="valmoins" style="background: #f0f0f0; border-top: 1.5px solid #000; border-bottom: 1px solid #ccc; cursor: pointer;">${formatNumber(-totalValMoins)}</td>
                        <td class="editable-footer" data-field="unit" data-block-id="${block.id}" style="background: #f0f0f0; border-bottom: 1px solid #ccc; cursor: pointer;">${block.footer.unit || ''}</td>
                        <td class="footer-calculated" data-field="qtetotal" style="background: #f0f0f0; border: 1.5px solid #000; cursor: pointer;">${formatNumber(footerQteTotal)}</td>
                        <td class="editable-footer" data-field="pu" data-block-id="${block.id}" style="background: #f0f0f0; border-bottom: 1px solid #ccc; cursor: pointer;">${formatNumber(footerPU, 2)}</td>
                        <td class="footer-calculated" data-field="totalht" style="background: #f0f0f0; border-bottom: 1px solid #ccc; border-right: 1px solid #ccc; cursor: pointer;">${footerTotalHT !== 0 ? formatNumber(footerTotalHT, 2) + ' ' + appSettings.units.defaultCurrency : ''}</td>
                    </tr>`;
            } else {
                lineNumber++;
                // Empty table block
                html += `
                    <tr class="block-row block-table-empty" data-block-id="${block.id}" data-block-index="${blockIndex}">
                        <td style="background: #f0f0f0; color: #999; text-align: center; font-size: 11px; padding: 4px; position: relative;">
                            <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                                <span>${lineNumber}</span>
                                <button class="btn-delete-block" data-block-id="${block.id}" title="Supprimer ce bloc" style="background: white; border: 1px solid #666; border-radius: 50%; cursor: pointer; color: #333; font-size: 10px; width: 16px; height: 16px; padding: 0; opacity: 0.5; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;">−</button>
                            </div>
                        </td>
                        <td colspan="15" style="padding: 10px; text-align: center; color: #999; font-style: italic; cursor: pointer;">
                            Tableau vide - Clic droit pour options
                        </td>
                    </tr>`;
            }
        } else if (block.type === 'canvas') {
            lineNumber++;
            // Render inline canvas block with integrated toolbar
            let canvasData = block.canvasData || {};
            let canvasTitle = canvasData.title || 'Canvas sans titre';
            let canvasWidth = canvasData.width || 800;
            let canvasHeight = canvasData.height || 400;
            
            html += `
                <tr class="block-row block-canvas" data-block-id="${block.id}" data-block-index="${blockIndex}">
                    <td style="background: #f0f0f0; color: #999; text-align: center; font-size: 11px; border-top: 1px solid #9b59b6; vertical-align: top; padding: 4px; position: relative;">
                        <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                            <span>${lineNumber}</span>
                            <button class="btn-delete-block" data-block-id="${block.id}" title="Supprimer ce bloc" style="background: white; border: 1px solid #666; border-radius: 50%; cursor: pointer; color: #333; font-size: 10px; width: 16px; height: 16px; padding: 0; opacity: 0.5; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;">−</button>
                        </div>
                    </td>
                    <td colspan="15" style="padding: 0; border-top: 1px solid #9b59b6; border-bottom: 1px solid #9b59b6;">
                        <div class="canvas-block" style="margin: 0;">
                            <!-- Compact Header -->
                            <div style="background: #9b59b6; color: white; padding: 3px 8px; display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 14px;">🎨</span>
                                    <input type="text" value="${canvasTitle}" 
                                           class="canvas-title-input" 
                                           data-block-id="${block.id}"
                                           style="background: transparent; border: none; color: white; font-weight: bold; font-size: 11px; outline: none; cursor: pointer; padding: 2px 4px;"
                                           readonly
                                           ondblclick="this.readOnly=false; this.select();"
                                           onblur="updateCanvasTitle('${projectId}', '${block.id}', this.value); this.readOnly=true;"
                                           onkeydown="if(event.key==='Enter'){this.blur();}">
                                </div>
                                <span style="font-size: 9px; opacity: 0.7;">📏 Auto-size</span>
                            </div>
                            
                            <!-- Inline Canvas Toolbar -->
                            <div style="background: #ecf0f1; padding: 5px 8px; border-bottom: 1px solid #bdc3c7; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                <div style="display: flex; gap: 2px; border-right: 1px solid #bdc3c7; padding-right: 6px;">
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="pen" title="Crayon" 
                                            style="background: #3498db; color: white; border: 1px solid #2980b9; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">✏️</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="eraser" title="Gomme"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">🧹</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="line" title="Ligne"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">📏</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="rect" title="Rectangle"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">▭</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="circle" title="Cercle"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">⭕</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="arrow" title="Flèche"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">➡️</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="text" title="Texte"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">📝</button>
                                    <button class="inline-canvas-tool" data-block-id="${block.id}" data-tool="select" title="Sélectionner/Déplacer"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">👆</button>
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; border-right: 1px solid #bdc3c7; padding-right: 6px;">
                                    <label style="font-size: 9px;">Couleur:</label>
                                    <input type="color" class="inline-canvas-color" data-block-id="${block.id}" value="#000000" 
                                           style="width: 35px; height: 22px; border: 1px solid #95a5a6; border-radius: 3px; cursor: pointer;">
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; border-right: 1px solid #bdc3c7; padding-right: 6px;">
                                    <label style="font-size: 9px;">Épaisseur:</label>
                                    <input type="range" class="inline-canvas-width" data-block-id="${block.id}" min="1" max="20" value="2" 
                                           style="width: 60px;">
                                    <span class="inline-width-value" data-block-id="${block.id}" style="font-size: 9px; min-width: 20px;">2px</span>
                                </div>
                                <div style="display: flex; gap: 2px;">
                                    <button onclick="clearInlineCanvas('${projectId}', '${block.id}')" title="Effacer"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">🗑️</button>
                                    <button onclick="undoInlineCanvas('${projectId}', '${block.id}')" title="Annuler"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">↶</button>
                                    <button onclick="redoInlineCanvas('${projectId}', '${block.id}')" title="Refaire"
                                            style="background: white; border: 1px solid #95a5a6; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px;">↷</button>
                                    <button onclick="exportCanvasImage('${projectId}', '${block.id}')" title="Exporter PNG"
                                            style="background: #27ae60; color: white; border: 1px solid #229954; padding: 3px 6px; cursor: pointer; border-radius: 3px; font-size: 10px; font-weight: bold;">💾</button>
                                </div>
                            </div>
                            
                            <!-- Canvas Drawing Area - Full width -->
                            <div style="padding: 5px; background: #34495e; overflow: auto;">
                                <div style="position: relative; display: inline-block; min-width: 100%;">
                                    <canvas id="inline-canvas-${block.id}" 
                                            width="${canvasWidth}" 
                                            height="${canvasHeight}"
                                            data-block-id="${block.id}"
                                            style="background: white; border: 1px solid #2c3e50; cursor: crosshair; display: block; width: 100%;">
                                    </canvas>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>`;
        } else if (block.type === 'image') {
            lineNumber++;
            // Render image block with multiple images support
            let imageData = block.imageData || {};
            let blockName = imageData.blockName || 'Images';
            let images = imageData.images || [];
            
            // If old format (single image), convert to array
            if (imageData.src && !imageData.images) {
                images = [{
                    id: 'img_' + Date.now(),
                    name: imageData.name || 'Image',
                    src: imageData.src,
                    x: 10,
                    y: 10,
                    width: imageData.width || 400,
                    originalWidth: imageData.originalWidth,
                    originalHeight: imageData.originalHeight
                }];
                imageData.images = images;
                imageData.blockName = blockName;
            }
            
            // Calculate required height based on tallest image
            let maxHeight = 200; // Minimum height
            images.forEach(img => {
                if (img.originalWidth && img.originalHeight) {
                    let imgHeight = (img.width / img.originalWidth) * img.originalHeight;
                    let totalHeight = img.y + imgHeight + 20; // 20px padding
                    maxHeight = Math.max(maxHeight, totalHeight);
                }
            });
            
            html += `
                <tr class="block-row block-image" data-block-id="${block.id}" data-block-index="${blockIndex}">
                    <td style="background: #f0f0f0; color: #999; text-align: center; font-size: 11px; border-top: 1px solid #ddd; vertical-align: top; padding: 4px; position: relative;">
                        <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                            <span>${lineNumber}</span>
                            <button class="btn-delete-block" data-block-id="${block.id}" title="Supprimer ce bloc" style="background: white; border: 1px solid #666; border-radius: 50%; cursor: pointer; color: #333; font-size: 10px; width: 16px; height: 16px; padding: 0; opacity: 0.5; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;">−</button>
                        </div>
                    </td>
                    <td colspan="15" style="padding: 0; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd;">
                        <div style="margin: 0;">
                            <!-- White Header with "Localisation" and Drawing Tools -->
                            <div style="background: white; padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; flex-wrap: wrap; gap: 8px;">
                                <!-- Left: Title -->
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 13px; font-weight: bold; color: #2c3e50;">📍 Localisation</span>
                                    <span style="font-size: 9px; color: #95a5a6;">(${images.length} image${images.length > 1 ? 's' : ''})</span>
                                </div>
                                
                                <!-- Center: Drawing Tools -->
                                <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="arrow" title="Flèche"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                        ➡️
                                    </button>
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="circle" title="Cercle/Ellipse"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                        ⭕
                                    </button>
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="rect" title="Rectangle"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                        ▭
                                    </button>
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="freehand" title="Main levée"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                        ✏️
                                    </button>
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="eraser" title="Gomme"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                            🧹
                                    </button>
                                    <button class="draw-tool-btn" data-block-id="${block.id}" data-tool="text" title="Texte"
                                            style="background: white; border: 1px solid #bdc3c7; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; transition: all 0.2s;">
                                        📝
                                    </button>
                                    
                                    <div style="width: 1px; height: 20px; background: #ddd; margin: 0 2px;"></div>
                                    
                                    <!-- Line Width -->
                                    <div style="display: flex; align-items: center; gap: 4px;">
                                        <label style="font-size: 10px; color: #7f8c8d;">Trait:</label>
                                        <input type="range" class="draw-line-width" data-block-id="${block.id}" min="1" max="20" value="3" 
                                               style="width: 60px; height: 20px;">
                                        <span class="draw-width-value" data-block-id="${block.id}" style="font-size: 10px; color: #7f8c8d; min-width: 25px;">3px</span>
                                    </div>
                                    
                                    <div style="width: 1px; height: 20px; background: #ddd; margin: 0 2px;"></div>
                                    
                                    <!-- Color with Opacity -->
                                    <div style="display: flex; align-items: center; gap: 4px;">
                                        <label style="font-size: 10px; color: #7f8c8d;">Couleur:</label>
                                        <input type="color" class="draw-color" data-block-id="${block.id}" value="#e74c3c" 
                                               style="width: 35px; height: 24px; border: 1px solid #bdc3c7; border-radius: 3px; cursor: pointer;">
                                        <label style="font-size: 10px; color: #7f8c8d;">Opacité:</label>
                                        <input type="range" class="draw-opacity" data-block-id="${block.id}" min="0" max="100" value="100" 
                                               style="width: 60px; height: 20px;">
                                        <span class="draw-opacity-value" data-block-id="${block.id}" style="font-size: 10px; color: #7f8c8d; min-width: 35px;">100%</span>
                                    </div>
                                </div>
                                
                                <!-- Right: Add Image Button -->
                                <button onclick="addImageToBlock('${projectId}', '${block.id}')" 
                                        style="background: #3498db; border: 1px solid #2980b9; color: white; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 10px; font-weight: bold;">
                                    ➕ Ajouter
                                </button>
                            </div>
                            
                            <!-- Image Container with drag/resize -->
                            <div id="image-container-${block.id}" 
                                 class="image-container"
                                 data-project-id="${projectId}"
                                 data-block-id="${block.id}"
                                 style="position: relative; padding: 10px; background: #f9f9f9; min-height: ${maxHeight}px; height: ${maxHeight}px; overflow: visible; border: 2px dashed #ddd;">
                                ${images.map((img, idx) => `
                                    <div class="draggable-image" 
                                         id="draggable-img-${block.id}-${img.id}"
                                         data-block-id="${block.id}"
                                         data-image-id="${img.id}"
                                         style="position: absolute; left: ${img.x}px; top: ${img.y}px; cursor: move; border: 2px solid transparent; z-index: 1;">
                                        <img src="${img.src}" 
                                             style="width: ${img.width}px; height: auto; display: block; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.2);"
                                             onload="updateImageOriginalDimensions('${projectId}', '${block.id}', '${img.id}', this)">
                                        <!-- Resize handle -->
                                        <div class="resize-handle" 
                                             data-block-id="${block.id}"
                                             data-image-id="${img.id}"
                                             style="position: absolute; bottom: -5px; right: -5px; width: 15px; height: 15px; background: #3498db; border: 2px solid white; border-radius: 50%; cursor: nwse-resize; display: none; z-index: 10;">
                                        </div>
                                        <!-- Delete button -->
                                        <button class="delete-image-btn"
                                                onclick="deleteImageFromBlock('${projectId}', '${block.id}', '${img.id}')"
                                                style="position: absolute; top: -8px; right: -8px; width: 20px; height: 20px; background: #e74c3c; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 1; display: none; font-weight: bold; z-index: 10;">
                                            ×
                                        </button>
                                    </div>
                                `).join('')}
                                
                                <!-- Drawing Canvas Overlay -->
                                <canvas id="draw-canvas-${block.id}" 
                                        class="drawing-canvas"
                                        data-block-id="${block.id}"
                                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 50;">
                                </canvas>
                            </div>
                        </div>
                    </td>
                </tr>`;
        }
    });
    
    html += `</tbody></table>`;
    
    // Ajouter un grand espace vide en bas pour permettre le scroll même avec peu de contenu
    // (150vh pour supporter les écrans en portrait)
    html += `<div class="metre-spacer" style="height: 150vh; min-height: 1200px;"></div>`;
    
    $(`#workspace-${projectId} .zoom-area-${projectId}`).html(html);
    
    // Copy Qté T. values from table footers to their associated file blocks
    $(`#workspace-${projectId} .file-block-qtetotal`).each(function() {
        let $cell = $(this);
        let linkedTableId = $cell.data('linked-table-id');
        if (linkedTableId) {
            // Find the footer of the linked table and get its qtetotal value
            let $footerQteTotal = $(`#workspace-${projectId} .block-table-footer[data-block-id="${linkedTableId}"] td[data-field="qtetotal"]`);
            if ($footerQteTotal.length > 0) {
                $cell.text($footerQteTotal.text());
            }
        }
    });
    
    // Afficher les badges de variables sur les cellules
    addVariableBadgesToCells(projectId);
    
    // Attach events for blocks using event delegation
    $(`#workspace-${projectId} .zoom-area-${projectId}`).off('contextmenu', '.block-row');
    $(`#workspace-${projectId} .zoom-area-${projectId}`).on('contextmenu', '.block-row', function(e) {
        e.preventDefault();
        e.stopPropagation();
        let blockId = $(this).data('block-id');
        console.log('Block context menu triggered for blockId:', blockId);
        showBlockContextMenu(projectId, blockId, e);
        return false;
    });
    
    // Click on block to select it (but not for file-block-cell clicks on block-file rows)
    $(`#workspace-${projectId} .zoom-area-${projectId}`).off('click', '.block-row');
    $(`#workspace-${projectId} .zoom-area-${projectId}`).on('click', '.block-row', function(e) {
        // If clicking on a file-block-cell in a block-file row, don't select the whole block
        // Let the cell click handler manage it
        if ($(this).hasClass('block-file') && $(e.target).closest('.file-block-cell').length > 0) {
            return;
        }
        let blockId = $(this).data('block-id');
        selectBlock(projectId, blockId);
    });
    
    // Attach events for table footer
    $(`#workspace-${projectId} .zoom-area-${projectId}`).off('contextmenu', '.block-table-footer');
    $(`#workspace-${projectId} .zoom-area-${projectId}`).on('contextmenu', '.block-table-footer', function(e) {
        e.preventDefault();
        e.stopPropagation();
        let blockId = $(this).data('block-id');
        console.log('Table footer context menu triggered for blockId:', blockId);
        showBlockContextMenu(projectId, blockId, e);
        return false;
    });
    
    // Attach events for footer Ens. cell (special handling)
    $(`#workspace-${projectId} .editable-footer-ens`).on('mousedown', function(e) {
        e.preventDefault(); // Prevent default to avoid issues
        let $cell = $(this);
        let field = $cell.data('field');
        let blockId = $cell.data('block-id');
        startEditingFooterCell(projectId, this, blockId, field);
    });
    
    // Attach events for other footer editable cells
    $(`#workspace-${projectId} .editable-footer`).on('click', function() {
        if ($(this).hasClass('editing')) return;
        
        let field = $(this).data('field');
        
        // For Unit field in footer, open dropdown immediately
        if (field === 'unit') {
            let $cell = $(this);
            let blockId = $cell.data('block-id');
            startEditingFooterCell(projectId, this, blockId, field);
        } else {
            selectCell(projectId, this);
        }
    });
    
    $(`#workspace-${projectId} .editable-footer`).on('dblclick', function() {
        let $cell = $(this);
        let field = $cell.data('field');
        let blockId = $cell.data('block-id');
        
        // Skip if it's Unit (already handled by click)
        if (field !== 'unit') {
            startEditingFooterCell(projectId, this, blockId, field);
        }
    });
    
    // Enter key or Space to start editing footer cell
    $(`#workspace-${projectId} .editable-footer, #workspace-${projectId} .editable-footer-ens`).off('keydown.edit').on('keydown.edit', function(e) {
        if ($(this).hasClass('editing')) return;
        
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            let $cell = $(this);
            let field = $cell.data('field');
            let blockId = $cell.data('block-id');
            
            // Special handling for Unit with Space - cycle through options without opening menu
            if (e.key === ' ' && field === 'unit') {
                let project = projects[projectId];
                let block = project.currentPoste.blocks.find(b => b.id === blockId);
                if (block && block.footer) {
                    let currentValue = block.footer.unit || '';
                    let units = [''].concat(appSettings.units.customUnits); // Include empty option
                    let currentIndex = units.indexOf(currentValue);
                    let nextIndex = (currentIndex + 1) % units.length;
                    block.footer.unit = units[nextIndex];
                    renderMetreTable(projectId);
                    
                    // Re-select the cell
                    setTimeout(() => {
                        let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
                        let $footerCell = $footerRow.find('td[data-field="unit"]');
                        if ($footerCell.length > 0) {
                            selectCell(projectId, $footerCell[0]);
                        }
                    }, 50);
                }
                return;
            }
            
            startEditingFooterCell(projectId, this, blockId, field);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            let $cell = $(this);
            let field = $cell.data('field');
            let blockId = $cell.data('block-id');
            
            // Delete footer cell content
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === blockId);
            if (block && block.footer) {
                if (field === 'unit') {
                    block.footer[field] = '';
                } else if (field === 'ens') {
                    block.footer[field] = '';
                } else {
                    block.footer[field] = null;
                }
                
                renderMetreTable(projectId);
                
                // Re-select the cell
                setTimeout(() => {
                    let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
                    let $footerCell = $footerRow.find(`td[data-field="${field}"]`);
                    if ($footerCell.length > 0) {
                        selectCell(projectId, $footerCell[0]);
                    }
                }, 50);
            }
        }
    });
    
    // Attach events for table rows (existing code follows...)
    $(`#workspace-${projectId} .metre-table td.editable`).on('dblclick', function() {
        let $cell = $(this);
        let rowIndex = parseInt($cell.closest('tr').data('row'));
        let field = $cell.data('field');
        let pid = $cell.closest('tr').data('project-id');
        startEditingCell(pid, this, rowIndex, field);
    });
    
    // Click on editable cell to select it (or open dropdown for Unit)
    $(`#workspace-${projectId} .metre-table td.editable`).off('click.select').on('click.select', function(e) {
        if ($(this).hasClass('editing')) return; // Don't select if already editing
        
        let $cell = $(this);
        let field = $cell.data('field');
        
        // For Unit field, open dropdown immediately on click
        if (field === 'unit') {
            let $row = $cell.closest('tr');
            let rowIndex = parseInt($row.data('row'));
            let pid = $row.data('project-id');
            let blockId = $row.data('block-id');
            
            let project = projects[pid];
            let block = project.currentPoste.blocks.find(b => b.id === blockId);
            if (block && block.data && block.data[rowIndex]) {
                selectCell(pid, this);
                let currentValue = block.data[rowIndex].unit || '';
                showUnitDropdown(pid, $cell, currentValue, function(selectedValue) {
                    block.data[rowIndex].unit = selectedValue;
                    renderMetreTable(pid);
                }, blockId, rowIndex, field);
            }
            return;
        }
        
        selectCell(projectId, this);
    });
    
    // Click on non-editable cells (calculated columns) to select them (but NOT line numbers)
    $(`#workspace-${projectId} .metre-table td.col-calculated`).off('click.select').on('click.select', function(e) {
        selectCell(projectId, this);
    });
    
    // Click on calculated Val+/Val- cells to select them
    $(`#workspace-${projectId} .metre-table td.calculated-val-cell`).off('click.select').on('click.select', function(e) {
        selectCell(projectId, this);
    });
    
    // Click on footer cells to select them (or open dropdown for Unit)
    $(`#workspace-${projectId} .metre-table td.editable-footer-ens`).off('click.select').on('click.select', function(e) {
        if ($(this).hasClass('editing')) return;
        selectCell(projectId, this);
    });
    
    // Click on footer editable cells (Unit, PU)
    $(`#workspace-${projectId} .metre-table td.editable-footer`).off('click.select').on('click.select', function(e) {
        if ($(this).hasClass('editing')) return;
        
        let $cell = $(this);
        let field = $cell.data('field');
        let blockId = $cell.data('block-id');
        
        // For Unit field in footer, open dropdown immediately on click
        if (field === 'unit') {
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === blockId);
            if (block && block.footer) {
                selectCell(projectId, this);
                let currentValue = block.footer.unit || '';
                showUnitDropdown(projectId, $cell, currentValue, function(selectedValue) {
                    block.footer.unit = selectedValue;
                    renderMetreTable(projectId);
                }, blockId, null, field);
            }
            return;
        }
        
        selectCell(projectId, this);
    });
    
    // Enter key or Space to start editing selected cell (or toggle for Val+/Val-)
    // Special: Enter on larg/h cells navigates diagonally for fast input
    $(`#workspace-${projectId} .metre-table td.editable`).off('keydown.edit').on('keydown.edit', function(e) {
        if ($(this).hasClass('editing')) return; // Already editing
        
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            let $cell = $(this);
            let $row = $cell.closest('tr');
            let rowIndex = parseInt($row.data('row'));
            let field = $cell.data('field');
            let pid = $row.data('project-id');
            let blockId = $row.data('block-id');
            
            // Special handling for Val+/Val- with Space
            if (e.key === ' ' && (field === 'valplus' || field === 'valmoins')) {
                if (!isNaN(rowIndex) && blockId) {
                    toggleValueSign(pid, rowIndex, blockId);
                }
                return;
            }
            
            // Special handling for Unit with Space - cycle through options without opening menu
            if (e.key === ' ' && field === 'unit') {
                let project = projects[pid];
                let block = project.currentPoste.blocks.find(b => b.id === blockId);
                if (block && block.data && block.data[rowIndex]) {
                    let currentValue = block.data[rowIndex].unit || '';
                    let units = [''].concat(appSettings.units.customUnits); // Include empty option
                    let currentIndex = units.indexOf(currentValue);
                    let nextIndex = (currentIndex + 1) % units.length;
                    block.data[rowIndex].unit = units[nextIndex];
                    renderMetreTable(pid);
                    
                    // Re-select the cell
                    setTimeout(() => {
                        let $newRow = $(`#workspace-${pid} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                        let $newCell = $newRow.find('td[data-field="unit"]');
                        if ($newCell.length > 0) {
                            selectCell(pid, $newCell[0]);
                        }
                    }, 50);
                }
                return;
            }
            
            // Special diagonal navigation for larg and h cells (Enter only)
            // larg → h (1 right, 1 down)
            // h → L (data-field="l") on next row - always navigate, never edit
            if (e.key === 'Enter' && (field === 'larg' || field === 'h')) {
                let $allRows = $(`#workspace-${pid} .metre-table tr[data-row]`);
                let currentIdx = $allRows.index($row);
                
                if (currentIdx >= 0 && currentIdx < $allRows.length - 1) {
                    let $nextRow = $allRows.eq(currentIdx + 1);
                    let nextField = (field === 'larg') ? 'h' : 'l'; // larg → h, h → L
                    let $targetCell = $nextRow.find(`td[data-field="${nextField}"]`);
                    
                    if ($targetCell.length > 0) {
                        if ($targetCell.hasClass('ens-cell')) {
                            $(`#workspace-${pid} .metre-table td`).removeClass('selected');
                            $targetCell.addClass('selected').focus();
                            updateSelection(pid);
                        } else {
                            selectCell(pid, $targetCell[0]);
                        }
                        return; // Don't start editing
                    }
                }
                
                // For h field: if no next row, create one and navigate to L
                if (field === 'h') {
                    let project = projects[pid];
                    let block = project.currentPoste.blocks.find(b => b.id === blockId);
                    if (block && block.data) {
                        // Add a new empty row at the end
                        block.data.push(createEmptyRow());
                        
                        // Re-render and select the L cell of the new row
                        renderMetreTable(pid);
                        
                        setTimeout(() => {
                            let newRowIndex = block.data.length - 1;
                            let $newRow = $(`#workspace-${pid} .metre-table tr[data-row="${newRowIndex}"][data-block-id="${blockId}"]`);
                            let $targetCell = $newRow.find('td[data-field="l"]');
                            if ($targetCell.length > 0) {
                                selectCell(pid, $targetCell[0]);
                            }
                        }, 50);
                    }
                    return; // Don't start editing
                }
            }
            
            // Default: start editing
            startEditingCell(pid, this, rowIndex, field);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            let $cell = $(this);
            let rowIndex = parseInt($cell.closest('tr').data('row'));
            let field = $cell.data('field');
            let pid = $cell.closest('tr').data('project-id');
            let blockId = $cell.closest('tr').data('block-id');
            
            // Delete cell content
            if (!isNaN(rowIndex) && blockId) {
                let project = projects[pid];
                let block = project.currentPoste.blocks.find(b => b.id === blockId);
                if (block && block.data && block.data[rowIndex]) {
                    let row = block.data[rowIndex];
                    
                    // Map display field to actual data field
                    let actualField = field;
                    if (field === 'valplus' || field === 'valmoins') {
                        actualField = 'valeurForcee';
                    }
                    
                    // Clear the field
                    if (field === 'code' || field === 'designation' || field === 'op' || field === 'unit') {
                        row[actualField] = '';
                    } else if (field === 'ens') {
                        row[actualField] = null;
                    } else {
                        row[actualField] = null;
                    }
                    
                    renderMetreTable(pid);
                    
                    // Re-select the cell
                    setTimeout(() => {
                        let $newRow = $(`#workspace-${pid} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                        let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                        if ($newCell.length > 0) {
                            selectCell(pid, $newCell[0]);
                        }
                    }, 50);
                }
            }
        }
    });
    
    // Arrow keys for navigation between cells (ALL cells except line numbers)
    $(document).off('keydown.cellnav').on('keydown.cellnav', function(e) {
        // Ignorer si on est en mode sélection de formule
        if (formulaSelectionMode.active) return;
        
        let $focused = $(`#workspace-${projectId} .metre-table td.selected`);
        if ($focused.length === 0) return;
        if ($focused.hasClass('editing')) return; // Don't navigate while editing
        
        let $row = $focused.closest('tr');
        let isFooter = $row.hasClass('block-table-footer');
        let isSubtotal = $row.hasClass('sous-total-row');
        
        // Get all navigable cells in current row (all td with data-field attribute)
        let $allCells = $row.find('td[data-field]');
        let currentIndex = $allCells.index($focused);
        
        // For ens-cell, it might not be in $allCells if selected differently
        if (currentIndex === -1 && $focused.hasClass('ens-cell')) {
            $allCells = $row.find('td[data-field], td.ens-cell');
            currentIndex = $allCells.index($focused);
        }
        
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (currentIndex < $allCells.length - 1) {
                let $nextCell = $allCells.eq(currentIndex + 1);
                if ($nextCell.hasClass('ens-cell')) {
                    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                    $nextCell.addClass('selected').focus();
                    updateSelection(projectId);
                } else {
                    selectCell(projectId, $nextCell[0]);
                }
            } else {
                // Go to first cell of next row (include block-file rows)
                let $nextRow = isFooter ? null : $row.next('tr[data-row], tr.block-table-footer, tr.block-file');
                if ($nextRow && $nextRow.length > 0) {
                    let $firstCell = $nextRow.find('td[data-field]').first();
                    if ($firstCell.length > 0) {
                        if ($firstCell.hasClass('ens-cell')) {
                            $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                            $firstCell.addClass('selected').focus();
                            updateSelection(projectId);
                        } else {
                            selectCell(projectId, $firstCell[0]);
                        }
                    }
                }
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (currentIndex > 0) {
                let $prevCell = $allCells.eq(currentIndex - 1);
                if ($prevCell.hasClass('ens-cell')) {
                    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                    $prevCell.addClass('selected').focus();
                    updateSelection(projectId);
                } else {
                    selectCell(projectId, $prevCell[0]);
                }
            } else {
                // Go to last cell of previous row (include block-file rows)
                let $prevRow = $row.prev('tr[data-row], tr.sous-total-row, tr.block-file');
                if ($prevRow.length > 0) {
                    let $lastCell = $prevRow.find('td[data-field]').last();
                    if ($lastCell.length > 0) {
                        if ($lastCell.hasClass('ens-cell')) {
                            $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                            $lastCell.addClass('selected').focus();
                            updateSelection(projectId);
                        } else {
                            selectCell(projectId, $lastCell[0]);
                        }
                    }
                }
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            
            let field = $focused.data('field');
            
            // Simple navigation: get ALL rows in the table and move to next/prev
            let $allRows = $(`#workspace-${projectId} .metre-table tbody tr`);
            let currentIdx = $allRows.index($row);
            
            if (currentIdx >= 0 && currentIdx < $allRows.length - 1) {
                let $nextRow = $allRows.eq(currentIdx + 1);
                navigateToRow(projectId, $nextRow, field);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            
            let field = $focused.data('field');
            
            // Simple navigation: get ALL rows in the table and move to next/prev
            let $allRows = $(`#workspace-${projectId} .metre-table tbody tr`);
            let currentIdx = $allRows.index($row);
            
            if (currentIdx > 0) {
                let $prevRow = $allRows.eq(currentIdx - 1);
                navigateToRow(projectId, $prevRow, field);
            }
        }
    });
    
    // Keyboard navigation for block headers (file, canvas, image)
    $(`#workspace-${projectId} .metre-table tr.block-file, #workspace-${projectId} .metre-table tr.block-canvas, #workspace-${projectId} .metre-table tr.block-image`).off('keydown.blocknav').on('keydown.blocknav', function(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            
            let $currentRow = $(this);
            let $allRows = $(`#workspace-${projectId} .metre-table tbody tr`);
            let currentIdx = $allRows.index($currentRow);
            
            if (e.key === 'ArrowDown' && currentIdx < $allRows.length - 1) {
                // Going DOWN from a poste/canvas/image
                // Go to the next row, but skip footers of OTHER blocks (not following a data row from same sequence)
                let $nextRow = $allRows.eq(currentIdx + 1);
                
                // If next row is a footer, check if it's "orphaned" (should have been before this block)
                // This happens when the DOM order is: footer-of-previous-table → current-poste
                // In that case, skip the footer and go to the row after
                if ($nextRow.hasClass('block-table-footer')) {
                    // Check if there's another row after this footer
                    let nextNextIdx = currentIdx + 2;
                    if (nextNextIdx < $allRows.length) {
                        let $nextNextRow = $allRows.eq(nextNextIdx);
                        // If the row after footer is a data row or block header, go there instead
                        if ($nextNextRow.attr('data-row') !== undefined || 
                            $nextNextRow.hasClass('block-file') || 
                            $nextNextRow.hasClass('block-canvas') || 
                            $nextNextRow.hasClass('block-image')) {
                            $nextRow = $nextNextRow;
                        }
                    }
                }
                
                navigateToRow(projectId, $nextRow, 'l');
            } else if (e.key === 'ArrowUp' && currentIdx > 0) {
                // Going UP from a poste/canvas/image
                let $prevRow = $allRows.eq(currentIdx - 1);
                
                // If previous row is a data row (not footer), find the footer of its block instead
                if ($prevRow.attr('data-row') !== undefined && !$prevRow.hasClass('block-table-footer')) {
                    let prevBlockId = $prevRow.data('block-id');
                    let $footer = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${prevBlockId}"]`);
                    if ($footer.length > 0) {
                        $prevRow = $footer;
                    }
                }
                
                navigateToRow(projectId, $prevRow, 'l');
            }
        }
    });
    
    // Type to start editing (replaces content)
    $(document).off('keypress.celledit').on('keypress.celledit', function(e) {
        // Ignorer si on est en mode sélection de formule (on édite déjà)
        if (formulaSelectionMode.active) return;
        
        let $focused = $(`#workspace-${projectId} .metre-table td.selected`);
        if ($focused.length === 0) return;
        if ($focused.hasClass('editing')) return;
        if ($focused.hasClass('ens-cell')) return; // ens-cell has its own handler
        if ($focused.hasClass('subtotal-val-cell')) return; // subtotal val cells toggle instead
        
        // Don't trigger on special keys
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        
        // Don't trigger on Enter or Space (handled by keydown.edit)
        if (e.which === 13 || e.which === 32) return;
        
        // Check if cell is editable (not a calculated or footer-calculated cell without editable class)
        let $row = $focused.closest('tr');
        let isSubtotal = $row.data('is-subtotal') === true || $row.data('is-subtotal') === 'true';
        let isFooter = $row.hasClass('block-table-footer');
        let isFileBlock = $row.hasClass('block-file');
        let field = $focused.data('field');
        
        // Handle file-block-cell - allow typing on editable cells
        if (isFileBlock && $focused.hasClass('file-block-cell') && $focused.hasClass('editable')) {
            let char = String.fromCharCode(e.which);
            if (char) {
                e.preventDefault();
                // Trigger the double-click handler with initial value
                startEditingFileBlockCell(projectId, $focused, char);
            }
            return;
        }
        
        // Don't allow typing on non-editable cells
        if ($focused.hasClass('col-calculated') && !$focused.hasClass('editable')) return;
        if ($focused.hasClass('footer-calculated')) return;
        if (isSubtotal && field !== 'valplus' && field !== 'valmoins' && field !== 'designation') return;
        
        // Handle footer PU cell - allow typing
        if (isFooter && field === 'pu' && $focused.hasClass('editable-footer')) {
            let char = String.fromCharCode(e.which);
            if (char) {
                e.preventDefault();
                let blockId = $focused.data('block-id');
                startEditingFooterCell(projectId, $focused[0], blockId, field, char);
            }
            return;
        }
        
        // Start editing with the typed character (replaces content)
        let char = String.fromCharCode(e.which);
        if (char) {
            e.preventDefault();
            let rowIndex = parseInt($row.data('row'));
            let pid = $row.data('project-id');
            startEditingCell(pid, $focused[0], rowIndex, field, char);
        }
    });
    
    // F2 to edit cell content (modify mode - keeps existing content)
    $(document).off('keydown.f2edit').on('keydown.f2edit', function(e) {
        if (e.key !== 'F2') return;
        
        let $focused = $(`#workspace-${projectId} .metre-table td.selected`);
        if ($focused.length === 0) return;
        if ($focused.hasClass('editing')) return;
        if ($focused.hasClass('ens-cell')) return;
        if ($focused.hasClass('subtotal-val-cell')) return;
        
        let $row = $focused.closest('tr');
        let isSubtotal = $row.data('is-subtotal') === true || $row.data('is-subtotal') === 'true';
        let isFooter = $row.hasClass('block-table-footer');
        let field = $focused.data('field');
        
        // Don't allow editing on non-editable cells
        if ($focused.hasClass('col-calculated') && !$focused.hasClass('editable')) return;
        if ($focused.hasClass('footer-calculated')) return;
        if (isSubtotal && field !== 'designation') return;
        
        e.preventDefault();
        let rowIndex = parseInt($row.data('row'));
        let pid = $row.data('project-id');
        
        // Start editing without initial value (keeps existing content)
        startEditingCell(pid, $focused[0], rowIndex, field);
    });
    
    // Paste into selected cell
    $(document).off('paste.cellpaste').on('paste.cellpaste', function(e) {
        let $focused = $(`#workspace-${projectId} .metre-table td.selected`);
        if ($focused.length === 0) return;
        if ($focused.hasClass('editing')) return;
        
        e.preventDefault();
        let pastedText = (e.originalEvent.clipboardData || window.clipboardData).getData('text');
        
        if (pastedText) {
            let rowIndex = parseInt($focused.closest('tr').data('row'));
            let field = $focused.data('field');
            let pid = $focused.closest('tr').data('project-id');
            startEditingCell(pid, $focused[0], rowIndex, field, pastedText);
        }
    });
    
    // Double-click on Val+ or Val- to toggle (excluding footer)
    $(`#workspace-${projectId} .metre-table tbody tr:not(.block-table-footer) td[data-field="valplus"], #workspace-${projectId} .metre-table tbody tr:not(.block-table-footer) td[data-field="valmoins"]`).on('dblclick', function() {
        let $cell = $(this);
        let $row = $cell.closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let pid = $row.data('project-id');
        
        if (!isNaN(rowIndex) && blockId) {
            toggleValueSign(pid, rowIndex, blockId);
        }
    });
    
    // Click on variable badge to flash cells with that variable
    $(`#workspace-${projectId} .variable-badge`).on('click', function(e) {
        e.stopPropagation();
        let varName = $(this).data('var-name');
        let pid = $(this).data('project-id');
        flashVariableCell(pid, varName);
    });
    
    // Click on delete block button
    $(`#workspace-${projectId} .btn-delete-block`).off('click');
    $(`#workspace-${projectId} .btn-delete-block`).on('click', function(e) {
        e.stopPropagation();
        let blockId = $(this).data('block-id');
        deleteBlock(projectId, blockId);
    });
    
    // Note: Click selection for file-block-cell is handled by the general mousedown handler on td[data-field]
    // Just need to stop propagation to prevent block-row selection
    $(`#workspace-${projectId} .file-block-cell`).off('click.stopblock').on('click.stopblock', function(e) {
        e.stopPropagation(); // Prevent block-row click handler from selecting whole block
    });
    
    // Double-click on editable file block cells (fileCode and fileName) to edit
    $(`#workspace-${projectId} .file-block-cell.editable`).off('dblclick').on('dblclick', function(e) {
        e.stopPropagation();
        if ($(this).hasClass('editing')) return;
        
        let $cell = $(this);
        let blockId = $cell.data('block-id');
        let field = $cell.data('field');
        
        let project = projects[projectId];
        let block = project.currentPoste.blocks.find(b => b.id === blockId);
        if (!block || block.type !== 'file') return;
        
        // Get current value
        let currentValue = block[field] || '';
        
        // Start editing
        $cell.addClass('editing');
        
        // For fileName (designation)
        if (field === 'fileName') {
            let input = $('<input type="text" style="width: 100%; font-size: 12px; font-weight: bold;">').val(currentValue);
            $cell.html(input);
            input.focus().select();
            
            let saveAndExit = function() {
                let newValue = input.val().trim();
                $cell.removeClass('editing');
                block[field] = newValue;
                renderMetreTable(projectId);
                updateTreeContent(projectId);
            };
            
            input.on('blur', saveAndExit);
            input.on('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    saveAndExit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    $cell.removeClass('editing');
                    renderMetreTable(projectId);
                } else if (ev.key === 'Tab') {
                    ev.preventDefault();
                    saveAndExit();
                    // Move to next/prev cell
                    setTimeout(() => {
                        let $row = $cell.closest('tr');
                        let $cells = $row.find('td.file-block-cell');
                        let currentIdx = $cells.index($cell);
                        let $nextCell = ev.shiftKey ? $cells.eq(currentIdx - 1) : $cells.eq(currentIdx + 1);
                        if ($nextCell.length) {
                            selectCell(projectId, $nextCell[0]);
                        }
                    }, 50);
                }
            });
        } else if (field === 'fileCode') {
            // For fileCode - keep the icon, just edit the text part
            let input = $('<input type="text" style="width: calc(100% - 24px); margin-left: 4px;">').val(currentValue);
            $cell.html('<span style="font-size: 14px;">📝</span>');
            $cell.append(input);
            input.focus().select();
            
            let saveAndExit = function() {
                let newValue = input.val().trim();
                $cell.removeClass('editing');
                block[field] = newValue;
                renderMetreTable(projectId);
                updateTreeContent(projectId); // Update tree to show new Code
            };
            
            input.on('blur', saveAndExit);
            input.on('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    saveAndExit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    $cell.removeClass('editing');
                    renderMetreTable(projectId);
                } else if (ev.key === 'Tab') {
                    ev.preventDefault();
                    saveAndExit();
                    // Move to next/prev cell
                    setTimeout(() => {
                        let $row = $cell.closest('tr');
                        let $cells = $row.find('td.file-block-cell');
                        let currentIdx = $cells.index($cell);
                        let $nextCell = ev.shiftKey ? $cells.eq(currentIdx - 1) : $cells.eq(currentIdx + 1);
                        if ($nextCell.length) {
                            selectCell(projectId, $nextCell[0]);
                        }
                    }, 50);
                }
            });
        }
    });
    
    // Fonction pour démarrer l'édition d'une cellule file-block en tapant directement
    function startEditingFileBlockCell(projectId, $cell, initialValue) {
        if ($cell.hasClass('editing')) return;
        
        let blockId = $cell.data('block-id');
        let field = $cell.data('field');
        
        let project = projects[projectId];
        let block = project.currentPoste.blocks.find(b => b.id === blockId);
        if (!block || block.type !== 'file') return;
        
        // Start editing
        $cell.addClass('editing');
        
        // For fileName (designation)
        if (field === 'fileName') {
            let input = $('<input type="text" style="width: 100%; font-size: 12px; font-weight: bold;">').val(initialValue || '');
            $cell.html(input);
            input.focus();
            // Position cursor at end
            let len = input.val().length;
            input[0].setSelectionRange(len, len);
            
            let saveAndExit = function() {
                let newValue = input.val().trim();
                $cell.removeClass('editing');
                block[field] = newValue;
                renderMetreTable(projectId);
                updateTreeContent(projectId);
            };
            
            input.on('blur', saveAndExit);
            input.on('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    saveAndExit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    $cell.removeClass('editing');
                    renderMetreTable(projectId);
                } else if (ev.key === 'Tab') {
                    ev.preventDefault();
                    saveAndExit();
                }
            });
        } else if (field === 'fileCode') {
            // For fileCode - keep the icon, just edit the text part
            let input = $('<input type="text" style="width: calc(100% - 24px); margin-left: 4px;">').val(initialValue || '');
            $cell.html('<span style="font-size: 14px;">📝</span>');
            $cell.append(input);
            input.focus();
            // Position cursor at end
            let len = input.val().length;
            input[0].setSelectionRange(len, len);
            
            let saveAndExit = function() {
                let newValue = input.val().trim();
                $cell.removeClass('editing');
                block[field] = newValue;
                renderMetreTable(projectId);
                updateTreeContent(projectId);
            };
            
            input.on('blur', saveAndExit);
            input.on('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    saveAndExit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    $cell.removeClass('editing');
                    renderMetreTable(projectId);
                } else if (ev.key === 'Tab') {
                    ev.preventDefault();
                    saveAndExit();
                }
            });
        }
    }
    
    // Handle paste on file block cells
    $(`#workspace-${projectId} .file-block-cell.editable`).off('paste').on('paste', function(pasteEvent) {
        let $cell = $(this);
        if ($cell.hasClass('editing')) return; // Let the input handle paste
        
        pasteEvent.preventDefault();
        pasteEvent.stopPropagation();
        
        let blockId = $cell.data('block-id');
        let field = $cell.data('field');
        let pastedText = (pasteEvent.originalEvent.clipboardData || window.clipboardData).getData('text');
        
        if (pastedText && pastedText.trim()) {
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === blockId);
            if (block && block.type === 'file') {
                block[field] = pastedText.trim();
                renderMetreTable(projectId);
                if (field === 'fileName') {
                    updateTreeContent(projectId);
                }
            }
        }
    });
    
    // Context menu on cells (pour les variables)
    $(`#workspace-${projectId} .metre-table td[data-field]`).on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        let $cell = $(this);
        let field = $cell.data('field');
        let $row = $cell.closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let pid = $row.data('project-id') || projectId;
        
        // Pour le footer, rowIndex sera -1 ou undefined
        if ($row.hasClass('block-table-footer')) {
            rowIndex = 'footer';
            blockId = $row.data('block-id');
        }
        
        // Afficher le menu contextuel de cellule pour les variables
        if (field && blockId) {
            showCellContextMenu(pid, e, blockId, rowIndex, field);
        }
        
        return false;
    });
    
    // Context menu on row number cells (pour les actions de ligne)
    $(`#workspace-${projectId} .metre-table .line-num-cell`).on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        let $row = $(this).closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let pid = $row.data('project-id') || projectId;
        
        if (!isNaN(rowIndex) && blockId) {
            showTableContextMenu(pid, e, rowIndex, blockId);
        }
        
        return false;
    });
    
    // ========== SELECTION MULTIPLE (Rectangle) ==========
    let selectionState = {
        isSelecting: false,
        startCell: null,
        startRow: null,
        startCol: null,
        $selectableRows: null
    };
    
    // Get cell position (row index and column index) relative to selectable rows only
    function getCellPosition($cell, $table) {
        let $row = $cell.closest('tr');
        let $allCells = $row.find('td[data-field]');
        let colIndex = $allCells.index($cell);
        
        // Get all selectable rows (data rows, subtotal rows, footer, block-file)
        let $selectableRows = $table.find('tbody tr[data-row], tbody tr.block-table-footer, tbody tr.block-file');
        let rowIndex = $selectableRows.index($row);
        
        return { row: rowIndex, col: colIndex, $row: $row };
    }
    
    // Select rectangle of cells
    function selectRectangle(startRow, startCol, endRow, endCol, $selectableRows) {
        let minRow = Math.min(startRow, endRow);
        let maxRow = Math.max(startRow, endRow);
        let minCol = Math.min(startCol, endCol);
        let maxCol = Math.max(startCol, endCol);
        
        $selectableRows.each(function(rowIdx) {
            if (rowIdx >= minRow && rowIdx <= maxRow) {
                let $cells = $(this).find('td[data-field]');
                $cells.each(function(colIdx) {
                    if (colIdx >= minCol && colIdx <= maxCol) {
                        $(this).addClass('selected');
                    }
                });
            }
        });
    }
    
    // Selection support - all cells with data-field (excludes line numbers)
    $(`#workspace-${projectId} .metre-table td[data-field]`).on('mousedown', function(e) {
        if ($(this).hasClass('editing')) return;
        if ($(e.target).hasClass('variable-badge')) return; // Don't select when clicking badge
        if ($(this).hasClass('ens-cell')) return; // ens-cell has its own handler
        
        let $cell = $(this);
        let $table = $(`#workspace-${projectId} .metre-table`);
        // Include block-file rows in selectable rows
        let $selectableRows = $table.find('tbody tr[data-row], tbody tr.block-table-footer, tbody tr.block-file');
        let pos = getCellPosition($cell, $table);
        
        // Ctrl+click: toggle selection without clearing others
        if (e.ctrlKey || e.metaKey) {
            $cell.toggleClass('selected');
            // Remove block-selected when selecting individual cells
            $(`#workspace-${projectId} .block-row`).removeClass('block-selected');
            updateSelection(projectId);
            return;
        }
        
        // Start rectangle selection
        $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
        $(`#workspace-${projectId} .block-row`).removeClass('block-selected');
        $cell.addClass('selected');
        
        selectionState.isSelecting = true;
        selectionState.startCell = $cell;
        selectionState.startRow = pos.row;
        selectionState.startCol = pos.col;
        selectionState.$selectableRows = $selectableRows;
        
        updateSelection(projectId);
    });
    
    // Mouse move for rectangle selection
    $(`#workspace-${projectId} .metre-table`).on('mousemove', 'td[data-field]', function(e) {
        if (!selectionState.isSelecting) return;
        if ($(this).hasClass('ens-cell')) return;
        
        let $cell = $(this);
        let $table = $(`#workspace-${projectId} .metre-table`);
        let pos = getCellPosition($cell, $table);
        let endRow = pos.row;
        let endCol = pos.col;
        
        // Clear previous selection and select rectangle
        $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
        
        selectRectangle(selectionState.startRow, selectionState.startCol, endRow, endCol, selectionState.$selectableRows);
        
        updateSelection(projectId);
    });
    
    // Mouse up to end selection
    $(document).on('mouseup.selection' + projectId, function(e) {
        if (selectionState.isSelecting) {
            selectionState.isSelecting = false;
            selectionState.startCell = null;
            selectionState.$selectableRows = null;
        }
    });
    
    // Double-click on metre title to rename
    $(`#workspace-${projectId} .metre-title-display-table`).on('dblclick', function() {
        renameCurrentPosteFromMetreHeader(projectId);
    });
    
    // Context menu on metre title
    $(`#workspace-${projectId} .metre-title-display-table`).on('contextmenu', function(e) {
        e.preventDefault();
        showMetreTitleContextMenu(projectId, e);
        return false;
    });
    
    // ========== SOUS-TOTAL: Events for ens. cell ==========
    // Single click on ens. cell to select it only
    $(`#workspace-${projectId} .metre-table td.ens-cell`).on('mousedown', function(e) {
        e.preventDefault();
        
        // Ctrl+click: toggle selection
        if (e.ctrlKey || e.metaKey) {
            $(this).toggleClass('selected');
        } else {
            $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
            $(this).addClass('selected');
        }
        
        $(this).focus();
        updateSelection(projectId);
    });
    
    // Double-click on ens. cell OR Space/Enter to insert a row above subtotal
    $(`#workspace-${projectId} .metre-table td.ens-cell`).on('dblclick', function(e) {
        e.preventDefault();
        e.stopPropagation();
        let $row = $(this).closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let pid = $row.data('project-id');
        
        if (!isNaN(rowIndex) && blockId) {
            insertRowAboveSubtotal(pid, blockId, rowIndex);
        }
    });
    
    // ========== SOUS-TOTAL: Toggle Val+/Val- with keyboard ==========
    // Keyboard (Space) on subtotal Val+/Val- cell to toggle
    $(`#workspace-${projectId} .metre-table td.subtotal-val-cell`).on('keydown', function(e) {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            let $row = $(this).closest('tr');
            let rowIndex = parseInt($row.data('row'));
            let blockId = $row.data('block-id');
            let pid = $row.data('project-id');
            
            if (!isNaN(rowIndex) && blockId) {
                toggleValueSign(pid, rowIndex, blockId);
            }
        }
    });
    
    // Keyboard (Space) on calculated Val+/Val- cell (after subtotal with l or h) to toggle
    $(`#workspace-${projectId} .metre-table td.calculated-val-cell`).on('keydown', function(e) {
        if (e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            let $row = $(this).closest('tr');
            let rowIndex = parseInt($row.data('row'));
            let blockId = $row.data('block-id');
            let pid = $row.data('project-id');
            
            if (!isNaN(rowIndex) && blockId) {
                toggleValueSign(pid, rowIndex, blockId);
            }
        }
    });
    
    // Keyboard events for ens. cell (Space, Enter, or typing)
    $(`#workspace-${projectId} .metre-table td.ens-cell`).on('keydown', function(e) {
        let $row = $(this).closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let pid = $row.data('project-id');
        
        if (e.key === ' ') {
            // Space: insert row above subtotal
            e.preventDefault();
            e.stopPropagation();
            if (!isNaN(rowIndex) && blockId) {
                insertRowAboveSubtotal(pid, blockId, rowIndex);
            }
        } else if (e.key === 'Enter') {
            // Enter: go to column l (larg) one row below
            e.preventDefault();
            e.stopPropagation();
            
            // Find next row after this subtotal row
            let $allRows = $(`#workspace-${pid} .metre-table tr[data-row]`);
            let currentIdx = $allRows.index($row);
            
            if (currentIdx >= 0 && currentIdx < $allRows.length - 1) {
                let $nextRow = $allRows.eq(currentIdx + 1);
                // Go to larg column (l minuscule)
                let $targetCell = $nextRow.find('td[data-field="larg"]');
                if ($targetCell.length > 0) {
                    if ($targetCell.hasClass('ens-cell')) {
                        $(`#workspace-${pid} .metre-table td`).removeClass('selected');
                        $targetCell.addClass('selected').focus();
                        updateSelection(pid);
                    } else {
                        selectCell(pid, $targetCell[0]);
                    }
                }
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // User started typing - insert row and start editing with the typed character
            e.preventDefault();
            e.stopPropagation();
            if (!isNaN(rowIndex) && blockId) {
                insertRowAboveSubtotal(pid, blockId, rowIndex, e.key);
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // Allow arrow key navigation
            e.preventDefault();
            let $allRows = $(`#workspace-${projectId} .metre-table tr[data-row]`);
            let currentRowIdx = $allRows.index($row);
            
            if (e.key === 'ArrowUp' && currentRowIdx > 0) {
                let $prevRow = $allRows.eq(currentRowIdx - 1);
                let $prevCell = $prevRow.find('td[data-field="l"]');
                if ($prevCell.length > 0) {
                    if ($prevCell.hasClass('ens-cell')) {
                        $prevCell.focus();
                    } else {
                        selectCell(pid, $prevCell[0]);
                    }
                }
            } else if (e.key === 'ArrowDown' && currentRowIdx < $allRows.length - 1) {
                let $nextRow = $allRows.eq(currentRowIdx + 1);
                let $nextCell = $nextRow.find('td[data-field="l"]');
                if ($nextCell.length > 0) {
                    if ($nextCell.hasClass('ens-cell')) {
                        $nextCell.focus();
                    } else {
                        selectCell(pid, $nextCell[0]);
                    }
                }
            } else if (e.key === 'ArrowLeft') {
                let $prevCell = $(this).prev('td');
                if ($prevCell.length > 0 && $prevCell.hasClass('editable')) {
                    selectCell(pid, $prevCell[0]);
                }
            } else if (e.key === 'ArrowRight') {
                let $nextCell = $(this).next('td');
                if ($nextCell.length > 0) {
                    selectCell(pid, $nextCell[0]);
                }
            }
        }
    });
    
    // Initialize inline canvas blocks
    initializeInlineCanvases(projectId);
    
    // Initialize draggable images
    initializeDraggableImages(projectId);
    
    // Initialize drawing tools
    initializeDrawingTools(projectId);
    
    // Initialize column resizing
    initializeColumnResizing(projectId);
    
    // Initialize row height menu
    initializeRowHeightMenu(projectId);
    
    // Apply saved row heights
    applyRowHeights(projectId);
    
    // Appliquer le zoom sauvegardé
    applyTableZoom(projectId);
    
    // Mettre à jour les variables après le rendu du tableau
    setTimeout(() => {
        // Mettre à jour les valeurs de toutes les variables depuis le DOM
        updateAllVariableValues(projectId);
        
        // Rafraîchir le panneau des variables
        if ($(`.variables-panel-${projectId}`).length > 0) {
            renderVariables(projectId);
        }
        
        // Si des variables existent et qu'on n'est pas déjà dans un second rendu, 
        // faire un second rendu pour propager les changements
        if (project.variables && Object.keys(project.variables).length > 0 && !project._isSecondRender) {
            project._isSecondRender = true;
            setTimeout(() => {
                renderMetreTable(projectId);
                // Réinitialiser le flag après le second rendu
                setTimeout(() => {
                    project._isSecondRender = false;
                }, 20);
            }, 5);
        }
    }, 10);
}

// ========== COLUMN RESIZING ==========
function initializeColumnResizing(projectId) {
    let project = projects[projectId];
    let $table = $(`#workspace-${projectId} .metre-table`);
    
    if ($table.length === 0) return;
    
    // Variables pour le drag
    let isResizing = false;
    let currentCol = null;
    let startX = 0;
    let startWidth = 0;
    let $resizeLine = null;
    
    // Gestionnaire de mousedown sur les resizers
    $table.find('.col-resizer').off('mousedown').on('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        currentCol = $(this).data('col');
        startX = e.pageX;
        
        let $th = $(this).closest('th');
        startWidth = $th.outerWidth();
        
        $(this).addClass('resizing');
        
        // Créer une ligne visuelle
        $resizeLine = $('<div class="resize-line"></div>');
        $resizeLine.css('left', e.pageX + 'px');
        $('body').append($resizeLine);
        
        // Empêcher la sélection de texte
        $('body').css('user-select', 'none');
    });
    
    // Gestionnaire de mousemove global
    $(document).off('mousemove.colresize').on('mousemove.colresize', function(e) {
        if (!isResizing) return;
        
        // Déplacer la ligne visuelle
        if ($resizeLine) {
            $resizeLine.css('left', e.pageX + 'px');
        }
    });
    
    // Gestionnaire de mouseup global
    $(document).off('mouseup.colresize').on('mouseup.colresize', function(e) {
        if (!isResizing) return;
        
        isResizing = false;
        
        // Calculer la nouvelle largeur
        let diff = e.pageX - startX;
        let newWidth = Math.max(1, startWidth + diff);
        
        // Appliquer la nouvelle largeur
        let $th = $table.find(`th[data-col="${currentCol}"]`);
        $th.css('width', newWidth + 'px');
        $th.find('.col-resizer').removeClass('resizing');
        
        // Sauvegarder la largeur
        if (!project.columnWidths) {
            project.columnWidths = {};
        }
        project.columnWidths[currentCol] = newWidth;
        
        // Supprimer la ligne visuelle
        if ($resizeLine) {
            $resizeLine.remove();
            $resizeLine = null;
        }
        
        // Réactiver la sélection de texte
        $('body').css('user-select', '');
        
        currentCol = null;
        
        // Sauvegarder
        saveToLocalStorage();
    });
    
    // Menu contextuel sur clic droit sur les en-têtes
    $table.find('th[data-col]').off('contextmenu').on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        let col = $(this).data('col');
        let $th = $(this);
        
        showColumnContextMenu(projectId, col, $th, e);
        
        return false;
    });
}

// Afficher le menu contextuel pour les colonnes
function showColumnContextMenu(projectId, col, $th, e) {
    // Fermer tout menu existant
    $('.column-context-menu').remove();
    
    let currentWidth = $th.outerWidth();
    let colName = $th.text().replace(/\s+/g, ' ').trim();
    
    let $menu = $(`
        <div class="column-context-menu">
            <div class="column-context-menu-item" data-action="width">
                📏 Largeur de colonne...
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="auto">
                ↔️ Ajuster automatiquement
            </div>
            <div class="column-context-menu-item" data-action="default">
                ↩️ Largeur par défaut
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="all-default">
                🔄 Réinitialiser toutes les colonnes
            </div>
        </div>
    `);
    
    // Positionner le menu
    $menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append($menu);
    
    // Gestionnaires d'actions
    $menu.find('[data-action="width"]').on('click', function() {
        $menu.remove();
        showColumnWidthDialog(projectId, col, $th, currentWidth);
    });
    
    $menu.find('[data-action="auto"]').on('click', function() {
        $menu.remove();
        autoFitColumn(projectId, col, $th);
    });
    
    $menu.find('[data-action="default"]').on('click', function() {
        $menu.remove();
        resetColumnToDefault(projectId, col, $th);
    });
    
    $menu.find('[data-action="all-default"]').on('click', function() {
        $menu.remove();
        resetAllColumns(projectId);
    });
    
    // Fermer le menu au clic ailleurs
    setTimeout(() => {
        $(document).one('click', function() {
            $menu.remove();
        });
    }, 10);
}

// Dialogue pour définir la largeur de colonne
function showColumnWidthDialog(projectId, col, $th, currentWidth) {
    let colName = $th.text().replace(/\s+/g, ' ').trim();
    
    let html = `
        <div class="dialog-title">Largeur de colonne - ${colName}</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Largeur (en pixels) :</label>
                <input type="number" id="inputColWidth" value="${Math.round(currentWidth)}" min="1" style="width: 100px;">
                <span style="color: #666; font-size: 11px; margin-left: 10px;">px</span>
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="applyColumnWidth('${projectId}', '${col}')">Appliquer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    $('#inputColWidth').focus().select();
    
    // Permettre de valider avec Entrée
    $('#inputColWidth').on('keydown', function(e) {
        if (e.key === 'Enter') {
            applyColumnWidth(projectId, col);
        }
    });
}

// Appliquer la largeur de colonne depuis le dialogue
function applyColumnWidth(projectId, col) {
    let newWidth = parseInt($('#inputColWidth').val());
    
    if (isNaN(newWidth) || newWidth < 1) {
        newWidth = 1;
    }
    
    let project = projects[projectId];
    let $th = $(`#workspace-${projectId} .metre-table th[data-col="${col}"]`);
    
    $th.css('width', newWidth + 'px');
    
    if (!project.columnWidths) {
        project.columnWidths = {};
    }
    project.columnWidths[col] = newWidth;
    
    closeDialog();
    saveToLocalStorage();
}

// Ajuster automatiquement la largeur d'une colonne
function autoFitColumn(projectId, col, $th) {
    // Créer un élément temporaire pour mesurer le contenu
    let maxWidth = 50;
    
    $(`#workspace-${projectId} .metre-table td[data-field="${col}"], #workspace-${projectId} .metre-table td[data-field="${col.replace('total', '')}"]`).each(function() {
        let $temp = $('<span>').css({
            'position': 'absolute',
            'visibility': 'hidden',
            'white-space': 'nowrap',
            'font-size': '12px'
        }).text($(this).text());
        $('body').append($temp);
        let width = $temp.width() + 20;
        $temp.remove();
        if (width > maxWidth) maxWidth = width;
    });
    
    // Inclure aussi l'en-tête
    let headerWidth = $th.text().length * 8 + 30;
    if (headerWidth > maxWidth) maxWidth = headerWidth;
    
    maxWidth = Math.min(maxWidth, 300);
    
    let project = projects[projectId];
    $th.css('width', maxWidth + 'px');
    
    if (!project.columnWidths) {
        project.columnWidths = {};
    }
    project.columnWidths[col] = maxWidth;
    
    saveToLocalStorage();
}

// Réinitialiser une colonne à sa largeur par défaut
function resetColumnToDefault(projectId, col, $th) {
    let defaultWidths = {
        'num': 40, 'code': 60, 'designation': 180, 'n': 40, 'op': 40,
        'l': 60, 'totall': 70, 'larg': 50, 'h': 50, 'ens': 50,
        'valplus': 70, 'valmoins': 70, 'unit': 50, 'qtetotal': 70, 'pu': 60, 'totalht': 80
    };
    
    let defaultWidth = defaultWidths[col] || 60;
    let project = projects[projectId];
    
    $th.css('width', defaultWidth + 'px');
    
    if (project.columnWidths) {
        delete project.columnWidths[col];
    }
    
    saveToLocalStorage();
}

// Réinitialiser toutes les colonnes
function resetAllColumns(projectId) {
    let project = projects[projectId];
    project.columnWidths = {};
    
    renderMetreTable(projectId);
    saveToLocalStorage();
}

// ========== ROW HEIGHT MANAGEMENT ==========
function initializeRowHeightMenu(projectId) {
    let $table = $(`#workspace-${projectId} .metre-table`);
    
    if ($table.length === 0) return;
    
    // Menu contextuel sur clic droit sur les cellules de numéro de ligne
    $table.find('.line-num-cell').off('contextmenu').on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        let rowIndex = $(this).data('row');
        let blockId = $(this).data('block-id');
        let $row = $(this).closest('tr');
        
        showRowHeightContextMenu(projectId, $row, rowIndex, blockId, e);
        
        return false;
    });
    
    // Menu contextuel sur clic droit sur l'en-tête # (pour toutes les lignes)
    $table.find('th[data-col="num"]').off('contextmenu').on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        showAllRowsHeightContextMenu(projectId, e);
        
        return false;
    });
}

// Menu contextuel pour une ligne spécifique
function showRowHeightContextMenu(projectId, $row, rowIndex, blockId, e) {
    // Fermer tout menu existant
    $('.column-context-menu, .row-context-menu').remove();
    
    let currentHeight = $row.height();
    
    let $menu = $(`
        <div class="row-context-menu column-context-menu">
            <div class="column-context-menu-item" data-action="height">
                📏 Hauteur de cette ligne...
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="small">
                ▬ Petite (18px)
            </div>
            <div class="column-context-menu-item" data-action="medium">
                ▬ Normale (22px)
            </div>
            <div class="column-context-menu-item" data-action="large">
                ▬ Grande (30px)
            </div>
            <div class="column-context-menu-item" data-action="xlarge">
                ▬ Très grande (40px)
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="table-height" style="font-weight: bold;">
                📊 Toutes les lignes du tableau...
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="default">
                ↩️ Hauteur par défaut
            </div>
        </div>
    `);
    
    // Positionner le menu
    $menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append($menu);
    
    // Gestionnaires d'actions
    $menu.find('[data-action="height"]').on('click', function() {
        $menu.remove();
        showRowHeightDialog(projectId, rowIndex, blockId, currentHeight);
    });
    
    $menu.find('[data-action="small"]').on('click', function() {
        $menu.remove();
        setRowHeight(projectId, rowIndex, blockId, 18);
    });
    
    $menu.find('[data-action="medium"]').on('click', function() {
        $menu.remove();
        setRowHeight(projectId, rowIndex, blockId, 22);
    });
    
    $menu.find('[data-action="large"]').on('click', function() {
        $menu.remove();
        setRowHeight(projectId, rowIndex, blockId, 30);
    });
    
    $menu.find('[data-action="xlarge"]').on('click', function() {
        $menu.remove();
        setRowHeight(projectId, rowIndex, blockId, 40);
    });
    
    $menu.find('[data-action="table-height"]').on('click', function() {
        $menu.remove();
        showTableRowsHeightContextMenu(projectId, blockId, currentHeight, e);
    });
    
    $menu.find('[data-action="default"]').on('click', function() {
        $menu.remove();
        setRowHeight(projectId, rowIndex, blockId, null);
    });
    
    // Fermer le menu au clic ailleurs
    setTimeout(() => {
        $(document).one('click', function() {
            $menu.remove();
        });
    }, 10);
}

// Menu contextuel pour toutes les lignes (clic sur en-tête #)
function showAllRowsHeightContextMenu(projectId, e) {
    // Fermer tout menu existant
    $('.column-context-menu, .row-context-menu').remove();
    
    let project = projects[projectId];
    let currentHeight = project.defaultRowHeight || 18;
    
    let $menu = $(`
        <div class="row-context-menu column-context-menu">
            <div class="column-context-menu-item" data-action="height-all">
                📏 Hauteur de toutes les lignes...
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="small-all">
                ▬ Petite (18px)
            </div>
            <div class="column-context-menu-item" data-action="medium-all">
                ▬ Normale (22px)
            </div>
            <div class="column-context-menu-item" data-action="large-all">
                ▬ Grande (30px)
            </div>
            <div class="column-context-menu-item" data-action="xlarge-all">
                ▬ Très grande (40px)
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="reset-all">
                🔄 Réinitialiser toutes les hauteurs
            </div>
        </div>
    `);
    
    // Positionner le menu
    $menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append($menu);
    
    // Gestionnaires d'actions
    $menu.find('[data-action="height-all"]').on('click', function() {
        $menu.remove();
        showAllRowsHeightDialog(projectId, currentHeight);
    });
    
    $menu.find('[data-action="small-all"]').on('click', function() {
        $menu.remove();
        setAllRowsHeight(projectId, 18);
    });
    
    $menu.find('[data-action="medium-all"]').on('click', function() {
        $menu.remove();
        setAllRowsHeight(projectId, 22);
    });
    
    $menu.find('[data-action="large-all"]').on('click', function() {
        $menu.remove();
        setAllRowsHeight(projectId, 30);
    });
    
    $menu.find('[data-action="xlarge-all"]').on('click', function() {
        $menu.remove();
        setAllRowsHeight(projectId, 40);
    });
    
    $menu.find('[data-action="reset-all"]').on('click', function() {
        $menu.remove();
        resetAllRowsHeight(projectId);
    });
    
    // Fermer le menu au clic ailleurs
    setTimeout(() => {
        $(document).one('click', function() {
            $menu.remove();
        });
    }, 10);
}

// Menu contextuel pour toutes les lignes d'un tableau spécifique
function showTableRowsHeightContextMenu(projectId, blockId, currentHeight, e) {
    // Fermer tout menu existant
    $('.column-context-menu, .row-context-menu').remove();
    
    let $menu = $(`
        <div class="row-context-menu column-context-menu">
            <div class="column-context-menu-item" data-action="table-height-custom">
                📏 Hauteur personnalisée...
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="table-small">
                ▬ Petite (18px)
            </div>
            <div class="column-context-menu-item" data-action="table-medium">
                ▬ Normale (22px)
            </div>
            <div class="column-context-menu-item" data-action="table-large">
                ▬ Grande (30px)
            </div>
            <div class="column-context-menu-item" data-action="table-xlarge">
                ▬ Très grande (40px)
            </div>
            <div class="column-context-menu-separator"></div>
            <div class="column-context-menu-item" data-action="table-reset">
                ↩️ Réinitialiser ce tableau
            </div>
        </div>
    `);
    
    // Positionner le menu
    $menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append($menu);
    
    // Gestionnaires d'actions
    $menu.find('[data-action="table-height-custom"]').on('click', function() {
        $menu.remove();
        showTableRowsHeightDialog(projectId, blockId, currentHeight);
    });
    
    $menu.find('[data-action="table-small"]').on('click', function() {
        $menu.remove();
        setTableRowsHeight(projectId, blockId, 18);
    });
    
    $menu.find('[data-action="table-medium"]').on('click', function() {
        $menu.remove();
        setTableRowsHeight(projectId, blockId, 22);
    });
    
    $menu.find('[data-action="table-large"]').on('click', function() {
        $menu.remove();
        setTableRowsHeight(projectId, blockId, 30);
    });
    
    $menu.find('[data-action="table-xlarge"]').on('click', function() {
        $menu.remove();
        setTableRowsHeight(projectId, blockId, 40);
    });
    
    $menu.find('[data-action="table-reset"]').on('click', function() {
        $menu.remove();
        resetTableRowsHeight(projectId, blockId);
    });
    
    // Fermer le menu au clic ailleurs
    setTimeout(() => {
        $(document).one('click', function() {
            $menu.remove();
        });
    }, 10);
}

// Dialogue pour définir la hauteur de toutes les lignes d'un tableau
function showTableRowsHeightDialog(projectId, blockId, currentHeight) {
    let html = `
        <div class="dialog-title">Hauteur des lignes du tableau</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Hauteur (en pixels) :</label>
                <input type="number" id="inputTableRowsHeight" value="${Math.round(currentHeight)}" min="1" style="width: 100px;">
                <span style="color: #666; font-size: 11px; margin-left: 10px;">px</span>
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="applyTableRowsHeight('${projectId}', '${blockId}')">Appliquer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    $('#inputTableRowsHeight').focus().select();
    
    // Permettre de valider avec Entrée
    $('#inputTableRowsHeight').on('keydown', function(e) {
        if (e.key === 'Enter') {
            applyTableRowsHeight(projectId, blockId);
        }
    });
}

// Appliquer la hauteur depuis le dialogue
function applyTableRowsHeight(projectId, blockId) {
    let newHeight = parseInt($('#inputTableRowsHeight').val());
    
    if (isNaN(newHeight) || newHeight < 1) {
        newHeight = 1;
    }
    
    setTableRowsHeight(projectId, blockId, newHeight);
    closeDialog();
}

// Définir la hauteur de toutes les lignes d'un tableau
function setTableRowsHeight(projectId, blockId, height) {
    let project = projects[projectId];
    
    if (!project.tableRowHeights) {
        project.tableRowHeights = {};
    }
    
    project.tableRowHeights[blockId] = height;
    
    // Supprimer les hauteurs individuelles de ce tableau
    if (project.rowHeights) {
        for (let key in project.rowHeights) {
            if (key.startsWith(blockId + '_')) {
                delete project.rowHeights[key];
            }
        }
    }
    
    // Appliquer immédiatement à toutes les lignes du tableau
    $(`#workspace-${projectId} .metre-table tr[data-block-id="${blockId}"]`).find('td').css('height', height + 'px');
    
    saveToLocalStorage();
}

// Réinitialiser la hauteur des lignes d'un tableau
function resetTableRowsHeight(projectId, blockId) {
    let project = projects[projectId];
    
    // Supprimer la hauteur du tableau
    if (project.tableRowHeights) {
        delete project.tableRowHeights[blockId];
    }
    
    // Supprimer les hauteurs individuelles de ce tableau
    if (project.rowHeights) {
        for (let key in project.rowHeights) {
            if (key.startsWith(blockId + '_')) {
                delete project.rowHeights[key];
            }
        }
    }
    
    // Réappliquer la hauteur par défaut
    let defaultHeight = project.defaultRowHeight || '';
    $(`#workspace-${projectId} .metre-table tr[data-block-id="${blockId}"]`).find('td').css('height', defaultHeight ? defaultHeight + 'px' : '');
    
    saveToLocalStorage();
}

// Dialogue pour définir la hauteur d'une ligne
function showRowHeightDialog(projectId, rowIndex, blockId, currentHeight) {
    let html = `
        <div class="dialog-title">Hauteur de ligne</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Hauteur (en pixels) :</label>
                <input type="number" id="inputRowHeight" value="${Math.round(currentHeight)}" min="1" style="width: 100px;">
                <span style="color: #666; font-size: 11px; margin-left: 10px;">px</span>
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="applyRowHeight('${projectId}', ${rowIndex}, '${blockId}')">Appliquer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    $('#inputRowHeight').focus().select();
    
    // Permettre de valider avec Entrée
    $('#inputRowHeight').on('keydown', function(e) {
        if (e.key === 'Enter') {
            applyRowHeight(projectId, rowIndex, blockId);
        }
    });
}

// Dialogue pour définir la hauteur de toutes les lignes
function showAllRowsHeightDialog(projectId, currentHeight) {
    let html = `
        <div class="dialog-title">Hauteur de toutes les lignes</div>
        <div class="dialog-content">
            <div class="form-group">
                <label>Hauteur (en pixels) :</label>
                <input type="number" id="inputAllRowsHeight" value="${Math.round(currentHeight)}" min="1" style="width: 100px;">
                <span style="color: #666; font-size: 11px; margin-left: 10px;">px</span>
            </div>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="applyAllRowsHeight('${projectId}')">Appliquer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    $('#inputAllRowsHeight').focus().select();
    
    // Permettre de valider avec Entrée
    $('#inputAllRowsHeight').on('keydown', function(e) {
        if (e.key === 'Enter') {
            applyAllRowsHeight(projectId);
        }
    });
}

// Appliquer la hauteur d'une ligne depuis le dialogue
function applyRowHeight(projectId, rowIndex, blockId) {
    let newHeight = parseInt($('#inputRowHeight').val());
    
    if (isNaN(newHeight) || newHeight < 1) {
        newHeight = 1;
    }
    
    setRowHeight(projectId, rowIndex, blockId, newHeight);
    closeDialog();
}

// Appliquer la hauteur de toutes les lignes depuis le dialogue
function applyAllRowsHeight(projectId) {
    let newHeight = parseInt($('#inputAllRowsHeight').val());
    
    if (isNaN(newHeight) || newHeight < 1) {
        newHeight = 1;
    }
    
    setAllRowsHeight(projectId, newHeight);
    closeDialog();
}

// Définir la hauteur d'une ligne spécifique
function setRowHeight(projectId, rowIndex, blockId, height) {
    let project = projects[projectId];
    
    if (!project.rowHeights) {
        project.rowHeights = {};
    }
    
    let key = blockId + '_' + rowIndex;
    
    if (height === null) {
        delete project.rowHeights[key];
    } else {
        project.rowHeights[key] = height;
    }
    
    // Appliquer immédiatement
    let $row = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
    if ($row.length > 0) {
        if (height === null) {
            $row.find('td').css('height', '');
        } else {
            $row.find('td').css('height', height + 'px');
        }
    }
    
    saveToLocalStorage();
}

// Définir la hauteur de toutes les lignes
function setAllRowsHeight(projectId, height) {
    let project = projects[projectId];
    
    project.defaultRowHeight = height;
    project.rowHeights = {}; // Reset individual heights
    
    // Appliquer à toutes les lignes
    $(`#workspace-${projectId} .metre-table tbody tr`).find('td').css('height', height + 'px');
    
    saveToLocalStorage();
}

// Réinitialiser toutes les hauteurs
function resetAllRowsHeight(projectId) {
    let project = projects[projectId];
    
    project.defaultRowHeight = 18;
    project.rowHeights = {};
    
    // Réappliquer
    $(`#workspace-${projectId} .metre-table tbody tr`).find('td').css('height', '');
    
    saveToLocalStorage();
}

// Appliquer les hauteurs sauvegardées après le rendu
function applyRowHeights(projectId) {
    let project = projects[projectId];
    
    // Appliquer la hauteur par défaut si définie
    if (project.defaultRowHeight && project.defaultRowHeight !== 18) {
        $(`#workspace-${projectId} .metre-table tbody tr`).find('td').css('height', project.defaultRowHeight + 'px');
    }
    
    // Appliquer les hauteurs par tableau
    if (project.tableRowHeights) {
        for (let blockId in project.tableRowHeights) {
            let height = project.tableRowHeights[blockId];
            $(`#workspace-${projectId} .metre-table tr[data-block-id="${blockId}"]`).find('td').css('height', height + 'px');
        }
    }
    
    // Appliquer les hauteurs individuelles (priorité sur les hauteurs par tableau)
    if (project.rowHeights) {
        for (let key in project.rowHeights) {
            let parts = key.split('_');
            let blockId = parts[0];
            let rowIndex = parts[1];
            let height = project.rowHeights[key];
            
            let $row = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
            if ($row.length > 0) {
                $row.find('td').css('height', height + 'px');
            }
        }
    }
}

// ========== SOUS-TOTAL: Insert row above subtotal ==========
function insertRowAboveSubtotal(projectId, blockId, subtotalRowIndex, initialChar) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    // Create a new empty row
    let newRow = createEmptyRow();
    
    // Insert the new row just before the subtotal row
    block.data.splice(subtotalRowIndex, 0, newRow);
    
    // Re-render the table
    renderMetreTable(projectId);
    
    // Focus on the new row's first editable cell (or L cell if initialChar provided)
    setTimeout(() => {
        let newRowIndex = subtotalRowIndex; // The new row is now at this index
        let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${newRowIndex}"][data-block-id="${blockId}"]`);
        
        if ($newRow.length > 0) {
            // Add highlight animation
            $newRow.addClass('new-row-highlight');
            setTimeout(() => $newRow.removeClass('new-row-highlight'), 800);
            
            // Focus on appropriate cell
            let targetField = initialChar ? 'l' : 'code';
            let $targetCell = $newRow.find(`td.editable[data-field="${targetField}"]`);
            
            if ($targetCell.length > 0) {
                if (initialChar) {
                    // Start editing with the initial character
                    startEditingCell(projectId, $targetCell[0], newRowIndex, targetField, initialChar);
                } else {
                    selectCell(projectId, $targetCell[0]);
                }
            }
        }
    }, 50);
}

function toggleValueSign(projectId, rowIndex, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    block.data[rowIndex].isDeduction = !block.data[rowIndex].isDeduction;
    renderMetreTable(projectId);
    
    // Re-select the appropriate cell after toggle
    setTimeout(() => {
        let $row = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
        
        // Select the valplus or valmoins cell depending on new state
        let field = block.data[rowIndex].isDeduction ? 'valmoins' : 'valplus';
        let $cell = $row.find(`td[data-field="${field}"]`);
        
        if ($cell.length > 0) {
            selectCell(projectId, $cell[0]);
            $cell.attr('tabindex', '0').focus();
        }
    }, 50);
}

function showValueSignContextMenu(projectId, e, rowIndex) {
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let row = project.currentPoste.data[rowIndex];
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { 
            label: row.isDeduction ? '➕ Passer en positif' : '➖ Passer en négatif', 
            action: () => toggleValueSign(projectId, rowIndex) 
        },
        { separator: true },
        { label: '📏 Variable L', action: () => assignVariableToValCol(projectId, rowIndex, 'L') },
        { label: '📐 Variable S', action: () => assignVariableToValCol(projectId, rowIndex, 'S') },
        { label: '📦 Variable V', action: () => assignVariableToValCol(projectId, rowIndex, 'V') }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Assign variable specifically to Val+/Val- column
function assignVariableToValCol(projectId, rowIndex, type) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let row = project.currentPoste.data[rowIndex];
    
    // Get the calculated value
    let numValue = Math.abs(calculateValue(row, project.variables));
    
    // Find next available number for this type
    let varName = getNextVariableName(projectId, type);
    
    // Auto-fill description with designation text
    let autoDescription = row.designation || "Sans description";
    
    // Create the variable with new structure
    project.variables[varName] = {
        declaration: {
            posteId: project.currentPoste.id,
            posteName: project.currentPoste.name,
            rowIndex: rowIndex,
            field: 'valeurForcee',
            value: numValue
        },
        description: autoDescription,
        calls: []
    };
    
    // Replace cell content with variable declaration
    row.valeurForcee = createVariableField(varName, true);
    
    // Update displays
    renderVariables(projectId);
    renderMetreTable(projectId);
}

// Show context menu for calculated columns (Total L, Qté T.)
function showCalculatedColumnContextMenu(projectId, e, rowIndex, columnType) {
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: '📏 Variable L', action: () => assignVariableToCalculatedCol(projectId, rowIndex, 'L', columnType) },
        { label: '📐 Variable S', action: () => assignVariableToCalculatedCol(projectId, rowIndex, 'S', columnType) },
        { label: '📦 Variable V', action: () => assignVariableToCalculatedCol(projectId, rowIndex, 'V', columnType) }
    ];
    
    menuItems.forEach(item => {
        let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
        menuItem.on('click', () => {
            item.action();
            contextMenu.remove();
            contextMenu = null;
        });
        contextMenu.append(menuItem);
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Assign variable to calculated column (Total L or Qté T.)
function assignVariableToCalculatedCol(projectId, rowIndex, type, columnType) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let row = project.currentPoste.data[rowIndex];
    
    // Determine field and value based on column type
    let fieldName, numValue;
    
    if (columnType === 'totall') {
        fieldName = 'totalLForcee';
        // Get current Total L value
        if (row.totalLForcee) {
            numValue = getValue(row.totalLForcee, project.variables);
        } else {
            numValue = calculateTotalL(row, project.variables);
        }
    } else if (columnType === 'qtetotal') {
        fieldName = 'qteForcee';
        // Get current Qté T. value
        if (row.qteForcee) {
            numValue = getValue(row.qteForcee, project.variables);
        } else {
            // Calculate based on valeurForcee if present, otherwise calculateValue
            if (row.valeurForcee) {
                numValue = Math.abs(getValue(row.valeurForcee, project.variables));
            } else {
                numValue = Math.abs(calculateValue(row, project.variables));
            }
        }
    }
    
    // Find next available number for this type
    let varName = getNextVariableName(projectId, type);
    
    // Auto-fill description with designation text
    let autoDescription = row.designation || "Sans description";
    
    // Create the variable with new structure
    project.variables[varName] = {
        declaration: {
            posteId: project.currentPoste.id,
            posteName: project.currentPoste.name,
            rowIndex: rowIndex,
            field: fieldName,
            value: numValue
        },
        description: autoDescription,
        calls: []
    };
    
    // Replace cell content with variable declaration
    row[fieldName] = createVariableField(varName, true);
    
    // Update displays
    renderVariables(projectId);
    renderMetreTable(projectId);
}

function flashCellsByVariable(projectId, varName) {
    // Find and flash all cells with this variable
    $(`#workspace-${projectId} .metre-table td[data-var-name="${varName}"]`).each(function() {
        $(this).addClass('flash-cell');
        setTimeout(() => {
            $(this).removeClass('flash-cell');
        }, 600); // 3 flashes × 200ms
    });
}

function selectCellsByVariable(projectId, varName) {
    let project = projects[projectId];
    
    // Clear current selection
    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
    
    // Select all cells with this variable
    $(`#workspace-${projectId} .metre-table td[data-var-name="${varName}"]`).addClass('selected');
    
    updateSelection(projectId);
}

// Navigate to a row and select appropriate cell
function navigateToRow(projectId, $row, preferredField) {
    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
    $(`#workspace-${projectId} .block-row`).removeClass('block-selected');
    
    // Check if it's a block header row (file, canvas, image)
    if ($row.hasClass('block-file') || $row.hasClass('block-canvas') || $row.hasClass('block-image')) {
        // For block-file, try to select a cell with data-field if available
        if ($row.hasClass('block-file')) {
            // Try to find the preferred field, or fall back to first file-block-cell
            let $targetCell = $row.find(`td.file-block-cell[data-field="${preferredField}"]`);
            if (!$targetCell.length) {
                $targetCell = $row.find('td.file-block-cell').first();
            }
            if ($targetCell.length > 0) {
                selectCell(projectId, $targetCell[0]);
                // Don't add block-selected - we want cell selection like in a table
                return;
            }
        }
        // For canvas/image or if no file-block-cell found, select first td and highlight whole block
        let $headerCell = $row.find('td').first();
        if ($headerCell.length > 0) {
            $headerCell.addClass('selected').attr('tabindex', '0').focus();
            $row.addClass('block-selected');
            updateSelection(projectId);
        }
        return;
    }
    
    // For regular rows, try to select the same field, otherwise first available
    let $targetCell = $row.find(`td[data-field="${preferredField}"]`);
    if (!$targetCell.length || $targetCell.css('display') === 'none') {
        $targetCell = $row.find('td[data-field]').first();
    }
    
    if ($targetCell.length > 0) {
        if ($targetCell.hasClass('ens-cell')) {
            $targetCell.addClass('selected').attr('tabindex', '0').focus();
            updateSelection(projectId);
        } else {
            selectCell(projectId, $targetCell[0]);
        }
    }
}

function selectCell(projectId, cell) {
    let $cell = $(cell);
    
    // Si on est en mode sélection de formule, ne pas sélectionner (géré par mousedown)
    if (formulaSelectionMode.active && formulaSelectionMode.inputElement) {
        return;
    }
    
    // Comportement normal: sélectionner la cellule
    // Remove previous selection
    $(`#workspace-${projectId} .metre-table td.selected`).removeClass('selected');
    
    // Add selection to new cell
    $cell.addClass('selected');
    
    // Make it focusable and focus it
    $cell.attr('tabindex', '0').focus();
    
    // Mettre à jour les infos de sélection (somme, cellules, formule)
    updateSelection(projectId);
}

function startEditingCell(projectId, cell, rowIndex, field, initialValue) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let $cell = $(cell);
    let $row = $cell.closest('tr');
    let blockId = $row.data('block-id');
    
    // Find the correct block
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    let row = block.data[rowIndex];
    
    // Map display field to actual data field
    let actualField = field;
    if (field === 'valplus' || field === 'valmoins') {
        actualField = 'valeurForcee';
    }
    
    let currentValue = row[actualField];
    
    // Special handling for Ens field - toggle with spacebar
    if (field === 'ens') {
        if (currentValue === 'Ens.') {
            row[field] = null;
        } else {
            row[field] = 'Ens.';
        }
        renderMetreTable(projectId);
        return;
    }
    
    // Special handling for Unit field - Excel-style dropdown
    if (field === 'unit') {
        // Open dropdown immediately on click (not just double-click)
        showUnitDropdown(projectId, $cell, currentValue, function(selectedValue) {
            row[field] = selectedValue;
            renderMetreTable(projectId);
        }, blockId, rowIndex, field);
        return;
    }
    
    // Get display value
    let displayValue = '';
    if (currentValue && typeof currentValue === 'object') {
        if (currentValue.type === 'variable') {
            // Show variable name if it's a variable
            displayValue = currentValue.name;
        } else if (currentValue.type === 'value') {
            displayValue = currentValue.value;
        } else if (currentValue.type === 'formula') {
            // Show the formula itself (not the calculated value)
            displayValue = currentValue.formula;
        }
    } else {
        displayValue = currentValue || '';
    }
    
    $cell.addClass('editing');
    
    // Créer le conteneur avec backdrop pour les formules
    let $container = $('<div class="formula-edit-container"></div>');
    let $backdrop = $('<div class="formula-edit-backdrop"></div>');
    let input = $('<input type="text">').val(initialValue !== undefined ? initialValue : displayValue);
    
    $container.append($backdrop);
    $container.append(input);
    $cell.html($container);
    input.focus();
    
    // Position cursor at end of text
    let len = input.val().length;
    input[0].setSelectionRange(len, len);
    
    // Fonction pour auto-redimensionner l'input selon le contenu
    function autoResizeInput() {
        // Créer un span temporaire pour mesurer la largeur du texte
        let $measurer = $('<span style="visibility: hidden; position: absolute; white-space: nowrap; font-size: 12px; font-family: inherit; padding: 2px 4px;"></span>');
        $measurer.text(input.val() || ' ');
        $('body').append($measurer);
        let textWidth = $measurer.width() + 20; // +20 pour le padding et la marge
        $measurer.remove();
        
        // Largeur minimum = largeur de la cellule originale
        let cellWidth = $cell.outerWidth();
        let newWidth = Math.max(cellWidth, textWidth);
        
        input.css('width', newWidth + 'px');
        $container.css('min-width', newWidth + 'px');
    }
    
    // Redimensionner au démarrage et à chaque frappe
    autoResizeInput();
    input.on('input', autoResizeInput);
    
    // Fonction pour mettre à jour la coloration
    function updateHighlighting() {
        let val = input.val();
        if (val.startsWith('=')) {
            updateFormulaHighlighting(projectId, input[0], $backdrop[0]);
        } else {
            $backdrop.html(escapeHtml(val));
            clearFormulaHighlights();
        }
    }
    
    // Activer le mode sélection de formule si le contenu commence par "="
    function checkFormulaMode() {
        let val = input.val();
        if (val.startsWith('=')) {
            formulaSelectionMode.active = true;
            formulaSelectionMode.projectId = projectId;
            formulaSelectionMode.blockId = blockId;
            formulaSelectionMode.inputElement = input[0];
            input.addClass('formula-input-mode');
        } else {
            formulaSelectionMode.active = false;
            formulaSelectionMode.inputElement = null;
            input.removeClass('formula-input-mode');
        }
        // Mettre à jour les surbrillances
        updateHighlighting();
    }
    
    // Vérifier au démarrage
    checkFormulaMode();
    
    // Vérifier à chaque frappe
    input.on('input', checkFormulaMode);
    
    // Gestionnaire mousedown global pour capturer les clics sur cellules en mode formule
    // (mousedown se déclenche AVANT blur, donc le mode formule est encore actif)
    $(document).off('mousedown.formulaSelect').on('mousedown.formulaSelect', function(e) {
        if (!formulaSelectionMode.active) return;
        
        let $target = $(e.target);
        let $cell = $target.closest('td[data-field]');
        
        // Ignorer si on clique sur l'input lui-même
        if ($target.is('input')) return;
        
        // Si on clique ailleurs que sur une cellule valide, empêcher le blur mais ne rien faire
        if ($cell.length === 0) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        let field = $cell.data('field');
        
        // Ne pas permettre de référencer les colonnes sans lettre (comme line-num-cell)
        if (!field || !COLUMN_TO_LETTER[field]) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        // Empêcher le blur de l'input
        e.preventDefault();
        e.stopPropagation();
        
        // Trouver le numéro de ligne
        let $row = $cell.closest('tr');
        let lineNumber = parseInt($row.data('line'));
        
        if (isNaN(lineNumber)) {
            let $lineNumCell = $row.find('.line-num-cell');
            lineNumber = parseInt($lineNumCell.text().trim());
        }
        
        if (isNaN(lineNumber) || lineNumber <= 0) return;
        
        // Construire la référence (ex: E5)
        let colLetter = COLUMN_TO_LETTER[field];
        let cellRef = colLetter + lineNumber;
        
        // Insérer la référence dans l'input de formule
        let inputEl = formulaSelectionMode.inputElement;
        if (!inputEl) return;
        
        let currentVal = inputEl.value;
        let cursorPos = inputEl.selectionStart;
        
        // Vérifier si on peut insérer une référence ici
        // Il faut que le caractère précédent soit un opérateur (+, -, *, /, (, =) ou que ce soit le début après "="
        let charBefore = cursorPos > 0 ? currentVal.charAt(cursorPos - 1) : '';
        let validOperators = ['+', '-', '*', '/', '(', '=', ' '];
        
        // Si on est juste après "=" ou après un opérateur, c'est OK
        let canInsert = cursorPos === 1 && currentVal.charAt(0) === '=' || // Juste après "="
                        validOperators.includes(charBefore);
        
        if (!canInsert) {
            // Ne pas insérer, il manque un opérateur
            // Faire clignoter l'input pour indiquer l'erreur
            $(inputEl).addClass('formula-error-flash');
            setTimeout(() => $(inputEl).removeClass('formula-error-flash'), 300);
            inputEl.focus();
            return;
        }
        
        // Insérer à la position du curseur
        let newVal = currentVal.slice(0, cursorPos) + cellRef + currentVal.slice(cursorPos);
        inputEl.value = newVal;
        
        // Déclencher l'événement input pour mettre à jour les surbrillances
        $(inputEl).trigger('input');
        
        // Repositionner le curseur après la référence insérée
        let newCursorPos = cursorPos + cellRef.length;
        inputEl.setSelectionRange(newCursorPos, newCursorPos);
        
        // S'assurer que le focus reste sur l'input (utiliser setTimeout pour être sûr)
        setTimeout(() => {
            inputEl.focus();
            inputEl.setSelectionRange(newCursorPos, newCursorPos);
        }, 10);
        
        // Highlight temporaire de la cellule référencée (flash)
        $cell.addClass('formula-ref-highlight');
        setTimeout(() => $cell.removeClass('formula-ref-highlight'), 500);
    });
    
    let saveAndExit = function(moveDirection) {
        // Désactiver le mode sélection de formule et nettoyer le gestionnaire
        formulaSelectionMode.active = false;
        formulaSelectionMode.inputElement = null;
        $(document).off('mousedown.formulaSelect');
        
        // Nettoyer les surbrillances de formule
        clearFormulaHighlights();
        
        let newValue = input.val().trim();
        $cell.removeClass('editing');
        
        // Handle empty value
        if (newValue === '') {
            if (field === 'code' || field === 'designation' || field === 'op' || field === 'unit') {
                row[actualField] = '';
            } else {
                row[actualField] = null;
            }
            renderMetreTable(projectId);
            
            // Move to next cell if requested
            if (moveDirection) {
                setTimeout(() => moveToCell(projectId, blockId, rowIndex, field, moveDirection), 50);
            }
            return;
        }
        
        // Handle text fields (but check for formulas first)
        if (field === 'code' || field === 'designation' || field === 'op' || field === 'unit') {
            // Check if it's a formula
            if (isFormula(newValue)) {
                let calculatedValue = evaluateFormula(newValue, projectId, blockId);
                row[actualField] = createFormulaField(newValue, calculatedValue);
            } else {
                row[actualField] = newValue;
            }
            renderMetreTable(projectId);
            
            // Move to next cell if requested
            if (moveDirection) {
                setTimeout(() => moveToCell(projectId, blockId, rowIndex, field, moveDirection), 50);
            }
            return;
        }
        
        // Check if it's a formula (starts with "=")
        if (isFormula(newValue)) {
            let calculatedValue = evaluateFormula(newValue, projectId, blockId);
            row[actualField] = createFormulaField(newValue, calculatedValue);
            
            // Update dependent formulas
            updateDependentFormulas(projectId, blockId, actualField, rowIndex);
            
            renderMetreTable(projectId);
            
            // Move to next cell if requested
            if (moveDirection) {
                setTimeout(() => moveToCell(projectId, blockId, rowIndex, field, moveDirection), 50);
            }
            return;
        }
        
        // Check if it's a variable pattern (L1, S2, V3, etc.)
        if (isVariablePattern(newValue)) {
            let varName = newValue.trim().toUpperCase();
            
            // Check if variable already exists
            if (project.variables[varName]) {
                // Create a variable CALL
                row[actualField] = createVariableField(varName, false);
                
                // Add this call to the variable's calls list
                if (!project.variables[varName].calls) {
                    project.variables[varName].calls = [];
                }
                project.variables[varName].calls.push({
                    posteId: project.currentPoste.id,
                    posteName: project.currentPoste.name,
                    blockId: blockId,
                    rowIndex: rowIndex,
                    field: actualField
                });
                
                // Si c'est dans la colonne L, on doit créer le pattern 1 fs valeur + ens.
                // comme pour une valeur normale
                if (field === 'l') {
                    // Auto-remplir N et Op si vides
                    if (!row.n || row.n === '' || row.n === null || row.n === 0) {
                        row.n = createValueField(1);
                    }
                    if (!row.op || row.op === '' || row.op === null) {
                        row.op = 'fs';
                    }
                }
                
                // Continuer vers la logique de sous-total (ne pas retourner ici)
            } else {
                // Create a variable DECLARATION
                // Get the current numeric value of the cell using getValue
                let numValue = getValue(currentValue, project.variables);
                
                // Create the variable avec le nouveau format
                project.variables[varName] = {
                    blockId: blockId,
                    rowIndex: rowIndex,
                    field: actualField,
                    value: numValue,
                    description: row.designation || "Sans description",
                    posteId: project.currentPoste.id,
                    posteName: project.currentPoste.name,
                    createdAt: Date.now(),
                    calls: []
                };
                
                // Create variable field in the row
                row[actualField] = createVariableField(varName, true);
                
                // Update variables panel
                renderVariables(projectId);
            }
        } else {
            // Check if it's "ens." in the L field (for subtotals)
            if (field === 'l' && newValue.toLowerCase() === 'ens.') {
                // Store "ens." as text in L field
                row[actualField] = createValueField(newValue.toLowerCase());
            } else {
                // It's a regular numeric value
                let numValue = parseFloat(newValue);
                if (isNaN(numValue)) numValue = 0;
                
                // If this cell was a variable declaration, we need to handle it
                if (currentValue && typeof currentValue === 'object' && 
                    currentValue.type === 'variable' && currentValue.isDeclaration) {
                    // Update the variable's value
                    let varName = currentValue.name;
                    if (project.variables[varName]) {
                        // Nouveau format
                        if (project.variables[varName].value !== undefined) {
                            project.variables[varName].value = numValue;
                        }
                        // Ancien format (compatibilité)
                        if (project.variables[varName].declaration) {
                            project.variables[varName].declaration.value = numValue;
                        }
                        renderVariables(projectId);
                    }
                } else {
                    // Just a regular value
                    row[actualField] = createValueField(numValue);
                }
            }
            
            // Update any formulas that depend on this cell
            updateDependentFormulas(projectId, blockId, actualField, rowIndex);
        }
        
        // ========== SOUS-TOTAL: Auto-create subtotal when Total L has a value ==========
        // Check if the field being edited affects Total L
        let affectsTotalL = ['n', 'l', 'op', 'totall'].includes(field);
        
        // Flag to track if we'll create a subtotal (to avoid double row creation)
        let willCreateSubtotal = false;
        
        if (affectsTotalL && newValue !== '' && newValue !== '0') {
            // Calculate the Total L for this row
            let totalL;
            if (row.totalLForcee) {
                totalL = getValue(row.totalLForcee, project.variables);
            } else {
                totalL = calculateTotalL(row, project.variables);
            }
            
            // If Total L is non-zero, check if there's already a subtotal somewhere after this row
            if (totalL !== 0) {
                let needsSubtotal = true;
                let existingSubtotalIndex = -1;
                
                // Search for an existing subtotal after this row
                for (let j = rowIndex + 1; j < block.data.length; j++) {
                    let checkRow = block.data[j];
                    let checkL = checkRow.l;
                    let isCheckSubtotal = checkRow.isSubtotalRow === true ||
                                         (typeof checkL === 'string' && checkL.toLowerCase() === 'ens.') ||
                                         (checkL && typeof checkL === 'object' && checkL.type === 'value' && 
                                          typeof checkL.value === 'string' && checkL.value.toLowerCase() === 'ens.');
                    
                    if (isCheckSubtotal) {
                        // Found an existing subtotal
                        needsSubtotal = false;
                        existingSubtotalIndex = j;
                        break;
                    }
                }
                
                if (!needsSubtotal && existingSubtotalIndex >= 0) {
                    // Subtotal already exists somewhere after - just render and move to next cell
                    renderMetreTable(projectId);
                    
                    // Move to next cell (down in same column)
                    if (moveDirection) {
                        setTimeout(() => moveToCell(projectId, blockId, rowIndex, field, moveDirection), 50);
                    }
                    
                    return; // Don't continue with normal flow
                }
                
                // Create subtotal + new row if needed (only if no subtotal exists after)
                if (needsSubtotal) {
                    // Create subtotal row
                    let subtotalRow = createSubtotalRow();
                    
                    // Create empty row after subtotal
                    let emptyRow = createEmptyRow();
                    
                    // Insert subtotal and new empty row after current row
                    block.data.splice(rowIndex + 1, 0, subtotalRow, emptyRow);
                    
                    console.log('[SOUS-TOTAL] Auto-created subtotal + new row after row', rowIndex);
                    
                    // Render and then focus on the ens. cell of the subtotal
                    renderMetreTable(projectId);
                    
                    setTimeout(() => {
                        // The subtotal row is now at rowIndex + 1
                        let subtotalRowIndex = rowIndex + 1;
                        let $subtotalRow = $(`#workspace-${projectId} .metre-table tr[data-row="${subtotalRowIndex}"][data-block-id="${blockId}"]`);
                        let $ensCell = $subtotalRow.find('td.ens-cell');
                        
                        if ($ensCell.length > 0) {
                            // Clear other selections and select/focus the ens. cell
                            $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                            $ensCell.addClass('selected').attr('tabindex', '0').focus();
                            updateSelection(projectId);
                        }
                    }, 60);
                    
                    return; // Don't continue with normal flow
                }
            }
        }
        
        // Auto-add new row if editing last row and value is not empty
        // (Only if we didn't create a subtotal above, which already adds a new row)
        if (rowIndex === block.data.length - 1 && newValue !== '') {
            block.data.push(createEmptyRow());
        }
        
        renderMetreTable(projectId);
        
        // Move to next cell if requested
        if (moveDirection) {
            setTimeout(() => moveToCell(projectId, blockId, rowIndex, field, moveDirection), 50);
        }
    };
    
    let cancelEdit = function() {
        // Désactiver le mode sélection de formule et nettoyer le gestionnaire
        formulaSelectionMode.active = false;
        formulaSelectionMode.inputElement = null;
        $(document).off('mousedown.formulaSelect');
        
        // Nettoyer les surbrillances de formule
        clearFormulaHighlights();
        
        $cell.removeClass('editing');
        renderMetreTable(projectId);
        
        // Re-select the cell after render
        setTimeout(() => {
            let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
            let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
            if ($newCell.length > 0) {
                selectCell(projectId, $newCell[0]);
            }
        }, 50);
    };
    
    input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            // Special diagonal navigation for larg and h
            if (field === 'larg') {
                saveAndExit('diagonal-larg'); // larg → h on next row
            } else if (field === 'h') {
                saveAndExit('diagonal-h'); // h → L on next row
            } else {
                saveAndExit('down'); // Move down after Enter
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                saveAndExit('left'); // Move left with Shift+Tab
            } else {
                saveAndExit('right'); // Move right with Tab
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelEdit();
        }
    });
    
    input.on('blur', function() {
        // Ne pas sauvegarder si on est en mode sélection de formule
        // (le blur peut se produire mais on veut rester en édition)
        if (formulaSelectionMode.active) {
            // Remettre le focus sur l'input
            setTimeout(() => {
                if (formulaSelectionMode.active && formulaSelectionMode.inputElement) {
                    formulaSelectionMode.inputElement.focus();
                }
            }, 10);
            return;
        }
        
        // Save when clicking outside (without moving)
        setTimeout(() => {
            if ($cell.hasClass('editing')) {
                saveAndExit(null);
            }
        }, 100);
    });
}

function moveToCell(projectId, blockId, currentRowIndex, currentField, direction) {
    let $currentRow = $(`#workspace-${projectId} .metre-table tr[data-row="${currentRowIndex}"][data-block-id="${blockId}"]`);
    
    // Diagonal navigation for larg → h (next row)
    if (direction === 'diagonal-larg') {
        let $allRows = $(`#workspace-${projectId} .metre-table tr[data-row]`);
        let currentIdx = $allRows.index($currentRow);
        
        if (currentIdx >= 0 && currentIdx < $allRows.length - 1) {
            let $nextRow = $allRows.eq(currentIdx + 1);
            let $targetCell = $nextRow.find('td[data-field="h"]');
            
            if ($targetCell.length > 0) {
                if ($targetCell.hasClass('ens-cell')) {
                    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                    $targetCell.addClass('selected').focus();
                    updateSelection(projectId);
                } else {
                    selectCell(projectId, $targetCell[0]);
                }
                return;
            }
        }
        // Fallback to down
        direction = 'down';
    }
    
    // Diagonal navigation for h → L (next row)
    if (direction === 'diagonal-h') {
        let $allRows = $(`#workspace-${projectId} .metre-table tr[data-row]`);
        let currentIdx = $allRows.index($currentRow);
        
        if (currentIdx >= 0 && currentIdx < $allRows.length - 1) {
            let $nextRow = $allRows.eq(currentIdx + 1);
            let $targetCell = $nextRow.find('td[data-field="l"]');
            
            if ($targetCell.length > 0) {
                if ($targetCell.hasClass('ens-cell')) {
                    $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                    $targetCell.addClass('selected').focus();
                    updateSelection(projectId);
                } else {
                    selectCell(projectId, $targetCell[0]);
                }
                return;
            }
        }
        
        // If we're at the last row or next row doesn't have L, create a new row
        let project = projects[projectId];
        let block = project.currentPoste.blocks.find(b => b.id === blockId);
        if (block && block.data) {
            // Add a new empty row at the end
            block.data.push(createEmptyRow());
            
            // Re-render and select the L cell of the new row
            renderMetreTable(projectId);
            
            setTimeout(() => {
                let newRowIndex = block.data.length - 1;
                let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${newRowIndex}"][data-block-id="${blockId}"]`);
                let $targetCell = $newRow.find('td[data-field="l"]');
                if ($targetCell.length > 0) {
                    selectCell(projectId, $targetCell[0]);
                }
            }, 50);
            return;
        }
        
        // Fallback: go to L on current row below (standard down for L)
        currentField = 'l';
        direction = 'down';
    }
    
    if (direction === 'down') {
        // Move to cell below - skip subtotal rows if needed
        let $nextRow = $currentRow.next('tr[data-row]');
        while ($nextRow.length > 0) {
            let isSubtotal = $nextRow.data('is-subtotal') === true || $nextRow.data('is-subtotal') === 'true';
            let $nextCell = $nextRow.find(`td[data-field="${currentField}"]`);
            
            if ($nextCell.length > 0) {
                // If it's a subtotal row, skip it for editable fields
                if (isSubtotal && !$nextCell.hasClass('subtotal-val-cell') && !$nextCell.hasClass('ens-cell')) {
                    $nextRow = $nextRow.next('tr[data-row]');
                    continue;
                }
                
                $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                $nextCell.addClass('selected');
                if ($nextCell.hasClass('ens-cell')) {
                    $nextCell.focus();
                }
                updateSelection(projectId);
                return;
            }
            $nextRow = $nextRow.next('tr[data-row]');
        }
        
        // If no next row found, try footer
        let $footer = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
        if ($footer.length > 0) {
            let $footerCell = $footer.find(`td[data-field="${currentField}"]`);
            if ($footerCell.length > 0) {
                $(`#workspace-${projectId} .metre-table td`).removeClass('selected');
                $footerCell.addClass('selected');
                updateSelection(projectId);
            }
        }
    } else if (direction === 'right') {
        // Move to cell on the right
        let $allCells = $currentRow.find('td.editable');
        let $currentCell = $currentRow.find(`td.editable[data-field="${currentField}"]`);
        let currentIndex = $allCells.index($currentCell);
        
        if (currentIndex < $allCells.length - 1) {
            selectCell(projectId, $allCells.eq(currentIndex + 1)[0]);
        } else {
            // Go to first cell of next row (skip subtotal rows)
            let $nextRow = $currentRow.next('tr[data-row]');
            while ($nextRow.length > 0) {
                let isSubtotal = $nextRow.data('is-subtotal') === true || $nextRow.data('is-subtotal') === 'true';
                if (!isSubtotal) {
                    let $firstCell = $nextRow.find('td.editable').first();
                    if ($firstCell.length > 0) {
                        selectCell(projectId, $firstCell[0]);
                        return;
                    }
                }
                $nextRow = $nextRow.next('tr[data-row]');
            }
        }
    } else if (direction === 'left') {
        // Move to cell on the left
        let $allCells = $currentRow.find('td.editable');
        let $currentCell = $currentRow.find(`td.editable[data-field="${currentField}"]`);
        let currentIndex = $allCells.index($currentCell);
        
        if (currentIndex > 0) {
            selectCell(projectId, $allCells.eq(currentIndex - 1)[0]);
        }
    }
}

function showUnitDropdown(projectId, $cell, currentValue, onSelect, blockId, rowIndex, field) {
    // Remove any existing dropdown
    $('.unit-dropdown').remove();
    
    // Get cell position
    let cellOffset = $cell.offset();
    let cellWidth = $cell.outerWidth();
    let cellHeight = $cell.outerHeight();
    
    // Create dropdown menu
    let $dropdown = $('<div class="unit-dropdown"></div>');
    $dropdown.css({
        position: 'absolute',
        left: cellOffset.left + 'px',
        top: (cellOffset.top + cellHeight) + 'px',
        width: Math.max(cellWidth, 150) + 'px',
        maxHeight: '300px',
        overflowY: 'auto',
        background: 'white',
        border: '1px solid #3498db',
        boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        zIndex: 10000,
        fontSize: '12px'
    });
    
    // Add empty option
    let $emptyOption = $('<div class="unit-option" data-value=""></div>');
    $emptyOption.text('(vide)');
    $emptyOption.css({
        padding: '6px 10px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee'
    });
    if (currentValue === '') {
        $emptyOption.css('background', '#e3f2fd');
    }
    $dropdown.append($emptyOption);
    
    // Add all custom units
    appSettings.units.customUnits.forEach(unit => {
        let $option = $('<div class="unit-option"></div>');
        $option.text(unit);
        $option.attr('data-value', unit);
        $option.css({
            padding: '6px 10px',
            cursor: 'pointer',
            borderBottom: '1px solid #eee'
        });
        
        if (currentValue === unit) {
            $option.css('background', '#e3f2fd');
        }
        
        $option.on('mouseenter', function() {
            $('.unit-option').css('background', '');
            $(this).css('background', '#f0f0f0');
        });
        
        $option.on('click', function() {
            let value = $(this).attr('data-value');
            $dropdown.remove();
            onSelect(value);
            
            // Re-select the cell after validation
            setTimeout(() => {
                if (rowIndex !== null && rowIndex !== undefined) {
                    let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                    let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                    if ($newCell.length > 0) {
                        selectCell(projectId, $newCell[0]);
                    }
                } else {
                    // Footer cell
                    let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
                    let $footerCell = $footerRow.find(`td.editable-footer[data-field="${field}"]`);
                    if ($footerCell.length > 0) {
                        selectCell(projectId, $footerCell[0]);
                    }
                }
            }, 50);
        });
        
        $dropdown.append($option);
    });
    
    // Add "Other..." option for free text entry
    let $otherOption = $('<div class="unit-option" data-value="__other__"></div>');
    $otherOption.html('✏️ <i>Autre...</i>');
    $otherOption.css({
        padding: '6px 10px',
        cursor: 'pointer',
        borderTop: '2px solid #3498db',
        fontStyle: 'italic',
        color: '#3498db'
    });
    $otherOption.on('mouseenter', function() {
        $('.unit-option').css('background', '');
        $(this).css('background', '#f0f0f0');
    });
    $otherOption.on('click', function() {
        $dropdown.remove();
        showUnitFreeTextInput(projectId, $cell, currentValue, onSelect, blockId, rowIndex, field);
    });
    $dropdown.append($otherOption);
    
    $('body').append($dropdown);
    
    // Close on click outside
    setTimeout(() => {
        $(document).one('click', function(e) {
            if (!$(e.target).closest('.unit-dropdown').length) {
                $dropdown.remove();
                // Re-select cell on close
                setTimeout(() => {
                    if (rowIndex !== null && rowIndex !== undefined) {
                        let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                        let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                        if ($newCell.length > 0) {
                            selectCell(projectId, $newCell[0]);
                        }
                    }
                }, 50);
            }
        });
    }, 10);
    
    // Keyboard navigation
    let selectedIndex = -1;
    let $options = $dropdown.find('.unit-option');
    
    // Find current value index
    $options.each(function(index) {
        if ($(this).attr('data-value') === currentValue) {
            selectedIndex = index;
        }
    });
    
    // Focus on dropdown to capture keyboard events
    $dropdown.attr('tabindex', '0').focus();
    
    $dropdown.on('keydown', function(e) {
        e.stopPropagation(); // Prevent event from reaching document
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, $options.length - 1);
            $options.css('background', '');
            $options.eq(selectedIndex).css('background', '#f0f0f0');
            // Scroll into view
            $options.eq(selectedIndex)[0].scrollIntoView({block: 'nearest'});
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            $options.css('background', '');
            $options.eq(selectedIndex).css('background', '#f0f0f0');
            $options.eq(selectedIndex)[0].scrollIntoView({block: 'nearest'});
        } else if (e.key === ' ') {
            // Space: move to next item (cycle through)
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % $options.length;
            $options.css('background', '');
            $options.eq(selectedIndex).css('background', '#f0f0f0');
            $options.eq(selectedIndex)[0].scrollIntoView({block: 'nearest'});
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0) {
                let value = $options.eq(selectedIndex).attr('data-value');
                $dropdown.remove();
                
                if (value === '__other__') {
                    showUnitFreeTextInput(projectId, $cell, currentValue, onSelect, blockId, rowIndex, field);
                } else {
                    onSelect(value);
                    
                    // Re-select the cell after validation
                    setTimeout(() => {
                        if (rowIndex !== null && rowIndex !== undefined) {
                            let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                            let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                            if ($newCell.length > 0) {
                                selectCell(projectId, $newCell[0]);
                            }
                        } else {
                            // Footer cell
                            let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
                            let $footerCell = $footerRow.find(`td.editable-footer[data-field="${field}"]`);
                            if ($footerCell.length > 0) {
                                selectCell(projectId, $footerCell[0]);
                            }
                        }
                    }, 50);
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            $dropdown.remove();
            // Re-select the cell
            setTimeout(() => {
                if (rowIndex !== null && rowIndex !== undefined) {
                    let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                    let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                    if ($newCell.length > 0) {
                        selectCell(projectId, $newCell[0]);
                    }
                }
            }, 50);
        } else {
            // Any other key - switch to free text input with that character
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                $dropdown.remove();
                showUnitFreeTextInput(projectId, $cell, e.key, onSelect, blockId, rowIndex, field);
            }
        }
    });
}

function showUnitFreeTextInput(projectId, $cell, initialValue, onSelect, blockId, rowIndex, field) {
    $cell.addClass('editing');
    
    let input = $('<input type="text">').val(initialValue || '');
    $cell.html(input);
    input.focus();
    
    // Position cursor at end
    let len = input.val().length;
    input[0].setSelectionRange(len, len);
    
    let saveAndExit = function() {
        let newValue = input.val().trim();
        $cell.removeClass('editing');
        onSelect(newValue);
        
        // Re-select the cell after validation
        setTimeout(() => {
            if (rowIndex !== null && rowIndex !== undefined) {
                let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                if ($newCell.length > 0) {
                    selectCell(projectId, $newCell[0]);
                }
            } else {
                // Footer cell
                let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
                let $footerCell = $footerRow.find(`td.editable-footer[data-field="${field}"]`);
                if ($footerCell.length > 0) {
                    selectCell(projectId, $footerCell[0]);
                }
            }
        }, 50);
    };
    
    let cancelEdit = function() {
        $cell.removeClass('editing');
        renderMetreTable(projectId);
        
        setTimeout(() => {
            if (rowIndex !== null && rowIndex !== undefined) {
                let $newRow = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"][data-block-id="${blockId}"]`);
                let $newCell = $newRow.find(`td.editable[data-field="${field}"]`);
                if ($newCell.length > 0) {
                    selectCell(projectId, $newCell[0]);
                }
            }
        }, 50);
    };
    
    input.on('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            saveAndExit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });
    
    input.on('blur', function() {
        setTimeout(() => {
            if ($cell.hasClass('editing')) {
                saveAndExit();
            }
        }, 100);
    });
}

function startEditingFooterCell(projectId, cell, blockId, field, initialValue) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.footer) return;
    
    let $cell = $(cell);
    
    // Special handling for Ens field - simple toggle between "Ens." and ""
    if (field === 'ens') {
        let currentValue = block.footer.ens || '';
        
        // Toggle between "Ens." and ""
        if (currentValue === 'Ens.') {
            block.footer.ens = '';
        } else {
            block.footer.ens = 'Ens.';
        }
        
        renderMetreTable(projectId);
        
        // Re-select the cell after render
        setTimeout(() => {
            let $footerRow = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
            let $footerCell = $footerRow.find('td[data-field="ens"]');
            if ($footerCell.length > 0) {
                selectCell(projectId, $footerCell[0]);
            }
        }, 50);
        return;
    }
    
    // Special handling for Unit field in footer - Excel-style dropdown
    if (field === 'unit') {
        showUnitDropdown(projectId, $cell, block.footer[field] || '', function(selectedValue) {
            block.footer[field] = selectedValue;
            renderMetreTable(projectId);
        }, blockId, null, field);
        return;
    }
    
    // Handle text fields (pu)
    let currentValue = block.footer[field];
    let displayValue = '';
    
    if (currentValue && typeof currentValue === 'object') {
        if (currentValue.type === 'variable') {
            displayValue = currentValue.name;
        } else if (currentValue.type === 'value') {
            displayValue = currentValue.value;
        }
    } else {
        displayValue = currentValue || '';
    }
    
    $cell.addClass('editing');
    let input = $('<input type="text">').val(initialValue !== undefined ? initialValue : displayValue);
    $cell.html(input);
    input.focus();
    
    // Position cursor at end
    let len = input.val().length;
    input[0].setSelectionRange(len, len);
    
    input.on('blur keydown', function(e) {
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        
        let newValue = input.val().trim();
        $cell.removeClass('editing');
        
        // Handle empty value
        if (newValue === '') {
            if (field === 'unit') {
                block.footer[field] = '';
            } else {
                block.footer[field] = null;
            }
            renderMetreTable(projectId);
            return;
        }
        
        // Handle text fields
        if (field === 'unit') {
            block.footer[field] = newValue;
            renderMetreTable(projectId);
            return;
        }
        
        // Check if it's a variable pattern for PU
        if (isVariablePattern(newValue)) {
            let varName = newValue.toUpperCase();
            
            if (project.variables[varName]) {
                block.footer[field] = createVariableField(varName, false);
            } else {
                let numValue = getValue(currentValue, project.variables);
                project.variables[varName] = {
                    declaration: {
                        posteId: project.currentPoste.id,
                        posteName: project.currentPoste.name,
                        type: 'footer',
                        blockId: blockId,
                        field: field
                    },
                    calls: [],
                    value: numValue
                };
                block.footer[field] = createVariableField(varName, true);
                renderVariables(projectId);
            }
            renderMetreTable(projectId);
            return;
        }
        
        // Parse as number
        let num = parseFloat(newValue);
        if (!isNaN(num)) {
            block.footer[field] = createValueField(num);
        } else {
            block.footer[field] = newValue;
        }
        
        renderMetreTable(projectId);
    });
}

function updateSelection(projectId) {
    let sum = 0;
    let count = 0;
    let formulaText = '';
    
    $(`#workspace-${projectId} .metre-table td.selected`).each(function() {
        // Get only the text content, excluding any child elements (like badges)
        let $cell = $(this).clone();
        $cell.find('.variable-badge').remove(); // Remove badge from clone
        let text = $cell.text().trim();
        let value = parseFloat(text.replace(/[^\d.-]/g, ''));
        if (!isNaN(value)) sum += value;
        count++;
    });
    
    // Si une seule cellule est sélectionnée, chercher si elle contient une formule
    if (count === 1) {
        let $selectedCell = $(`#workspace-${projectId} .metre-table td.selected`);
        let $row = $selectedCell.closest('tr');
        let rowIndex = parseInt($row.data('row'));
        let blockId = $row.data('block-id');
        let field = $selectedCell.data('field');
        
        if (!isNaN(rowIndex) && blockId && field) {
            let project = projects[projectId];
            if (project && project.currentPoste) {
                let block = project.currentPoste.blocks.find(b => b.id === blockId);
                if (block && block.data && block.data[rowIndex]) {
                    let row = block.data[rowIndex];
                    
                    // Mapper le champ d'affichage vers le champ de données
                    let actualField = field;
                    if (field === 'valplus' || field === 'valmoins') {
                        actualField = 'valeurForcee';
                    }
                    
                    let cellData = row[actualField];
                    if (cellData && typeof cellData === 'object' && cellData.type === 'formula') {
                        formulaText = cellData.formula;
                    }
                }
            }
        }
    }
    
    $('#sum-val').text(formatNumber(sum));
    $('#cell-count').text(count);
    
    // Afficher ou masquer le label de formule
    if (formulaText) {
        $('#formula-text').text(formulaText);
        $('#formula-display').attr('title', formulaText).show();
    } else {
        $('#formula-display').hide();
    }
}

function showTableContextMenu(projectId, e, rowIndex, blockId) {
    e.preventDefault();
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: '➕ Ajouter ligne', action: () => addRowAt(projectId, rowIndex + 1, blockId) },
        { label: '🗑️ Supprimer ligne', action: () => deleteRowAt(projectId, rowIndex, blockId) },
        { separator: true },
        { label: '⬆️ Monter ligne', action: () => moveRowUpAt(projectId, rowIndex, blockId) },
        { label: '⬇️ Descendre ligne', action: () => moveRowDownAt(projectId, rowIndex, blockId) },
        { separator: true },
        { label: '📋 Copier ligne', action: () => copyRowAt(projectId, rowIndex, blockId) },
        { label: '📌 Coller ligne', action: () => pasteRowAt(projectId, rowIndex + 1), disabled: !project.copiedRow }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item ${item.disabled ? 'disabled' : ''}">${item.label}</div>`);
            
            if (!item.disabled) {
                menuItem.on('click', () => {
                    item.action();
                    contextMenu.remove();
                    contextMenu = null;
                });
            } else {
                menuItem.css({ opacity: 0.5, cursor: 'not-allowed' });
            }
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
        $('.context-submenu').remove();
    });
}

// Show submenu for calling existing variables
function showVariableCallSubmenu(projectId, rowIndex, $parentItem) {
    let project = projects[projectId];
    let submenu = $('<div class="context-submenu context-menu"></div>');
    
    if (Object.keys(project.variables).length === 0) {
        submenu.append('<div class="context-menu-item" style="opacity:0.5; cursor:not-allowed;">Aucune variable</div>');
    } else {
        // Sort variables by type and number
        let sortedVars = Object.keys(project.variables).sort();
        
        sortedVars.forEach(varName => {
            let item = $(`<div class="context-menu-item">${varName}</div>`);
            item.on('click', () => {
                callExistingVariable(projectId, rowIndex, varName);
                contextMenu.remove();
                contextMenu = null;
                submenu.remove();
            });
            submenu.append(item);
        });
    }
    
    // Position submenu to the right of parent item
    let parentOffset = $parentItem.offset();
    let parentWidth = $parentItem.outerWidth();
    
    submenu.css({
        position: 'absolute',
        left: (parentOffset.left + parentWidth) + 'px',
        top: parentOffset.top + 'px'
    });
    
    $('body').append(submenu);
}

// Call an existing variable (for context menu)
function callExistingVariable(projectId, rowIndex, varName) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    // Ask which field to apply the variable to
    let field = prompt(`Appliquer la variable ${varName} à quelle colonne ?\nOptions: n, l, larg, h, ens, pu, val+ (ou val-), qte`);
    if (!field) return;
    
    field = field.toLowerCase().trim();
    
    // Map user input to internal field names
    let fieldMapping = {
        'n': 'n',
        'l': 'l',
        'larg': 'larg',
        'h': 'h',
        'ens': 'ens',
        'pu': 'pu',
        'val+': 'valeurForcee',
        'val-': 'valeurForcee',
        'qte': 'qteForcee'
    };
    
    let internalField = fieldMapping[field];
    
    if (!internalField) {
        alert('Colonne invalide. Utilisez: n, l, larg, h, ens, pu, val+, val-, ou qte');
        return;
    }
    
    let row = project.currentPoste.data[rowIndex];
    
    // Create variable call
    row[internalField] = createVariableField(varName, false);
    
    // Add to variable's calls list
    if (!project.variables[varName].calls) {
        project.variables[varName].calls = [];
    }
    project.variables[varName].calls.push({
        posteId: project.currentPoste.id,
        posteName: project.currentPoste.name,
        rowIndex: rowIndex,
        field: internalField
    });
    
    renderMetreTable(projectId);
    renderVariables(projectId);
}

// ===== NOUVEAU SYSTÈME DE VARIABLES =====
// Assigner une variable à une cellule spécifique
function assignVariableToCell(projectId, blockId, rowIndex, field, type) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    // Obtenir la valeur actuelle de la cellule
    let cellValue = getCellValue(projectId, blockId, rowIndex, field);
    
    // Générer le prochain nom de variable (L1, L2, S1, etc.)
    let varName = getNextVariableName(projectId, type);
    
    // Obtenir la description auto (depuis la désignation de la ligne - colonne B)
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    let autoDescription = '';
    
    if (rowIndex === 'footer') {
        // Pour le footer, utiliser le nom du bloc file précédent ou le nom du poste
        let blockIndex = project.currentPoste.blocks.indexOf(block);
        if (blockIndex > 0) {
            let prevBlock = project.currentPoste.blocks[blockIndex - 1];
            if (prevBlock && prevBlock.type === 'file') {
                autoDescription = prevBlock.fileName || '';
            }
        }
        if (!autoDescription) {
            autoDescription = 'Footer - ' + field;
        }
    } else if (block && block.data && block.data[rowIndex]) {
        // Pour les lignes normales, prendre la colonne B (designation)
        autoDescription = block.data[rowIndex].designation || '';
    }
    
    // Stocker la variable avec timestamp pour le tri par ordre de déclaration
    project.variables[varName] = {
        blockId: blockId,
        rowIndex: rowIndex,
        field: field,
        value: cellValue,
        description: autoDescription,
        posteId: project.currentPoste.id,
        posteName: project.currentPoste.name,
        createdAt: Date.now()
    };
    
    console.log(`[VARIABLE] Assigned ${varName} to cell ${field} at row ${rowIndex}, value: ${cellValue}, description: ${autoDescription}`);
    
    // Mettre à jour les affichages
    renderMetreTable(projectId);
    renderVariables(projectId);
    saveProjectToStorage(projectId);
}

// Mettre à jour les valeurs de toutes les variables depuis le DOM
function updateAllVariableValues(projectId) {
    let project = projects[projectId];
    if (!project || !project.variables) return;
    
    Object.keys(project.variables).forEach(varName => {
        let varData = project.variables[varName];
        if (varData.blockId !== undefined && varData.field !== undefined) {
            // Lire la valeur depuis le DOM
            let value = getCellValue(projectId, varData.blockId, varData.rowIndex, varData.field);
            varData.value = value;
        }
    });
}

// Calculer la valeur d'une cellule depuis les DONNÉES (pas le DOM)
// Obtenir la valeur d'une cellule spécifique - lire directement depuis le DOM
function getCellValue(projectId, blockId, rowIndex, field) {
    let $row;
    if (rowIndex === -1 || rowIndex === 'footer') {
        $row = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${blockId}"]`);
    } else {
        $row = $(`#workspace-${projectId} .metre-table tr[data-block-id="${blockId}"][data-row="${rowIndex}"]`);
    }
    
    if ($row.length === 0) return 0;
    
    let $cell = $row.find(`td[data-field="${field}"]`);
    if ($cell.length === 0) return 0;
    
    // Lire le texte de la cellule et convertir en nombre
    let text = $cell.text().trim();
    
    // Enlever les badges de variables s'il y en a
    text = text.replace(/[LSV]\d+/g, '').trim();
    
    // Enlever les espaces et caractères non numériques sauf - et .
    text = text.replace(/[^\d\-.,]/g, '');
    
    // Remplacer la virgule par un point pour le parsing
    text = text.replace(',', '.');
    
    let value = parseFloat(text);
    return isNaN(value) ? 0 : Math.abs(value);
}

// Calculer le total Val+ d'un bloc
function calculateBlockTotalValPlus(block, variables) {
    if (!block.data) return 0;
    let total = 0;
    block.data.forEach(row => {
        if (row.isSubtotalRow) return;
        let value = 0;
        if (row.valeurForcee) {
            value = getValue(row.valeurForcee, variables);
        } else {
            let totalL = row.totalLForcee ? getValue(row.totalLForcee, variables) : calculateTotalL(row, variables);
            let larg = getValue(row.larg, variables) || 1;
            let h = getValue(row.h, variables) || 1;
            let ens = row.ens === 'Ens.' ? 1 : 0;
            value = ens === 0 ? (totalL || 0) * larg * h : (totalL || 0);
        }
        if (!row.isDeduction) {
            total += Math.abs(value);
        }
    });
    return total;
}

// Calculer le total Val- d'un bloc
function calculateBlockTotalValMoins(block, variables) {
    if (!block.data) return 0;
    let total = 0;
    block.data.forEach(row => {
        if (row.isSubtotalRow) return;
        let value = 0;
        if (row.valeurForcee) {
            value = getValue(row.valeurForcee, variables);
        } else {
            let totalL = row.totalLForcee ? getValue(row.totalLForcee, variables) : calculateTotalL(row, variables);
            let larg = getValue(row.larg, variables) || 1;
            let h = getValue(row.h, variables) || 1;
            let ens = row.ens === 'Ens.' ? 1 : 0;
            value = ens === 0 ? (totalL || 0) * larg * h : (totalL || 0);
        }
        if (row.isDeduction) {
            total += Math.abs(value);
        }
    });
    return total;
}

// Calculer la Qté Total d'un bloc
function calculateBlockQteTotal(block, variables) {
    let totalPlus = calculateBlockTotalValPlus(block, variables);
    let totalMoins = calculateBlockTotalValMoins(block, variables);
    return totalPlus - totalMoins;
}

// Trouver la variable assignée à une cellule
function findVariableForCell(projectId, blockId, rowIndex, field) {
    let project = projects[projectId];
    if (!project.variables) return null;
    
    for (let varName in project.variables) {
        let v = project.variables[varName];
        if (v.blockId === blockId && v.rowIndex === rowIndex && v.field === field) {
            return varName;
        }
    }
    return null;
}

// Menu contextuel pour les cellules (clic droit sur une cellule)
function showCellContextMenu(projectId, e, blockId, rowIndex, field) {
    e.preventDefault();
    e.stopPropagation();
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    // Vérifier si une variable est déjà assignée à cette cellule
    let existingVar = findVariableForCell(projectId, blockId, rowIndex, field);
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [];
    
    // ===== Options d'appel de variable (avec sous-menu) =====
    let varList = Object.keys(project.variables || {});
    if (varList.length > 0) {
        // Regrouper par type
        let varsByType = { L: [], S: [], V: [] };
        varList.forEach(v => {
            let type = v.charAt(0).toUpperCase();
            if (varsByType[type]) {
                varsByType[type].push(v);
            }
        });
        
        // Trier chaque groupe par numéro
        ['L', 'S', 'V'].forEach(type => {
            varsByType[type].sort((a, b) => {
                let numA = parseInt(a.substring(1));
                let numB = parseInt(b.substring(1));
                return numA - numB;
            });
        });
        
        // Créer le sous-menu d'appel de variable
        let callSubmenu = [];
        if (varsByType.L.length > 0) {
            varsByType.L.forEach(v => callSubmenu.push({ label: v, action: () => insertVariableCall(projectId, blockId, rowIndex, field, v) }));
        }
        if (varsByType.S.length > 0) {
            varsByType.S.forEach(v => callSubmenu.push({ label: v, action: () => insertVariableCall(projectId, blockId, rowIndex, field, v) }));
        }
        if (varsByType.V.length > 0) {
            varsByType.V.forEach(v => callSubmenu.push({ label: v, action: () => insertVariableCall(projectId, blockId, rowIndex, field, v) }));
        }
        
        if (callSubmenu.length > 0) {
            menuItems.push({ 
                label: '📞 Appel Variable ▸', 
                submenu: callSubmenu
            });
            menuItems.push({ separator: true });
        }
    }
    
    // ===== Options pour assigner une variable =====
    menuItems.push({ label: '📏 Variable L', action: () => assignVariableToCell(projectId, blockId, rowIndex, field, 'L') });
    menuItems.push({ label: '📐 Variable S', action: () => assignVariableToCell(projectId, blockId, rowIndex, field, 'S') });
    menuItems.push({ label: '📦 Variable V', action: () => assignVariableToCell(projectId, blockId, rowIndex, field, 'V') });
    
    // ===== Options de manipulation de lignes =====
    menuItems.push({ separator: true });
    menuItems.push({ label: '➕ Ajouter ligne', action: () => addRowAt(projectId, rowIndex + 1, blockId) });
    menuItems.push({ label: '🗑️ Supprimer ligne', action: () => deleteRowAt(projectId, rowIndex, blockId) });
    
    menuItems.push({ separator: true });
    menuItems.push({ label: '⬆️ Monter ligne', action: () => moveRowUpAt(projectId, rowIndex, blockId) });
    menuItems.push({ label: '⬇️ Descendre ligne', action: () => moveRowDownAt(projectId, rowIndex, blockId) });
    
    menuItems.push({ separator: true });
    menuItems.push({ label: '📋 Copier ligne', action: () => copyRowAt(projectId, rowIndex, blockId) });
    menuItems.push({ label: '📌 Coller ligne', action: () => pasteRowAt(projectId, rowIndex, blockId), disabled: !project.copiedRow });
    
    // ===== Option pour supprimer la variable si existante =====
    if (existingVar) {
        menuItems.push({ separator: true });
        menuItems.push({ label: `❌ Supprimer variable ${existingVar}`, action: () => removeVariable(projectId, existingVar) });
    }
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else if (item.submenu) {
            // Item avec sous-menu
            let menuItem = $(`<div class="context-menu-item has-submenu">${item.label}</div>`);
            let submenu = $('<div class="context-submenu"></div>');
            
            item.submenu.forEach(subItem => {
                let subMenuItem = $(`<div class="context-menu-item">${subItem.label}</div>`);
                subMenuItem.on('click', (e) => {
                    e.stopPropagation();
                    subItem.action();
                    contextMenu.remove();
                    contextMenu = null;
                });
                submenu.append(subMenuItem);
            });
            
            menuItem.append(submenu);
            menuItem.on('mouseenter', function() {
                // Positionner le sous-menu
                let $this = $(this);
                let $sub = $this.find('.context-submenu');
                $sub.css({
                    display: 'block',
                    left: $this.outerWidth() - 2 + 'px',
                    top: '0'
                });
            });
            menuItem.on('mouseleave', function() {
                $(this).find('.context-submenu').hide();
            });
            contextMenu.append(menuItem);
        } else {
            let disabledClass = item.disabled ? ' disabled' : '';
            let disabledStyle = item.disabled ? ' style="color:#ccc; cursor:not-allowed;"' : '';
            let menuItem = $(`<div class="context-menu-item${disabledClass}"${disabledStyle}>${item.label}</div>`);
            if (!item.disabled) {
                menuItem.on('click', () => {
                    item.action();
                    contextMenu.remove();
                    contextMenu = null;
                });
            }
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Insérer un appel de variable dans une cellule (depuis le menu contextuel)
function insertVariableCall(projectId, blockId, rowIndex, field, varName) {
    let project = projects[projectId];
    if (!project || !project.currentPoste) return;
    
    // Trouver le bloc et la ligne
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data || !block.data[rowIndex]) {
        return;
    }
    
    let row = block.data[rowIndex];
    
    // Mapper le field vers le champ interne
    let actualField = field;
    if (field === 'totall') actualField = 'l';
    
    // Créer l'appel de variable
    row[actualField] = createVariableField(varName, false);
    
    // Ajouter aux appels de la variable
    if (project.variables[varName]) {
        if (!project.variables[varName].calls) {
            project.variables[varName].calls = [];
        }
        project.variables[varName].calls.push({
            posteId: project.currentPoste.id,
            posteName: project.currentPoste.name,
            blockId: blockId,
            rowIndex: rowIndex,
            field: actualField
        });
    }
    
    // Si c'est dans la colonne L, auto-remplir N et Op si vides et créer sous-total
    if (field === 'l' || field === 'totall') {
        if (!row.n || row.n === '' || row.n === null || row.n === 0) {
            row.n = createValueField(1);
        }
        if (!row.op || row.op === '' || row.op === null) {
            row.op = 'fs';
        }
        
        // Créer le sous-total si nécessaire
        autoCreateSubtotalIfNeeded(projectId, blockId, rowIndex, block, row);
        return;
    }
    
    // Re-render
    renderMetreTable(projectId);
    saveProjectToStorage(projectId);
}

// Fonction pour créer automatiquement le sous-total après une ligne avec Total L
function autoCreateSubtotalIfNeeded(projectId, blockId, rowIndex, block, row) {
    let project = projects[projectId];
    
    // Calculer le Total L pour cette ligne
    // Si c'est un appel de variable, utiliser la valeur de la variable
    let totalL = 0;
    
    let lValue = row.l;
    if (lValue && typeof lValue === 'object' && lValue.type === 'variable') {
        // C'est un appel de variable - utiliser la valeur de la variable
        let varData = project.variables[lValue.name];
        if (varData && varData.value) {
            totalL = varData.value;
        }
    } else if (row.totalLForcee) {
        totalL = getValue(row.totalLForcee, project.variables);
    } else {
        totalL = calculateTotalL(row, project.variables);
    }
    
    // Si Total L est non-zéro, vérifier s'il y a déjà un sous-total après cette ligne
    if (totalL !== 0) {
        let needsSubtotal = true;
        
        // Chercher un sous-total existant après cette ligne
        for (let j = rowIndex + 1; j < block.data.length; j++) {
            let checkRow = block.data[j];
            let checkL = checkRow.l;
            let isCheckSubtotal = checkRow.isSubtotalRow === true ||
                                 (typeof checkL === 'string' && checkL.toLowerCase() === 'ens.') ||
                                 (checkL && typeof checkL === 'object' && checkL.type === 'value' && 
                                  typeof checkL.value === 'string' && checkL.value.toLowerCase() === 'ens.');
            
            if (isCheckSubtotal) {
                needsSubtotal = false;
                break;
            }
        }
        
        // Créer sous-total + nouvelle ligne si nécessaire
        if (needsSubtotal) {
            let subtotalRow = createSubtotalRow();
            let emptyRow = createEmptyRow();
            block.data.splice(rowIndex + 1, 0, subtotalRow, emptyRow);
            console.log('[SOUS-TOTAL] Auto-created subtotal + new row after row', rowIndex);
        }
    }
    
    renderMetreTable(projectId);
    saveProjectToStorage(projectId);
}

// Supprimer une variable
function removeVariable(projectId, varName) {
    let project = projects[projectId];
    if (project.variables && project.variables[varName]) {
        delete project.variables[varName];
        renderMetreTable(projectId);
        renderVariables(projectId);
        saveProjectToStorage(projectId);
    }
}

// L'ancienne fonction assignVariable - conservée pour compatibilité mais redirige vers le nouveau système
function assignVariable(projectId, rowIndex, type, blockId) {
    // Cette fonction n'est plus utilisée directement
    // Le nouveau système utilise assignVariableToCell avec le field spécifique
    alert("Utilisez le clic droit directement sur la cellule pour assigner une variable.");
}

function addRowAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    block.data.splice(index, 0, createEmptyRow());
    renderMetreTable(projectId);
}

function deleteRowAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    block.data.splice(index, 1);
    renderMetreTable(projectId);
}

function moveRowUpAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || index === 0) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    let data = block.data;
    [data[index - 1], data[index]] = [data[index], data[index - 1]];
    renderMetreTable(projectId);
}

function moveRowDownAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    let data = block.data;
    if (index === data.length - 1) return;
    
    [data[index], data[index + 1]] = [data[index + 1], data[index]];
    renderMetreTable(projectId);
}

function copyRowAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    project.copiedRow = JSON.parse(JSON.stringify(block.data[index]));
    alert('Ligne copiée !');
}

function pasteRowAt(projectId, index, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.copiedRow) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data) return;
    
    block.data.splice(index, 0, JSON.parse(JSON.stringify(project.copiedRow)));
    renderMetreTable(projectId);
}

function parseValue(val) {
    if (val === null || val === undefined || val === '') return 0;
    return parseFloat(val) || 0;
}

function calculateTotalL(row, variables) {
    let n = getValue(row.n, variables);
    let op = row.op || 'fs';
    let l = getValue(row.l, variables);
    
    if (op === 'fs') return n * l;
    if (op === 'ft') return n * (n + 1) / 2 * l;
    return n * l;
}

function calculateValue(row, variables) {
    let totalL = calculateTotalL(row, variables);
    let larg = getValue(row.larg, variables);
    let h = getValue(row.h, variables);
    let ens = getValue(row.ens, variables);
    
    let result = totalL;
    if (larg > 0) result *= larg;
    if (h > 0) result *= h;
    if (ens > 0) result *= ens;
    
    return row.isDeduction ? -result : result;
}

// Calculate Qté Total for a row
function calculateQteTotal(row, variables) {
    if (row.qteForcee) {
        return getValue(row.qteForcee, variables);
    }
    
    let value;
    if (row.valeurForcee) {
        value = getValue(row.valeurForcee, variables);
        if (row.isDeduction) value = -value;
    } else {
        value = calculateValue(row, variables);
    }
    
    return value;
}

function formatNumber(num, decimals) {
    // Return empty string for null/undefined/NaN
    if (num === null || num === undefined || isNaN(num)) return '';
    
    // Return empty string for zero values
    if (num === 0 || num === '0') return '';
    
    // Convert to number if string
    if (typeof num === 'string') {
        num = parseFloat(num);
        if (isNaN(num)) return '';
    }
    
    if (decimals === undefined) decimals = 2; // Force 2 decimals by default
    let fixed = num.toFixed(decimals);
    
    // Replace decimal separator if needed
    if (appSettings.format.decimalSeparator === ',') {
        fixed = fixed.replace('.', ',');
    }
    
    return fixed;
}

// ===== VARIABLE SYSTEM HELPERS (v0.06) =====

// Check if text matches variable pattern (L1, S2, V3, etc.)
function isVariablePattern(text) {
    if (!text || typeof text !== 'string') return false;
    text = text.trim().toUpperCase();
    // Match L, S, or V followed by one or more digits
    return /^[LSV]\d+$/.test(text);
}

// Get the actual numeric value from a field (handles both values and variables)
function getValue(field, variables, projectId) {
    if (!field) return 0;
    
    // Simple number
    if (typeof field === 'number') return field;
    
    // Object
    if (typeof field === 'object') {
        if (field.type === 'variable') {
            // Variable = simplement retourner la valeur stockée
            let varData = variables ? variables[field.name] : null;
            return varData ? (varData.value || 0) : 0;
        }
        if (field.type === 'value') {
            return field.value || 0;
        }
        if (field.type === 'formula') {
            return field.value || 0;
        }
    }
    
    // Try to parse as number
    let num = parseFloat(field);
    return isNaN(num) ? 0 : num;
}

// Find all usages of a variable in a project
function findVariableUsages(projectId, varName) {
    let project = projects[projectId];
    let usages = {
        declaration: null,
        calls: []
    };
    
    function traverseNode(node) {
        if (node.type === 'poste') {
            // Support new blocks structure
            if (node.blocks) {
                node.blocks.forEach((block, blockIndex) => {
                    if (block.type === 'table' && block.data) {
                        block.data.forEach((row, rowIndex) => {
                            // Check all fields in the row
                            ['code', 'designation', 'n', 'op', 'l', 'larg', 'h', 'ens', 'unit', 'pu', 'valplus', 'valmoins'].forEach(field => {
                                if (row[field] && typeof row[field] === 'object' && row[field].type === 'variable' && row[field].name === varName) {
                                    let usage = {
                                        posteId: node.id,
                                        posteName: node.name,
                                        blockId: block.id,
                                        blockIndex: blockIndex,
                                        rowIndex: rowIndex,
                                        field: field
                                    };
                                    
                                    if (row[field].isDeclaration) {
                                        usages.declaration = usage;
                                    } else {
                                        usages.calls.push(usage);
                                    }
                                }
                            });
                        });
                        
                        // Check footer too
                        if (block.footer) {
                            ['l', 'larg', 'h', 'ens', 'pu', 'valplus', 'valmoins'].forEach(field => {
                                if (block.footer[field] && typeof block.footer[field] === 'object' && 
                                    block.footer[field].type === 'variable' && block.footer[field].name === varName) {
                                    let usage = {
                                        posteId: node.id,
                                        posteName: node.name,
                                        blockId: block.id,
                                        blockIndex: blockIndex,
                                        isFooter: true,
                                        field: field
                                    };
                                    
                                    if (block.footer[field].isDeclaration) {
                                        usages.declaration = usage;
                                    } else {
                                        usages.calls.push(usage);
                                    }
                                }
                            });
                        }
                    }
                });
            }
            
            // Support old data structure for backward compatibility
            if (node.data) {
                node.data.forEach((row, rowIndex) => {
                    // Check all fields in the row
                    ['code', 'designation', 'n', 'op', 'l', 'larg', 'h', 'ens', 'unit', 'pu', 'valplus', 'valmoins'].forEach(field => {
                        if (row[field] && typeof row[field] === 'object' && row[field].type === 'variable' && row[field].name === varName) {
                            let usage = {
                                posteId: node.id,
                                posteName: node.name,
                                rowIndex: rowIndex,
                                field: field
                            };
                            
                            if (row[field].isDeclaration) {
                                usages.declaration = usage;
                            } else {
                                usages.calls.push(usage);
                            }
                        }
                    });
                });
            }
        }
        
        if (node.children) {
            node.children.forEach(child => traverseNode(child));
        }
    }
    
    project.treeData.forEach(node => traverseNode(node));
    return usages;
}

// Get variable type from name (L, S, or V)
function getVariableType(varName) {
    if (!varName) return null;
    let firstChar = varName.charAt(0).toUpperCase();
    if (firstChar === 'L') return 'L';
    if (firstChar === 'S') return 'S';
    if (firstChar === 'V') return 'V';
    return null;
}

// Get next available variable name for a type
function getNextVariableName(projectId, type) {
    let project = projects[projectId];
    let maxNum = 0;
    
    Object.keys(project.variables).forEach(varName => {
        if (varName.startsWith(type)) {
            let num = parseInt(varName.substring(1));
            if (!isNaN(num) && num > maxNum) {
                maxNum = num;
            }
        }
    });
    
    return type + (maxNum + 1);
}

// ===== VARIABLES FUNCTIONS =====
function renderVariables(projectId) {
    let project = projects[projectId];
    
    // Initialiser le mode de tri si nécessaire
    if (!project.variablesSortMode) {
        project.variablesSortMode = 'alpha'; // 'alpha' ou 'declaration'
    }
    
    let sortedVars;
    if (project.variablesSortMode === 'alpha') {
        // Tri alphabétique: L1, L2, L3, S1, S2, V1, V2...
        sortedVars = Object.entries(project.variables).sort((a, b) => {
            let typeA = getVariableType(a[0]);
            let typeB = getVariableType(b[0]);
            
            // First sort by type (L < S < V)
            if (typeA !== typeB) {
                if (typeA === 'L') return -1;
                if (typeB === 'L') return 1;
                if (typeA === 'S') return -1;
                if (typeB === 'S') return 1;
            }
            
            // Then sort by number
            let numA = parseInt(a[0].substring(1));
            let numB = parseInt(b[0].substring(1));
            return numA - numB;
        });
    } else {
        // Tri par ordre de déclaration (timestamp)
        sortedVars = Object.entries(project.variables).sort((a, b) => {
            let timeA = a[1].createdAt || 0;
            let timeB = b[1].createdAt || 0;
            return timeA - timeB;
        });
    }
    
    let html = `
        <div style="display:flex; flex-direction:column; height:100%; padding:10px; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-shrink:0;">
                <div style="font-size:11px; color:#666;">VARIABLES (${sortedVars.length})</div>
                <div style="display:flex; gap:3px;">
                    <button class="var-sort-btn ${project.variablesSortMode === 'alpha' ? 'active' : ''}" data-sort="alpha" data-project-id="${projectId}" title="Tri alphabétique (L1, L2, S1...)" style="font-size:9px; padding:2px 5px; cursor:pointer; border:1px solid #ccc; border-radius:3px; background:${project.variablesSortMode === 'alpha' ? '#3498db' : '#fff'}; color:${project.variablesSortMode === 'alpha' ? '#fff' : '#333'};">A-Z</button>
                    <button class="var-sort-btn ${project.variablesSortMode === 'declaration' ? 'active' : ''}" data-sort="declaration" data-project-id="${projectId}" title="Tri par déclaration" style="font-size:9px; padding:2px 5px; cursor:pointer; border:1px solid #ccc; border-radius:3px; background:${project.variablesSortMode === 'declaration' ? '#3498db' : '#fff'}; color:${project.variablesSortMode === 'declaration' ? '#fff' : '#333'};">1-2-3</button>
                </div>
            </div>
            <div class="variables-list" style="flex:1; overflow-y:auto; overflow-x:hidden;">
    `;
    
    if (sortedVars.length === 0) {
        html += '<div style="padding:20px; text-align:center; color:#999; font-size:11px;">Aucune variable.<br>Clic droit sur une cellule pour assigner une variable.</div>';
    } else {
        sortedVars.forEach(([varName, varData]) => {
            let varType = getVariableType(varName);
            
            // Utiliser simplement la valeur stockée
            let value = varData.value || 0;
            
            let description = varData.description || varName;
            
            html += `
                <div class="variable-item" data-var-name="${varName}" data-project-id="${projectId}" style="margin-bottom:4px; padding:4px 6px; background:#f9f9f9; border-radius:4px; cursor:pointer;">
                    <div style="display: flex; align-items: center;">
                        <span class="variable-badge var-declaration" data-var-name="${varName}" data-var-type="${varType}" data-project-id="${projectId}" style="cursor:pointer; position:relative; top:auto; right:auto; min-width:28px; text-align:center;">${varName}</span>
                        <span class="variable-value" style="font-weight:bold; width:55px; font-size:11px; text-align:right; margin-left:6px;">${formatNumber(value)}</span>
                        <span class="variable-description" style="color:#666; font-size:10px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-left:8px;" title="Double-clic pour modifier">${description}</span>
                        <button class="insert-var-btn" data-var-name="${varName}" data-project-id="${projectId}" title="Insérer dans la cellule sélectionnée" style="background:none; border:none; cursor:pointer; font-size:11px; padding:2px 4px; color:#27ae60;">➜</button>
                        <button class="delete-var-btn" onclick="event.stopPropagation(); removeVariable('${projectId}', '${varName}')" title="Supprimer" style="background:none; border:none; cursor:pointer; font-size:12px; padding:2px 0 2px 4px; color:#e74c3c;">🗑️</button>
                    </div>
                </div>`;
        });
    }
    
    html += '</div></div>';
    $(`.variables-panel-${projectId}`).html(html);
    
    // Event pour les boutons de tri
    $(`.variables-panel-${projectId} .var-sort-btn`).on('click', function() {
        let sortMode = $(this).data('sort');
        let pid = $(this).data('project-id');
        projects[pid].variablesSortMode = sortMode;
        renderVariables(pid);
    });
    
    // Click on variable badge - flash la cellule source
    $(`.variables-panel-${projectId} .variable-badge`).on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        let varName = $(this).data('var-name');
        let pid = $(this).data('project-id');
        flashVariableCell(pid, varName);
    });
    
    // Bouton d'insertion de variable dans la cellule sélectionnée
    $(`.variables-panel-${projectId} .insert-var-btn`).on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        let varName = $(this).data('var-name');
        let pid = $(this).data('project-id');
        insertVariableInSelectedCell(pid, varName);
    });
    
    $(`.variables-panel-${projectId} .variable-item`).on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        let varName = $(this).data('var-name');
        let pid = $(this).data('project-id');
        showVariableContextMenu(pid, varName, e);
        return false;
    });
    
    // Double-click on description to edit
    $(`.variables-panel-${projectId} .variable-description`).on('dblclick', function(e) {
        e.stopPropagation();
        let varName = $(this).closest('.variable-item').data('var-name');
        let pid = $(this).closest('.variable-item').data('project-id');
        renameVariableDescription(pid, varName);
    });
    
    // Mettre à jour les compteurs dans le footer
    updateVariableCounters(projectId);
}

// Mettre à jour les compteurs de variables dans le footer du logiciel
function updateVariableCounters(projectId) {
    let project = projects[projectId];
    if (!project || !project.variables) return;
    
    let maxL = 0, maxS = 0, maxV = 0;
    
    Object.keys(project.variables).forEach(varName => {
        let type = varName.charAt(0).toUpperCase();
        let num = parseInt(varName.substring(1)) || 0;
        
        if (type === 'L' && num > maxL) maxL = num;
        if (type === 'S' && num > maxS) maxS = num;
        if (type === 'V' && num > maxV) maxV = num;
    });
    
    $('#var-counter-L').text('L' + maxL);
    $('#var-counter-S').text('S' + maxS);
    $('#var-counter-V').text('V' + maxV);
}

// Insérer une variable dans la cellule sélectionnée
function insertVariableInSelectedCell(projectId, varName) {
    let project = projects[projectId];
    if (!project || !project.currentPoste) return;
    
    // Trouver la cellule sélectionnée
    let $selectedCell = $(`#workspace-${projectId} .metre-table td.selected`);
    if ($selectedCell.length === 0) {
        alert('Veuillez d\'abord sélectionner une cellule dans le tableau.');
        return;
    }
    
    // Obtenir les infos de la cellule
    let $row = $selectedCell.closest('tr');
    let blockId = $row.data('block-id');
    let rowIndex = $row.data('row');
    let field = $selectedCell.data('field');
    
    // Vérifier que c'est une cellule éditable (pas footer, pas colonnes calculées sauf certaines)
    if ($row.hasClass('block-table-footer')) {
        alert('Impossible d\'insérer une variable dans le footer.');
        return;
    }
    
    // Vérifier que la variable existe
    if (!project.variables[varName]) {
        alert('Variable ' + varName + ' non trouvée.');
        return;
    }
    
    // Trouver le bloc et la ligne
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || !block.data || !block.data[rowIndex]) {
        return;
    }
    
    let row = block.data[rowIndex];
    
    // Mapper le field vers le champ interne
    let actualField = field;
    if (field === 'totall') actualField = 'l';
    
    // Créer l'appel de variable
    row[actualField] = createVariableField(varName, false);
    
    // Ajouter aux appels de la variable
    if (!project.variables[varName].calls) {
        project.variables[varName].calls = [];
    }
    project.variables[varName].calls.push({
        posteId: project.currentPoste.id,
        posteName: project.currentPoste.name,
        blockId: blockId,
        rowIndex: rowIndex,
        field: actualField
    });
    
    // Si c'est dans la colonne L, auto-remplir N et Op si vides et créer sous-total
    if (field === 'l' || field === 'totall') {
        if (!row.n || row.n === '' || row.n === null || row.n === 0) {
            row.n = createValueField(1);
        }
        if (!row.op || row.op === '' || row.op === null) {
            row.op = 'fs';
        }
        
        // Créer le sous-total si nécessaire
        autoCreateSubtotalIfNeeded(projectId, blockId, rowIndex, block, row);
        return;
    }
    
    // Re-render
    renderMetreTable(projectId);
    saveProjectToStorage(projectId);
}

// Clignoter la cellule d'une variable
function flashVariableCell(projectId, varName) {
    let project = projects[projectId];
    let v = project.variables[varName];
    if (!v) return;
    
    let $row;
    if (v.rowIndex === 'footer') {
        $row = $(`#workspace-${projectId} .metre-table tr.block-table-footer[data-block-id="${v.blockId}"]`);
    } else {
        $row = $(`#workspace-${projectId} .metre-table tr[data-block-id="${v.blockId}"][data-row="${v.rowIndex}"]`);
    }
    
    if ($row.length > 0) {
        let $cell = $row.find(`td[data-field="${v.field}"]`);
        if ($cell.length > 0) {
            // Flash animation
            $cell.addClass('flash-highlight');
            setTimeout(() => $cell.removeClass('flash-highlight'), 1500);
            
            // Scroll to cell
            $cell[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Sort variables
function sortVariables(projectId, order) {
    let project = projects[projectId];
    
    // Convert to array and sort
    let varsArray = Object.entries(project.variables);
    
    if (order === 'asc') {
        varsArray.sort((a, b) => a[0].localeCompare(b[0]));
    } else {
        varsArray.sort((a, b) => b[0].localeCompare(a[0]));
    }
    
    // Rebuild variables object in new order
    let newVars = {};
    varsArray.forEach(([key, value]) => {
        newVars[key] = value;
    });
    
    project.variables = newVars;
    renderVariables(projectId);
}

// Show context menu for variables
function showVariableContextMenu(projectId, varName, e) {
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    let varData = project.variables[varName];
    if (!varData) return;
    
    let callCount = varData.calls ? varData.calls.length : 0;
    let totalUsages = callCount + 1;
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: `ℹ️ Informations`, action: () => showVariableInfo(projectId, varName) },
        { label: `📝 Renommer description`, action: () => renameVariableDescription(projectId, varName) },
        { label: `🔍 Afficher utilisations (${totalUsages})`, action: () => showVariableUsages(projectId, varName) },
        { separator: true },
        { label: `🗑️ Supprimer variable`, action: () => deleteVariableWithConfirmation(projectId, varName) }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).on('click.contextmenu', function() {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
        $(document).off('click.contextmenu');
    });
}

// Show variable information popup
function showVariableInfo(projectId, varName) {
    let project = projects[projectId];
    let varData = project.variables[varName];
    if (!varData) return;
    
    let usages = findVariableUsages(projectId, varName);
    let callCount = usages.calls.length;
    
    let declarationLocation = '';
    if (usages.declaration) {
        if (usages.declaration.isFooter) {
            declarationLocation = `Poste "${usages.declaration.posteName}" > Pied de tableau > ${usages.declaration.field}`;
        } else if (usages.declaration.rowIndex !== undefined) {
            declarationLocation = `Poste "${usages.declaration.posteName}" > Ligne ${usages.declaration.rowIndex + 1} > ${usages.declaration.field}`;
        } else {
            declarationLocation = `Poste "${usages.declaration.posteName}"`;
        }
    }
    
    let html = `
        <div style="padding:20px;">
            <h3 style="margin:0 0 15px 0;">Informations - ${varName}</h3>
            <table style="width:100%; font-size:12px;">
                <tr><td style="padding:5px; font-weight:bold;">Type:</td><td>${getVariableType(varName) === 'L' ? 'Longueur' : getVariableType(varName) === 'S' ? 'Surface' : 'Volume'}</td></tr>
                <tr><td style="padding:5px; font-weight:bold;">Valeur:</td><td>${formatNumber(varData.declaration.value)}</td></tr>
                <tr><td style="padding:5px; font-weight:bold;">Description:</td><td>${varData.description}</td></tr>
                <tr><td style="padding:5px; font-weight:bold;">Déclaration:</td><td>${declarationLocation}</td></tr>
                <tr><td style="padding:5px; font-weight:bold;">Appels:</td><td>${callCount} utilisations</td></tr>
            </table>
            ${callCount > 0 ? `
                <div style="margin-top:15px;">
                    <strong>Liste des appels:</strong>
                    <ul style="margin:10px 0; padding-left:20px; max-height:200px; overflow-y:auto;">
                        ${usages.calls.map(call => {
                            if (call.isFooter) {
                                return `<li style="margin:5px 0;">Poste "${call.posteName}" > Pied de tableau > ${call.field}</li>`;
                            } else if (call.rowIndex !== undefined) {
                                return `<li style="margin:5px 0;">Poste "${call.posteName}" > Ligne ${call.rowIndex + 1} > ${call.field}</li>`;
                            } else {
                                return `<li style="margin:5px 0;">Poste "${call.posteName}"</li>`;
                            }
                        }).join('')}
                    </ul>
                </div>
            ` : ''}
            <div style="margin-top:20px; text-align:right;">
                <button onclick="$('#dialogOverlay').hide()" style="padding:8px 20px; cursor:pointer;">Fermer</button>
            </div>
        </div>
    `;
    
    $('#dialogContent').html(html);
    $('#dialogOverlay').css('display', 'flex');
}

// Rename variable description
function renameVariableDescription(projectId, varName) {
    let project = projects[projectId];
    let varData = project.variables[varName];
    if (!varData) return;
    
    // Trouver l'élément description dans le panneau
    let $item = $(`.variables-panel-${projectId} .variable-item[data-var-name="${varName}"]`);
    let $desc = $item.find('.variable-description');
    
    if ($desc.hasClass('editing')) return;
    
    let currentDesc = varData.description || varName;
    
    // Créer un input en place
    $desc.addClass('editing');
    let $input = $(`<input type="text" class="desc-edit-input" value="${currentDesc}" style="width:100%; font-size:10px; padding:2px; border:1px solid #3498db; border-radius:2px;">`);
    $desc.html($input);
    $input.focus().select();
    
    let saveDesc = function() {
        let newDesc = $input.val().trim();
        varData.description = newDesc;
        $desc.removeClass('editing');
        $desc.text(newDesc || varName);
        $desc.attr('title', 'Double-clic pour modifier');
        saveProjectToStorage(projectId);
    };
    
    $input.on('blur', saveDesc);
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveDesc();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            $desc.removeClass('editing');
            $desc.text(currentDesc || varName);
        }
    });
}

// Show variable usages with navigation
function showVariableUsages(projectId, varName) {
    let usages = findVariableUsages(projectId, varName);
    let callCount = usages.calls.length;
    
    let html = `
        <div style="padding:20px;">
            <h3 style="margin:0 0 15px 0;">Utilisations de ${varName}</h3>
            <p style="margin-bottom:15px;"><strong>Déclaration:</strong> Poste "${usages.declaration.posteName}" > Ligne ${usages.declaration.rowIndex + 1} > ${usages.declaration.field}</p>
            ${callCount > 0 ? `
                <p style="margin-bottom:10px;"><strong>Appels (${callCount}):</strong></p>
                <ul style="margin:0; padding-left:20px; max-height:300px; overflow-y:auto;">
                    ${usages.calls.map((call, idx) => `
                        <li style="margin:8px 0; cursor:pointer; padding:5px; border-radius:3px;" 
                            onmouseover="this.style.background='#f0f0f0'" 
                            onmouseout="this.style.background='transparent'"
                            onclick="navigateToCell('${projectId}', '${call.posteId}', ${call.rowIndex}, '${call.field}')">
                            Poste "${call.posteName}" > Ligne ${call.rowIndex + 1} > ${call.field}
                        </li>
                    `).join('')}
                </ul>
            ` : '<p>Aucun appel</p>'}
            <div style="margin-top:20px; text-align:right;">
                <button onclick="$('#dialogOverlay').hide()" style="padding:8px 20px; cursor:pointer;">Fermer</button>
            </div>
        </div>
    `;
    
    $('#dialogContent').html(html);
    $('#dialogOverlay').css('display', 'flex');
}

// Navigate to a specific cell (helper for showVariableUsages)
function navigateToCell(projectId, posteId, rowIndex, field) {
    $('#dialogOverlay').hide();
    
    // Find and select the poste in the tree
    selectTreeNode(projectId, posteId);
    
    // Wait for table to render, then highlight the cell
    setTimeout(() => {
        let $cell = $(`#workspace-${projectId} .metre-table tr[data-row="${rowIndex}"] td[data-field="${field}"]`);
        if ($cell.length) {
            // Flash the cell
            $cell.css('background', '#ffeb3b');
            setTimeout(() => $cell.css('background', ''), 200);
            setTimeout(() => $cell.css('background', '#ffeb3b'), 400);
            setTimeout(() => $cell.css('background', ''), 600);
            setTimeout(() => $cell.css('background', '#ffeb3b'), 800);
            setTimeout(() => $cell.css('background', ''), 1000);
            
            // Scroll into view
            $cell[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 300);
}

// Delete variable with confirmation
function deleteVariableWithConfirmation(projectId, varName) {
    let usages = findVariableUsages(projectId, varName);
    let callCount = usages.calls.length;
    let totalUsages = callCount + 1;
    
    if (confirm(`Supprimer la variable ${varName} ?\n\n${totalUsages} usage(s) seront convertis en valeurs fixes.\n- 1 déclaration\n- ${callCount} appel(s)\n\nCette action est irréversible.`)) {
        deleteVariable(projectId, varName);
    }
}

// Delete a variable completely
function deleteVariable(projectId, varName) {
    let project = projects[projectId];
    let varData = project.variables[varName];
    if (!varData) return;
    
    let usages = findVariableUsages(projectId, varName);
    let fixedValue = varData.declaration.value;
    
    // Convert declaration to fixed value
    if (usages.declaration) {
        let declPoste = findPosteById(projectId, usages.declaration.posteId);
        if (declPoste) {
            // Support new blocks structure
            if (usages.declaration.blockId && declPoste.blocks) {
                let block = declPoste.blocks.find(b => b.id === usages.declaration.blockId);
                if (block) {
                    if (usages.declaration.isFooter && block.footer) {
                        block.footer[usages.declaration.field] = createValueField(fixedValue);
                    } else if (block.data && block.data[usages.declaration.rowIndex]) {
                        block.data[usages.declaration.rowIndex][usages.declaration.field] = createValueField(fixedValue);
                    }
                }
            }
            // Support old data structure
            else if (declPoste.data && declPoste.data[usages.declaration.rowIndex]) {
                declPoste.data[usages.declaration.rowIndex][usages.declaration.field] = createValueField(fixedValue);
            }
        }
    }
    
    // Convert all calls to fixed values
    usages.calls.forEach(call => {
        let poste = findPosteById(projectId, call.posteId);
        if (poste) {
            // Support new blocks structure
            if (call.blockId && poste.blocks) {
                let block = poste.blocks.find(b => b.id === call.blockId);
                if (block) {
                    if (call.isFooter && block.footer) {
                        block.footer[call.field] = createValueField(fixedValue);
                    } else if (block.data && block.data[call.rowIndex]) {
                        block.data[call.rowIndex][call.field] = createValueField(fixedValue);
                    }
                }
            }
            // Support old data structure
            else if (poste.data && poste.data[call.rowIndex]) {
                poste.data[call.rowIndex][call.field] = createValueField(fixedValue);
            }
        }
    });
    
    // Remove variable from project
    delete project.variables[varName];
    
    // Re-render
    renderVariables(projectId);
    renderMetreTable(projectId);
}

// Helper to find a poste by ID
function findPosteById(projectId, posteId) {
    let project = projects[projectId];
    let result = null;
    
    function traverse(node) {
        if (node.id === posteId && node.type === 'poste') {
            result = node;
            return;
        }
        if (node.children) {
            node.children.forEach(child => traverse(child));
        }
    }
    
    project.treeData.forEach(node => traverse(node));
    return result;
}

function startEditingVariableValue(projectId, varKey, element) {
    let project = projects[projectId];
    let $el = $(element);
    let currentValue = project.variables[varKey].value;
    
    let $input = $('<input type="text">').val(currentValue);
    $input.css({
        width: '60px',
        padding: '2px 4px',
        border: '1px solid #3498db',
        outline: 'none',
        fontSize: '11px'
    });
    
    $el.html($input);
    $input.focus().select();
    
    function finishEdit(save) {
        if (save) {
            let newValue = parseFloat($input.val()) || 0;
            project.variables[varKey].value = newValue;
            renderVariables(projectId);
            renderMetreTable(projectId); // Update table
        } else {
            renderVariables(projectId);
        }
    }
    
    $input.on('blur', () => finishEdit(true));
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEdit(false);
        }
    });
}

function startEditingVariableDescription(projectId, varKey, element) {
    let project = projects[projectId];
    let $el = $(element);
    let currentDesc = project.variables[varKey].description;
    
    let $input = $('<input type="text">').val(currentDesc);
    $input.css({
        width: '150px',
        padding: '2px 4px',
        border: '1px solid #3498db',
        outline: 'none',
        fontSize: '10px'
    });
    
    $el.html($input);
    $input.focus().select();
    
    function finishEdit(save) {
        if (save) {
            let newDesc = $input.val().trim();
            if (newDesc) {
                project.variables[varKey].description = newDesc;
            }
            renderVariables(projectId);
        } else {
            renderVariables(projectId);
        }
    }
    
    $input.on('blur', () => finishEdit(true));
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEdit(false);
        }
    });
}

function showVariableContextMenu(projectId, e, varKey) {
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: '✏️ Modifier valeur', action: () => {
            let $value = $(`.variables-panel-${projectId} .variable-value[data-var-key="${varKey}"]`);
            startEditingVariableValue(projectId, varKey, $value[0]);
        }},
        { label: '📝 Modifier description', action: () => {
            let $desc = $(`.variables-panel-${projectId} .variable-description[data-var-key="${varKey}"]`);
            startEditingVariableDescription(projectId, varKey, $desc[0]);
        }},
        { separator: true },
        { label: '🗑️ Supprimer', action: () => deleteVariable(projectId, varKey) }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

function addVariable(projectId) {
    let project = projects[projectId];
    
    let key = prompt("Nom de la variable (ex: L2, S2, V1):");
    if (!key) return;
    
    key = key.toUpperCase().trim();
    if (project.variables[key]) {
        alert("Cette variable existe déjà");
        return;
    }
    
    let value = prompt("Valeur:");
    if (value === null) return;
    
    let description = prompt("Description:");
    if (description === null) return;
    
    project.variables[key] = {
        value: parseFloat(value) || 0,
        description: description
    };
    
    renderVariables(projectId);
}

function deleteVariable(projectId, key) {
    let project = projects[projectId];
    
    if (confirm(`Supprimer la variable ${key} ?`)) {
        delete project.variables[key];
        renderVariables(projectId);
        renderMetreTable(projectId);
    }
}

// ===== TOOLBAR ACTIONS (work on current project) =====
function addRow() {
    if (!currentProjectId) return;
    let project = projects[currentProjectId];
    if (!project.currentPoste) return;
    
    // Find the last table block
    let lastTableBlock = null;
    if (project.currentPoste.blocks) {
        for (let i = project.currentPoste.blocks.length - 1; i >= 0; i--) {
            if (project.currentPoste.blocks[i].type === 'table') {
                lastTableBlock = project.currentPoste.blocks[i];
                break;
            }
        }
    }
    
    // If no table block found, create one
    if (!lastTableBlock) {
        if (!project.currentPoste.blocks) {
            project.currentPoste.blocks = [];
        }
        lastTableBlock = {
            id: 'block_table_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: createInitialTableData(),
            footer: {
                ens: 'Ens.',
                unit: '',
                pu: 0
            }
        };
        project.currentPoste.blocks.push(lastTableBlock);
        renderMetreTable(currentProjectId);
        return;
    }
    
    // Add row to the last table block
    lastTableBlock.data.push(createEmptyRow());
    renderMetreTable(currentProjectId);
}

function saveFile() {
    if (!currentProjectId) {
        alert("Aucun projet ouvert");
        return;
    }
    
    let project = projects[currentProjectId];
    
    // Sauvegarder les données du poste actuel
    if (project.currentPoste) {
        project.currentPoste.data = getCurrentMetreData(currentProjectId);
    }
    
    let data = {
        metadata: project.metadata,
        treeData: project.treeData,
        variables: project.variables
    };
    
    let json = JSON.stringify(data, null, 2);
    let blob = new Blob([json], { type: 'application/json' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = `${project.metadata.client}_${project.metadata.projet}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function openFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        let file = e.target.files[0];
        let reader = new FileReader();
        reader.onload = function(event) {
            try {
                let data = JSON.parse(event.target.result);
                
                // Vérifier si le projet n'est pas déjà ouvert
                for (let pid in projects) {
                    let p = projects[pid];
                    if (p.metadata.client === data.metadata.client && 
                        p.metadata.projet === data.metadata.projet) {
                        alert('Ce projet est déjà ouvert !');
                        switchToProject(pid);
                        return;
                    }
                }
                
                let projectId = 'project_' + Date.now();
                
                let project = {
                    id: projectId,
                    metadata: data.metadata,
                    treeData: data.treeData || [],
                    variables: data.variables || {},
                    currentPoste: null,
                    selectedTreeNode: null,
                    copiedRow: null
                };
                
                projects[projectId] = project;
                createProjectTab(projectId);
                switchToProject(projectId);
                
            } catch (err) {
                alert("Erreur lors du chargement du fichier: " + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ===== SETTINGS FUNCTIONS =====
function openSettings() {
    $('#settingsOverlay').css('display', 'flex');
    showSettingsSection('general');
    
    // Empêcher les événements clavier globaux d'interférer avec les inputs
    $('#settingsOverlay').off('keydown.settings keypress.settings').on('keydown.settings keypress.settings', 'input, select, textarea', function(e) {
        e.stopPropagation();
    });
    
    // Attach sidebar click events
    $('.settings-menu-item').off('click').on('click', function() {
        // Sauvegarder les valeurs de la section actuelle avant de changer
        saveCurrentSectionValues();
        
        $('.settings-menu-item').removeClass('active');
        $(this).addClass('active');
        let section = $(this).data('section');
        showSettingsSection(section);
        
        // Update badge previews when opening theme section
        if (section === 'theme') {
            setTimeout(updateBadgePreview, 50);
        }
    });
}

// Sauvegarder les valeurs de la section actuelle (appelé avant de changer de section)
function saveCurrentSectionValues() {
    // Sauvegarder les valeurs de layout si les inputs existent
    let colNames = ['num', 'code', 'designation', 'n', 'op', 'l', 'totall', 'larg', 'h', 'ens', 'valplus', 'valmoins', 'unit', 'qtetotal', 'pu', 'totalht'];
    
    // Hauteur des lignes
    if ($('#layoutDefaultRowHeight').length) {
        if (!appSettings.layout) appSettings.layout = { defaultRowHeight: 18, columnWidths: {}, columnTitles: {} };
        appSettings.layout.defaultRowHeight = parseInt($('#layoutDefaultRowHeight').val()) || 18;
    }
    
    // Largeurs et titres de colonnes
    colNames.forEach(col => {
        let $inputWidth = $(`#colWidth_${col}`);
        if ($inputWidth.length) {
            if (!appSettings.layout) appSettings.layout = { defaultRowHeight: 18, columnWidths: {}, columnTitles: {} };
            if (!appSettings.layout.columnWidths) appSettings.layout.columnWidths = {};
            appSettings.layout.columnWidths[col] = parseInt($inputWidth.val()) || 40;
        }
        
        let $inputTitle = $(`#colTitle_${col}`);
        if ($inputTitle.length) {
            if (!appSettings.layout) appSettings.layout = { defaultRowHeight: 18, columnWidths: {}, columnTitles: {} };
            if (!appSettings.layout.columnTitles) appSettings.layout.columnTitles = {};
            let val = $inputTitle.val();
            if (val !== '') {
                appSettings.layout.columnTitles[col] = val;
            }
        }
    });
}

function closeSettings() {
    $('#settingsOverlay').hide();
}

// ===== LAYOUT SETTINGS HELPERS =====
function setLayoutRowHeightPreset(height) {
    $('#layoutDefaultRowHeight').val(height);
}

function resetLayoutColumnWidths() {
    let defaults = {
        num: 40, code: 60, designation: 180, n: 40, op: 40,
        l: 60, totall: 70, larg: 50, h: 50, ens: 50,
        valplus: 70, valmoins: 70, unit: 50, qtetotal: 70, pu: 60, totalht: 80
    };
    
    for (let col in defaults) {
        $(`#colWidth_${col}`).val(defaults[col]);
    }
}

function resetLayoutColumnTitles() {
    let defaults = {
        num: '#', code: 'Code', designation: 'Désignation', n: 'N', op: 'Op',
        l: 'L', totall: 'Total L', larg: 'l', h: 'h', ens: 'Ens.',
        valplus: 'Val (+)', valmoins: 'Val (-)', unit: 'Unit', qtetotal: 'Qté T.', pu: 'PU', totalht: 'Total HT'
    };
    
    for (let col in defaults) {
        $(`#colTitle_${col}`).val(defaults[col]);
    }
}

// Appliquer les réglages de mise en page globaux
function applyLayoutSettings() {
    // Appliquer la hauteur des lignes
    if (appSettings.layout && appSettings.layout.defaultRowHeight) {
        $('table.metre-table tbody tr td').css('height', appSettings.layout.defaultRowHeight + 'px');
    }
    
    // Appliquer les largeurs de colonnes
    if (appSettings.layout && appSettings.layout.columnWidths) {
        let widths = appSettings.layout.columnWidths;
        for (let col in widths) {
            $(`table.metre-table th[data-col="${col}"]`).css('width', widths[col] + 'px');
        }
    }
}

// ===== COMPLETE showSettingsSection FUNCTION FOR v0.05 =====
// Replace the existing function at line ~2146 with this complete version

function showSettingsSection(section) {
    let content = '';
    
    switch(section) {
        case 'general':
            content = `
                <div class="settings-section">
                    <h3>Paramètres Généraux</h3>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="autoSave" ${appSettings.general.autoSave ? 'checked' : ''}>
                            Sauvegarde automatique
                        </label>
                        <div class="settings-description">Sauvegarde automatiquement votre travail à intervalles réguliers</div>
                    </div>
                    <div class="settings-item">
                        <label>Intervalle de sauvegarde (minutes)</label>
                        <input type="number" id="autoSaveInterval" value="${appSettings.general.autoSaveInterval}" min="1" max="30">
                    </div>
                    <div class="settings-item">
                        <label>Langue</label>
                        <select id="language">
                            <option value="fr" ${appSettings.general.language === 'fr' ? 'selected' : ''}>Français</option>
                            <option value="en" ${appSettings.general.language === 'en' ? 'selected' : ''}>English</option>
                            <option value="es" ${appSettings.general.language === 'es' ? 'selected' : ''}>Español</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <label>Action au démarrage</label>
                        <select id="startupAction">
                            <option value="empty" ${appSettings.general.startupAction === 'empty' ? 'selected' : ''}>Écran vide</option>
                            <option value="last" ${appSettings.general.startupAction === 'last' ? 'selected' : ''}>Dernier projet ouvert</option>
                            <option value="new" ${appSettings.general.startupAction === 'new' ? 'selected' : ''}>Nouveau projet</option>
                        </select>
                    </div>
                </div>
            `;
            break;
            
        case 'display':
            content = `
                <div class="settings-section">
                    <h3>Options d'Affichage</h3>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="showGrid" ${appSettings.display.showGrid ? 'checked' : ''}>
                            Afficher la grille du tableau
                        </label>
                    </div>
                    <div class="settings-item">
                        <label>Taille de police (px)</label>
                        <input type="number" id="fontSize" min="10" max="16" value="${appSettings.display.fontSize}" style="width:80px;">
                    </div>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="compactMode" ${appSettings.display.compactMode ? 'checked' : ''}>
                            Mode compact
                        </label>
                        <div class="settings-description">Réduit les espaces et marges pour afficher plus de données</div>
                    </div>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="highlightEdited" ${appSettings.display.highlightEdited ? 'checked' : ''}>
                            Surligner les cellules modifiées
                        </label>
                    </div>
                </div>
            `;
            break;
            
        case 'layout':
            // Récupérer les valeurs actuelles ou par défaut
            let defaultColWidths = {
                'num': 40, 'code': 60, 'designation': 180, 'n': 40, 'op': 40,
                'l': 60, 'totall': 70, 'larg': 50, 'h': 50, 'ens': 50,
                'valplus': 70, 'valmoins': 70, 'unit': 50, 'qtetotal': 70, 'pu': 60, 'totalht': 80
            };
            let defaultColTitles = {
                num: '#', code: 'Code', designation: 'Désignation', n: 'N', op: 'Op',
                l: 'L', totall: 'Total L', larg: 'l', h: 'h', ens: 'Ens.',
                valplus: 'Val (+)', valmoins: 'Val (-)', unit: 'Unit', qtetotal: 'Qté T.', pu: 'PU', totalht: 'Total HT'
            };
            let colWidths = appSettings.layout?.columnWidths || defaultColWidths;
            let colTitles = appSettings.layout?.columnTitles || defaultColTitles;
            let defaultRowHeight = appSettings.layout?.defaultRowHeight || 18;
            
            content = `
                <div class="settings-section">
                    <h3>📏 Hauteur des lignes</h3>
                    <div class="settings-item">
                        <label>Hauteur par défaut des lignes (px)</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="number" id="layoutDefaultRowHeight" value="${defaultRowHeight}" min="1" style="width: 80px;">
                            <button class="dialog-btn" onclick="setLayoutRowHeightPreset(18)">Petite</button>
                            <button class="dialog-btn" onclick="setLayoutRowHeightPreset(22)">Normale</button>
                            <button class="dialog-btn" onclick="setLayoutRowHeightPreset(30)">Grande</button>
                        </div>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>🏷️ Titres des colonnes</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Numéro</label>
                            <input type="text" id="colTitle_num" value="${colTitles.num || '#'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Code</label>
                            <input type="text" id="colTitle_code" value="${colTitles.code || 'Code'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Désignation</label>
                            <input type="text" id="colTitle_designation" value="${colTitles.designation || 'Désignation'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">N</label>
                            <input type="text" id="colTitle_n" value="${colTitles.n || 'N'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Op</label>
                            <input type="text" id="colTitle_op" value="${colTitles.op || 'Op'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">L</label>
                            <input type="text" id="colTitle_l" value="${colTitles.l || 'L'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Total L</label>
                            <input type="text" id="colTitle_totall" value="${colTitles.totall || 'Total L'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">l (largeur)</label>
                            <input type="text" id="colTitle_larg" value="${colTitles.larg || 'l'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">h (hauteur)</label>
                            <input type="text" id="colTitle_h" value="${colTitles.h || 'h'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Ens.</label>
                            <input type="text" id="colTitle_ens" value="${colTitles.ens || 'Ens.'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Val (+)</label>
                            <input type="text" id="colTitle_valplus" value="${colTitles.valplus || 'Val (+)'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Val (-)</label>
                            <input type="text" id="colTitle_valmoins" value="${colTitles.valmoins || 'Val (-)'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Unité</label>
                            <input type="text" id="colTitle_unit" value="${colTitles.unit || 'Unit'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Qté T.</label>
                            <input type="text" id="colTitle_qtetotal" value="${colTitles.qtetotal || 'Qté T.'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">PU</label>
                            <input type="text" id="colTitle_pu" value="${colTitles.pu || 'PU'}" style="width: 100px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 5px;">
                            <label style="display: inline-block; width: 80px; font-size: 11px;">Total HT</label>
                            <input type="text" id="colTitle_totalht" value="${colTitles.totalht || 'Total HT'}" style="width: 100px;">
                        </div>
                    </div>
                    <div style="margin-top: 10px;">
                        <button class="dialog-btn" onclick="resetLayoutColumnTitles()">🔄 Réinitialiser les titres par défaut</button>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>📊 Largeur des colonnes (px)</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;"># (Numéro)</label>
                            <input type="number" id="colWidth_num" value="${colWidths.num || 40}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Code</label>
                            <input type="number" id="colWidth_code" value="${colWidths.code || 60}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Désignation</label>
                            <input type="number" id="colWidth_designation" value="${colWidths.designation || 180}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">N</label>
                            <input type="number" id="colWidth_n" value="${colWidths.n || 40}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Op</label>
                            <input type="number" id="colWidth_op" value="${colWidths.op || 40}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">L</label>
                            <input type="number" id="colWidth_l" value="${colWidths.l || 60}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Total L</label>
                            <input type="number" id="colWidth_totall" value="${colWidths.totall || 70}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">l (largeur)</label>
                            <input type="number" id="colWidth_larg" value="${colWidths.larg || 50}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">h (hauteur)</label>
                            <input type="number" id="colWidth_h" value="${colWidths.h || 50}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Ens.</label>
                            <input type="number" id="colWidth_ens" value="${colWidths.ens || 50}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Val (+)</label>
                            <input type="number" id="colWidth_valplus" value="${colWidths.valplus || 70}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Val (-)</label>
                            <input type="number" id="colWidth_valmoins" value="${colWidths.valmoins || 70}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Unité</label>
                            <input type="number" id="colWidth_unit" value="${colWidths.unit || 50}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Qté T.</label>
                            <input type="number" id="colWidth_qtetotal" value="${colWidths.qtetotal || 70}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">PU</label>
                            <input type="number" id="colWidth_pu" value="${colWidths.pu || 60}" min="1" style="width: 70px;">
                        </div>
                        <div class="settings-item" style="margin-bottom: 8px;">
                            <label style="display: inline-block; width: 100px;">Total HT</label>
                            <input type="number" id="colWidth_totalht" value="${colWidths.totalht || 80}" min="1" style="width: 70px;">
                        </div>
                    </div>
                    <div style="margin-top: 15px;">
                        <button class="dialog-btn" onclick="resetLayoutColumnWidths()">🔄 Réinitialiser les largeurs par défaut</button>
                    </div>
                </div>
            `;
            break;
            
        case 'theme':
            content = `
                <div class="settings-section">
                    <h3>Thèmes Prédéfinis</h3>
                    <div class="settings-item">
                        <label>Sélectionner un thème</label>
                        <select id="themePreset" onchange="applyThemePreset()">
                            <option value="custom">Personnalisé</option>
                            <option value="default" ${appSettings.theme.preset === 'default' ? 'selected' : ''}>Défaut</option>
                            <option value="blue" ${appSettings.theme.preset === 'blue' ? 'selected' : ''}>Bleu Professionnel</option>
                            <option value="green" ${appSettings.theme.preset === 'green' ? 'selected' : ''}>Vert Nature</option>
                            <option value="dark" ${appSettings.theme.preset === 'dark' ? 'selected' : ''}>Sombre</option>
                            <option value="modern" ${appSettings.theme.preset === 'modern' ? 'selected' : ''}>Moderne</option>
                            <option value="pastel" ${appSettings.theme.preset === 'pastel' ? 'selected' : ''}>Pastel</option>
                        </select>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Tableau Minute - En-tête</h3>
                    <div class="settings-item">
                        <label>Couleur de fond en-tête</label>
                        <input type="color" id="headerBg" value="${appSettings.theme.customTable.headerBg}">
                    </div>
                    <div class="settings-item">
                        <label>Couleur texte en-tête</label>
                        <input type="color" id="headerColor" value="${appSettings.theme.customTable.headerColor}">
                    </div>
                    <div class="settings-item">
                        <label>Police en-tête</label>
                        <select id="headerFont">
                            <option value="Segoe UI" ${appSettings.theme.customTable.headerFont === 'Segoe UI' ? 'selected' : ''}>Segoe UI</option>
                            <option value="Arial" ${appSettings.theme.customTable.headerFont === 'Arial' ? 'selected' : ''}>Arial</option>
                            <option value="Verdana" ${appSettings.theme.customTable.headerFont === 'Verdana' ? 'selected' : ''}>Verdana</option>
                            <option value="Tahoma" ${appSettings.theme.customTable.headerFont === 'Tahoma' ? 'selected' : ''}>Tahoma</option>
                        </select>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Dimensions des Cellules</h3>
                    <div class="settings-item">
                        <label>Largeur des cellules</label>
                        <input type="text" id="cellWidth" value="${appSettings.theme.customTable.cellWidth}" placeholder="auto">
                        <label class="settings-checkbox-label" style="margin-top:5px;">
                            <input type="checkbox" id="lockWidth" ${appSettings.theme.customTable.lockWidth ? 'checked' : ''}>
                            Verrouiller la largeur
                        </label>
                    </div>
                    <div class="settings-item">
                        <label>Hauteur des cellules (px)</label>
                        <input type="number" id="cellHeight" value="${appSettings.theme.customTable.cellHeight}" min="18" max="40">
                        <label class="settings-checkbox-label" style="margin-top:5px;">
                            <input type="checkbox" id="lockHeight" ${appSettings.theme.customTable.lockHeight ? 'checked' : ''}>
                            Verrouiller la hauteur
                        </label>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Badges Variables</h3>
                    <div class="settings-item">
                        <label>Forme des badges</label>
                        <select id="badgeShape" onchange="updateBadgePreview()">
                            <option value="square" ${appSettings.theme.badges.shape === 'square' ? 'selected' : ''}>Carré</option>
                            <option value="rounded" ${appSettings.theme.badges.shape === 'rounded' ? 'selected' : ''}>Bords arrondis</option>
                            <option value="round" ${appSettings.theme.badges.shape === 'round' ? 'selected' : ''}>Rond</option>
                        </select>
                    </div>
                    
                    <h4 style="font-size:12px; margin:15px 0 10px 0; color:#666;">Variable L</h4>
                    <div class="settings-item">
                        <label>Définition de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="LVarBorder" value="${appSettings.theme.badges.L.varBorder}" title="Contour" onchange="updateBadgePreview()">
                            <input type="color" id="LVarBg" value="${appSettings.theme.badges.L.varBg}" title="Fond" onchange="updateBadgePreview()">
                            <input type="color" id="LVarColor" value="${appSettings.theme.badges.L.varColor}" title="Texte" onchange="updateBadgePreview()">
                            <span id="previewLVar" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid; font-weight: bold;">L1</span>
                        </div>
                        <div class="settings-description">Contour / Fond / Texte</div>
                    </div>
                    <div class="settings-item">
                        <label>Appel de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="LRefBorder" value="${appSettings.theme.badges.L.refBorder}" title="Contour" onchange="updateBadgePreview()">
                            <input type="color" id="LRefBg" value="${appSettings.theme.badges.L.refBg}" title="Fond" onchange="updateBadgePreview()">
                            <input type="color" id="LRefColor" value="${appSettings.theme.badges.L.refColor}" title="Texte" onchange="updateBadgePreview()">
                            <span id="previewLRef" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid;">L1</span>
                        </div>
                    </div>
                    
                    <h4 style="font-size:12px; margin:15px 0 10px 0; color:#666;">Variable S</h4>
                    <div class="settings-item">
                        <label>Définition de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="SVarBorder" value="${appSettings.theme.badges.S.varBorder}" onchange="updateBadgePreview()">
                            <input type="color" id="SVarBg" value="${appSettings.theme.badges.S.varBg}" onchange="updateBadgePreview()">
                            <input type="color" id="SVarColor" value="${appSettings.theme.badges.S.varColor}" onchange="updateBadgePreview()">
                            <span id="previewSVar" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid; font-weight: bold;">S1</span>
                        </div>
                    </div>
                    <div class="settings-item">
                        <label>Appel de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="SRefBorder" value="${appSettings.theme.badges.S.refBorder}" onchange="updateBadgePreview()">
                            <input type="color" id="SRefBg" value="${appSettings.theme.badges.S.refBg}" onchange="updateBadgePreview()">
                            <input type="color" id="SRefColor" value="${appSettings.theme.badges.S.refColor}" onchange="updateBadgePreview()">
                            <span id="previewSRef" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid;">S1</span>
                        </div>
                    </div>
                    
                    <h4 style="font-size:12px; margin:15px 0 10px 0; color:#666;">Variable V</h4>
                    <div class="settings-item">
                        <label>Définition de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="VVarBorder" value="${appSettings.theme.badges.V.varBorder}" onchange="updateBadgePreview()">
                            <input type="color" id="VVarBg" value="${appSettings.theme.badges.V.varBg}" onchange="updateBadgePreview()">
                            <input type="color" id="VVarColor" value="${appSettings.theme.badges.V.varColor}" onchange="updateBadgePreview()">
                            <span id="previewVVar" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid; font-weight: bold;">V1</span>
                        </div>
                    </div>
                    <div class="settings-item">
                        <label>Appel de variable - Couleur</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="color" id="VRefBorder" value="${appSettings.theme.badges.V.refBorder}" onchange="updateBadgePreview()">
                            <input type="color" id="VRefBg" value="${appSettings.theme.badges.V.refBg}" onchange="updateBadgePreview()">
                            <input type="color" id="VRefColor" value="${appSettings.theme.badges.V.refColor}" onchange="updateBadgePreview()">
                            <span id="previewVRef" style="font-size: 9px; padding: 1px 4px; margin-left: 10px; border-width: 1px; border-style: solid;">V1</span>
                        </div>
                    </div>
                </div>
            `;
            break;
            
        case 'units':
            content = `
                <div class="settings-section">
                    <h3>Devise</h3>
                    <div class="settings-item">
                        <label>Symbole de devise</label>
                        <select id="defaultCurrency">
                            <option value="€" ${appSettings.units.defaultCurrency === '€' ? 'selected' : ''}>€ (Euro)</option>
                            <option value="$" ${appSettings.units.defaultCurrency === '$' ? 'selected' : ''}>$ (Dollar)</option>
                            <option value="£" ${appSettings.units.defaultCurrency === '£' ? 'selected' : ''}>£ (Livre)</option>
                            <option value="CHF" ${appSettings.units.defaultCurrency === 'CHF' ? 'selected' : ''}>CHF (Franc suisse)</option>
                        </select>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Unités Personnalisées</h3>
                    <div class="settings-item">
                        <label>Liste des unités (une par ligne)</label>
                        <textarea id="customUnits" rows="10" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px; font-family:monospace;">${appSettings.units.customUnits.join('\n')}</textarea>
                        <div class="settings-description">Ces unités seront disponibles dans la colonne "Unit" du tableau</div>
                    </div>
                </div>
            `;
            break;
            
        case 'tags':
            content = `
                <div class="settings-section">
                    <h3>Système de Tags</h3>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="enableTags" ${appSettings.tags.enableTags ? 'checked' : ''}>
                            Activer le système de tags
                        </label>
                        <div class="settings-description">Permet l'autocomplétion de la colonne unité basée sur des tags</div>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Association Tag → Unité</h3>
                    <div class="settings-item">
                        <label>Liste Tag-Unité</label>
                        <div style="background:#f9f9f9; padding:10px; border:1px solid #ddd; border-radius:4px;">
                            <div style="display:grid; grid-template-columns:1fr 1fr 40px; gap:5px; margin-bottom:5px; font-weight:bold; font-size:11px; color:#666;">
                                <div>Tag</div>
                                <div>Unité</div>
                                <div></div>
                            </div>
                            <div id="tagUnitList"></div>
                            <button class="tool-btn" onclick="addTagUnit()" style="margin-top:10px; width:100%;">➕ Ajouter</button>
                        </div>
                        <div class="settings-description">Quand vous tapez un tag, l'unité associée sera suggérée</div>
                    </div>
                </div>
            `;
            setTimeout(() => {
                renderTagUnitList();
            }, 100);
            break;
            
        case 'format':
            content = `
                <div class="settings-section">
                    <h3>Format des Nombres et Dates</h3>
                    <div class="settings-item">
                        <label>Nombre de décimales</label>
                        <input type="number" id="decimalPlaces" value="${appSettings.format.decimalPlaces}" min="0" max="6">
                    </div>
                    <div class="settings-item">
                        <label>Séparateur décimal</label>
                        <select id="decimalSeparator">
                            <option value="." ${appSettings.format.decimalSeparator === '.' ? 'selected' : ''}>Point (10.50)</option>
                            <option value="," ${appSettings.format.decimalSeparator === ',' ? 'selected' : ''}>Virgule (10,50)</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <label>Format de date</label>
                        <select id="dateFormat">
                            <option value="DD/MM/YYYY" ${appSettings.format.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>JJ/MM/AAAA (24/01/2026)</option>
                            <option value="MM/DD/YYYY" ${appSettings.format.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>MM/JJ/AAAA (01/24/2026)</option>
                            <option value="YYYY-MM-DD" ${appSettings.format.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>AAAA-MM-JJ (2026-01-24)</option>
                        </select>
                    </div>
                </div>
            `;
            break;
            
        case 'ai':
            content = `
                <div class="settings-section">
                    <h3>Intelligence Artificielle</h3>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="enableAI" ${appSettings.ai.enableAI ? 'checked' : ''}>
                            Activer les fonctionnalités IA
                        </label>
                        <div class="settings-description">Permet l'utilisation de l'IA pour suggérer des valeurs et automatiser certaines tâches</div>
                    </div>
                    <div class="settings-item">
                        <label>Fournisseur IA</label>
                        <select id="aiProvider">
                            <option value="none" ${appSettings.ai.aiProvider === 'none' ? 'selected' : ''}>Aucun</option>
                            <option value="openai" ${appSettings.ai.aiProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
                            <option value="anthropic" ${appSettings.ai.aiProvider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
                            <option value="local" ${appSettings.ai.aiProvider === 'local' ? 'selected' : ''}>Modèle local</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="autoSuggest" ${appSettings.ai.autoSuggest ? 'checked' : ''}>
                            Suggestions automatiques
                        </label>
                        <div class="settings-description">L'IA suggère des valeurs basées sur le contexte</div>
                    </div>
                </div>
            `;
            break;
            
        case 'export':
            content = `
                <div class="settings-section">
                    <h3>Options d'Export</h3>
                    <div class="settings-item">
                        <label>Format par défaut</label>
                        <select id="defaultFormat">
                            <option value="pdf" ${appSettings.export.defaultFormat === 'pdf' ? 'selected' : ''}>PDF</option>
                            <option value="excel" ${appSettings.export.defaultFormat === 'excel' ? 'selected' : ''}>Excel (.xlsx)</option>
                            <option value="csv" ${appSettings.export.defaultFormat === 'csv' ? 'selected' : ''}>CSV</option>
                            <option value="json" ${appSettings.export.defaultFormat === 'json' ? 'selected' : ''}>JSON</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="includeMetadata" ${appSettings.export.includeMetadata ? 'checked' : ''}>
                            Inclure les métadonnées du projet
                        </label>
                    </div>
                    <div class="settings-item">
                        <label>Taille de page (PDF)</label>
                        <select id="pageSize">
                            <option value="A4" ${appSettings.export.pageSize === 'A4' ? 'selected' : ''}>A4</option>
                            <option value="A3" ${appSettings.export.pageSize === 'A3' ? 'selected' : ''}>A3</option>
                            <option value="Letter" ${appSettings.export.pageSize === 'Letter' ? 'selected' : ''}>Letter</option>
                        </select>
                    </div>
                    <div class="settings-item">
                        <label>Orientation (PDF)</label>
                        <select id="orientation">
                            <option value="portrait" ${appSettings.export.orientation === 'portrait' ? 'selected' : ''}>Portrait</option>
                            <option value="landscape" ${appSettings.export.orientation === 'landscape' ? 'selected' : ''}>Paysage</option>
                        </select>
                    </div>
                </div>
            `;
            break;
            
        case 'advanced':
            content = `
                <div class="settings-section">
                    <h3>Paramètres Avancés</h3>
                    <div class="settings-item">
                        <label class="settings-checkbox-label">
                            <input type="checkbox" id="enableDebug" ${appSettings.advanced.enableDebug ? 'checked' : ''} onchange="toggleDebugConsole()">
                            Mode débogage
                        </label>
                        <div class="settings-description">Affiche la console de débogage</div>
                    </div>
                    <div class="settings-item">
                        <label>Nombre maximum d'annulations</label>
                        <input type="number" id="maxUndoSteps" value="${appSettings.advanced.maxUndoSteps}" min="10" max="100">
                        <div class="settings-description">Limite la mémoire utilisée pour l'historique</div>
                    </div>
                    <div class="settings-item">
                        <label>Taille du cache (MB)</label>
                        <input type="number" id="cacheSize" value="${appSettings.advanced.cacheSize}" min="50" max="500">
                    </div>
                </div>
            `;
            break;
    }
    
    $('#settingsContent').html(content);
}


function saveSettings() {
    // Sauvegarder les valeurs de la section actuelle d'abord
    saveCurrentSectionValues();
    
    // General
    appSettings.general.autoSave = $('#autoSave').is(':checked');
    appSettings.general.autoSaveInterval = parseInt($('#autoSaveInterval').val());
    appSettings.general.language = $('#language').val();
    appSettings.general.startupAction = $('#startupAction').val();
    
    // Display
    appSettings.display.showGrid = $('#showGrid').is(':checked');
    appSettings.display.fontSize = parseInt($('#fontSize').val());
    appSettings.display.compactMode = $('#compactMode').is(':checked');
    appSettings.display.highlightEdited = $('#highlightEdited').is(':checked');
    
    // Theme
    appSettings.theme.preset = $('#themePreset').val();
    appSettings.theme.customTable.headerBg = $('#headerBg').val();
    appSettings.theme.customTable.headerColor = $('#headerColor').val();
    appSettings.theme.customTable.headerFont = $('#headerFont').val();
    appSettings.theme.customTable.cellWidth = $('#cellWidth').val();
    appSettings.theme.customTable.cellHeight = parseInt($('#cellHeight').val());
    appSettings.theme.customTable.lockWidth = $('#lockWidth').is(':checked');
    appSettings.theme.customTable.lockHeight = $('#lockHeight').is(':checked');
    
    appSettings.theme.badges.shape = $('#badgeShape').val();
    appSettings.theme.badges.L.varBorder = $('#LVarBorder').val();
    appSettings.theme.badges.L.varBg = $('#LVarBg').val();
    appSettings.theme.badges.L.varColor = $('#LVarColor').val();
    appSettings.theme.badges.L.refBorder = $('#LRefBorder').val();
    appSettings.theme.badges.L.refBg = $('#LRefBg').val();
    appSettings.theme.badges.L.refColor = $('#LRefColor').val();
    
    appSettings.theme.badges.S.varBorder = $('#SVarBorder').val();
    appSettings.theme.badges.S.varBg = $('#SVarBg').val();
    appSettings.theme.badges.S.varColor = $('#SVarColor').val();
    appSettings.theme.badges.S.refBorder = $('#SRefBorder').val();
    appSettings.theme.badges.S.refBg = $('#SRefBg').val();
    appSettings.theme.badges.S.refColor = $('#SRefColor').val();
    
    appSettings.theme.badges.V.varBorder = $('#VVarBorder').val();
    appSettings.theme.badges.V.varBg = $('#VVarBg').val();
    appSettings.theme.badges.V.varColor = $('#VVarColor').val();
    appSettings.theme.badges.V.refBorder = $('#VRefBorder').val();
    appSettings.theme.badges.V.refBg = $('#VRefBg').val();
    appSettings.theme.badges.V.refColor = $('#VRefColor').val();
    
    // Tags
    appSettings.tags.enableTags = $('#enableTags').is(':checked');
    
    // Units
    appSettings.units.defaultCurrency = $('#defaultCurrency').val();
    let unitsText = $('#customUnits').val();
    appSettings.units.customUnits = unitsText ? unitsText.split('\n').filter(u => u.trim()) : [];
    
    // Format
    appSettings.format.decimalPlaces = parseInt($('#decimalPlaces').val());
    appSettings.format.decimalSeparator = $('#decimalSeparator').val();
    appSettings.format.dateFormat = $('#dateFormat').val();
    
    // AI
    appSettings.ai.enableAI = $('#enableAI').is(':checked');
    appSettings.ai.aiProvider = $('#aiProvider').val();
    appSettings.ai.autoSuggest = $('#autoSuggest').is(':checked');
    
    // Export
    appSettings.export.defaultFormat = $('#defaultFormat').val();
    appSettings.export.includeMetadata = $('#includeMetadata').is(':checked');
    appSettings.export.pageSize = $('#pageSize').val();
    appSettings.export.orientation = $('#orientation').val();
    
    // Advanced
    appSettings.advanced.enableDebug = $('#enableDebug').is(':checked');
    appSettings.advanced.maxUndoSteps = parseInt($('#maxUndoSteps').val());
    appSettings.advanced.cacheSize = parseInt($('#cacheSize').val());
    
    // Layout (Mise en page)
    // S'assurer que layout est initialisé
    if (!appSettings.layout) {
        appSettings.layout = {
            defaultRowHeight: 18,
            columnWidths: {},
            columnTitles: {}
        };
    }
    if (!appSettings.layout.columnWidths) {
        appSettings.layout.columnWidths = {};
    }
    if (!appSettings.layout.columnTitles) {
        appSettings.layout.columnTitles = {};
    }
    
    if ($('#layoutDefaultRowHeight').length) {
        appSettings.layout.defaultRowHeight = parseInt($('#layoutDefaultRowHeight').val()) || 18;
    }
    // Sauvegarder les largeurs et titres de colonnes
    let colNames = ['num', 'code', 'designation', 'n', 'op', 'l', 'totall', 'larg', 'h', 'ens', 'valplus', 'valmoins', 'unit', 'qtetotal', 'pu', 'totalht'];
    colNames.forEach(col => {
        let $inputWidth = $(`#colWidth_${col}`);
        if ($inputWidth.length) {
            appSettings.layout.columnWidths[col] = parseInt($inputWidth.val()) || appSettings.layout.columnWidths[col];
        }
        // Sauvegarder les titres de colonnes
        let $inputTitle = $(`#colTitle_${col}`);
        if ($inputTitle.length && $inputTitle.val() !== '') {
            appSettings.layout.columnTitles[col] = $inputTitle.val();
        }
    });
    
    saveSettingsToStorage();
    closeSettings();
    applySettings();
    
    // Notification non-bloquante
    showNotification('Réglages enregistrés et appliqués !', 'success');
}

// Afficher une notification temporaire
function showNotification(message, type) {
    let $notif = $(`<div class="temp-notification ${type || ''}">${message}</div>`);
    $notif.css({
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '12px 20px',
        background: type === 'success' ? '#27ae60' : '#3498db',
        color: 'white',
        borderRadius: '5px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: 10000,
        opacity: 0,
        transition: 'opacity 0.3s'
    });
    $('body').append($notif);
    
    setTimeout(() => $notif.css('opacity', 1), 10);
    setTimeout(() => {
        $notif.css('opacity', 0);
        setTimeout(() => $notif.remove(), 300);
    }, 2000);
}

// Apply settings to the UI
function applySettings() {
    // Apply font size
    $('table.metre-table').css('font-size', appSettings.display.fontSize + 'px');
    
    // Apply table header styles
    $('table.metre-table th').css({
        'background-color': appSettings.theme.customTable.headerBg,
        'color': appSettings.theme.customTable.headerColor,
        'font-family': appSettings.theme.customTable.headerFont
    });
    
    // Apply cell height
    $('table.metre-table td').css('height', appSettings.theme.customTable.cellHeight + 'px');
    
    // Apply layout settings (column widths and row heights)
    applyLayoutSettings();
    
    // Apply badge styles
    updateBadgeStyles();
    
    // Apply grid
    if (appSettings.display.showGrid) {
        $('table.metre-table td').css('border', '1px solid #eee');
    } else {
        $('table.metre-table td').css('border', 'none');
    }
    
    // Start auto-save if enabled
    if (appSettings.general.autoSave) {
        startAutoSave();
    }
    
    if (appSettings.advanced.enableDebug) {
        debugLog('Réglages appliqués', 'success');
    }
    
    // Apply badge styles
    applyBadgeStyles();
    
    // Re-render table to apply column titles changes
    if (currentProjectId && projects[currentProjectId]) {
        renderMetreTable(currentProjectId);
    }
}

// Update badge previews in settings
function updateBadgePreview() {
    let shape = $('#badgeShape').val();
    let borderRadius = shape === 'square' ? '0' : shape === 'rounded' ? '3px' : '10px';
    
    // L Variable
    $('#previewLVar').css({
        'border-color': $('#LVarBorder').val(),
        'background-color': $('#LVarBg').val(),
        'color': $('#LVarColor').val(),
        'border-radius': borderRadius
    });
    $('#previewLRef').css({
        'border-color': $('#LRefBorder').val(),
        'background-color': $('#LRefBg').val(),
        'color': $('#LRefColor').val(),
        'border-radius': borderRadius
    });
    
    // S Variable
    $('#previewSVar').css({
        'border-color': $('#SVarBorder').val(),
        'background-color': $('#SVarBg').val(),
        'color': $('#SVarColor').val(),
        'border-radius': borderRadius
    });
    $('#previewSRef').css({
        'border-color': $('#SRefBorder').val(),
        'background-color': $('#SRefBg').val(),
        'color': $('#SRefColor').val(),
        'border-radius': borderRadius
    });
    
    // V Variable
    $('#previewVVar').css({
        'border-color': $('#VVarBorder').val(),
        'background-color': $('#VVarBg').val(),
        'color': $('#VVarColor').val(),
        'border-radius': borderRadius
    });
    $('#previewVRef').css({
        'border-color': $('#VRefBorder').val(),
        'background-color': $('#VRefBg').val(),
        'color': $('#VRefColor').val(),
        'border-radius': borderRadius
    });
}

// Apply badge styles based on settings
function applyBadgeStyles() {
    let shape = appSettings.theme.badges.shape;
    let borderRadius = shape === 'square' ? '0' : shape === 'rounded' ? '3px' : '10px';
    
    // Create CSS for badges
    let css = `
        <style id="badge-styles">
            .variable-badge {
                border-radius: ${borderRadius};
            }
            
            /* L Variable - Declaration */
            .variable-badge[data-var-type="L"].var-declaration {
                border-color: ${appSettings.theme.badges.L.varBorder} !important;
                background-color: ${appSettings.theme.badges.L.varBg} !important;
                color: ${appSettings.theme.badges.L.varColor} !important;
            }
            
            /* L Variable - Call */
            .variable-badge[data-var-type="L"].var-call {
                border-color: ${appSettings.theme.badges.L.refBorder} !important;
                background-color: ${appSettings.theme.badges.L.refBg} !important;
                color: ${appSettings.theme.badges.L.refColor} !important;
            }
            
            /* S Variable - Declaration */
            .variable-badge[data-var-type="S"].var-declaration {
                border-color: ${appSettings.theme.badges.S.varBorder} !important;
                background-color: ${appSettings.theme.badges.S.varBg} !important;
                color: ${appSettings.theme.badges.S.varColor} !important;
            }
            
            /* S Variable - Call */
            .variable-badge[data-var-type="S"].var-call {
                border-color: ${appSettings.theme.badges.S.refBorder} !important;
                background-color: ${appSettings.theme.badges.S.refBg} !important;
                color: ${appSettings.theme.badges.S.refColor} !important;
            }
            
            /* V Variable - Declaration */
            .variable-badge[data-var-type="V"].var-declaration {
                border-color: ${appSettings.theme.badges.V.varBorder} !important;
                background-color: ${appSettings.theme.badges.V.varBg} !important;
                color: ${appSettings.theme.badges.V.varColor} !important;
            }
            
            /* V Variable - Call */
            .variable-badge[data-var-type="V"].var-call {
                border-color: ${appSettings.theme.badges.V.refBorder} !important;
                background-color: ${appSettings.theme.badges.V.refBg} !important;
                color: ${appSettings.theme.badges.V.refColor} !important;
            }
        </style>
    `;
    
    // Remove existing badge styles and add new ones
    $('#badge-styles').remove();
    $('head').append(css);
}

// Apply theme preset
function applyThemePreset() {
    let preset = $('#themePreset').val();
    if (preset !== 'custom' && themePresets[preset]) {
        let theme = themePresets[preset];
        $('#headerBg').val(theme.headerBg);
        $('#headerColor').val(theme.headerColor);
        appSettings.theme.customTable.columns.valPlus.color = theme.valPlusColor;
        appSettings.theme.customTable.columns.valMoins.color = theme.valMoinsColor;
    }
}

// Tag-Unit management
function renderTagUnitList() {
    let html = '';
    appSettings.tags.tagUnits.forEach((item, index) => {
        html += `
            <div style="display:grid; grid-template-columns:1fr 1fr 40px; gap:5px; margin-bottom:5px;">
                <input type="text" value="${item.tag}" onchange="updateTagUnit(${index}, 'tag', this.value)" style="padding:4px; font-size:11px;">
                <select onchange="updateTagUnit(${index}, 'unit', this.value)" style="padding:4px; font-size:11px;">
                    ${appSettings.units.customUnits.map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
                </select>
                <button onclick="removeTagUnit(${index})" style="padding:4px; font-size:14px; cursor:pointer;">🗑️</button>
            </div>
        `;
    });
    $('#tagUnitList').html(html);
}

function addTagUnit() {
    appSettings.tags.tagUnits.push({ tag: '', unit: appSettings.units.customUnits[0] || 'Ml' });
    renderTagUnitList();
}

function updateTagUnit(index, field, value) {
    appSettings.tags.tagUnits[index][field] = value;
}

function removeTagUnit(index) {
    appSettings.tags.tagUnits.splice(index, 1);
    renderTagUnitList();
}

// Debug console
function toggleDebugConsole() {
    if ($('#enableDebug').is(':checked')) {
        $('#debugConsole').css('display', 'flex');
        debugLog('Console de débogage activée', 'info');
    } else {
        $('#debugConsole').hide();
    }
}

function debugLog(message, type = 'info') {
    if (!appSettings.advanced.enableDebug) return;
    
    let timestamp = new Date().toLocaleTimeString();
    let $log = $(`<div class="debug-log ${type}">[${timestamp}] ${message}</div>`);
    $('#debugContent').append($log);
    $('#debugContent').scrollTop($('#debugContent')[0].scrollHeight);
}

// Auto-save functionality
let autoSaveInterval = null;

function startAutoSave() {
    if (appSettings.general.autoSave && currentProjectId) {
        if (autoSaveInterval) clearInterval(autoSaveInterval);
        
        autoSaveInterval = setInterval(() => {
            if (currentProjectId) {
                if (appSettings.advanced.enableDebug) {
                    debugLog('Sauvegarde automatique...', 'info');
                }
                let project = projects[currentProjectId];
                if (project.currentPoste) {
                    project.currentPoste.data = getCurrentMetreData(currentProjectId);
                }
                saveSettingsToStorage();
                if (appSettings.advanced.enableDebug) {
                    debugLog('Sauvegarde automatique terminée', 'success');
                }
            }
        }, appSettings.general.autoSaveInterval * 60 * 1000);
    }
}

// Delete selected rows in metre table
function deleteSelectedRows(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let $selectedRows = $(`#workspace-${projectId} .metre-table tr.selected, #workspace-${projectId} .metre-table tr:has(td.selected)`);
    if ($selectedRows.length === 0) {
        alert('Aucune ligne sélectionnée');
        return;
    }
    
    if (confirm(`Supprimer ${$selectedRows.length} ligne(s) ?`)) {
        let indices = [];
        $selectedRows.each(function() {
            let idx = parseInt($(this).data('row'));
            if (!isNaN(idx)) indices.push(idx);
        });
        
        // Sort in reverse order to delete from end to start
        indices.sort((a, b) => b - a);
        indices.forEach(idx => {
            project.currentPoste.data.splice(idx, 1);
        });
        
        renderMetreTable(projectId);
    }
}

// Move selected rows up
function moveSelectedRowsUp(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let $selectedRows = $(`#workspace-${projectId} .metre-table tr.selected, #workspace-${projectId} .metre-table tr:has(td.selected)`);
    if ($selectedRows.length === 0) {
        alert('Aucune ligne sélectionnée');
        return;
    }
    
    let indices = [];
    $selectedRows.each(function() {
        let idx = parseInt($(this).data('row'));
        if (!isNaN(idx)) indices.push(idx);
    });
    
    indices.sort((a, b) => a - b);
    
    let moved = false;
    indices.forEach(idx => {
        if (idx > 0) {
            let temp = project.currentPoste.data[idx];
            project.currentPoste.data[idx] = project.currentPoste.data[idx - 1];
            project.currentPoste.data[idx - 1] = temp;
            moved = true;
        }
    });
    
    if (moved) renderMetreTable(projectId);
}

// Move selected rows down
function moveSelectedRowsDown(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let $selectedRows = $(`#workspace-${projectId} .metre-table tr.selected, #workspace-${projectId} .metre-table tr:has(td.selected)`);
    if ($selectedRows.length === 0) {
        alert('Aucune ligne sélectionnée');
        return;
    }
    
    let indices = [];
    $selectedRows.each(function() {
        let idx = parseInt($(this).data('row'));
        if (!isNaN(idx)) indices.push(idx);
    });
    
    indices.sort((a, b) => b - a);
    
    let moved = false;
    let maxIdx = project.currentPoste.data.length - 1;
    indices.forEach(idx => {
        if (idx < maxIdx) {
            let temp = project.currentPoste.data[idx];
            project.currentPoste.data[idx] = project.currentPoste.data[idx + 1];
            project.currentPoste.data[idx + 1] = temp;
            moved = true;
        }
    });
    
    if (moved) renderMetreTable(projectId);
}

// Filter metre table
function filterMetreTable(projectId, searchText) {
    searchText = searchText.toLowerCase().trim();
    
    if (!searchText) {
        $(`#workspace-${projectId} .metre-table tr`).show();
        return;
    }
    
    $(`#workspace-${projectId} .metre-table tbody tr`).each(function() {
        let text = $(this).text().toLowerCase();
        if (text.includes(searchText)) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}

// Update metre header title (now just re-renders the table)
function updateMetreTitle(projectId) {
    let project = projects[projectId];
    
    // Update the Golden Layout component title
    if (project.metreContainer && project.currentPoste) {
        project.metreContainer.setTitle(project.currentPoste.name);
    }
    
    // Re-render table to update inline title
    renderMetreTable(projectId);
}

// Get full path of a poste (folder names + poste name)
function getPosteFullPath(projectId, posteId) {
    let project = projects[projectId];
    let path = [];
    
    function findPath(nodes, targetId, currentPath) {
        for (let node of nodes) {
            let newPath = [...currentPath, node.name];
            
            if (node.id === targetId) {
                return newPath;
            }
            
            if (node.children) {
                let result = findPath(node.children, targetId, newPath);
                if (result) return result;
            }
        }
        return null;
    }
    
    let foundPath = findPath(project.treeData, posteId, []);
    return foundPath ? foundPath.join(' / ') : 'Poste';
}

// Get folder path and poste name separately
function getPosteFolderAndName(projectId, posteId) {
    let project = projects[projectId];
    
    function findPath(nodes, targetId, currentPath) {
        for (let node of nodes) {
            if (node.id === targetId) {
                // Found the poste
                return {
                    folders: currentPath,
                    posteName: node.name,
                    posteNode: node
                };
            }
            
            if (node.children) {
                // Add this node to path only if it's a folder
                let newPath = [...currentPath];
                if (node.type === 'folder') {
                    newPath.push(node.name);
                }
                let result = findPath(node.children, targetId, newPath);
                if (result) return result;
            }
        }
        return null;
    }
    
    let result = findPath(project.treeData, posteId, []);
    return result || { folders: [], posteName: 'Poste', posteNode: null };
}

// Rebuild poste blocks based on current tree path
function rebuildPosteBlocksFromTree(projectId, posteId) {
    let project = projects[projectId];
    let pathInfo = getPosteFolderAndName(projectId, posteId);
    let poste = pathInfo.posteNode;
    
    if (!poste || !poste.blocks) return;
    
    // Remove all folder blocks from beginning
    while (poste.blocks.length > 0 && poste.blocks[0].type === 'folder') {
        poste.blocks.shift();
    }
    
    // Recreate folder blocks based on current tree path
    let folderBlocks = pathInfo.folders.map((folderName, index) => ({
        id: 'block_folder_' + Date.now() + '_' + index,
        type: 'folder',
        folderName: folderName,
        fileName: '',
        data: []
    }));
    
    // Insert folder blocks at the beginning
    poste.blocks.unshift(...folderBlocks);
}

// Update all descendant postes when a folder is renamed or moved
function updateDescendantPostesBlocks(projectId, folderId) {
    let project = projects[projectId];
    
    function updateDescendants(nodes) {
        for (let node of nodes) {
            if (node.type === 'poste') {
                // This is a poste, rebuild its blocks
                rebuildPosteBlocksFromTree(projectId, node.id);
            }
            
            if (node.children) {
                updateDescendants(node.children);
            }
        }
    }
    
    // Find the folder node and update all its descendants
    let folderNode = findNodeById(project.treeData, folderId);
    if (folderNode && folderNode.children) {
        updateDescendants(folderNode.children);
    }
}

// Get full path of a folder (parent folders + folder name)
function getFolderFullPath(projectId, folderId) {
    let project = projects[projectId];
    
    function findPath(nodes, targetId, currentPath) {
        for (let node of nodes) {
            let newPath = [...currentPath, node.name];
            
            if (node.id === targetId) {
                return newPath;
            }
            
            if (node.children) {
                let result = findPath(node.children, targetId, newPath);
                if (result) return result;
            }
        }
        return null;
    }
    
    let foundPath = findPath(project.treeData, folderId, []);
    return foundPath ? foundPath.join(' / ') : 'Dossier';
}

// Rename current folder from tree header
function renameCurrentFolderFromHeader(projectId) {
    let project = projects[projectId];
    
    if (!project.selectedTreeNode) {
        alert('Aucun dossier sélectionné');
        return;
    }
    
    let selectedNode = findNodeById(project.treeData, project.selectedTreeNode);
    if (!selectedNode || selectedNode.type !== 'folder') {
        alert('Veuillez sélectionner un dossier');
        return;
    }
    
    let currentName = selectedNode.name;
    let newName = prompt('Nouveau nom du dossier:', currentName);
    
    if (newName && newName.trim() !== '' && newName !== currentName) {
        selectedNode.name = newName.trim();
        updateTreeContent(projectId);
    }
}

// Show context menu for folder title
function showFolderTitleContextMenu(projectId, e) {
    let project = projects[projectId];
    
    if (!project.selectedTreeNode) {
        return;
    }
    
    let selectedNode = findNodeById(project.treeData, project.selectedTreeNode);
    if (!selectedNode || selectedNode.type !== 'folder') {
        return;
    }
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: '✏️ Renommer', action: () => renameCurrentFolderFromHeader(projectId) },
        { separator: true },
        { label: '📂 Aller au dossier dans l\'arborescence', action: () => scrollToNodeInTree(projectId, selectedNode.id) }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Rename current poste from metre header
function renameCurrentPosteFromMetreHeader(projectId) {
    let project = projects[projectId];
    
    if (!project.currentPoste) {
        alert('Aucun poste sélectionné');
        return;
    }
    
    let currentName = project.currentPoste.name;
    let newName = prompt('Nouveau nom du poste:', currentName);
    
    if (newName && newName.trim() !== '' && newName !== currentName) {
        project.currentPoste.name = newName.trim();
        updateMetreTitle(projectId);
        updateTreeContent(projectId);
    }
}

// Show context menu for metre title
function showMetreTitleContextMenu(projectId, e) {
    let project = projects[projectId];
    
    if (!project.currentPoste) {
        return;
    }
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [
        { label: '✏️ Renommer', action: () => renameCurrentPosteFromMetreHeader(projectId) },
        { separator: true },
        { label: '📂 Aller au poste dans l\'arborescence', action: () => scrollToNodeInTree(projectId, project.currentPoste.id) }
    ];
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Scroll to node in tree
function scrollToNodeInTree(projectId, nodeId) {
    let $node = $(`#workspace-${projectId} .tree-node[data-node-id="${nodeId}"]`);
    if ($node.length) {
        $node[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Flash the node
        $node.css('background', '#ffeb3b');
        setTimeout(() => $node.css('background', ''), 200);
        setTimeout(() => $node.css('background', '#ffeb3b'), 400);
        setTimeout(() => $node.css('background', ''), 600);
    }
}

// ===== BLOCK MANAGEMENT =====

// Add a new block to the current poste
function addBlock(projectId, blockType) {
    let project = projects[projectId];
    
    if (!project.currentPoste) {
        alert('Veuillez sélectionner un poste');
        return;
    }
    
    // Initialize blocks if needed
    if (!project.currentPoste.blocks) {
        project.currentPoste.blocks = [];
    }
    
    if (blockType === 'folder') {
        let folderName = prompt('Nom du dossier:');
        if (!folderName) return;
        
        let newBlock = {
            id: 'block_' + Date.now(),
            type: 'folder',
            folderName: folderName,
            fileName: '',
            data: []
        };
        
        project.currentPoste.blocks.push(newBlock);
        
    } else if (blockType === 'file') {
        // Auto-générer le nom du poste
        let posteCount = project.currentPoste.blocks.filter(b => b.type === 'file').length;
        let fileName = 'Poste ' + (posteCount + 1);
        
        let newFileBlock = {
            id: 'block_file_' + Date.now(),
            type: 'file',
            folderName: '',
            fileName: fileName,
            data: []
        };
        
        project.currentPoste.blocks.push(newFileBlock);
        
        // Ajouter automatiquement un tableau après le poste
        let newTableBlock = {
            id: 'block_table_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: createInitialTableData(),
            footer: {
                ens: 'Ens.',
                unit: '',
                pu: 0
            }
        };
        
        project.currentPoste.blocks.push(newTableBlock);
        
    } else if (blockType === 'table') {
        let newBlock = {
            id: 'block_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: createInitialTableData(),
            footer: {
                ens: 'Ens.',
                unit: '',
                pu: 0
            }
        };
        
        project.currentPoste.blocks.push(newBlock);
        
    } else if (blockType === 'canvas') {
        // Auto-increment canvas name like files
        let canvasCount = project.currentPoste.blocks.filter(b => b.type === 'canvas').length;
        let canvasTitle = 'Canvas ' + (canvasCount + 1);
        
        let newBlock = {
            id: 'block_' + Date.now(),
            type: 'canvas',
            folderName: '',
            fileName: '',
            data: [],
            canvasData: {
                title: canvasTitle,
                width: 800,
                height: 400,
                background: '#ffffff',
                image: ''
            }
        };
        
        project.currentPoste.blocks.push(newBlock);
        
    } else if (blockType === 'image') {
        // Create empty image block
        let imageCount = project.currentPoste.blocks.filter(b => b.type === 'image').length;
        let blockName = 'Images ' + (imageCount + 1);
        
        let newBlock = {
            id: 'block_' + Date.now(),
            type: 'image',
            folderName: '',
            fileName: '',
            data: [],
            imageData: {
                blockName: blockName,
                images: []
            }
        };
        
        project.currentPoste.blocks.push(newBlock);
    }
    
    renderMetreTable(projectId);
    updateTreeContent(projectId);  // Actualiser l'arborescence
    
    // Scroll vers le nouveau bloc créé (dernier bloc de la liste)
    setTimeout(() => {
        let lastBlockId = project.currentPoste.blocks[project.currentPoste.blocks.length - 1].id;
        let $newBlock = $(`#workspace-${projectId} [data-block-id="${lastBlockId}"]`).first();
        let $container = $(`#workspace-${projectId} .zoom-area-${projectId}`);
        
        if ($newBlock.length > 0 && $container.length > 0) {
            // Obtenir la position du bloc dans le conteneur
            let blockOffsetTop = $newBlock.offset().top;
            let containerOffsetTop = $container.offset().top;
            let currentScroll = $container.scrollTop();
            
            // Calculer où scroller pour mettre le bloc en haut
            let scrollTo = currentScroll + (blockOffsetTop - containerOffsetTop) - 10;
            
            // Scroller avec animation
            $container.animate({
                scrollTop: scrollTo
            }, 400);
        }
    }, 200);
}

// ===== HIERARCHICAL BLOCK MANAGEMENT =====

// Get children indices of a block (folder or file)
function getBlockChildren(projectId, blockIndex) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return [];
    
    let blocks = project.currentPoste.blocks;
    let block = blocks[blockIndex];
    let children = [];
    
    if (block.type === 'folder') {
        // Folder contains: files and tables until next folder
        for (let i = blockIndex + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'folder') break; // Stop at next folder
            children.push(i);
        }
    } else if (block.type === 'file') {
        // File contains: tables until next file or folder
        for (let i = blockIndex + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'file' || blocks[i].type === 'folder') break; // Stop at next file or folder
            if (blocks[i].type === 'table') {
                children.push(i);
            }
        }
    }
    
    return children;
}

// Count total children recursively
function countTotalChildren(projectId, blockIndex) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return 0;
    
    let blocks = project.currentPoste.blocks;
    let block = blocks[blockIndex];
    let count = 0;
    
    if (block.type === 'folder') {
        // Count files and tables until next folder
        for (let i = blockIndex + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'folder') break;
            count++;
        }
    } else if (block.type === 'file') {
        // Count tables until next file or folder
        for (let i = blockIndex + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'file' || blocks[i].type === 'folder') break;
            if (blocks[i].type === 'table') count++;
        }
    }
    
    return count;
}

// Delete block with confirmation and children
function deleteBlockWithConfirmation(projectId, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let blockIndex = project.currentPoste.blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return;
    
    let block = project.currentPoste.blocks[blockIndex];
    let childrenCount = countTotalChildren(projectId, blockIndex);
    
    // Build confirmation message
    let message = '';
    let blockTypeName = block.type === 'folder' ? 'dossier' : (block.type === 'file' ? 'fichier' : 'tableau');
    let blockName = block.folderName || block.fileName || 'tableau';
    
    if (childrenCount > 0) {
        if (block.type === 'folder') {
            message = `Supprimer le dossier "${blockName}" ?\n\nCela supprimera également ${childrenCount} élément(s) contenu(s) dans ce dossier (fichiers et tableaux).`;
        } else if (block.type === 'file') {
            message = `Supprimer le fichier "${blockName}" ?\n\nCela supprimera également ${childrenCount} tableau(x) contenu(s) dans ce fichier.`;
        }
    } else {
        message = `Supprimer ${blockTypeName === 'tableau' ? 'le' : 'le'} ${blockTypeName} "${blockName}" ?`;
    }
    
    // Show custom confirmation dialog
    showConfirmDialog(message, () => {
        // Get children indices to delete
        let indicesToDelete = [blockIndex];
        let children = getBlockChildren(projectId, blockIndex);
        indicesToDelete.push(...children);
        
        // Sort in descending order to delete from end to avoid index shifting
        indicesToDelete.sort((a, b) => b - a);
        
        // Delete all blocks
        indicesToDelete.forEach(index => {
            project.currentPoste.blocks.splice(index, 1);
        });
        
        renderMetreTable(projectId);
    });
}

// Custom confirmation dialog
function showConfirmDialog(message, onConfirm) {
    let html = `
        <div class="dialog-title">⚠️ Confirmation</div>
        <div class="dialog-content" style="white-space: pre-line; padding: 20px; line-height: 1.6;">
            ${message}
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" id="confirmDeleteBtn" style="background: #e74c3c;">Supprimer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    
    $('#confirmDeleteBtn').on('click', function() {
        closeDialog();
        onConfirm();
    });
}

// Show context menu for block
function showBlockContextMenu(projectId, blockId, e) {
    console.log('showBlockContextMenu called with:', { projectId, blockId, e });
    
    if (contextMenu) {
        contextMenu.remove();
    }
    
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) {
        console.log('No currentPoste or blocks');
        return;
    }
    
    let blockIndex = project.currentPoste.blocks.findIndex(b => b.id === blockId);
    console.log('Block index found:', blockIndex);
    
    if (blockIndex === -1) {
        console.log('Block not found with id:', blockId);
        return;
    }
    
    let block = project.currentPoste.blocks[blockIndex];
    console.log('Block found:', block);
    
    contextMenu = $('<div class="context-menu"></div>');
    
    let menuItems = [];
    
    if (block.type === 'folder' || block.type === 'file') {
        menuItems.push({ label: '✏️ Renommer', action: () => renameBlock(projectId, blockId) });
        menuItems.push({ separator: true });
    }
    
    // Copy/Cut/Paste
    menuItems.push({ label: '📋 Copier le bloc', action: () => copyBlock(projectId, blockId) });
    menuItems.push({ label: '✂️ Couper le bloc', action: () => cutBlock(projectId, blockId) });
    if (window.copiedBlock) {
        menuItems.push({ label: '📥 Coller avant', action: () => pasteBlockBefore(projectId, blockIndex) });
    }
    menuItems.push({ separator: true });
    
    // Insert before (not after)
    menuItems.push({ label: '📁 Insérer Dossier avant', action: () => insertBlockBefore(projectId, blockIndex, 'folder') });
    menuItems.push({ label: '📝 Insérer Fichier avant', action: () => insertBlockBefore(projectId, blockIndex, 'file') });
    menuItems.push({ label: '📊 Insérer Tableau avant', action: () => insertBlockBefore(projectId, blockIndex, 'table') });
    menuItems.push({ separator: true });
    
    if (blockIndex > 0) {
        menuItems.push({ label: '⬆️ Monter', action: () => moveBlockUp(projectId, blockIndex) });
    }
    if (blockIndex < project.currentPoste.blocks.length - 1) {
        menuItems.push({ label: '⬇️ Descendre', action: () => moveBlockDown(projectId, blockIndex) });
    }
    
    menuItems.push({ separator: true });
    
    // Special option for tables
    if (block.type === 'table') {
        menuItems.push({ label: '🗑️ Supprimer tableau', action: () => deleteBlockWithConfirmation(projectId, blockId) });
    } else if (block.type === 'folder') {
        menuItems.push({ label: '🗑️ Supprimer dossier', action: () => deleteBlockWithConfirmation(projectId, blockId) });
    } else if (block.type === 'file') {
        menuItems.push({ label: '🗑️ Supprimer fichier', action: () => deleteBlockWithConfirmation(projectId, blockId) });
    }
    
    menuItems.forEach(item => {
        if (item.separator) {
            contextMenu.append('<div class="context-menu-separator"></div>');
        } else {
            let menuItem = $(`<div class="context-menu-item">${item.label}</div>`);
            menuItem.on('click', () => {
                item.action();
                contextMenu.remove();
                contextMenu = null;
            });
            contextMenu.append(menuItem);
        }
    });
    
    positionContextMenu(contextMenu, e);
    
    $(document).one('click', () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

// Rename a block
function renameBlock(projectId, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    let currentName = block.type === 'folder' ? block.folderName : block.fileName;
    let newName = prompt('Nouveau nom:', currentName);
    
    if (newName && newName.trim()) {
        if (block.type === 'folder') {
            block.folderName = newName.trim();
        } else if (block.type === 'file') {
            block.fileName = newName.trim();
        }
        renderMetreTable(projectId);
    }
}

// Insert block after a specific index
function insertBlockAfter(projectId, afterIndex, blockType) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let blockName = '';
    let newBlock;
    
    if (blockType === 'folder') {
        blockName = prompt('Nom du dossier:');
        if (!blockName) return;
        
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'folder',
            folderName: blockName,
            fileName: '',
            data: []
        };
    } else if (blockType === 'file') {
        blockName = prompt('Nom du fichier:');
        if (!blockName) return;
        
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'file',
            folderName: '',
            fileName: blockName,
            data: []
        };
    } else if (blockType === 'table') {
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: createInitialTableData(),
            footer: {
                ens: 'Ens.',
                unit: (appSettings.units.customUnits && appSettings.units.customUnits[0]) || "Ml",
                pu: 0
            }
        };
    }
    
    project.currentPoste.blocks.splice(afterIndex + 1, 0, newBlock);
    renderMetreTable(projectId);
}

// Insert block before a specific index
function insertBlockBefore(projectId, beforeIndex, blockType) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let blockName = '';
    let newBlock;
    
    if (blockType === 'folder') {
        blockName = prompt('Nom du dossier:');
        if (!blockName) return;
        
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'folder',
            folderName: blockName,
            fileName: '',
            data: []
        };
    } else if (blockType === 'file') {
        blockName = prompt('Nom du fichier:');
        if (!blockName) return;
        
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'file',
            folderName: '',
            fileName: blockName,
            data: []
        };
    } else if (blockType === 'table') {
        newBlock = {
            id: 'block_' + Date.now(),
            type: 'table',
            folderName: '',
            fileName: '',
            data: createInitialTableData(),
            footer: {
                ens: 'Ens.',
                unit: (appSettings.units.customUnits && appSettings.units.customUnits[0]) || "Ml",
                pu: 0
            }
        };
    }
    
    project.currentPoste.blocks.splice(beforeIndex, 0, newBlock);
    renderMetreTable(projectId);
}

// Copy a block
function copyBlock(projectId, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    // Deep copy the block
    window.copiedBlock = JSON.parse(JSON.stringify(block));
    window.isCut = false; // Mark as copy, not cut
    
    // Visual feedback
    alert(`Bloc copié !\n\nType: ${block.type === 'folder' ? '📁 Dossier' : block.type === 'file' ? '📝 Fichier' : '📊 Tableau'}\n${block.type === 'folder' ? 'Nom: ' + block.folderName : block.type === 'file' ? 'Nom: ' + block.fileName : 'Lignes: ' + block.data.length}`);
}

// Cut block (copy then delete)
function cutBlock(projectId, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    // Deep copy the block
    window.copiedBlock = JSON.parse(JSON.stringify(block));
    window.isCut = true; // Mark as cut
    window.cutBlockId = blockId; // Remember which block was cut
    
    // Visual feedback (don't delete yet, wait for paste)
    alert(`Bloc coupé !\n\nType: ${block.type === 'folder' ? '📁 Dossier' : block.type === 'file' ? '📝 Fichier' : '📊 Tableau'}\n\nLe bloc sera supprimé après collage.`);
}

// Paste block before a specific index
function pasteBlockBefore(projectId, beforeIndex) {
    if (!window.copiedBlock) {
        alert('Aucun bloc copié');
        return;
    }
    
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    // If it was a cut operation, delete the original block first
    if (window.isCut && window.cutBlockId) {
        let cutIndex = project.currentPoste.blocks.findIndex(b => b.id === window.cutBlockId);
        if (cutIndex !== -1) {
            // Adjust beforeIndex if cutting from before paste position
            if (cutIndex < beforeIndex) {
                beforeIndex--;
            }
            project.currentPoste.blocks.splice(cutIndex, 1);
        }
        window.isCut = false;
        window.cutBlockId = null;
    }
    
    // Create new block with new ID
    let newBlock = JSON.parse(JSON.stringify(window.copiedBlock));
    newBlock.id = 'block_' + Date.now();
    
    // Insert before
    project.currentPoste.blocks.splice(beforeIndex, 0, newBlock);
    renderMetreTable(projectId);
}

// ===== HIERARCHICAL BLOCK SYSTEM =====

// Get all children indices of a block (recursive hierarchy)
function getBlockChildren(blocks, parentIndex) {
    let children = [];
    let parentBlock = blocks[parentIndex];
    
    if (!parentBlock) return children;
    
    // Start checking from the next block
    for (let i = parentIndex + 1; i < blocks.length; i++) {
        let currentBlock = blocks[i];
        
        // If parent is a folder
        if (parentBlock.type === 'folder') {
            // Stop when we hit another folder (same level)
            if (currentBlock.type === 'folder') {
                break;
            }
            // Everything else (files and tables) belongs to this folder
            children.push(i);
        }
        // If parent is a file
        else if (parentBlock.type === 'file') {
            // Stop when we hit a folder or another file (same/higher level)
            if (currentBlock.type === 'folder' || currentBlock.type === 'file') {
                break;
            }
            // Only tables belong to this file
            if (currentBlock.type === 'table') {
                children.push(i);
            }
        }
        // If parent is a table, it has no children
        else if (parentBlock.type === 'table') {
            break;
        }
    }
    
    return children;
}

// Get count of children for display
function getChildrenCount(blocks, parentIndex) {
    let children = getBlockChildren(blocks, parentIndex);
    let count = {
        folders: 0,
        files: 0,
        tables: 0,
        total: children.length
    };
    
    children.forEach(childIndex => {
        let child = blocks[childIndex];
        if (child.type === 'folder') count.folders++;
        else if (child.type === 'file') count.files++;
        else if (child.type === 'table') count.tables++;
    });
    
    return count;
}

// Show confirmation dialog for deletion
function showDeleteConfirmation(message, onConfirm) {
    let html = `
        <div class="dialog-title" style="color: #e74c3c;">⚠️ Confirmation de suppression</div>
        <div class="dialog-content" style="padding: 20px;">
            <p style="margin-bottom: 15px;">${message}</p>
            <p style="color: #e74c3c; font-weight: bold;">Cette action est irréversible !</p>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn" style="background: #e74c3c; color: white;" id="confirmDeleteBtn">Supprimer</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
    
    // Attach confirm handler
    $('#confirmDeleteBtn').off('click').on('click', function() {
        closeDialog();
        onConfirm();
    });
}

// ===== END HIERARCHICAL BLOCK SYSTEM =====

// Move block up (with all children)
function moveBlockUp(projectId, blockIndex) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    if (blockIndex === 0) return;
    
    let blocks = project.currentPoste.blocks;
    
    // Get all children of this block
    let childrenIndices = getBlockChildren(blocks, blockIndex);
    
    // Extract the block and its children
    let blockGroup = [blockIndex, ...childrenIndices];
    let extractedBlocks = blockGroup.map(idx => blocks[idx]);
    
    // Remove from original positions (in reverse order to maintain indices)
    blockGroup.sort((a, b) => b - a).forEach(idx => {
        blocks.splice(idx, 1);
    });
    
    // Insert before the previous block
    let newPosition = blockIndex - 1;
    blocks.splice(newPosition, 0, ...extractedBlocks);
    
    renderMetreTable(projectId);
}

// Move block down (with all children)
function moveBlockDown(projectId, blockIndex) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let blocks = project.currentPoste.blocks;
    
    // Get all children of this block
    let childrenIndices = getBlockChildren(blocks, blockIndex);
    let blockGroup = [blockIndex, ...childrenIndices];
    
    // Check if we can move down
    let lastIndex = Math.max(...blockGroup);
    if (lastIndex >= blocks.length - 1) return;
    
    // Extract the block and its children
    let extractedBlocks = blockGroup.map(idx => blocks[idx]);
    
    // Remove from original positions (in reverse order to maintain indices)
    blockGroup.sort((a, b) => b - a).forEach(idx => {
        blocks.splice(idx, 1);
    });
    
    // Insert after the next block (which is now at blockIndex position after deletion)
    let newPosition = blockIndex + 1;
    blocks.splice(newPosition, 0, ...extractedBlocks);
    
    renderMetreTable(projectId);
}

// Select a block (highlight it)
function selectBlock(projectId, blockId) {
    let project = projects[projectId];
    if (!project) return;
    
    // Store selected block ID
    project.selectedBlockId = blockId;
    
    // Remove previous selection
    $(`#workspace-${projectId} .block-row`).removeClass('block-selected');
    
    // Add selection to clicked block
    $(`#workspace-${projectId} .block-row[data-block-id="${blockId}"]`).addClass('block-selected');
}

// Edit file block title
function editFileBlockTitle(projectId, blockId, cellElement) {
    let project = projects[projectId];
    if (!project || !project.currentPoste) return;
    
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    if (!block || block.type !== 'file') return;
    
    let $cell = $(cellElement);
    let $titleText = $cell.find('.file-block-title-text');
    let currentTitle = block.fileName;
    
    // Create input element
    let $input = $('<input type="text" />')
        .val(currentTitle)
        .css({
            'width': '100%',
            'font-size': '12px',
            'font-weight': 'bold',
            'color': '#2c3e50',
            'border': '2px solid #3498db',
            'padding': '2px 4px',
            'outline': 'none',
            'background': 'white',
            'text-align': 'left'
        });
    
    // Replace text with input
    $titleText.html('').append($input);
    $input.focus().select();
    
    // Handle blur (save changes)
    $input.on('blur', function() {
        let newTitle = $(this).val().trim();
        if (newTitle === '') {
            newTitle = 'Sans titre';
        }
        
        // Update block only (do NOT update tree node name)
        block.fileName = newTitle;
        
        // Re-render table
        renderMetreTable(projectId);
        updateTreeContent(projectId);  // Actualiser l'arborescence
    });
    
    // Handle Enter key
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') {
            $(this).blur();
        } else if (e.key === 'Escape') {
            // Cancel editing
            renderMetreTable(projectId);
        }
    });
    
    // Prevent event propagation
    $input.on('click', function(e) {
        e.stopPropagation();
    });
}

// Delete block
function deleteBlock(projectId, blockId) {
    let project = projects[projectId];
    if (!project.currentPoste || !project.currentPoste.blocks) return;
    
    let blockIndex = project.currentPoste.blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return;
    
    let block = project.currentPoste.blocks[blockIndex];
    let blocks = project.currentPoste.blocks;
    
    // Get children that will be deleted
    let childrenIndices = getBlockChildren(blocks, blockIndex);
    let childrenCount = getChildrenCount(blocks, blockIndex);
    
    // Build description
    let blockDesc = block.type === 'folder' ? `dossier "${block.folderName}"` :
                    block.type === 'file' ? `fichier "${block.fileName}"` :
                    block.type === 'canvas' ? `canvas "${block.canvasData?.title || 'sans titre'}"` :
                    block.type === 'image' ? `zone d'images "${block.imageData?.blockName || 'sans titre'}"` :
                    'tableau';
    
    // Build detailed message
    let message = `Voulez-vous vraiment supprimer le <strong>${blockDesc}</strong> ?`;
    
    if (childrenIndices.length > 0) {
        message += `<br><br>⚠️ Cela supprimera également :`;
        message += `<ul style="margin: 10px 0; padding-left: 20px;">`;
        
        if (childrenCount.files > 0) {
            message += `<li><strong>${childrenCount.files}</strong> fichier${childrenCount.files > 1 ? 's' : ''}</li>`;
        }
        if (childrenCount.tables > 0) {
            message += `<li><strong>${childrenCount.tables}</strong> tableau${childrenCount.tables > 1 ? 'x' : ''}</li>`;
        }
        
        message += `</ul>`;
        message += `<strong>Total : ${childrenIndices.length + 1} élément${childrenIndices.length + 1 > 1 ? 's' : ''}</strong>`;
    }
    
    // Show confirmation dialog
    showDeleteConfirmation(message, function() {
        // Delete in reverse order to maintain correct indices
        let indicesToDelete = [blockIndex, ...childrenIndices].sort((a, b) => b - a);
        
        indicesToDelete.forEach(index => {
            blocks.splice(index, 1);
        });
        
        renderMetreTable(projectId);
        updateTreeContent(projectId);  // Actualiser l'arborescence
    });
}

// ===== ZOOM =====
document.getElementById('zoomSlider').addEventListener('input', function(e) {
    let zoom = e.target.value;
    document.getElementById('zoomText').innerText = zoom + '%';
    let zoomFactor = zoom / 100;
    if (currentProjectId) {
        // Sauvegarder le zoom dans le projet
        projects[currentProjectId].tableZoom = zoomFactor;
        $(`#workspace-${currentProjectId} .metre-table`).css('transform', `scale(${zoomFactor})`);
        $(`#workspace-${currentProjectId} .metre-table`).css('transform-origin', 'top left');
    }
});

// Zoom out button
document.getElementById('zoomOut').addEventListener('click', function() {
    let slider = document.getElementById('zoomSlider');
    let currentZoom = parseInt(slider.value);
    let newZoom = Math.max(10, currentZoom - 10);
    slider.value = newZoom;
    slider.dispatchEvent(new Event('input'));
});

// Zoom in button
document.getElementById('zoomIn').addEventListener('click', function() {
    let slider = document.getElementById('zoomSlider');
    let currentZoom = parseInt(slider.value);
    let newZoom = Math.min(400, currentZoom + 10);
    slider.value = newZoom;
    slider.dispatchEvent(new Event('input'));
});

// Fonction pour appliquer le zoom sauvegardé
function applyTableZoom(projectId) {
    let project = projects[projectId];
    if (!project) return;
    
    let zoomFactor = project.tableZoom || 1;
    $(`#workspace-${projectId} .metre-table`).css('transform', `scale(${zoomFactor})`);
    $(`#workspace-${projectId} .metre-table`).css('transform-origin', 'top left');
    
    // Mettre à jour le slider si c'est le projet actif
    if (projectId === currentProjectId) {
        let slider = document.getElementById('zoomSlider');
        if (slider) {
            slider.value = Math.round(zoomFactor * 100);
            document.getElementById('zoomText').innerText = Math.round(zoomFactor * 100) + '%';
        }
    }
}

// Update days remaining counter
function updateDaysRemaining() {
    console.log('[DEBUG] updateDaysRemaining called, currentProjectId:', currentProjectId);
    
    if (!currentProjectId) {
        document.getElementById('days-remaining').innerHTML = '';
        return;
    }
    
    let project = projects[currentProjectId];
    console.log('[DEBUG] project.metadata:', project ? project.metadata : 'no project');
    
    if (!project || !project.metadata) {
        document.getElementById('days-remaining').innerHTML = '<span style="color: #999;">📅 Aucune date définie</span>';
        return;
    }
    
    // Support both endDate and dateFin field names
    let dateStr = project.metadata.endDate || project.metadata.dateFin;
    
    if (!dateStr) {
        document.getElementById('days-remaining').innerHTML = '<span style="color: #999;">📅 Aucune date de fin</span>';
        return;
    }
    
    let endDate = new Date(dateStr);
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    
    let diffTime = endDate - today;
    let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    console.log('[DEBUG] Days remaining:', diffDays);
    
    let color = '#666';
    let icon = '📅';
    let text = '';
    
    if (diffDays < 0) {
        color = '#e74c3c';
        icon = '⚠️';
        text = `${Math.abs(diffDays)} jour(s) de retard`;
    } else if (diffDays === 0) {
        color = '#e67e22';
        icon = '⏰';
        text = `Aujourd'hui - Fin du projet`;
    } else if (diffDays <= 7) {
        color = '#e67e22';
        icon = '⏰';
        text = `${diffDays} jour(s) restant(s)`;
    } else {
        color = '#27ae60';
        icon = '📅';
        text = `${diffDays} jour(s) restant(s)`;
    }
    
    document.getElementById('days-remaining').innerHTML = `<span style="color: ${color}; cursor: pointer;" title="Double-clic pour modifier">${icon} ${text}</span>`;
    
    // Add double-click handler to the entire days-remaining div
    $('#days-remaining').off('dblclick').on('dblclick', function() {
        if (currentProjectId) {
            showProjectInfo(currentProjectId);
        }
    });
}

// Double-click on days-remaining to open project info
$(document).on('dblclick', '#days-remaining', function() {
    if (currentProjectId) {
        showProjectInfo(currentProjectId);
    }
});

// Call updateDaysRemaining when project changes or when opening
setInterval(updateDaysRemaining, 60000); // Update every minute

// Call after page loads
setTimeout(updateDaysRemaining, 500); // Initial call with delay

// Apply badge styles on startup
applyBadgeStyles();

// ===== INLINE CANVAS FUNCTIONS =====
let inlineCanvasStates = {}; // Store state for each canvas by blockId

function initializeInlineCanvases(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    // Initialize each canvas block
    project.currentPoste.blocks.forEach(block => {
        if (block.type === 'canvas') {
            let canvas = document.getElementById('inline-canvas-' + block.id);
            if (!canvas) return;
            
            let ctx = canvas.getContext('2d');
            
            // Initialize state for this canvas
            if (!inlineCanvasStates[block.id]) {
                inlineCanvasStates[block.id] = {
                    canvas: canvas,
                    ctx: ctx,
                    isDrawing: false,
                    currentTool: 'pen',
                    currentColor: '#000000',
                    lineWidth: 2,
                    startX: 0,
                    startY: 0,
                    history: [],
                    historyStep: -1,
                    images: [], // Array of image objects with position, scale, rotation
                    selectedImage: null,
                    isDragging: false,
                    isResizing: false,
                    isRotating: false,
                    dragStartX: 0,
                    dragStartY: 0
                };
            }
            
            let state = inlineCanvasStates[block.id];
            state.canvas = canvas;
            state.ctx = ctx;
            
            // Load canvas data
            if (block.canvasData) {
                // Load images if any
                if (block.canvasData.images) {
                    state.images = block.canvasData.images;
                }
                
                // Render everything
                renderCanvasContent(block.id, projectId);
            } else {
                // Fill with background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                saveInlineCanvasState(block.id);
            }
            
            // Attach mouse events
            $(canvas).off(); // Remove old events
            $(canvas).on('mousedown', function(e) { handleInlineCanvasMouseDown(e, block.id); });
            $(canvas).on('mousemove', function(e) { handleInlineCanvasMouseMove(e, block.id); });
            $(canvas).on('mouseup', function(e) { handleInlineCanvasMouseUp(e, block.id, projectId); });
            $(canvas).on('mouseleave', function(e) { handleInlineCanvasMouseUp(e, block.id, projectId); });
            
            // Right-click to import image
            $(canvas).on('contextmenu', function(e) {
                e.preventDefault();
                uploadImageToInlineCanvas(projectId, block.id);
                return false;
            });
        }
    });
    
    // Attach tool button events
    $('.inline-canvas-tool').off('click').on('click', function() {
        let blockId = $(this).data('block-id');
        let tool = $(this).data('tool');
        
        // Update active state for this canvas's tools only
        $(`.inline-canvas-tool[data-block-id="${blockId}"]`).css({
            background: 'white',
            color: 'black',
            borderColor: '#95a5a6'
        });
        $(this).css({
            background: '#3498db',
            color: 'white',
            borderColor: '#2980b9'
        });
        
        if (inlineCanvasStates[blockId]) {
            inlineCanvasStates[blockId].currentTool = tool;
            inlineCanvasStates[blockId].selectedImage = null; // Deselect image when changing tool
            renderCanvasContent(blockId, null);
        }
    });
    
    // Attach color picker events
    $('.inline-canvas-color').off('change').on('change', function() {
        let blockId = $(this).data('block-id');
        if (inlineCanvasStates[blockId]) {
            inlineCanvasStates[blockId].currentColor = $(this).val();
        }
    });
    
    // Attach line width events
    $('.inline-canvas-width').off('input').on('input', function() {
        let blockId = $(this).data('block-id');
        let width = parseInt($(this).val());
        if (inlineCanvasStates[blockId]) {
            inlineCanvasStates[blockId].lineWidth = width;
        }
        $(`.inline-width-value[data-block-id="${blockId}"]`).text(width + 'px');
    });
}

function renderCanvasContent(blockId, projectId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    let ctx = state.ctx;
    let canvas = state.canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw base drawing if exists
    if (state.history.length > 0 && state.historyStep >= 0) {
        let baseImg = new Image();
        baseImg.src = state.history[state.historyStep];
        baseImg.onload = function() {
            ctx.drawImage(baseImg, 0, 0);
            
            // Draw images on top
            drawAllImages(state);
        };
    } else {
        // Draw images
        drawAllImages(state);
    }
}

function drawAllImages(state) {
    let ctx = state.ctx;
    
    // Draw all images
    state.images.forEach((imgData, index) => {
        if (!imgData.loaded) {
            imgData.img = new Image();
            imgData.img.onload = function() {
                imgData.loaded = true;
                imgData.width = imgData.img.width * imgData.scale;
                imgData.height = imgData.img.height * imgData.scale;
                drawAllImages(state); // Redraw when image loads
            };
            imgData.img.src = imgData.src;
            return;
        }
        
        ctx.save();
        
        // Translate to image center
        ctx.translate(imgData.x + imgData.width / 2, imgData.y + imgData.height / 2);
        
        // Rotate
        ctx.rotate(imgData.rotation * Math.PI / 180);
        
        // Draw image centered
        ctx.drawImage(imgData.img, -imgData.width / 2, -imgData.height / 2, imgData.width, imgData.height);
        
        ctx.restore();
        
        // Draw selection handles if selected
        if (state.selectedImage === index) {
            drawSelectionHandles(ctx, imgData);
        }
    });
}

function drawSelectionHandles(ctx, imgData) {
    let x = imgData.x;
    let y = imgData.y;
    let w = imgData.width;
    let h = imgData.height;
    
    // Draw bounding box
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    
    // Draw resize handles (corners)
    let handleSize = 8;
    ctx.fillStyle = '#3498db';
    
    // Top-left
    ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
    // Top-right
    ctx.fillRect(x + w - handleSize/2, y - handleSize/2, handleSize, handleSize);
    // Bottom-left
    ctx.fillRect(x - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
    // Bottom-right
    ctx.fillRect(x + w - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
    
    // Draw rotation handle (top center)
    ctx.beginPath();
    ctx.arc(x + w/2, y - 20, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function handleInlineCanvasMouseDown(e, blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    let rect = state.canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;
    
    state.startX = mouseX;
    state.startY = mouseY;
    
    // If select tool, check if clicking on an image or handle
    if (state.currentTool === 'select') {
        // Check rotation handle first
        if (state.selectedImage !== null) {
            let img = state.images[state.selectedImage];
            let handleX = img.x + img.width / 2;
            let handleY = img.y - 20;
            if (Math.sqrt(Math.pow(mouseX - handleX, 2) + Math.pow(mouseY - handleY, 2)) < 8) {
                state.isRotating = true;
                return;
            }
            
            // Check resize handles
            let handleSize = 8;
            let handles = [
                {x: img.x, y: img.y, corner: 'tl'},
                {x: img.x + img.width, y: img.y, corner: 'tr'},
                {x: img.x, y: img.y + img.height, corner: 'bl'},
                {x: img.x + img.width, y: img.y + img.height, corner: 'br'}
            ];
            
            for (let handle of handles) {
                if (Math.abs(mouseX - handle.x) < handleSize && Math.abs(mouseY - handle.y) < handleSize) {
                    state.isResizing = true;
                    state.resizeCorner = handle.corner;
                    state.resizeStartWidth = img.width;
                    state.resizeStartHeight = img.height;
                    state.resizeStartX = img.x;
                    state.resizeStartY = img.y;
                    return;
                }
            }
        }
        
        // Check if clicking inside selected image (drag)
        if (state.selectedImage !== null) {
            let img = state.images[state.selectedImage];
            if (mouseX >= img.x && mouseX <= img.x + img.width &&
                mouseY >= img.y && mouseY <= img.y + img.height) {
                state.isDragging = true;
                state.dragStartX = mouseX - img.x;
                state.dragStartY = mouseY - img.y;
                return;
            }
        }
        
        // Check if clicking on any image (select)
        for (let i = state.images.length - 1; i >= 0; i--) {
            let img = state.images[i];
            if (mouseX >= img.x && mouseX <= img.x + img.width &&
                mouseY >= img.y && mouseY <= img.y + img.height) {
                state.selectedImage = i;
                renderCanvasContent(blockId, null);
                return;
            }
        }
        
        // Clicked on empty space - deselect
        state.selectedImage = null;
        renderCanvasContent(blockId, null);
        return;
    }
    
    // Drawing tools
    state.isDrawing = true;
    
    if (state.currentTool === 'pen') {
        state.ctx.beginPath();
        state.ctx.moveTo(state.startX, state.startY);
    }
}

function handleInlineCanvasMouseMove(e, blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    let rect = state.canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;
    
    // Handle image operations
    if (state.currentTool === 'select' && state.selectedImage !== null) {
        let img = state.images[state.selectedImage];
        
        if (state.isDragging) {
            img.x = mouseX - state.dragStartX;
            img.y = mouseY - state.dragStartY;
            renderCanvasContent(blockId, null);
            return;
        }
        
        if (state.isResizing) {
            let dx = mouseX - state.startX;
            let dy = mouseY - state.startY;
            
            // Maintain aspect ratio
            let aspectRatio = state.resizeStartWidth / state.resizeStartHeight;
            let newWidth, newHeight;
            
            if (state.resizeCorner === 'br') {
                newWidth = state.resizeStartWidth + dx;
                newHeight = newWidth / aspectRatio;
            } else if (state.resizeCorner === 'bl') {
                newWidth = state.resizeStartWidth - dx;
                newHeight = newWidth / aspectRatio;
                img.x = state.resizeStartX + dx;
            } else if (state.resizeCorner === 'tr') {
                newWidth = state.resizeStartWidth + dx;
                newHeight = newWidth / aspectRatio;
                img.y = state.resizeStartY - (newHeight - state.resizeStartHeight);
            } else if (state.resizeCorner === 'tl') {
                newWidth = state.resizeStartWidth - dx;
                newHeight = newWidth / aspectRatio;
                img.x = state.resizeStartX + dx;
                img.y = state.resizeStartY - (newHeight - state.resizeStartHeight);
            }
            
            if (newWidth > 10 && newHeight > 10) {
                img.width = newWidth;
                img.height = newHeight;
                img.scale = newWidth / img.img.width;
            }
            
            renderCanvasContent(blockId, null);
            return;
        }
        
        if (state.isRotating) {
            let centerX = img.x + img.width / 2;
            let centerY = img.y + img.height / 2;
            let angle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
            img.rotation = angle + 90;
            renderCanvasContent(blockId, null);
            return;
        }
    }
    
    // Normal drawing
    if (!state.isDrawing) return;
    
    if (state.currentTool === 'pen') {
        state.ctx.strokeStyle = state.currentColor;
        state.ctx.lineWidth = state.lineWidth;
        state.ctx.lineCap = 'round';
        state.ctx.lineTo(mouseX, mouseY);
        state.ctx.stroke();
    } else if (state.currentTool === 'eraser') {
        state.ctx.clearRect(mouseX - state.lineWidth/2, mouseY - state.lineWidth/2, state.lineWidth, state.lineWidth);
    }
}

function handleInlineCanvasMouseUp(e, blockId, projectId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    // Reset drag/resize/rotate states
    if (state.isDragging || state.isResizing || state.isRotating) {
        state.isDragging = false;
        state.isResizing = false;
        state.isRotating = false;
        saveInlineCanvasToBlock(projectId, blockId);
        return;
    }
    
    if (!state.isDrawing) return;
    
    let rect = state.canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    
    state.ctx.strokeStyle = state.currentColor;
    state.ctx.fillStyle = state.currentColor;
    state.ctx.lineWidth = state.lineWidth;
    
    if (state.currentTool === 'line') {
        state.ctx.beginPath();
        state.ctx.moveTo(state.startX, state.startY);
        state.ctx.lineTo(x, y);
        state.ctx.stroke();
    } else if (state.currentTool === 'rect') {
        state.ctx.strokeRect(state.startX, state.startY, x - state.startX, y - state.startY);
    } else if (state.currentTool === 'circle') {
        let radius = Math.sqrt(Math.pow(x - state.startX, 2) + Math.pow(y - state.startY, 2));
        state.ctx.beginPath();
        state.ctx.arc(state.startX, state.startY, radius, 0, 2 * Math.PI);
        state.ctx.stroke();
    } else if (state.currentTool === 'arrow') {
        drawInlineArrow(state, state.startX, state.startY, x, y);
    } else if (state.currentTool === 'text') {
        let text = prompt('Entrez le texte:');
        if (text) {
            state.ctx.font = (state.lineWidth * 8) + 'px Arial';
            state.ctx.fillText(text, state.startX, state.startY);
        }
    }
    
    state.isDrawing = false;
    saveInlineCanvasState(blockId);
    saveInlineCanvasToBlock(projectId, blockId);
}

function drawInlineArrow(state, fromX, fromY, toX, toY) {
    let headlen = 15;
    let angle = Math.atan2(toY - fromY, toX - fromX);
    
    state.ctx.beginPath();
    state.ctx.moveTo(fromX, fromY);
    state.ctx.lineTo(toX, toY);
    state.ctx.stroke();
    
    state.ctx.beginPath();
    state.ctx.moveTo(toX, toY);
    state.ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    state.ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    state.ctx.closePath();
    state.ctx.fill();
}

function saveInlineCanvasState(blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    state.history = state.history.slice(0, state.historyStep + 1);
    state.history.push(state.canvas.toDataURL());
    state.historyStep++;
}

function saveInlineCanvasToBlock(projectId, blockId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    let state = inlineCanvasStates[blockId];
    
    if (block && state) {
        if (!block.canvasData) block.canvasData = {};
        
        // Render everything to a temp canvas
        let tempCanvas = document.createElement('canvas');
        tempCanvas.width = state.canvas.width;
        tempCanvas.height = state.canvas.height;
        let tempCtx = tempCanvas.getContext('2d');
        
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Draw base drawing
        if (state.history.length > 0 && state.historyStep >= 0) {
            let baseImg = new Image();
            baseImg.src = state.history[state.historyStep];
            baseImg.onload = function() {
                tempCtx.drawImage(baseImg, 0, 0);
                finalizeCanvas();
            };
        } else {
            finalizeCanvas();
        }
        
        function finalizeCanvas() {
            // Draw images
            state.images.forEach(imgData => {
                if (imgData.loaded) {
                    tempCtx.save();
                    tempCtx.translate(imgData.x + imgData.width / 2, imgData.y + imgData.height / 2);
                    tempCtx.rotate(imgData.rotation * Math.PI / 180);
                    tempCtx.drawImage(imgData.img, -imgData.width / 2, -imgData.height / 2, imgData.width, imgData.height);
                    tempCtx.restore();
                }
            });
            
            block.canvasData.image = tempCanvas.toDataURL();
            block.canvasData.images = state.images.map(img => ({
                src: img.src,
                x: img.x,
                y: img.y,
                width: img.width,
                height: img.height,
                scale: img.scale,
                rotation: img.rotation
            }));
        }
    }
}

function undoInlineCanvas(projectId, blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state || state.historyStep <= 0) return;
    
    state.historyStep--;
    renderCanvasContent(blockId, projectId);
    saveInlineCanvasToBlock(projectId, blockId);
}

function redoInlineCanvas(projectId, blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state || state.historyStep >= state.history.length - 1) return;
    
    state.historyStep++;
    renderCanvasContent(blockId, projectId);
    saveInlineCanvasToBlock(projectId, blockId);
}

function clearInlineCanvas(projectId, blockId) {
    if (!confirm('Effacer tout le canvas ?')) return;
    
    let state = inlineCanvasStates[blockId];
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (!state || !block) return;
    
    state.images = [];
    state.selectedImage = null;
    state.history = [];
    state.historyStep = -1;
    
    let bg = (block.canvasData && block.canvasData.background) || '#ffffff';
    state.ctx.fillStyle = bg;
    state.ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
    saveInlineCanvasState(blockId);
    saveInlineCanvasToBlock(projectId, blockId);
}

function uploadImageToInlineCanvas(projectId, blockId) {
    let state = inlineCanvasStates[blockId];
    if (!state) return;
    
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function(e) {
        let file = e.target.files[0];
        let reader = new FileReader();
        reader.onload = function(event) {
            let img = new Image();
            img.onload = function() {
                // Add image as a new layer
                state.images.push({
                    src: event.target.result,
                    img: img,
                    x: 50,
                    y: 50,
                    width: img.width,
                    height: img.height,
                    scale: 1,
                    rotation: 0,
                    loaded: true
                });
                
                renderCanvasContent(blockId, projectId);
                saveInlineCanvasToBlock(projectId, blockId);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function updateCanvasTitle(projectId, blockId, newTitle) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.canvasData) {
        block.canvasData.title = newTitle;
        updateTreeContent(projectId);  // Actualiser l'arborescence
    }
}

// ===== IMAGE BLOCK FUNCTIONS =====
function updateImageBlockName(projectId, blockId, newName) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData) {
        block.imageData.blockName = newName;
        updateTreeContent(projectId);  // Actualiser l'arborescence
    }
}

function addImageToBlock(projectId, blockId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (!block) return;
    
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function(e) {
        let file = e.target.files[0];
        if (!file) return;
        
        let reader = new FileReader();
        reader.onload = function(event) {
            if (!block.imageData) block.imageData = { images: [], blockName: 'Images' };
            if (!block.imageData.images) block.imageData.images = [];
            
            let newImage = {
                id: 'img_' + Date.now(),
                name: file.name,
                src: event.target.result,
                x: 10 + (block.imageData.images.length * 20),
                y: 10 + (block.imageData.images.length * 20),
                width: 300,
                originalWidth: null,
                originalHeight: null
            };
            
            block.imageData.images.push(newImage);
            renderMetreTable(projectId);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function deleteImageFromBlock(projectId, blockId, imageId) {
    if (!confirm('Supprimer cette image ?')) return;
    
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images) {
        block.imageData.images = block.imageData.images.filter(img => img.id !== imageId);
        renderMetreTable(projectId);
    }
}

function updateImageOriginalDimensions(projectId, blockId, imageId, imgElement) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images && imgElement) {
        let img = block.imageData.images.find(i => i.id === imageId);
        if (img) {
            img.originalWidth = imgElement.naturalWidth;
            img.originalHeight = imgElement.naturalHeight;
            
            // Adjust container height
            adjustImageContainerHeight(projectId, blockId);
        }
    }
}

function initializeDraggableImages(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    let dragState = {
        isDragging: false,
        isResizing: false,
        currentElement: null,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        blockId: null,
        imageId: null,
        selectedImageElement: null,
        selectedBlockId: null,
        selectedImageId: null
    };
    
    // Store drag state globally for keyboard access
    window.imageDragState = dragState;
    
    // Attach events to all draggable images
    $('.draggable-image').each(function() {
        let $elem = $(this);
        let blockId = $elem.data('block-id');
        let imageId = $elem.data('image-id');
        
        // Show/hide handles on hover
        $elem.on('mouseenter', function() {
            $(this).css('border-color', '#3498db');
            $(this).find('.resize-handle').show();
            $(this).find('.delete-image-btn').show();
        }).on('mouseleave', function() {
            if (!dragState.isDragging && !dragState.isResizing) {
                // Keep border if selected
                if (dragState.selectedImageElement !== this) {
                    $(this).css('border-color', 'transparent');
                    $(this).find('.resize-handle').hide();
                    $(this).find('.delete-image-btn').hide();
                }
            }
        });
        
        // Click to select
        $elem.on('click', function(e) {
            if ($(e.target).hasClass('resize-handle') || $(e.target).hasClass('delete-image-btn')) {
                return;
            }
            
            // Deselect previous
            if (dragState.selectedImageElement) {
                $(dragState.selectedImageElement).css('border-color', 'transparent');
                $(dragState.selectedImageElement).find('.resize-handle').hide();
                $(dragState.selectedImageElement).find('.delete-image-btn').hide();
            }
            
            // Select this one
            dragState.selectedImageElement = this;
            dragState.selectedBlockId = blockId;
            dragState.selectedImageId = imageId;
            
            $(this).css('border-color', '#3498db');
            $(this).find('.resize-handle').show();
            $(this).find('.delete-image-btn').show();
            
            e.stopPropagation();
        });
        
        // Start dragging
        $elem.on('mousedown', function(e) {
            // Ignore if clicking on resize handle or delete button
            if ($(e.target).hasClass('resize-handle') || $(e.target).hasClass('delete-image-btn')) {
                return;
            }
            
            dragState.isDragging = true;
            dragState.currentElement = this;
            dragState.blockId = blockId;
            dragState.imageId = imageId;
            
            let offset = $elem.position();
            dragState.startX = e.pageX;
            dragState.startY = e.pageY;
            dragState.startLeft = offset.left;
            dragState.startTop = offset.top;
            
            $(this).css({
                'z-index': '100',
                'border-color': '#3498db'
            });
            
            e.preventDefault();
            e.stopPropagation();
        });
        
        // Right-click context menu on individual image
        $elem.on('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Select this image
            if (dragState.selectedImageElement) {
                $(dragState.selectedImageElement).css('border-color', 'transparent');
            }
            dragState.selectedImageElement = this;
            dragState.selectedBlockId = blockId;
            dragState.selectedImageId = imageId;
            $(this).css('border-color', '#3498db');
            
            showImageItemContextMenu(projectId, blockId, imageId, e);
            return false;
        });
    });
    
    // Resize handle events
    $('.resize-handle').on('mousedown', function(e) {
        let blockId = $(this).data('block-id');
        let imageId = $(this).data('image-id');
        let $elem = $(`#draggable-img-${blockId}-${imageId}`);
        
        dragState.isResizing = true;
        dragState.currentElement = $elem[0];
        dragState.blockId = blockId;
        dragState.imageId = imageId;
        dragState.startX = e.pageX;
        dragState.startWidth = $elem.find('img').width();
        
        $elem.css({
            'z-index': '100',
            'border-color': '#3498db'
        });
        
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Mouse move
    $(document).on('mousemove.draggableImages', function(e) {
        if (dragState.isDragging && dragState.currentElement) {
            let deltaX = e.pageX - dragState.startX;
            let deltaY = e.pageY - dragState.startY;
            
            let newLeft = dragState.startLeft + deltaX;
            let newTop = dragState.startTop + deltaY;
            
            // Keep within bounds (minimum 0)
            newLeft = Math.max(0, newLeft);
            newTop = Math.max(0, newTop);
            
            $(dragState.currentElement).css({
                left: newLeft + 'px',
                top: newTop + 'px'
            });
            
        } else if (dragState.isResizing && dragState.currentElement) {
            let deltaX = e.pageX - dragState.startX;
            let newWidth = dragState.startWidth + deltaX;
            
            if (newWidth > 50 && newWidth < 2000) {
                $(dragState.currentElement).find('img').css('width', newWidth + 'px');
            }
        }
    });
    
    // Mouse up
    $(document).on('mouseup.draggableImages', function(e) {
        if (dragState.isDragging && dragState.currentElement) {
            // Save position
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === dragState.blockId);
            if (block && block.imageData && block.imageData.images) {
                let img = block.imageData.images.find(i => i.id === dragState.imageId);
                if (img) {
                    img.x = parseInt($(dragState.currentElement).css('left'));
                    img.y = parseInt($(dragState.currentElement).css('top'));
                }
            }
            
            $(dragState.currentElement).css('z-index', '1');
            adjustImageContainerHeight(projectId, dragState.blockId);
            
        } else if (dragState.isResizing && dragState.currentElement) {
            // Save width
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === dragState.blockId);
            if (block && block.imageData && block.imageData.images) {
                let img = block.imageData.images.find(i => i.id === dragState.imageId);
                if (img) {
                    img.width = $(dragState.currentElement).find('img').width();
                }
            }
            
            $(dragState.currentElement).css('z-index', '1');
            adjustImageContainerHeight(projectId, dragState.blockId);
        }
        
        dragState.isDragging = false;
        dragState.isResizing = false;
        dragState.currentElement = null;
    });
    
    // Click on container to deselect
    $('.image-container').on('click', function(e) {
        if (e.target === this) {
            if (dragState.selectedImageElement) {
                $(dragState.selectedImageElement).css('border-color', 'transparent');
                $(dragState.selectedImageElement).find('.resize-handle').hide();
                $(dragState.selectedImageElement).find('.delete-image-btn').hide();
            }
            dragState.selectedImageElement = null;
            dragState.selectedBlockId = null;
            dragState.selectedImageId = null;
        }
    });
    
    // Right-click context menu on image containers
    $('.image-container').on('contextmenu', function(e) {
        // Only show container menu if not clicking on an image
        if (!$(e.target).closest('.draggable-image').length) {
            e.preventDefault();
            let blockId = $(this).data('block-id');
            let projectId = $(this).data('project-id');
            showImageContextMenu(projectId, blockId, e);
            return false;
        }
    });
    
    // Keyboard shortcuts
    setupImageKeyboardShortcuts(projectId);
}

function setupImageKeyboardShortcuts(projectId) {
    $(document).off('keydown.imageShortcuts').on('keydown.imageShortcuts', function(e) {
        let dragState = window.imageDragState;
        if (!dragState || !dragState.selectedImageElement) return;
        
        let blockId = dragState.selectedBlockId;
        let imageId = dragState.selectedImageId;
        let $elem = $(dragState.selectedImageElement);
        
        // Delete/Suppr key
        if (e.key === 'Delete' || e.key === 'Suppr') {
            e.preventDefault();
            deleteImageFromBlock(projectId, blockId, imageId);
            return;
        }
        
        // Arrow keys to move image
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            
            let step = e.shiftKey ? 10 : 1;
            let currentLeft = parseInt($elem.css('left'));
            let currentTop = parseInt($elem.css('top'));
            
            let newLeft = currentLeft;
            let newTop = currentTop;
            
            if (e.key === 'ArrowLeft') newLeft -= step;
            if (e.key === 'ArrowRight') newLeft += step;
            if (e.key === 'ArrowUp') newTop -= step;
            if (e.key === 'ArrowDown') newTop += step;
            
            // Keep within bounds
            newLeft = Math.max(0, newLeft);
            newTop = Math.max(0, newTop);
            
            $elem.css({
                left: newLeft + 'px',
                top: newTop + 'px'
            });
            
            // Save position
            let project = projects[projectId];
            let block = project.currentPoste.blocks.find(b => b.id === blockId);
            if (block && block.imageData && block.imageData.images) {
                let img = block.imageData.images.find(i => i.id === imageId);
                if (img) {
                    img.x = newLeft;
                    img.y = newTop;
                }
            }
            
            adjustImageContainerHeight(projectId, blockId);
        }
    });
}

function adjustImageContainerHeight(projectId, blockId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (!block || !block.imageData || !block.imageData.images) return;
    
    let maxHeight = 200; // Minimum
    
    block.imageData.images.forEach(img => {
        if (img.originalWidth && img.originalHeight) {
            let imgHeight = (img.width / img.originalWidth) * img.originalHeight;
            let totalHeight = img.y + imgHeight + 20;
            maxHeight = Math.max(maxHeight, totalHeight);
        }
    });
    
    $(`#image-container-${blockId}`).css({
        'min-height': maxHeight + 'px',
        'height': maxHeight + 'px'
    });
}

function showImageContextMenu(projectId, blockId, e) {
    // Remove existing context menu
    $('.custom-context-menu').remove();
    
    let menu = $(`
        <div class="custom-context-menu" style="position: fixed; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 10000; min-width: 180px;">
            <div class="context-menu-item" data-action="add" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                ➕ Ajouter une image
            </div>
            <div class="context-menu-item" data-action="paste" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                📋 Coller une image
            </div>
            <div class="context-menu-item" data-action="clear" style="padding: 8px 15px; cursor: pointer; font-size: 12px; color: #e74c3c;">
                🗑️ Tout supprimer
            </div>
        </div>
    `);
    
    menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append(menu);
    
    // Menu item click
    menu.find('.context-menu-item').on('click', function() {
        let action = $(this).data('action');
        
        if (action === 'paste') {
            pasteImageToBlock(projectId, blockId);
        } else if (action === 'add') {
            addImageToBlock(projectId, blockId);
        } else if (action === 'clear') {
            clearAllImagesFromBlock(projectId, blockId);
        }
        
        menu.remove();
    });
    
    // Hover effect
    menu.find('.context-menu-item').on('mouseenter', function() {
        $(this).css('background', '#e8f4fd');
    }).on('mouseleave', function() {
        $(this).css('background', 'white');
    });
    
    // Close on click outside
    $(document).one('click', function() {
        menu.remove();
    });
}

function showImageItemContextMenu(projectId, blockId, imageId, e) {
    // Remove existing context menu
    $('.custom-context-menu').remove();
    
    let menu = $(`
        <div class="custom-context-menu" style="position: fixed; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 10000; min-width: 180px;">
            <div class="context-menu-item" data-action="cut" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                ✂️ Couper
            </div>
            <div class="context-menu-item" data-action="copy" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                📄 Copier
            </div>
            <div class="context-menu-item" data-action="bringFront" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                ⬆️ Placer devant
            </div>
            <div class="context-menu-item" data-action="sendBack" style="padding: 8px 15px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #eee;">
                ⬇️ Placer derrière
            </div>
            <div class="context-menu-item" data-action="delete" style="padding: 8px 15px; cursor: pointer; font-size: 12px; color: #e74c3c;">
                🗑️ Supprimer
            </div>
        </div>
    `);
    
    menu.css({
        left: e.pageX + 'px',
        top: e.pageY + 'px'
    });
    
    $('body').append(menu);
    
    // Menu item click
    menu.find('.context-menu-item').on('click', function() {
        let action = $(this).data('action');
        
        if (action === 'copy') {
            copyImage(projectId, blockId, imageId);
        } else if (action === 'cut') {
            cutImage(projectId, blockId, imageId);
        } else if (action === 'bringFront') {
            bringImageToFront(projectId, blockId, imageId);
        } else if (action === 'sendBack') {
            sendImageToBack(projectId, blockId, imageId);
        } else if (action === 'delete') {
            deleteImageFromBlock(projectId, blockId, imageId);
        }
        
        menu.remove();
    });
    
    // Hover effect
    menu.find('.context-menu-item').on('mouseenter', function() {
        $(this).css('background', '#e8f4fd');
    }).on('mouseleave', function() {
        $(this).css('background', 'white');
    });
    
    // Close on click outside
    $(document).one('click', function() {
        menu.remove();
    });
}

// Image clipboard
let imageClipboard = null;

function copyImage(projectId, blockId, imageId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images) {
        let img = block.imageData.images.find(i => i.id === imageId);
        if (img) {
            imageClipboard = {
                action: 'copy',
                data: JSON.parse(JSON.stringify(img)) // Deep copy
            };
            console.log('✅ Image copiée');
        }
    }
}

function cutImage(projectId, blockId, imageId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images) {
        let img = block.imageData.images.find(i => i.id === imageId);
        if (img) {
            imageClipboard = {
                action: 'cut',
                sourceProjectId: projectId,
                sourceBlockId: blockId,
                sourceImageId: imageId,
                data: JSON.parse(JSON.stringify(img))
            };
            
            // Mark as cut (semi-transparent)
            $(`#draggable-img-${blockId}-${imageId}`).css('opacity', '0.5');
            console.log('✅ Image coupée');
        }
    }
}

function bringImageToFront(projectId, blockId, imageId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images) {
        let imgIndex = block.imageData.images.findIndex(i => i.id === imageId);
        if (imgIndex !== -1) {
            // Move to end of array (rendered last = on top)
            let img = block.imageData.images.splice(imgIndex, 1)[0];
            block.imageData.images.push(img);
            renderMetreTable(projectId);
            console.log('✅ Image placée devant');
        }
    }
}

function sendImageToBack(projectId, blockId, imageId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData && block.imageData.images) {
        let imgIndex = block.imageData.images.findIndex(i => i.id === imageId);
        if (imgIndex !== -1) {
            // Move to beginning of array (rendered first = at back)
            let img = block.imageData.images.splice(imgIndex, 1)[0];
            block.imageData.images.unshift(img);
            renderMetreTable(projectId);
            console.log('✅ Image placée derrière');
        }
    }
}

function pasteImageToBlock(projectId, blockId) {
    // First check internal clipboard
    if (imageClipboard) {
        let project = projects[projectId];
        let block = project.currentPoste.blocks.find(b => b.id === blockId);
        
        if (block && block.imageData) {
            if (!block.imageData.images) block.imageData.images = [];
            
            // Create new image from clipboard
            let newImage = JSON.parse(JSON.stringify(imageClipboard.data));
            newImage.id = 'img_' + Date.now();
            newImage.x = newImage.x + 20; // Offset slightly
            newImage.y = newImage.y + 20;
            
            block.imageData.images.push(newImage);
            
            // If it was cut, remove from source
            if (imageClipboard.action === 'cut') {
                let sourceProject = projects[imageClipboard.sourceProjectId];
                let sourceBlock = sourceProject.currentPoste.blocks.find(b => b.id === imageClipboard.sourceBlockId);
                if (sourceBlock && sourceBlock.imageData && sourceBlock.imageData.images) {
                    sourceBlock.imageData.images = sourceBlock.imageData.images.filter(i => i.id !== imageClipboard.sourceImageId);
                }
                imageClipboard = null; // Clear clipboard after cut
            }
            
            renderMetreTable(projectId);
            console.log('✅ Image collée');
            return;
        }
    }
    
    // Try to read from system clipboard
    navigator.clipboard.read().then(items => {
        for (let item of items) {
            for (let type of item.types) {
                if (type.startsWith('image/')) {
                    item.getType(type).then(blob => {
                        let reader = new FileReader();
                        reader.onload = function(event) {
                            let project = projects[projectId];
                            let block = project.currentPoste.blocks.find(b => b.id === blockId);
                            
                            if (block && block.imageData) {
                                if (!block.imageData.images) block.imageData.images = [];
                                
                                let newImage = {
                                    id: 'img_' + Date.now(),
                                    name: 'Image collée',
                                    src: event.target.result,
                                    x: 10 + (block.imageData.images.length * 20),
                                    y: 10 + (block.imageData.images.length * 20),
                                    width: 300,
                                    originalWidth: null,
                                    originalHeight: null
                                };
                                
                                block.imageData.images.push(newImage);
                                renderMetreTable(projectId);
                                console.log('✅ Image collée depuis le presse-papiers');
                            }
                        };
                        reader.readAsDataURL(blob);
                    });
                    return;
                }
            }
        }
        alert('Aucune image dans le presse-papiers');
    }).catch(err => {
        alert('Impossible de lire le presse-papiers. Utilisez Ctrl+V ou le bouton Ajouter.');
    });
}

function clearAllImagesFromBlock(projectId, blockId) {
    if (!confirm('Supprimer toutes les images de ce bloc ?')) return;
    
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (block && block.imageData) {
        block.imageData.images = [];
        renderMetreTable(projectId);
    }
}

// ===== DRAWING TOOLS SYSTEM =====
let drawingStates = {}; // Store drawing state for each block

function initializeDrawingTools(projectId) {
    let project = projects[projectId];
    if (!project.currentPoste) return;
    
    // Initialize each image block
    project.currentPoste.blocks.forEach(block => {
        if (block.type === 'image') {
            let canvas = document.getElementById(`draw-canvas-${block.id}`);
            if (!canvas) return;
            
            let container = $(`#image-container-${block.id}`);
            canvas.width = container.width();
            canvas.height = container.height();
            
            let ctx = canvas.getContext('2d');
            
            // Initialize state
            if (!drawingStates[block.id]) {
                drawingStates[block.id] = {
                    canvas: canvas,
                    ctx: ctx,
                    isDrawing: false,
                    currentTool: null,
                    color: '#e74c3c',
                    opacity: 1,
                    lineWidth: 3,
                    startX: 0,
                    startY: 0,
                    drawings: [] // Store all drawn elements
                };
            }
            
            let state = drawingStates[block.id];
            state.canvas = canvas;
            state.ctx = ctx;
            
            // Load existing drawings if any
            if (block.imageData && block.imageData.drawings) {
                state.drawings = block.imageData.drawings;
                redrawAllAnnotations(block.id);
            }
            
            // Attach tool button events
            $(`.draw-tool-btn[data-block-id="${block.id}"]`).off('click').on('click', function() {
                let tool = $(this).data('tool');
                
                // Toggle tool
                if (state.currentTool === tool) {
                    // Deactivate
                    state.currentTool = null;
                    $(this).css({background: 'white', borderColor: '#bdc3c7'});
                    canvas.style.pointerEvents = 'none';
                } else {
                    // Activate this tool
                    state.currentTool = tool;
                    $(`.draw-tool-btn[data-block-id="${block.id}"]`).css({background: 'white', borderColor: '#bdc3c7'});
                    $(this).css({background: '#3498db', color: 'white', borderColor: '#2980b9'});
                    canvas.style.pointerEvents = 'auto';
                }
            });
            
            // Line width slider
            $(`.draw-line-width[data-block-id="${block.id}"]`).off('input').on('input', function() {
                state.lineWidth = parseInt($(this).val());
                $(`.draw-width-value[data-block-id="${block.id}"]`).text(state.lineWidth + 'px');
            });
            
            // Color picker
            $(`.draw-color[data-block-id="${block.id}"]`).off('change').on('change', function() {
                state.color = $(this).val();
            });
            
            // Opacity slider
            $(`.draw-opacity[data-block-id="${block.id}"]`).off('input').on('input', function() {
                let opacity = parseInt($(this).val());
                state.opacity = opacity / 100;
                $(`.draw-opacity-value[data-block-id="${block.id}"]`).text(opacity + '%');
            });
            
            // Canvas drawing events
            $(canvas).off('mousedown').on('mousedown', function(e) {
                if (!state.currentTool) return;
                
                let rect = canvas.getBoundingClientRect();
                state.startX = e.clientX - rect.left;
                state.startY = e.clientY - rect.top;
                state.isDrawing = true;
                
                if (state.currentTool === 'freehand') {
                    ctx.beginPath();
                    ctx.moveTo(state.startX, state.startY);
                } else if (state.currentTool === 'eraser') {
                    // Start erasing
                }
            });
            
            $(canvas).off('mousemove').on('mousemove', function(e) {
                if (!state.isDrawing || !state.currentTool) return;
                
                let rect = canvas.getBoundingClientRect();
                let x = e.clientX - rect.left;
                let y = e.clientY - rect.top;
                
                if (state.currentTool === 'freehand') {
                    ctx.globalAlpha = state.opacity;
                    ctx.strokeStyle = state.color;
                    ctx.lineWidth = state.lineWidth;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineTo(x, y);
                    ctx.stroke();
                } else if (state.currentTool === 'eraser') {
                    // Erase by clearing
                    ctx.clearRect(x - state.lineWidth/2, y - state.lineWidth/2, state.lineWidth, state.lineWidth);
                }
            });
            
            $(canvas).off('mouseup').on('mouseup', function(e) {
                if (!state.isDrawing || !state.currentTool) return;
                
                let rect = canvas.getBoundingClientRect();
                let x = e.clientX - rect.left;
                let y = e.clientY - rect.top;
                
                ctx.globalAlpha = state.opacity;
                ctx.strokeStyle = state.color;
                ctx.fillStyle = state.color;
                ctx.lineWidth = state.lineWidth;
                
                if (state.currentTool === 'arrow') {
                    drawArrowOnCanvas(ctx, state.startX, state.startY, x, y, state.lineWidth);
                    saveDrawing(block.id, {
                        type: 'arrow',
                        x1: state.startX,
                        y1: state.startY,
                        x2: x,
                        y2: y,
                        color: state.color,
                        opacity: state.opacity,
                        lineWidth: state.lineWidth
                    });
                } else if (state.currentTool === 'circle') {
                    let radiusX = Math.abs(x - state.startX) / 2;
                    let radiusY = Math.abs(y - state.startY) / 2;
                    let centerX = state.startX + (x - state.startX) / 2;
                    let centerY = state.startY + (y - state.startY) / 2;
                    
                    ctx.beginPath();
                    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                    ctx.stroke();
                    
                    saveDrawing(block.id, {
                        type: 'circle',
                        cx: centerX,
                        cy: centerY,
                        rx: radiusX,
                        ry: radiusY,
                        color: state.color,
                        opacity: state.opacity,
                        lineWidth: state.lineWidth
                    });
                } else if (state.currentTool === 'rect') {
                    ctx.strokeRect(state.startX, state.startY, x - state.startX, y - state.startY);
                    
                    saveDrawing(block.id, {
                        type: 'rect',
                        x: state.startX,
                        y: state.startY,
                        width: x - state.startX,
                        height: y - state.startY,
                        color: state.color,
                        opacity: state.opacity,
                        lineWidth: state.lineWidth
                    });
                } else if (state.currentTool === 'text') {
                    let text = prompt('Entrez le texte:');
                    if (text) {
                        ctx.font = (state.lineWidth * 5) + 'px Arial';
                        ctx.fillText(text, state.startX, state.startY);
                        
                        saveDrawing(block.id, {
                            type: 'text',
                            x: state.startX,
                            y: state.startY,
                            text: text,
                            color: state.color,
                            opacity: state.opacity,
                            fontSize: state.lineWidth * 5
                        });
                    }
                } else if (state.currentTool === 'freehand') {
                    // Save the current canvas state as freehand drawing
                    saveDrawing(block.id, {
                        type: 'freehand',
                        image: canvas.toDataURL()
                    });
                }
                
                state.isDrawing = false;
                ctx.globalAlpha = 1; // Reset
                
                // Save to block
                saveDrawingsToBlock(projectId, block.id);
            });
        }
    });
}

function drawArrowOnCanvas(ctx, fromX, fromY, toX, toY, lineWidth) {
    let headlen = 15 + lineWidth;
    let angle = Math.atan2(toY - fromY, toX - fromX);
    
    // Draw line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    
    // Draw arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function saveDrawing(blockId, drawing) {
    let state = drawingStates[blockId];
    if (state) {
        state.drawings.push(drawing);
    }
}

function saveDrawingsToBlock(projectId, blockId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    let state = drawingStates[blockId];
    
    if (block && block.imageData && state) {
        block.imageData.drawings = state.drawings;
    }
}

function redrawAllAnnotations(blockId) {
    let state = drawingStates[blockId];
    if (!state) return;
    
    let ctx = state.ctx;
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    
    state.drawings.forEach(drawing => {
        ctx.globalAlpha = drawing.opacity || 1;
        ctx.strokeStyle = drawing.color;
        ctx.fillStyle = drawing.color;
        ctx.lineWidth = drawing.lineWidth;
        
        if (drawing.type === 'arrow') {
            drawArrowOnCanvas(ctx, drawing.x1, drawing.y1, drawing.x2, drawing.y2, drawing.lineWidth);
        } else if (drawing.type === 'circle') {
            ctx.beginPath();
            ctx.ellipse(drawing.cx, drawing.cy, drawing.rx, drawing.ry, 0, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (drawing.type === 'rect') {
            ctx.strokeRect(drawing.x, drawing.y, drawing.width, drawing.height);
        } else if (drawing.type === 'text') {
            ctx.font = drawing.fontSize + 'px Arial';
            ctx.fillText(drawing.text, drawing.x, drawing.y);
        } else if (drawing.type === 'freehand') {
            let img = new Image();
            img.onload = function() {
                ctx.drawImage(img, 0, 0);
            };
            img.src = drawing.image;
        }
    });
    
    ctx.globalAlpha = 1;
}

function exportCanvasImage(projectId, blockId) {
    let project = projects[projectId];
    let block = project.currentPoste.blocks.find(b => b.id === blockId);
    
    if (!block || !block.canvasData || !block.canvasData.image) {
        alert('Aucune image à exporter');
        return;
    }
    
    // Download image
    let link = document.createElement('a');
    link.download = (block.canvasData.title || 'canvas') + '.png';
    link.href = block.canvasData.image;
    link.click();
}

// ===== PASTE IMAGE SUPPORT =====
// Listen for paste events globally
document.addEventListener('paste', function(e) {
    // Only handle paste if we're in a project with a current poste
    if (!currentProjectId) return;
    
    let project = projects[currentProjectId];
    if (!project || !project.currentPoste) return;
    
    // Get clipboard items
    let items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            
            let blob = items[i].getAsFile();
            let reader = new FileReader();
            
            reader.onload = function(event) {
                let imageCount = project.currentPoste.blocks.filter(b => b.type === 'image').length;
                let blockName = 'Images collées ' + (imageCount + 1);
                
                let newBlock = {
                    id: 'block_' + Date.now(),
                    type: 'image',
                    folderName: '',
                    fileName: '',
                    data: [],
                    imageData: {
                        blockName: blockName,
                        images: [{
                            id: 'img_' + Date.now(),
                            name: 'Image collée',
                            src: event.target.result,
                            x: 10,
                            y: 10,
                            width: 400,
                            originalWidth: null,
                            originalHeight: null
                        }]
                    }
                };
                
                project.currentPoste.blocks.push(newBlock);
                renderMetreTable(currentProjectId);
                
                // Show notification
                console.log('✅ Image collée avec succès !');
            };
            
            reader.readAsDataURL(blob);
            break;
        }
    }
});

// ===== TOOLBAR TOGGLE FUNCTIONALITY =====
let toolbarCollapsed = false;

// Toggle toolbar visibility
document.getElementById('toolbarToggle').addEventListener('click', function(e) {
    e.stopPropagation();
    toolbarCollapsed = !toolbarCollapsed;
    const toolbar = document.getElementById('mainToolbar');
    const toggle = document.getElementById('toolbarToggle');
    
    if (toolbarCollapsed) {
        toolbar.classList.add('collapsed');
        toggle.textContent = '▲';
    } else {
        toolbar.classList.remove('collapsed');
        toggle.textContent = '▼';
    }
});

// Handle tab clicks - expand toolbar if collapsed
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function(e) {
        // Remove active class from all tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        // Add active class to clicked tab
        this.classList.add('active');
        
        // Get the tab name
        const tabName = this.dataset.tab;
        
        // Hide all toolbar contents
        document.querySelectorAll('.toolbar-content').forEach(content => {
            content.style.display = 'none';
        });
        
        // Show the selected toolbar content
        const selectedToolbar = document.querySelector(`.toolbar-content[data-toolbar="${tabName}"]`);
        if (selectedToolbar) {
            selectedToolbar.style.display = 'flex';
        }
        
        // If toolbar is collapsed, expand it
        if (toolbarCollapsed) {
            toolbarCollapsed = false;
            const toolbar = document.getElementById('mainToolbar');
            const toggle = document.getElementById('toolbarToggle');
            toolbar.classList.remove('collapsed');
            toggle.textContent = '▼';
            toolbar.dataset.openedByTab = 'true';
        }
    });
});

// Click outside toolbar to collapse it (if it was opened by tab click)
document.addEventListener('click', function(e) {
    const toolbar = document.getElementById('mainToolbar');
    const tabsBar = document.querySelector('.tabs-bar');
    const header = document.querySelector('header');
    
    // Check if click is outside header area
    if (!header.contains(e.target)) {
        // Auto-collapse only if user clicked a tab to open it
        // We don't auto-collapse if user manually opened it with the toggle button
        // This is tracked by checking if a tab was recently clicked
        if (toolbar.dataset.openedByTab === 'true') {
            toolbarCollapsed = true;
            toolbar.classList.add('collapsed');
            document.getElementById('toolbarToggle').textContent = '▲';
            toolbar.dataset.openedByTab = 'false';
        }
    }
});

// Track when toolbar is opened by tab click
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
        const toolbar = document.getElementById('mainToolbar');
        if (!toolbar.classList.contains('collapsed')) {
            toolbar.dataset.openedByTab = 'true';
        }
    });
});

// ===== PANEL MANAGEMENT FUNCTIONS =====
function showPanel(panelName) {
    console.log('[showPanel] Demande d\'affichage du panneau:', panelName);
    
    if (!currentProjectId) {
        alert('Veuillez d\'abord ouvrir un projet');
        return;
    }
    
    let project = projects[currentProjectId];
    if (!project || !project.layout) {
        alert('Aucun layout disponible');
        return;
    }
    
    // Map panel names to component names and titles
    const panelInfo = {
        'tree': { 
            componentName: 'explorateur',
            title: 'Explorateur'
        },
        'metre': { 
            componentName: 'metre',
            title: 'Minute de Métré'
        },
        'variables': { 
            componentName: 'variables',
            title: 'Variables L-S-V'
        },
        'viewer': { 
            componentName: 'viewer',
            title: 'Visionneuse'
        }
    };
    
    const info = panelInfo[panelName];
    if (!info) {
        console.error('[showPanel] Nom de panneau inconnu:', panelName);
        return;
    }
    
    console.log('[showPanel] Recherche du composant:', info.componentName);
    
    // Recursive function to find all components by name
    function findAllComponentsByName(item, targetName, results = []) {
        if (!item) return results;
        
        // Check if this is a component with the target name
        if (item.componentName === targetName) {
            results.push(item);
        }
        
        // Recursively search children
        if (item.contentItems && item.contentItems.length > 0) {
            for (let child of item.contentItems) {
                findAllComponentsByName(child, targetName, results);
            }
        }
        
        return results;
    }
    
    let root = project.layout.root;
    let foundPanels = findAllComponentsByName(root, info.componentName, []);
    
    console.log('[showPanel] Panneaux trouvés:', foundPanels.length);
    
    if (foundPanels.length > 0) {
        // Panel exists, just activate it
        let panel = foundPanels[0];
        
        console.log('[showPanel] Panneau trouvé, activation...');
        
        if (panel.parent && panel.parent.type === 'stack') {
            panel.parent.setActiveContentItem(panel);
            console.log('[showPanel] ✓ Panneau existant activé');
        } else {
            console.warn('[showPanel] Le panneau n\'est pas dans un stack');
        }
        
        return; // Don't create a new one
    }
    
    // Panel doesn't exist, create it
    console.log('[showPanel] Panneau non trouvé, création...');
    
    const config = {
        type: 'component',
        componentName: info.componentName,
        componentState: { projectId: currentProjectId },
        title: info.title
    };
    
    try {
        let rootContent = project.layout.root.contentItems[0];
        
        if (!rootContent) {
            console.error('[showPanel] Racine du layout introuvable');
            alert('Structure du layout invalide');
            return;
        }
        
        // Recursive function to find the first stack
        function findFirstStack(item) {
            if (!item) return null;
            
            if (item.type === 'stack') {
                return item;
            }
            
            if (item.contentItems && item.contentItems.length > 0) {
                for (let child of item.contentItems) {
                    let found = findFirstStack(child);
                    if (found) return found;
                }
            }
            
            return null;
        }
        
        let targetStack = findFirstStack(rootContent);
        
        if (targetStack) {
            console.log('[showPanel] Stack trouvé, ajout...');
            targetStack.addChild(config);
            
            // Activate the new panel
            setTimeout(() => {
                let newItem = targetStack.contentItems[targetStack.contentItems.length - 1];
                if (newItem) {
                    targetStack.setActiveContentItem(newItem);
                    console.log('[showPanel] ✓ Nouveau panneau créé et activé');
                }
            }, 100);
        } else if (rootContent.type === 'row' || rootContent.type === 'column') {
            console.log('[showPanel] Création d\'un nouveau stack...');
            rootContent.addChild({
                type: 'stack',
                width: 25,
                content: [config]
            });
            console.log('[showPanel] ✓ Nouveau stack créé avec le panneau');
        } else {
            console.error('[showPanel] Impossible d\'ajouter le panneau');
            alert('Impossible d\'ajouter le panneau à cette structure de layout');
        }
        
    } catch (e) {
        console.error('[showPanel] ❌ Erreur:', e);
        console.error('[showPanel] Stack:', e.stack);
        alert('Erreur: ' + e.message);
    }
}

// Helper function to add block to current poste
function addBlockToCurrentPoste(blockType) {
    if (!currentProjectId) {
        alert('Veuillez d\'abord ouvrir un projet');
        return;
    }
    addBlock(currentProjectId, blockType);
}

// Alias for adding new folder
function addNewFolder(projectId) {
    if (!projectId) projectId = currentProjectId;
    if (!projectId) {
        alert('Veuillez d\'abord ouvrir un projet');
        return;
    }
    addFolder(projectId);
}

// Zoom functions
function zoomIn() {
    let slider = document.getElementById('zoomSlider');
    let currentZoom = parseInt(slider.value);
    let newZoom = Math.min(400, currentZoom + 10);
    slider.value = newZoom;
    slider.dispatchEvent(new Event('input'));
}

function zoomOut() {
    let slider = document.getElementById('zoomSlider');
    let currentZoom = parseInt(slider.value);
    let newZoom = Math.max(10, currentZoom - 10);
    slider.value = newZoom;
    slider.dispatchEvent(new Event('input'));
}

function zoomReset() {
    let slider = document.getElementById('zoomSlider');
    slider.value = 100;
    slider.dispatchEvent(new Event('input'));
}

// Placeholder functions for new features
function showVariableManager() {
    alert('Gestionnaire de variables - Fonctionnalité à venir');
}

function showSearchReplace() {
    alert('Rechercher/Remplacer - Fonctionnalité à venir');
}

function validateFormulas() {
    alert('Validation des formules - Fonctionnalité à venir');
}

function showCalculator() {
    alert('Calculatrice - Fonctionnalité à venir');
}

function showUnitsSettings() {
    alert('Paramètres des unités - Fonctionnalité à venir');
}

function showDisplaySettings() {
    alert('Paramètres d\'apparence - Fonctionnalité à venir');
}

function showShortcutsSettings() {
    let html = `
        <div class="dialog-title">⌨️ Configuration des Raccourcis Clavier</div>
        <div class="dialog-content">
            <p style="margin-bottom: 15px; color: #666;">Personnalisez les raccourcis clavier de l'application</p>
            <div style="max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f0f0f0; border-bottom: 2px solid #ddd;">
                            <th style="padding: 8px; text-align: left; font-size: 12px;">Action</th>
                            <th style="padding: 8px; text-align: left; font-size: 12px;">Raccourci</th>
                            <th style="padding: 8px; text-align: center; font-size: 12px; width: 100px;">Modifier</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">📁 Nouveau dossier</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newFolder" value="${appSettings.shortcuts.newFolder}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newFolder')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">📄 Nouveau fichier</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newFile" value="${appSettings.shortcuts.newFile}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newFile')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">📝 Nouveau poste</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newPoste" value="${appSettings.shortcuts.newPoste}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newPoste')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">📊 Nouveau tableau</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newTable" value="${appSettings.shortcuts.newTable}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newTable')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">🎨 Nouveau canvas</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newCanvas" value="${appSettings.shortcuts.newCanvas}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newCanvas')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">📷 Nouvelle zone image</td>
                            <td style="padding: 8px;"><input type="text" id="shortcut-newImage" value="${appSettings.shortcuts.newImage}" readonly style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; background: #f9f9f9;"></td>
                            <td style="padding: 8px; text-align: center;"><button onclick="editShortcut('newImage')" style="padding: 4px 12px; cursor: pointer;">✏️</button></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p style="margin-top: 15px; font-size: 11px; color: #999; font-style: italic;">
                💡 Cliquez sur ✏️ puis appuyez sur la combinaison de touches souhaitée
            </p>
        </div>
        <div class="dialog-buttons">
            <button class="dialog-btn" onclick="closeDialog()">Annuler</button>
            <button class="dialog-btn primary" onclick="saveShortcuts()">💾 Sauvegarder</button>
        </div>
    `;
    
    $('#dialogBox').html(html);
    $('#dialogOverlay').css('display', 'flex');
}

let editingShortcut = null;

function editShortcut(actionName) {
    editingShortcut = actionName;
    let $input = $(`#shortcut-${actionName}`);
    $input.val('Appuyez sur une touche...');
    $input.css('background', '#fffacd');
    $input.focus();
    
    // Listen for keydown
    $input.off('keydown').on('keydown', function(e) {
        e.preventDefault();
        
        let keys = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.shiftKey) keys.push('Shift');
        if (e.altKey) keys.push('Alt');
        
        // Get the actual key
        if (e.key && e.key.length === 1) {
            keys.push(e.key.toUpperCase());
        } else if (e.key && e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
            keys.push(e.key);
        }
        
        if (keys.length > 1) { // Need at least one modifier + one key
            let shortcut = keys.join('+');
            $input.val(shortcut);
            $input.css('background', '#d4f1d4');
            
            // Remove listener
            setTimeout(() => {
                $input.off('keydown');
                $input.blur();
                $input.css('background', '#f9f9f9');
            }, 500);
        }
    });
}

function saveShortcuts() {
    // Update appSettings with new shortcuts
    appSettings.shortcuts.newFolder = $('#shortcut-newFolder').val();
    appSettings.shortcuts.newFile = $('#shortcut-newFile').val();
    appSettings.shortcuts.newPoste = $('#shortcut-newPoste').val();
    appSettings.shortcuts.newTable = $('#shortcut-newTable').val();
    appSettings.shortcuts.newCanvas = $('#shortcut-newCanvas').val();
    appSettings.shortcuts.newImage = $('#shortcut-newImage').val();
    
    // Save to localStorage
    saveToLocalStorage();
    
    closeDialog();
    alert('✓ Raccourcis sauvegardés !');
}

// Global keyboard shortcut listener
document.addEventListener('keydown', function(e) {
    // Don't trigger if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    let keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');
    
    if (e.key && e.key.length === 1) {
        keys.push(e.key.toUpperCase());
    } else if (e.key && e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
        keys.push(e.key);
    }
    
    let pressedShortcut = keys.join('+');
    
    // Check against defined shortcuts
    if (pressedShortcut === appSettings.shortcuts.newFolder) {
        e.preventDefault();
        addNewFolder(currentProjectId);
    } else if (pressedShortcut === appSettings.shortcuts.newFile) {
        e.preventDefault();
        if (currentProjectId) addPoste(currentProjectId);
    } else if (pressedShortcut === appSettings.shortcuts.newPoste) {
        e.preventDefault();
        addBlockToCurrentPoste('file');
    } else if (pressedShortcut === appSettings.shortcuts.newTable) {
        e.preventDefault();
        addBlockToCurrentPoste('table');
    } else if (pressedShortcut === appSettings.shortcuts.newCanvas) {
        e.preventDefault();
        addBlockToCurrentPoste('canvas');
    } else if (pressedShortcut === appSettings.shortcuts.newImage) {
        e.preventDefault();
        addBlockToCurrentPoste('image');
    }
});

function showUnitsSettings() {
    alert('Paramètres des unités - Fonctionnalité à venir');
}

function showDisplaySettings() {
    alert('Paramètres d\'apparence - Fonctionnalité à venir');
}

function printProject() {
    window.print();
}

function showHelp() {
    alert('Aide - Documentation à venir');
}

function showShortcuts() {
    let shortcuts = `
Raccourcis clavier :

Ctrl + N : Nouveau projet
Ctrl + O : Ouvrir
Ctrl + S : Sauvegarder
Ctrl + + : Zoom avant
Ctrl + - : Zoom arrière
Ctrl + 0 : Réinitialiser le zoom
F2 : Renommer l'élément sélectionné
Suppr : Supprimer l'élément sélectionné
    `;
    alert(shortcuts);
}

function showAbout() {
    alert('Métré Pro-Studio v0.4\n\nApplication professionnelle de gestion de métrés\n\n© 2024');
}

function showTutorial() {
    alert('Tutoriel - À venir');
}

function checkUpdates() {
    alert('Vous utilisez la dernière version');
}

