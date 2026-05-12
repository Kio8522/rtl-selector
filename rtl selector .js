// ==UserScript==
// @name         RTL Element Selector - Force RTL Mode
// @namespace    http://tampermonkey.net/
// @version      8.1
// @description  Enhanced Auto Mode with line-by-line Arabic detection and smart RTL application
// @author       You
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    // ==================== VARIABLES ====================
    let panel = null;
    let rules = [];
    let nextId = 1;
    let isSelectingMode = false;
    let currentDomain = '';
    let forceRTLEnabled = false;
    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;
    let panelPosition = { x: null, y: null };
    let rulesMinimized = false;

    // Enhanced Arabic Unicode range: U+0600 to U+06FF, plus Arabic supplements, Persian, Urdu extensions
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

    // Line break tags and block elements
    const lineBreakTags = new Set(['BR', 'DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'MAIN']);

    // ==================== HELPER FUNCTIONS ====================
    function getCurrentDomain() {
        return window.location.hostname;
    }

    function getStorageKey() {
        return `rtlRules_${currentDomain}`;
    }

    function getForceRTLKey() {
        return `forceRTL_${currentDomain}`;
    }

    function getPositionKey() {
        return `rtlPanelPos_${currentDomain}`;
    }

    function getMinimizeKey() {
        return `rtlRulesMinimized_${currentDomain}`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Check if text contains Arabic characters
    function containsArabic(text) {
        if (!text) return false;
        return arabicRegex.test(text);
    }

    // Get smart text nodes within element with their context
    function getTextNodesWithContext(element) {
        const textNodes = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip empty text and script/style content
                    if (!node.textContent.trim()) return NodeFilter.FILTER_SKIP;
                    if (node.parentElement?.closest('script, style, noscript')) return NodeFilter.FILTER_SKIP;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        while (walker.nextNode()) {
            const node = walker.currentNode;
            textNodes.push({
                node: node,
                text: node.textContent,
                parent: node.parentElement,
                hasArabic: containsArabic(node.textContent)
            });
        }
        return textNodes;
    }

    // Apply RTL to element based on rule type (ENHANCED AUTO MODE)
    function applyRuleToElement(element, rule) {
        if (rule.mode === 'auto' && rule.autoDetectArabic) {
            // ENHANCED Auto mode: Smart line-by-line detection with context awareness

            // First, clear existing inline RTL styles on this element and its children
            clearInlineRTLStyles(element);

            const textNodes = getTextNodesWithContext(element);

            if (textNodes.length === 0) {
                // No text nodes found, check direct text content as fallback
                if (containsArabic(element.textContent)) {
                    element.style.direction = 'rtl';
                    element.style.textAlign = 'right';
                    element.style.unicodeBidi = 'isolate';
                } else {
                    resetElementStyles(element);
                }
                return;
            }

            // Group text nodes by their nearest block parent for better context
            const blocks = groupTextNodesByBlocks(textNodes);
            let hasAnyArabic = false;

            // Process each block
            for (const block of blocks) {
                const blockHasArabic = block.nodes.some(n => n.hasArabic);

                if (blockHasArabic) {
                    hasAnyArabic = true;
                    // Apply RTL to the block container
                    if (block.container && block.container !== element) {
                        applyRTLToElement(block.container);
                    }

                    // Apply RTL to individual text nodes that contain Arabic
                    for (const textNode of block.nodes) {
                        if (textNode.hasArabic) {
                            applyRTLToTextNode(textNode);
                        } else {
                            // For mixed content, apply neutral direction
                            applyNeutralToTextNode(textNode);
                        }
                    }
                } else {
                    // Reset non-Arabic blocks
                    if (block.container && block.container !== element) {
                        resetElementStyles(block.container);
                    }
                    for (const textNode of block.nodes) {
                        resetTextNodeStyles(textNode);
                    }
                }
            }

            // Handle the parent container
            if (hasAnyArabic) {
                // Only set parent RTL if it helps layout
                if (needsParentRTL(element)) {
                    element.style.direction = 'rtl';
                    element.style.textAlign = 'right';
                    element.style.unicodeBidi = 'isolate';
                }
            } else {
                resetElementStyles(element);
            }

        } else {
            // Force mode: Always apply RTL
            applyRTLToElement(element);
        }
    }

    function groupTextNodesByBlocks(textNodes) {
        const blocks = [];
        const processed = new Set();

        for (const tn of textNodes) {
            if (processed.has(tn.node)) continue;

            // Find the nearest block-level ancestor
            let blockContainer = tn.parent;
            while (blockContainer && blockContainer !== blockContainer.parentElement?.parentElement) {
                if (lineBreakTags.has(blockContainer.tagName) ||
                    getComputedStyle(blockContainer).display === 'block') {
                    break;
                }
                blockContainer = blockContainer.parentElement;
            }

            if (!blockContainer) blockContainer = tn.parent;

            // Collect all text nodes under this block container
            const blockNodes = textNodes.filter(tn2 =>
                blockContainer.contains(tn2.node.parentElement) ||
                tn2.parent === blockContainer
            );

            blocks.push({
                container: blockContainer,
                nodes: blockNodes
            });

            blockNodes.forEach(tn => processed.add(tn.node));
        }

        return blocks;
    }

    function applyRTLToElement(element) {
        element.style.direction = 'rtl';
        element.style.textAlign = 'right';
        element.style.unicodeBidi = 'isolate';
        element.setAttribute('data-rtl-applied', 'true');
    }

    function applyRTLToTextNode(textNode) {
        if (textNode.parent) {
            textNode.parent.style.direction = 'rtl';
            textNode.parent.style.unicodeBidi = 'isolate';
            textNode.parent.style.textAlign = 'right';
        }
    }

    function applyNeutralToTextNode(textNode) {
        if (textNode.parent) {
            textNode.parent.style.direction = 'ltr';
            textNode.parent.style.unicodeBidi = 'isolate';
        }
    }

    function resetElementStyles(element) {
        element.style.direction = '';
        element.style.textAlign = '';
        element.style.unicodeBidi = '';
        element.removeAttribute('data-rtl-applied');
    }

    function resetTextNodeStyles(textNode) {
        if (textNode.parent) {
            if (textNode.parent.getAttribute('data-rtl-applied') !== 'true') {
                textNode.parent.style.direction = '';
                textNode.parent.style.unicodeBidi = '';
            }
        }
    }

    function clearInlineRTLStyles(element) {
        const appliedElements = element.querySelectorAll('[data-rtl-applied="true"]');
        appliedElements.forEach(el => {
            if (!el.hasAttribute('data-rtl-preserve')) {
                el.style.direction = '';
                el.style.textAlign = '';
                el.style.unicodeBidi = '';
                el.removeAttribute('data-rtl-applied');
            }
        });
        element.removeAttribute('data-rtl-applied');
    }

    function needsParentRTL(element) {
        const children = element.children;
        let hasRTLCount = 0;
        let hasLTCount = 0;

        for (let child of children) {
            const text = child.textContent;
            if (containsArabic(text)) {
                hasRTLCount++;
            } else if (text.trim()) {
                hasLTCount++;
            }
        }

        return hasRTLCount > hasLTCount;
    }

    // ==================== STORAGE ====================
    function loadRules() {
        currentDomain = getCurrentDomain();
        const savedRules = GM_getValue(getStorageKey(), '[]');
        rules = JSON.parse(savedRules);

        let needsSave = false;
        rules.forEach(rule => {
            if (!rule.mode) {
                rule.mode = 'auto';
                rule.autoDetectArabic = true;
                needsSave = true;
            }
            if (rule.autoDetectArabic === undefined) {
                rule.autoDetectArabic = true;
                needsSave = true;
            }
            if (rule.smartDetection === undefined) {
                rule.smartDetection = true;
                needsSave = true;
            }
        });

        if (needsSave) saveRules();

        if (rules.length > 0) {
            nextId = Math.max(...rules.map(r => r.id), 0) + 1;
        }

        if (!forceRTLEnabled) applyAllRules();

        if (panel) {
            updatePanelTitle();
            refreshPanel();
        }
    }

    function saveRules() {
        GM_setValue(getStorageKey(), JSON.stringify(rules));
    }

    function loadPosition() {
        const x = GM_getValue(getPositionKey(), null);
        const y = GM_getValue(getPositionKey() + '_y', null);
        if (x !== null && y !== null) panelPosition = { x, y };
    }

    function savePosition(x, y) {
        GM_setValue(getPositionKey(), x);
        GM_setValue(getPositionKey() + '_y', y);
    }

    function loadMinimizeState() {
        rulesMinimized = GM_getValue(getMinimizeKey(), false);
    }

    function saveMinimizeState(minimized) {
        rulesMinimized = minimized;
        GM_setValue(getMinimizeKey(), minimized);
    }

    function loadForceRTL() {
        forceRTLEnabled = GM_getValue(getForceRTLKey(), false);
        if (forceRTLEnabled) applyForceRTL();
        updateForceRTLButton();
    }

    function saveForceRTL(enabled) {
        forceRTLEnabled = enabled;
        GM_setValue(getForceRTLKey(), enabled);
        if (enabled) {
            applyForceRTL();
        } else {
            removeForceRTL();
        }
        updateForceRTLButton();
        if (panel) refreshPanel();
    }

    // ==================== RTL FUNCTIONS ====================
    function applyAllRules() {
        if (forceRTLEnabled) return;

        document.querySelectorAll('[data-rtl-rule-id]').forEach(el => {
            el.style.direction = '';
            el.style.textAlign = '';
            el.style.unicodeBidi = '';
            el.removeAttribute('data-rtl-rule-id');
            el.removeAttribute('data-rtl-applied');
        });

        rules.forEach(rule => {
            if (rule.enabled !== false) {
                try {
                    const elements = document.querySelectorAll(rule.selector);
                    elements.forEach(el => {
                        el.setAttribute('data-rtl-rule-id', rule.id);
                        applyRuleToElement(el, rule);
                    });
                } catch(e) {}
            }
        });
    }

    function applyForceRTL() {
        const existing = document.getElementById('rtl-force-mode');
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.id = 'rtl-force-mode';
        style.textContent = `* { direction: rtl !important; text-align: right !important; unicode-bidi: isolate !important; }`;
        document.head.appendChild(style);
        showStatus('🔁 Force RTL: ON - Entire page is RTL', false);
    }

    function removeForceRTL() {
        const style = document.getElementById('rtl-force-mode');
        if (style) style.remove();
        applyAllRules();
        showStatus('🔁 Force RTL: OFF', false);
    }

    function toggleForceRTL() {
        saveForceRTL(!forceRTLEnabled);
    }

    function updateForceRTLButton() {
        const btn = document.getElementById('forceRTLBtn');
        if (btn) {
            if (forceRTLEnabled) {
                btn.textContent = '🔁 Force RTL: ON';
                btn.style.background = '#f44336';
            } else {
                btn.textContent = '🔁 Force RTL: OFF';
                btn.style.background = '#555';
            }
        }
    }

    // ==================== RULE MANAGEMENT ====================
    function generateSelector(element) {
        if (element.id) return `#${element.id}`;

        if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/).filter(c => c && c !== 'rtl-hover');
            if (classes.length > 0) {
                const sel = `${element.tagName.toLowerCase()}.${classes[0]}`;
                if (document.querySelectorAll(sel).length === 1) return sel;
            }
        }

        let path = [];
        let current = element;
        let depth = 0;
        const maxDepth = 5;

        while (current && current !== document.body && depth < maxDepth) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                path.unshift(`#${current.id}`);
                break;
            }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => c && c !== 'rtl-hover');
                if (classes.length) selector += `.${classes.slice(0, 2).join('.')}`;
            }

            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
                if (sameTagSiblings.length > 1) {
                    const index = sameTagSiblings.indexOf(current) + 1;
                    selector += `:nth-of-type(${index})`;
                }
            }
            path.unshift(selector);
            current = current.parentElement;
            depth++;
        }
        return path.join(' > ');
    }

    function addRule(element) {
        const selector = generateSelector(element);

        if (rules.find(r => r.selector === selector)) {
            showStatus('⚠️ This element already has a rule', true);
            return null;
        }

        let name = '';
        if (element.id) {
            name = `#${element.id}`;
        } else if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/);
            name = `${element.tagName.toLowerCase()}.${classes[0]}`;
        } else {
            name = element.tagName.toLowerCase();
        }

        if (name.length > 40) name = name.substring(0, 37) + '...';

        const rule = {
            id: nextId++,
            name: name,
            selector: selector,
            enabled: true,
            mode: 'auto',
            autoDetectArabic: true,
            smartDetection: true,
            createdAt: new Date().toLocaleString(),
            elementInfo: `${element.tagName.toLowerCase()}${element.id ? '#'+element.id : ''}`
        };

        rules.push(rule);
        saveRules();
        if (!forceRTLEnabled) applyAllRules();
        if (panel) refreshPanel();
        showStatus(`✅ Added: ${name} (Smart Auto Mode)`, false);

        return rule;
    }

    function removeRule(ruleId) {
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            rules = rules.filter(r => r.id !== ruleId);
            saveRules();
            if (!forceRTLEnabled) applyAllRules();
            if (panel) refreshPanel();
            showStatus(`❌ Removed: ${rule.name}`, false);
        }
    }

    function toggleRuleEnable(ruleId) {
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            rule.enabled = !rule.enabled;
            saveRules();
            if (!forceRTLEnabled) applyAllRules();
            if (panel) refreshPanel();
            showStatus(`${rule.enabled ? '✅ Enabled' : '⭕ Disabled'}: ${rule.name}`, false);
        }
    }

    function toggleRuleMode(ruleId) {
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            if (rule.mode === 'force') {
                rule.mode = 'auto';
                rule.autoDetectArabic = true;
                rule.smartDetection = true;
                showStatus(`🔄 ${rule.name}: Changed to Smart Auto RTL (detects Arabic lines)`, false);
            } else {
                rule.mode = 'force';
                rule.autoDetectArabic = false;
                rule.smartDetection = false;
                showStatus(`🔄 ${rule.name}: Changed to Force RTL`, false);
            }
            saveRules();
            if (!forceRTLEnabled) applyAllRules();
            if (panel) refreshPanel();
        }
    }

    function clearAllRules() {
        if (rules.length === 0) return;
        if (confirm(`Delete all ${rules.length} rule(s) for ${currentDomain}?`)) {
            rules = [];
            saveRules();
            if (!forceRTLEnabled) applyAllRules();
            if (panel) refreshPanel();
            showStatus('🗑️ All rules cleared', false);
        }
    }

    function toggleRulesMinimize() {
        rulesMinimized = !rulesMinimized;
        saveMinimizeState(rulesMinimized);

        const rulesContainer = document.getElementById('rulesList');
        const minimizeBtn = document.getElementById('minimizeRulesBtn');

        if (rulesContainer) {
            if (rulesMinimized) {
                rulesContainer.style.display = 'none';
                if (minimizeBtn) minimizeBtn.innerHTML = '▶ Show Rules';
            } else {
                rulesContainer.style.display = 'block';
                if (minimizeBtn) minimizeBtn.innerHTML = '▼ Hide Rules';
            }
        }
    }

    // ==================== UI PANEL ====================
    function updatePanelTitle() {
        const title = document.getElementById('panelTitle');
        if (title) title.innerHTML = `🎨 RTL Manager <span style="font-size:10px;color:#aaa;">(${currentDomain})</span>`;
        const count = document.getElementById('rulesCount');
        if (count) count.textContent = `${rules.length}`;
    }

    function showStatus(msg, isError = false) {
        const statusDiv = document.getElementById('status');
        if (!statusDiv) return;
        statusDiv.textContent = msg;
        statusDiv.style.color = isError ? '#ff6b6b' : '#4CAF50';
        setTimeout(() => {
            if (statusDiv.textContent === msg) {
                statusDiv.textContent = '';
            }
        }, 2500);
    }

    function refreshPanel() {
        if (!panel) return;
        const container = document.getElementById('rulesList');
        if (!container) return;
        updatePanelTitle();

        if (forceRTLEnabled) {
            container.innerHTML = `
                <div style="color:#ff9800;text-align:center;padding:20px;background:#3a3a3a;border-radius:8px;">
                    ⚠️ Force RTL Mode is ON<br>
                    <span style="font-size:12px;">Individual rules are disabled</span>
                </div>
            `;
            return;
        }

        if (rules.length === 0) {
            container.innerHTML = `
                <div style="color:#aaa;text-align:center;padding:20px;">
                    📭 No rules for ${currentDomain}<br>
                    <span style="font-size:12px;">Click "Select Element Mode" and click any element</span>
                    <br><span style="font-size:11px;color:#888;">New rules default to Smart Auto Mode!</span>
                </div>
            `;
            return;
        }

        container.innerHTML = rules.map(rule => `
            <div style="background:#3a3a3a;margin-bottom:8px;padding:10px;border-radius:6px;border-left:4px solid ${rule.enabled ? '#4CAF50' : '#888'};">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:5px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <input type="checkbox" class="rule-toggle" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                        <strong>${escapeHtml(rule.name)}</strong>
                        <span style="font-size:10px;background:#555;padding:2px 6px;border-radius:3px;">${escapeHtml(rule.elementInfo)}</span>
                        <span style="font-size:10px;padding:2px 6px;border-radius:3px;${rule.mode === 'auto' ? 'background:#2196F3;' : 'background:#ff9800;'}">
                            ${rule.mode === 'auto' ? '🔍 Smart Auto' : '💪 Force RTL'}
                        </span>
                    </div>
                    <div style="display:flex;gap:5px;">
                        <button class="rule-mode" data-id="${rule.id}" style="background:#2196F3;border:none;color:white;padding:4px 8px;cursor:pointer;border-radius:4px;font-size:11px;">
                            ${rule.mode === 'auto' ? '📝 Switch to Force' : '🔍 Switch to Smart Auto'}
                        </button>
                        <button class="rule-delete" data-id="${rule.id}" style="background:#f44336;border:none;color:white;padding:4px 8px;cursor:pointer;border-radius:4px;font-size:11px;">✖</button>
                    </div>
                </div>
                <div style="font-size:11px;color:#aaa;font-family:monospace;word-break:break-all;">${escapeHtml(rule.selector)}</div>
                <div style="font-size:10px;color:#888;margin-top:4px;">Added: ${rule.createdAt}</div>
                ${rule.mode === 'auto' ? '<div style="font-size:10px;color:#4CAF50;margin-top:4px;">✨ Smart Auto: Applies RTL only to lines/blocks containing Arabic text</div>' : ''}
            </div>
        `).join('');

        document.querySelectorAll('.rule-toggle').forEach(cb => {
            cb.addEventListener('change', (e) => toggleRuleEnable(parseInt(cb.dataset.id)));
        });
        document.querySelectorAll('.rule-delete').forEach(btn => {
            btn.addEventListener('click', (e) => removeRule(parseInt(btn.dataset.id)));
        });
        document.querySelectorAll('.rule-mode').forEach(btn => {
            btn.addEventListener('click', (e) => toggleRuleMode(parseInt(btn.dataset.id)));
        });

        if (rulesMinimized) {
            container.style.display = 'none';
            const minimizeBtn = document.getElementById('minimizeRulesBtn');
            if (minimizeBtn) minimizeBtn.innerHTML = '▶ Show Rules';
        } else {
            container.style.display = 'block';
            const minimizeBtn = document.getElementById('minimizeRulesBtn');
            if (minimizeBtn) minimizeBtn.innerHTML = '▼ Hide Rules';
        }
    }

    // ==================== SELECTION MODE ====================
    function isPartOfPanel(element) {
        return panel && panel.contains(element);
    }

    function startSelectionMode() {
        if (isSelectingMode) return;
        isSelectingMode = true;

        const btn = document.getElementById('selectBtn');
        if (btn) {
            btn.textContent = '🔴 Cancel Selection';
            btn.style.background = '#f44336';
        }

        showStatus('🎯 Click on any element to add Smart Auto RTL rule (ESC to cancel)', false);

        const style = document.createElement('style');
        style.id = 'rtl-select-hover';
        style.textContent = `
            .rtl-hover {
                outline: 3px solid #ff9800 !important;
                cursor: pointer !important;
                transition: outline 0.1s ease;
            }
        `;
        document.head.appendChild(style);

        const onMouseOver = (e) => {
            if (!isPartOfPanel(e.target)) e.target.classList.add('rtl-hover');
        };
        const onMouseOut = (e) => e.target.classList.remove('rtl-hover');
        const onClick = (e) => {
            if (isPartOfPanel(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            addRule(e.target);
            stopSelectionMode();
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') stopSelectionMode();
        };

        document.addEventListener('mouseover', onMouseOver);
        document.addEventListener('mouseout', onMouseOut);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown);

        window.__stopSelection = () => {
            document.removeEventListener('mouseover', onMouseOver);
            document.removeEventListener('mouseout', onMouseOut);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown);
            const s = document.getElementById('rtl-select-hover');
            if (s) s.remove();
            document.querySelectorAll('.rtl-hover').forEach(el => el.classList.remove('rtl-hover'));
            if (btn) {
                btn.textContent = '🎯 Select Element Mode';
                btn.style.background = '#4CAF50';
            }
            isSelectingMode = false;
            showStatus('Selection mode ended', false);
        };
    }

    function stopSelectionMode() {
        if (window.__stopSelection) window.__stopSelection();
    }

    // ==================== DRAG AND DROP ====================
    function makeDraggable(panelEl, handle) {
        handle.style.cursor = 'move';
        const onMouseMove = (e) => {
            if (!isDragging) return;
            let x = e.clientX - dragOffsetX;
            let y = e.clientY - dragOffsetY;
            const rect = panelEl.getBoundingClientRect();
            x = Math.max(0, Math.min(x, window.innerWidth - rect.width));
            y = Math.max(0, Math.min(y, window.innerHeight - rect.height));
            panelEl.style.left = x + 'px';
            panelEl.style.top = y + 'px';
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
            savePosition(x, y);
        };
        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.userSelect = '';
        };
        const onMouseDown = (e) => {
            if (e.target === handle || handle.contains(e.target)) {
                isDragging = true;
                const rect = panelEl.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            }
        };
        handle.addEventListener('mousedown', onMouseDown);
    }

    // ==================== CREATE PANEL ====================
    function createPanel() {
        if (panel) return panel;

        loadPosition();
        loadMinimizeState();

        panel = document.createElement('div');
        panel.id = 'rtl-tool-panel';
        panel.style.cssText = 'position:fixed;z-index:999999;' +
            (panelPosition.x ? `left:${panelPosition.x}px;top:${panelPosition.y}px;` : 'bottom:20px;right:20px;');

        panel.innerHTML = `
            <div style="background:#2d2d2d;color:white;padding:15px;border-radius:12px;font-family:Arial,sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:380px;max-width:500px;max-height:85vh;overflow-y:auto;border:1px solid #555;">
                <div id="dragHandle" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #555;padding-bottom:10px;cursor:move;">
                    <strong style="font-size:18px;" id="panelTitle">🎨 RTL Manager</strong>
                    <button id="closePanel" style="background:#666;border:none;color:white;cursor:pointer;padding:2px 12px;border-radius:6px;font-size:20px;">×</button>
                </div>

                <button id="forceRTLBtn" style="background:#555;border:none;color:white;padding:10px;cursor:pointer;border-radius:8px;width:100%;margin-bottom:10px;font-weight:bold;">🔁 Force RTL: OFF</button>

                <button id="selectBtn" style="background:#4CAF50;border:none;color:white;padding:10px;cursor:pointer;border-radius:8px;width:100%;margin-bottom:10px;font-weight:bold;">🎯 Select Element Mode</button>

                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span>📋 Rules (<span id="rulesCount">0</span>)</span>
                            <button id="minimizeRulesBtn" style="background:#555;border:none;color:white;padding:4px 8px;cursor:pointer;border-radius:5px;font-size:11px;">▼ Hide Rules</button>
                        </div>
                        <button id="clearBtn" style="background:#f44336;border:none;color:white;padding:4px 10px;cursor:pointer;border-radius:5px;font-size:11px;">Clear All</button>
                    </div>
                    <div id="rulesList" style="max-height:350px;overflow-y:auto;"></div>
                </div>

                <div id="status" style="margin-top:10px;font-size:12px;text-align:center;"></div>
                <div style="margin-top:8px;font-size:10px;color:#888;text-align:center;">✨ Smart Auto Mode: Only applies RTL to Arabic content</div>
            </div>
        `;

        document.body.appendChild(panel);

        makeDraggable(panel, document.getElementById('dragHandle'));

        document.getElementById('forceRTLBtn').onclick = () => toggleForceRTL();
        document.getElementById('selectBtn').onclick = () => {
            if (isSelectingMode) stopSelectionMode();
            else startSelectionMode();
        };
        document.getElementById('clearBtn').onclick = () => clearAllRules();
        document.getElementById('minimizeRulesBtn').onclick = () => toggleRulesMinimize();
        document.getElementById('closePanel').onclick = () => {
            if (isSelectingMode) stopSelectionMode();
            panel.remove();
            panel = null;
        };

        refreshPanel();
        return panel;
    }

    function togglePanel() {
        if (panel && panel.parentNode) {
            if (isSelectingMode) stopSelectionMode();
            panel.remove();
            panel = null;
        } else {
            createPanel();
        }
    }

    // ==================== INITIALIZATION ====================
    loadForceRTL();
    loadRules();

    const observer = new MutationObserver(() => {
        if (!forceRTLEnabled) applyAllRules();
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    const attributeObserver = new MutationObserver((mutations) => {
        if (!forceRTLEnabled) {
            const shouldReapply = mutations.some(m =>
                m.type === 'characterData' ||
                (m.type === 'attributes' && m.attributeName === 'innerHTML')
            );
            if (shouldReapply) applyAllRules();
        }
    });

    if (document.body) {
        attributeObserver.observe(document.body, {
            characterData: true,
            characterDataOldValue: true,
            subtree: true
        });
    }

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('🎨 Toggle RTL Panel', togglePanel);
    }

    console.log('RTL Manager v8.1 - Enhanced Auto Mode loaded for', currentDomain);
})();
