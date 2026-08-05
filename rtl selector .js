// ==UserScript==
// @name         RTL Element Selector - Pro Edition
// @namespace    http://tampermonkey.net/
// @version      9.4
// @description  Adds Reload + Open Panel, auto-open after reload, reset site settings, safe storage
// @author       You
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== VARIABLES ====================
    let hostElement = null;
    let shadowRoot = null;
    let panelInner = null;
    let rtlLauncherButton = null;

    let rules = [];
    let nextId = 1;
    let isSelectingMode = false;
    let currentDomain = '';
    let forceRTLEnabled = false;
    let forceLTREnabled = false;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let panelPosition = { x: null, y: null };
    let rulesMinimized = false;

    const rtlRegex = /[\u0591-\u07FF\u08A0-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC\u200F\u202B\u202E]/;

    const lineBreakTags = new Set([
        'BR', 'DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE', 'DD', 'DT',
        'FIGCAPTION', 'FIGURE', 'PRE'
    ]);

    // ==================== HELPERS ====================
    function getCurrentDomain() {
        return window.location.hostname;
    }

    function getStorageKey() {
        return `rtlRules_${currentDomain}`;
    }

    function getForceRTLKey() {
        return `forceRTL_${currentDomain}`;
    }

    function getForceLTRKey() {
        return `forceLTR_${currentDomain}`;
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

    function containsRTL(text) {
        if (!text) return false;
        return rtlRegex.test(text);
    }

    function getTextNodesWithContext(element) {
        const textNodes = [];

        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    if (!node.textContent.trim()) return NodeFilter.FILTER_SKIP;
                    if (node.parentElement?.closest('script, style, noscript, svg, math, textarea, input')) {
                        return NodeFilter.FILTER_SKIP;
                    }
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
                hasRTL: containsRTL(node.textContent)
            });
        }

        return textNodes;
    }

    function isExcluded(element, rule) {
        if (!rule.excludeSelector) return false;

        try {
            if (element.matches(rule.excludeSelector)) return true;
            if (element.closest(rule.excludeSelector)) return true;
        } catch (e) {}

        return false;
    }

    function deleteValueSafe(key) {
        try {
            if (typeof GM_deleteValue === 'function') {
                GM_deleteValue(key);
                return;
            }
        } catch (e) {}

        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, null);
            }
        } catch (e) {}
    }

    // ==================== RTL CORE ====================
    function applyRuleToElement(element, rule) {
        if (isExcluded(element, rule)) {
            clearInlineRTLStyles(element);
            return;
        }

        if (rule.mode === 'ltr') {
            clearInlineRTLStyles(element);
            element.style.direction = 'ltr';
            element.style.textAlign = 'left';
            element.style.unicodeBidi = 'isolate';
            element.setAttribute('data-rtl-applied', 'true');
            return;
        }

        if (rule.mode === 'auto' && rule.autoDetectArabic) {
            clearInlineRTLStyles(element);

            const textNodes = getTextNodesWithContext(element);

            if (textNodes.length === 0) {
                if (containsRTL(element.textContent)) {
                    applyRTLToElement(element);
                } else {
                    resetElementStyles(element);
                }
                return;
            }

            const blocks = groupTextNodesByBlocks(textNodes);
            let hasAnyRTL = false;

            for (const block of blocks) {
                const blockHasRTL = block.nodes.some(n => n.hasRTL);

                if (blockHasRTL) {
                    hasAnyRTL = true;

                    if (block.container) {
                        applyRTLToElement(block.container);
                    }

                    for (const textNode of block.nodes) {
                        if (textNode.hasRTL) {
                            applyRTLToTextNode(textNode);
                        } else {
                            applyNeutralToTextNode(textNode);
                        }
                    }
                } else {
                    if (block.container) {
                        resetElementStyles(block.container);
                    }

                    for (const textNode of block.nodes) {
                        resetTextNodeStyles(textNode);
                    }
                }
            }

            if (hasAnyRTL) {
                element.style.direction = 'rtl';
                element.style.textAlign = 'right';
                element.style.unicodeBidi = 'isolate';
                element.setAttribute('data-rtl-applied', 'true');
            } else {
                resetElementStyles(element);
            }
        } else {
            applyRTLToElement(element);
        }
    }

    function groupTextNodesByBlocks(textNodes) {
        const blocks = [];
        const processed = new Set();

        for (const tn of textNodes) {
            if (processed.has(tn.node)) continue;

            let blockContainer = tn.parent;

            while (blockContainer && blockContainer !== blockContainer.parentElement?.parentElement) {
                if (
                    lineBreakTags.has(blockContainer.tagName) ||
                    getComputedStyle(blockContainer).display === 'block'
                ) {
                    break;
                }

                blockContainer = blockContainer.parentElement;
            }

            if (!blockContainer) blockContainer = tn.parent;

            const blockNodes = textNodes.filter(tn2 =>
                !processed.has(tn2.node) &&
                (
                    blockContainer.contains(tn2.node.parentElement) ||
                    tn2.parent === blockContainer
                )
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
        if (!textNode.parent) return;

        textNode.parent.style.direction = 'rtl';
        textNode.parent.style.unicodeBidi = 'isolate';
        textNode.parent.style.textAlign = 'right';
        textNode.parent.setAttribute('data-rtl-applied', 'true');
    }

    function applyNeutralToTextNode(textNode) {
        if (!textNode.parent) return;

        textNode.parent.style.direction = 'ltr';
        textNode.parent.style.unicodeBidi = 'isolate';
        textNode.parent.setAttribute('data-rtl-applied', 'true');
    }

    function resetElementStyles(element) {
        element.style.direction = '';
        element.style.textAlign = '';
        element.style.unicodeBidi = '';
        element.removeAttribute('data-rtl-applied');
    }

    function resetTextNodeStyles(textNode) {
        if (
            textNode.parent &&
            textNode.parent.getAttribute('data-rtl-applied') !== 'true'
        ) {
            textNode.parent.style.direction = '';
            textNode.parent.style.unicodeBidi = '';
        }
    }

    function clearInlineRTLStyles(element) {
        if (element.hasAttribute?.('data-rtl-applied')) {
            if (!element.hasAttribute('data-rtl-preserve')) {
                element.style.direction = '';
                element.style.textAlign = '';
                element.style.unicodeBidi = '';
            }

            element.removeAttribute('data-rtl-applied');
        }

        element.querySelectorAll?.('[data-rtl-applied="true"]').forEach(el => {
            if (!el.hasAttribute('data-rtl-preserve')) {
                el.style.direction = '';
                el.style.textAlign = '';
                el.style.unicodeBidi = '';
                el.removeAttribute('data-rtl-applied');
            }
        });
    }

    // ==================== STORAGE ====================
    function saveRules() {
        try {
            GM_setValue(getStorageKey(), JSON.stringify(rules));
        } catch (e) {
            console.error('RTL Manager: saveRules failed', e);
        }
    }

    function loadRules() {
        currentDomain = getCurrentDomain();

        try {
            const raw = GM_getValue(getStorageKey(), '[]');
            rules = JSON.parse(raw);

            if (!Array.isArray(rules)) {
                rules = [];
            }
        } catch (e) {
            console.error('RTL Manager: corrupted rules, resetting', e);
            rules = [];
        }

        let needsSave = false;

        rules.forEach(rule => {
            if (!rule.mode) {
                rule.mode = 'auto';
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

            if (rule.excludeSelector === undefined) {
                rule.excludeSelector = 'code, pre, .math, .katex, svg, [contenteditable="true"], textarea, input';
                needsSave = true;
            }
        });

        if (needsSave) saveRules();

        if (rules.length > 0) {
            nextId = Math.max(...rules.map(r => r.id), 0) + 1;
        }

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }
    }

    function loadPosition() {
        try {
            const x = GM_getValue(getPositionKey(), null);
            const y = GM_getValue(getPositionKey() + '_y', null);

            if (x !== null && y !== null) {
                panelPosition = { x, y };
            }
        } catch (e) {}
    }

    function savePosition(x, y) {
        try {
            GM_setValue(getPositionKey(), x);
            GM_setValue(getPositionKey() + '_y', y);
        } catch (e) {}
    }

    function loadMinimizeState() {
        try {
            rulesMinimized = !!GM_getValue(getMinimizeKey(), false);
        } catch (e) {}
    }

    function saveMinimizeState(minimized) {
        try {
            GM_setValue(getMinimizeKey(), minimized);
        } catch (e) {}
    }

    function loadForceRTL() {
        try {
            forceRTLEnabled = !!GM_getValue(getForceRTLKey(), false);

            if (forceRTLEnabled) {
                applyForceRTL();
            }
        } catch (e) {
            forceRTLEnabled = false;
        }
    }

    function loadForceLTR() {
        try {
            forceLTREnabled = !!GM_getValue(getForceLTRKey(), false);

            if (forceLTREnabled) {
                applyForceLTR();
            }
        } catch (e) {
            forceLTREnabled = false;
        }
    }

    function saveForceRTL(enabled) {
        if (forceRTLEnabled === enabled) return;

        forceRTLEnabled = enabled;

        try {
            GM_setValue(getForceRTLKey(), enabled);
        } catch (e) {}

        if (enabled && forceLTREnabled) {
            forceLTREnabled = false;

            try {
                GM_setValue(getForceLTRKey(), false);
            } catch (e) {}

            removeForceLTR();
        }

        if (enabled) {
            applyForceRTL();
        } else {
            removeForceRTL();
        }

        updateForceButtons();

        if (panelInner) {
            refreshPanel();
        }
    }

    function saveForceLTR(enabled) {
        if (forceLTREnabled === enabled) return;

        forceLTREnabled = enabled;

        try {
            GM_setValue(getForceLTRKey(), enabled);
        } catch (e) {}

        if (enabled && forceRTLEnabled) {
            forceRTLEnabled = false;

            try {
                GM_setValue(getForceRTLKey(), false);
            } catch (e) {}

            removeForceRTL();
        }

        if (enabled) {
            applyForceLTR();
        } else {
            removeForceLTR();
        }

        updateForceButtons();

        if (panelInner) {
            refreshPanel();
        }
    }

    // ==================== GLOBAL APPLY ====================
    function applyAllRules() {
        if (forceRTLEnabled || forceLTREnabled) return;

        document.querySelectorAll('[data-rtl-applied="true"]').forEach(el => {
            if (!el.hasAttribute('data-rtl-preserve')) {
                el.style.direction = '';
                el.style.textAlign = '';
                el.style.unicodeBidi = '';
            }

            el.removeAttribute('data-rtl-applied');
        });

        document.querySelectorAll('[data-rtl-rule-id]').forEach(el => {
            el.removeAttribute('data-rtl-rule-id');
        });

        rules.forEach(rule => {
            if (rule.enabled === false) return;

            try {
                const elements = document.querySelectorAll(rule.selector);

                elements.forEach(el => {
                    el.setAttribute('data-rtl-rule-id', rule.id);
                    applyRuleToElement(el, rule);
                });
            } catch (e) {}
        });
    }

    function applyRulesToNode(node) {
        if (forceRTLEnabled || forceLTREnabled) return;

        rules.forEach(rule => {
            if (rule.enabled === false) return;

            try {
                if (node.matches?.(rule.selector)) {
                    node.setAttribute('data-rtl-rule-id', rule.id);
                    applyRuleToElement(node, rule);
                }

                node.querySelectorAll?.(rule.selector).forEach(el => {
                    el.setAttribute('data-rtl-rule-id', rule.id);
                    applyRuleToElement(el, rule);
                });
            } catch (e) {}
        });
    }

    function applyForceRTL() {
        document.getElementById('rtl-force-mode')?.remove();

        const style = document.createElement('style');
        style.id = 'rtl-force-mode';
        style.textContent = `
            body { direction: rtl !important; }

            div, p, h1, h2, h3, h4, h5, h6, li, ul, ol,
            span, a, td, th, blockquote, section, article,
            main, header, footer, nav, aside, label {
                direction: rtl !important;
            }

            p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th {
                text-align: right !important;
            }
        `;

        document.head.appendChild(style);
        showStatus('🔁 Force RTL: ON', false);
    }

    function removeForceRTL() {
        document.getElementById('rtl-force-mode')?.remove();

        if (!forceLTREnabled) {
            applyAllRules();
        }

        showStatus('🔁 Force RTL: OFF', false);
    }

    function applyForceLTR() {
        document.getElementById('rtl-force-ltr-mode')?.remove();

        const style = document.createElement('style');
        style.id = 'rtl-force-ltr-mode';
        style.textContent = `
            body { direction: ltr !important; }

            div, p, h1, h2, h3, h4, h5, h6, li, ul, ol,
            span, a, td, th, blockquote, section, article,
            main, header, footer, nav, aside, label {
                direction: ltr !important;
            }

            p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th {
                text-align: left !important;
            }
        `;

        document.head.appendChild(style);
        showStatus('🔁 Force LTR: ON', false);
    }

    function removeForceLTR() {
        document.getElementById('rtl-force-ltr-mode')?.remove();

        if (!forceRTLEnabled) {
            applyAllRules();
        }

        showStatus('🔁 Force LTR: OFF', false);
    }

    function toggleForceRTL() {
        saveForceRTL(!forceRTLEnabled);
    }

    function toggleForceLTR() {
        saveForceLTR(!forceLTREnabled);
    }

    function resetView() {
        document.querySelectorAll('[data-rtl-applied="true"]').forEach(el => {
            if (!el.hasAttribute('data-rtl-preserve')) {
                el.style.direction = '';
                el.style.textAlign = '';
                el.style.unicodeBidi = '';
            }

            el.removeAttribute('data-rtl-applied');
        });

        document.querySelectorAll('[data-rtl-rule-id]').forEach(el => {
            el.removeAttribute('data-rtl-rule-id');
        });

        showStatus('🔄 View reset. Rules are still saved.', false);
    }

    function updateForceButtons() {
        if (!shadowRoot) return;

        const rtlBtn = shadowRoot.getElementById('forceRTLBtn');
        const ltrBtn = shadowRoot.getElementById('forceLTRBtn');

        if (rtlBtn) {
            rtlBtn.textContent = forceRTLEnabled ? '🔁 RTL: ON' : '🔁 RTL: OFF';
            rtlBtn.className = `rtl-btn rtl-btn-full ${forceRTLEnabled ? 'rtl-btn-danger' : 'rtl-btn-secondary'}`;
        }

        if (ltrBtn) {
            ltrBtn.textContent = forceLTREnabled ? '🔁 LTR: ON' : '🔁 LTR: OFF';
            ltrBtn.className = `rtl-btn rtl-btn-full ${forceLTREnabled ? 'rtl-btn-info' : 'rtl-btn-secondary'}`;
        }
    }

    // ==================== RULE MANAGEMENT ====================
    function generateSelector(element) {
        if (element.id) {
            return `#${CSS.escape(element.id)}`;
        }

        const dataAttrs = ['data-testid', 'data-id', 'data-cy', 'data-name'];

        for (const attr of dataAttrs) {
            const val = element.getAttribute(attr);

            if (val) {
                const sel = `[${attr}="${CSS.escape(val)}"]`;

                if (document.querySelectorAll(sel).length === 1) {
                    return sel;
                }
            }
        }

        if (element.className && typeof element.className === 'string') {
            const classes = element.className
                .trim()
                .split(/\s+/)
                .filter(c => c && !c.startsWith('rtl-'));

            for (const cls of classes) {
                const sel = `${element.tagName.toLowerCase()}.${CSS.escape(cls)}`;

                if (document.querySelectorAll(sel).length === 1) {
                    return sel;
                }
            }
        }

        const path = [];
        let current = element;
        let depth = 0;

        while (current && current !== document.body && current.parentElement && depth < 5) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                path.unshift(`#${CSS.escape(current.id)}`);
                break;
            }

            if (current.className && typeof current.className === 'string') {
                const classes = current.className
                    .trim()
                    .split(/\s+/)
                    .filter(c => c && !c.startsWith('rtl-'));

                if (classes.length) {
                    selector += `.${classes.map(CSS.escape).join('.')}`;
                }
            }

            const parent = current.parentElement;

            if (parent) {
                const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);

                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
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
            name = `${element.tagName.toLowerCase()}.${element.className.trim().split(' ')[0]}`;
        } else {
            name = element.tagName.toLowerCase();
        }

        if (name.length > 40) {
            name = name.substring(0, 37) + '...';
        }

        const rule = {
            id: nextId++,
            name: name,
            selector: selector,
            excludeSelector: 'code, pre, .math, .katex, svg, [contenteditable="true"], textarea, input',
            enabled: true,
            mode: 'auto',
            autoDetectArabic: true,
            smartDetection: true,
            createdAt: new Date().toLocaleString(),
            elementInfo: `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}`
        };

        rules.push(rule);
        saveRules();

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }

        showStatus(`✅ Added: ${name}`, false);
        return rule;
    }

    function removeRule(ruleId) {
        const rule = rules.find(r => r.id === ruleId);

        if (!rule) return;

        rules = rules.filter(r => r.id !== ruleId);
        saveRules();

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }

        showStatus(`❌ Removed: ${rule.name}`, false);
    }

    function toggleRuleEnable(ruleId) {
        const rule = rules.find(r => r.id === ruleId);

        if (!rule) return;

        rule.enabled = !rule.enabled;
        saveRules();

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }

        showStatus(`${rule.enabled ? '✅ Enabled' : '⭕ Disabled'}: ${rule.name}`, false);
    }

    function toggleRuleMode(ruleId) {
        const rule = rules.find(r => r.id === ruleId);

        if (!rule) return;

        if (rule.mode === 'auto') {
            rule.mode = 'force';
            rule.autoDetectArabic = false;
        } else if (rule.mode === 'force') {
            rule.mode = 'ltr';
            rule.autoDetectArabic = false;
        } else {
            rule.mode = 'auto';
            rule.autoDetectArabic = true;
        }

        saveRules();

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }
    }

    function highlightRule(rule) {
        document.querySelectorAll('.rtl-highlight').forEach(el => el.classList.remove('rtl-highlight'));

        try {
            const els = document.querySelectorAll(rule.selector);

            els.forEach(el => el.classList.add('rtl-highlight'));

            setTimeout(() => {
                document.querySelectorAll('.rtl-highlight').forEach(el => el.classList.remove('rtl-highlight'));
            }, 3000);
        } catch (e) {}
    }

    function clearAllRules() {
        if (rules.length === 0) return;

        if (!confirm(`Delete all ${rules.length} rule(s) for ${currentDomain}?`)) return;

        rules = [];
        saveRules();

        if (!forceRTLEnabled && !forceLTREnabled) {
            applyAllRules();
        }

        if (panelInner) {
            refreshPanel();
        }

        showStatus('🗑️ All rules cleared', false);
    }

    function toggleRulesMinimize() {
        rulesMinimized = !rulesMinimized;
        saveMinimizeState(rulesMinimized);

        const container = shadowRoot?.getElementById('rulesList');
        const btn = shadowRoot?.getElementById('minimizeRulesBtn');

        if (container) {
            container.style.display = rulesMinimized ? 'none' : 'block';
        }

        if (btn) {
            btn.innerHTML = rulesMinimized ? '▶' : '▼';
        }
    }

    // ==================== RELOAD / RESET HELPERS ====================
    function reloadAndOpenPanel() {
        try {
            sessionStorage.setItem('rtlOpenAfterReload', '1');
        } catch (e) {}

        location.reload();
    }

    function resetSiteSettings() {
        const domain = getCurrentDomain();

        if (!confirm(`Reset ALL RTL settings for ${domain}? This deletes rules and force modes.`)) {
            return;
        }

        deleteValueSafe(`rtlRules_${domain}`);
        deleteValueSafe(`forceRTL_${domain}`);
        deleteValueSafe(`forceLTR_${domain}`);
        deleteValueSafe(`rtlPanelPos_${domain}`);
        deleteValueSafe(`rtlPanelPos_${domain}_y`);
        deleteValueSafe(`rtlRulesMinimized_${domain}`);

        try {
            sessionStorage.removeItem('rtlOpenAfterReload');
        } catch (e) {}

        location.reload();
    }

    // ==================== UI PANEL ====================
    function updatePanelTitle() {
        const title = shadowRoot?.getElementById('panelTitle');

        if (title) {
            title.innerHTML = `🎨 RTL Manager <span style="font-size:10px;color:#aaa;">(${currentDomain})</span>`;
        }

        const count = shadowRoot?.getElementById('rulesCount');

        if (count) {
            count.textContent = `${rules.length}`;
        }
    }

    function showStatus(msg, isError = false) {
        const statusDiv = shadowRoot?.getElementById('status');

        if (!statusDiv) return;

        statusDiv.textContent = msg;
        statusDiv.style.color = isError ? '#ff6b6b' : '#4CAF50';

        setTimeout(() => {
            if (statusDiv.textContent === msg) {
                statusDiv.textContent = '';
            }
        }, 3000);
    }

    function showEditModal(rule) {
        const modal = document.createElement('div');
        modal.className = 'rtl-modal';

        modal.innerHTML = `
            <div class="rtl-modal-content">
                <h3>Edit Rule: ${escapeHtml(rule.name)}</h3>

                <label>Rule Name:</label>
                <input type="text" class="rtl-input" id="editName" value="${escapeHtml(rule.name)}">

                <label>Selector:</label>
                <input type="text" class="rtl-input" id="editSelector" value="${escapeHtml(rule.selector)}">

                <label>Exclude Selector:</label>
                <input type="text" class="rtl-input" id="editExclude" value="${escapeHtml(rule.excludeSelector || '')}">

                <div class="rtl-modal-actions">
                    <button class="rtl-btn rtl-btn-primary" id="saveEdit">Save</button>
                    <button class="rtl-btn rtl-btn-secondary" id="cancelEdit">Cancel</button>
                </div>
            </div>
        `;

        shadowRoot.appendChild(modal);

        modal.querySelector('#saveEdit').onclick = () => {
            rule.selector = modal.querySelector('#editSelector').value;
            rule.excludeSelector = modal.querySelector('#editExclude').value;
            rule.name = modal.querySelector('#editName').value;

            saveRules();

            if (!forceRTLEnabled && !forceLTREnabled) {
                applyAllRules();
            }

            refreshPanel();
            modal.remove();
        };

        modal.querySelector('#cancelEdit').onclick = () => {
            modal.remove();
        };
    }

    function refreshPanel() {
        if (!panelInner) return;

        const container = shadowRoot.getElementById('rulesList');

        if (!container) return;

        updatePanelTitle();

        if (forceRTLEnabled || forceLTREnabled) {
            const mode = forceRTLEnabled ? 'Force RTL' : 'Force LTR';

            container.innerHTML = `
                <div class="rtl-empty">
                    ⚠️ ${mode} Mode is ON<br>
                    <span>Individual rules are disabled</span>
                </div>
            `;

            return;
        }

        if (rules.length === 0) {
            container.innerHTML = `
                <div class="rtl-empty">
                    📭 No rules for ${currentDomain}<br>
                    <span>Click "Select Element" to start</span>
                </div>
            `;

            return;
        }

        container.innerHTML = rules.map(rule => {
            let matchCount = 0;

            try {
                matchCount = document.querySelectorAll(rule.selector).length;
            } catch (e) {}

            return `
                <div class="rtl-rule-card ${rule.enabled ? '' : 'disabled'}" data-id="${rule.id}">
                    <div class="rtl-rule-header">
                        <div class="rtl-rule-title">
                            <input type="checkbox" class="rule-toggle" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                            <strong title="${escapeHtml(rule.name)}">${escapeHtml(rule.name)}</strong>
                            <span class="rtl-badge ${rule.mode === 'auto' ? 'badge-info' : rule.mode === 'force' ? 'badge-warning' : 'badge-success'}">
                                ${rule.mode === 'auto' ? '🔍 Auto' : rule.mode === 'force' ? '💪 RTL' : '👈 LTR'}
                            </span>
                            <span class="rtl-match-count ${matchCount === 0 ? 'count-zero' : ''}">
                                ${matchCount}
                            </span>
                        </div>

                        <div class="rtl-rule-actions">
                            <button class="rtl-btn-icon rule-highlight" data-id="${rule.id}" title="Highlight">🔦</button>
                            <button class="rtl-btn-icon rule-mode" data-id="${rule.id}" title="Toggle Mode">🔄</button>
                            <button class="rtl-btn-icon rule-edit" data-id="${rule.id}" title="Edit">✏️</button>
                            <button class="rtl-btn-icon rule-delete" data-id="${rule.id}" title="Delete">🗑️</button>
                        </div>
                    </div>

                    <div class="rtl-rule-selector" title="${escapeHtml(rule.selector)}">
                        ${escapeHtml(rule.selector)}
                    </div>

                    ${
                        rule.excludeSelector
                            ? `<div class="rtl-rule-exclude">🚫 Exclude: ${escapeHtml(rule.excludeSelector)}</div>`
                            : ''
                    }

                    ${
                        rule.mode === 'auto'
                            ? '<div class="rtl-rule-hint">✨ Applies only to RTL text blocks</div>'
                            : ''
                    }

                    ${
                        rule.mode === 'ltr'
                            ? '<div class="rtl-rule-hint">👈 Forces LTR direction</div>'
                            : ''
                    }
                </div>
            `;
        }).join('');

        if (rulesMinimized) {
            container.style.display = 'none';

            const minimizeBtn = shadowRoot.getElementById('minimizeRulesBtn');

            if (minimizeBtn) {
                minimizeBtn.innerHTML = '▶';
            }
        } else {
            container.style.display = 'block';

            const minimizeBtn = shadowRoot.getElementById('minimizeRulesBtn');

            if (minimizeBtn) {
                minimizeBtn.innerHTML = '▼';
            }
        }
    }

    function createPanel() {
        if (hostElement) return;

        loadPosition();
        loadMinimizeState();

        hostElement = document.createElement('div');
        hostElement.id = 'rtl-manager-host';
        hostElement.style.cssText =
            'position:fixed;z-index:999999;' +
            (
                panelPosition.x
                    ? `left:${panelPosition.x}px;top:${panelPosition.y}px;`
                    : 'bottom:20px;right:20px;'
            );

        shadowRoot = hostElement.attachShadow({ mode: 'open' });

        const style = document.createElement('style');

        style.textContent = `
            * { box-sizing: border-box; }

            .rtl-panel {
                background: #2d2d2d;
                color: #e0e0e0;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                font-size: 14px;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,.5);
                width: 420px;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border: 1px solid #444;
                user-select: none;
            }

            .rtl-header {
                padding: 12px 16px;
                background: #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                border-bottom: 1px solid #555;
            }

            .rtl-header strong {
                font-size: 16px;
                color: #fff;
            }

            .rtl-header-actions {
                display: flex;
                gap: 8px;
            }

            .rtl-body {
                padding: 16px;
                overflow-y: auto;
                flex: 1;
            }

            .rtl-btn {
                padding: 8px 12px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all .2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            .rtl-btn:hover {
                filter: brightness(1.15);
            }

            .rtl-btn-full {
                width: 100%;
                margin-bottom: 10px;
                padding: 10px;
                font-size: 14px;
            }

            .rtl-btn-primary { background: #4CAF50; color: #fff; }
            .rtl-btn-danger { background: #f44336; color: #fff; }
            .rtl-btn-secondary { background: #555; color: #fff; }
            .rtl-btn-warning { background: #ff9800; color: #fff; }
            .rtl-btn-info { background: #2196F3; color: #fff; }

            .rtl-btn-icon {
                background: transparent;
                border: none;
                color: #ccc;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                border-radius: 4px;
            }

            .rtl-btn-icon:hover {
                background: #444;
                color: #fff;
            }

            .rtl-btn-sm {
                padding: 4px 8px;
                font-size: 11px;
            }

            .rtl-section {
                margin-top: 16px;
            }

            .rtl-section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                font-size: 14px;
                font-weight: bold;
            }

            .rtl-rules-container {
                max-height: 350px;
                overflow-y: auto;
            }

            .rtl-rules-container::-webkit-scrollbar {
                width: 6px;
            }

            .rtl-rules-container::-webkit-scrollbar-thumb {
                background: #666;
                border-radius: 3px;
            }

            .rtl-rule-card {
                background: #3a3a3a;
                margin-bottom: 10px;
                padding: 12px;
                border-radius: 8px;
                border-left: 4px solid #4CAF50;
                font-size: 13px;
                transition: all .2s;
            }

            .rtl-rule-card:hover {
                background: #404040;
            }

            .rtl-rule-card.disabled {
                border-left-color: #888;
                opacity: .6;
            }

            .rtl-rule-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .rtl-rule-title {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                overflow: hidden;
            }

            .rtl-rule-title strong {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .rtl-rule-actions {
                display: flex;
                gap: 4px;
            }

            .rtl-rule-selector {
                font-family: monospace;
                font-size: 11px;
                color: #aaa;
                background: #222;
                padding: 4px 8px;
                border-radius: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-bottom: 6px;
            }

            .rtl-rule-exclude {
                font-size: 10px;
                color: #ff9800;
                margin-bottom: 4px;
            }

            .rtl-rule-hint {
                font-size: 10px;
                color: #4CAF50;
                font-style: italic;
            }

            .rtl-badge {
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: bold;
                white-space: nowrap;
            }

            .badge-info { background: #2196F3; color: #fff; }
            .badge-warning { background: #ff9800; color: #fff; }
            .badge-success { background: #4CAF50; color: #fff; }

            .rtl-match-count {
                font-size: 10px;
                color: #888;
                margin-left: 6px;
            }

            .count-zero {
                color: #f44336;
                font-weight: bold;
            }

            .rtl-status {
                margin-top: 12px;
                font-size: 12px;
                text-align: center;
                min-height: 18px;
            }

            .rtl-footer {
                margin-top: 12px;
                font-size: 10px;
                color: #666;
                text-align: center;
                border-top: 1px solid #444;
                padding-top: 8px;
            }

            .rtl-empty {
                text-align: center;
                padding: 20px;
                color: #aaa;
                font-size: 13px;
            }

            .rtl-empty span {
                font-size: 11px;
                color: #888;
            }

            .rtl-modal {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }

            .rtl-modal-content {
                background: #333;
                padding: 20px;
                border-radius: 8px;
                width: 90%;
                max-width: 400px;
                border: 1px solid #555;
            }

            .rtl-modal-content h3 {
                margin: 0 0 16px 0;
                font-size: 16px;
                color: #fff;
            }

            .rtl-modal-content label {
                display: block;
                font-size: 12px;
                color: #ccc;
                margin-bottom: 4px;
            }

            .rtl-input {
                width: 100%;
                padding: 8px;
                margin-bottom: 12px;
                background: #222;
                border: 1px solid #555;
                color: #fff;
                border-radius: 4px;
                box-sizing: border-box;
                font-family: monospace;
            }

            .rtl-input:focus {
                outline: none;
                border-color: #4CAF50;
            }

            .rtl-modal-actions {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
                margin-top: 10px;
            }

            input[type="checkbox"] {
                accent-color: #4CAF50;
                cursor: pointer;
            }
        `;

        shadowRoot.appendChild(style);

        panelInner = document.createElement('div');
        panelInner.className = 'rtl-panel';

        panelInner.innerHTML = `
            <div class="rtl-header" id="dragHandle">
                <strong id="panelTitle">🎨 RTL Manager</strong>

                <div class="rtl-header-actions">
                    <button class="rtl-btn-icon" id="reloadOpenBtn" title="Reload page and open panel">↻</button>
                    <button class="rtl-btn-icon" id="importBtn" title="Import Rules">📥</button>
                    <button class="rtl-btn-icon" id="exportBtn" title="Export Rules">📤</button>
                    <button class="rtl-btn-icon" id="closePanel" title="Close">✕</button>
                </div>
            </div>

            <div class="rtl-body">
                <div style="display:flex;gap:10px;margin-bottom:10px;">
                    <button class="rtl-btn rtl-btn-full rtl-btn-secondary" id="forceRTLBtn">🔁 RTL: OFF</button>
                    <button class="rtl-btn rtl-btn-full rtl-btn-secondary" id="forceLTRBtn">🔁 LTR: OFF</button>
                </div>

                <button class="rtl-btn rtl-btn-full rtl-btn-primary" id="selectBtn">
                    🎯 Select Element
                </button>

                <div class="rtl-section">
                    <div class="rtl-section-header">
                        <span>
                            📋 Rules (<span id="rulesCount">0</span>)
                        </span>

                        <div style="display:flex;gap:5px;">
                            <button class="rtl-btn rtl-btn-sm rtl-btn-secondary" id="resetViewBtn" title="Clear injected styles temporarily">
                                🔄 Reset View
                            </button>

                            <button class="rtl-btn rtl-btn-sm rtl-btn-secondary" id="minimizeRulesBtn">
                                ▼
                            </button>

                            <button class="rtl-btn rtl-btn-sm rtl-btn-danger" id="clearBtn">
                                Clear
                            </button>
                        </div>
                    </div>

                    <div id="rulesList" class="rtl-rules-container"></div>
                </div>

                <div id="status" class="rtl-status"></div>

                <div class="rtl-footer">
                    ✨ v9.4 • Shortcuts: Alt+Shift+R / F / L / S / U
                </div>
            </div>
        `;

        shadowRoot.appendChild(panelInner);
        document.body.appendChild(hostElement);

        makeDraggable(hostElement, shadowRoot.getElementById('dragHandle'));

        shadowRoot.getElementById('forceRTLBtn').onclick = toggleForceRTL;
        shadowRoot.getElementById('forceLTRBtn').onclick = toggleForceLTR;

        shadowRoot.getElementById('selectBtn').onclick = () => {
            if (isSelectingMode) {
                stopSelectionMode();
            } else {
                startSelectionMode();
            }
        };

        shadowRoot.getElementById('clearBtn').onclick = clearAllRules;
        shadowRoot.getElementById('resetViewBtn').onclick = resetView;
        shadowRoot.getElementById('minimizeRulesBtn').onclick = toggleRulesMinimize;
        shadowRoot.getElementById('reloadOpenBtn').onclick = reloadAndOpenPanel;

        shadowRoot.getElementById('closePanel').onclick = () => {
            if (isSelectingMode) {
                stopSelectionMode();
            }

            hostElement.remove();
            hostElement = null;
            shadowRoot = null;
            panelInner = null;

            ensureLauncher();
        };

        shadowRoot.getElementById('exportBtn').onclick = () => {
            const data = JSON.stringify(rules, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `rtl-rules-${currentDomain}.json`;
            a.click();

            URL.revokeObjectURL(url);
            showStatus('📤 Rules exported', false);
        };

        shadowRoot.getElementById('importBtn').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';

            input.onchange = e => {
                const file = e.target.files[0];

                if (!file) return;

                const reader = new FileReader();

                reader.onload = ev => {
                    try {
                        const imported = JSON.parse(ev.target.result);

                        if (Array.isArray(imported)) {
                            if (confirm(`Merge ${imported.length} imported rules with existing rules?`)) {
                                let added = 0;

                                imported.forEach(importedRule => {
                                    if (!rules.find(existing => existing.selector === importedRule.selector)) {
                                        importedRule.id = nextId++;
                                        rules.push(importedRule);
                                        added++;
                                    }
                                });

                                saveRules();

                                if (!forceRTLEnabled && !forceLTREnabled) {
                                    applyAllRules();
                                }

                                refreshPanel();
                                showStatus(`📥 Imported ${added} new rule(s)`, false);
                            }
                        } else {
                            showStatus('Invalid JSON format', true);
                        }
                    } catch (err) {
                        showStatus('Failed to parse JSON file', true);
                    }
                };

                reader.readAsText(file);
            };

            input.click();
        };

        shadowRoot.getElementById('rulesList').addEventListener('click', e => {
            const btn = e.target.closest('button');

            if (!btn) return;

            const id = parseInt(btn.dataset.id);
            const rule = rules.find(r => r.id === id);

            if (!rule) return;

            if (btn.classList.contains('rule-delete')) {
                removeRule(id);
            } else if (btn.classList.contains('rule-mode')) {
                toggleRuleMode(id);
            } else if (btn.classList.contains('rule-edit')) {
                showEditModal(rule);
            } else if (btn.classList.contains('rule-highlight')) {
                highlightRule(rule);
            }
        });

        shadowRoot.getElementById('rulesList').addEventListener('change', e => {
            if (e.target.classList.contains('rule-toggle')) {
                toggleRuleEnable(parseInt(e.target.dataset.id));
            }
        });

        refreshPanel();
        removeLauncher();
    }

    function togglePanel() {
        if (hostElement && hostElement.parentNode) {
            if (isSelectingMode) {
                stopSelectionMode();
            }

            hostElement.remove();
            hostElement = null;
            shadowRoot = null;
            panelInner = null;

            ensureLauncher();
        } else {
            createPanel();
        }
    }

    // ==================== FLOATING LAUNCHER ====================
    function ensureLauncher() {
        // Floating launcher button disabled
    }

    function removeLauncher() {
        if (rtlLauncherButton) {
            rtlLauncherButton.remove();
            rtlLauncherButton = null;
        }
    }   
     // ==================== SELECTION MODE ====================
    function isPartOfPanel(element) {
        return hostElement && hostElement.contains(element);
    }

    function startSelectionMode() {
        if (isSelectingMode) return;

        isSelectingMode = true;

        const btn = shadowRoot?.getElementById('selectBtn');

        if (btn) {
            btn.textContent = '🔴 Cancel Selection';
            btn.className = 'rtl-btn rtl-btn-full rtl-btn-danger';
        }

        showStatus('🎯 Click any element. ESC to cancel.', false);

        const onMouseOver = e => {
            if (!isPartOfPanel(e.target)) {
                e.target.classList.add('rtl-hover');
            }
        };

        const onMouseOut = e => {
            e.target.classList.remove('rtl-hover');
        };

        const onClick = e => {
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

        const onKeyDown = e => {
            if (e.key === 'Escape') {
                stopSelectionMode();
            }
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

            document.querySelectorAll('.rtl-hover').forEach(el => {
                el.classList.remove('rtl-hover');
            });

            if (btn) {
                btn.textContent = '🎯 Select Element';
                btn.className = 'rtl-btn rtl-btn-full rtl-btn-primary';
            }

            isSelectingMode = false;
            showStatus('Selection mode ended', false);
        };
    }

    function stopSelectionMode() {
        if (window.__stopSelection) {
            window.__stopSelection();
        }
    }

    // ==================== DRAG AND DROP ====================
    function makeDraggable(panelEl, handle) {
        handle.style.cursor = 'move';

        const onMouseMove = e => {
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

        const onMouseDown = e => {
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

    // ==================== INITIALIZATION ====================
    currentDomain = getCurrentDomain();

    // Register userscript manager menu commands FIRST.
    try {
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('🎨 Toggle RTL Panel', togglePanel);
            GM_registerMenuCommand('🔄 Reload Page + Open RTL Panel', reloadAndOpenPanel);
            GM_registerMenuCommand('🧹 Reset RTL Settings for Site', resetSiteSettings);
        }
    } catch (e) {
        console.error('RTL Manager: menu registration failed', e);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        try {
            const target = e.target;

            if (
                target &&
                (
                    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
                    target.isContentEditable
                )
            ) {
                return;
            }

            if (e.altKey && e.shiftKey) {
                if (e.key === 'R' || e.key === 'r') {
                    e.preventDefault();
                    togglePanel();
                } else if (e.key === 'F' || e.key === 'f') {
                    e.preventDefault();
                    toggleForceRTL();
                } else if (e.key === 'L' || e.key === 'l') {
                    e.preventDefault();
                    toggleForceLTR();
                } else if (e.key === 'S' || e.key === 's') {
                    e.preventDefault();

                    if (!hostElement) {
                        createPanel();
                    }

                    startSelectionMode();
                } else if (e.key === 'U' || e.key === 'u') {
                    e.preventDefault();
                    reloadAndOpenPanel();
                }
            }
        } catch (err) {
            console.error('RTL Manager: keyboard shortcut failed', err);
        }
    });

    // Inject highlight styles
    try {
        const mainStyle = document.createElement('style');
        mainStyle.id = 'rtl-main-styles';
        mainStyle.textContent = `
            .rtl-hover {
                outline: 3px solid #ff9800 !important;
                cursor: pointer !important;
                transition: outline 0.1s ease;
            }

            .rtl-highlight {
                outline: 3px dashed #ff0000 !important;
                background: rgba(255, 0, 0, 0.1) !important;
                transition: all 0.3s;
            }
        `;

        document.head.appendChild(mainStyle);
    } catch (e) {
        console.error('RTL Manager: style injection failed', e);
    }

    // Load saved state safely
    try {
        loadForceRTL();
    } catch (e) {
        console.error('RTL Manager: loadForceRTL failed', e);
        forceRTLEnabled = false;
    }

    try {
        loadForceLTR();
    } catch (e) {
        console.error('RTL Manager: loadForceLTR failed', e);
        forceLTREnabled = false;
    }

    try {
        loadRules();
    } catch (e) {
        console.error('RTL Manager: loadRules failed, resetting rules', e);
        rules = [];
        nextId = 1;
    }

    // Mutation observer
    try {
        let debounceTimer;

        const observer = new MutationObserver(mutations => {
            if (forceRTLEnabled || forceLTREnabled) return;

            clearTimeout(debounceTimer);

            debounceTimer = setTimeout(() => {
                let hasNewNodes = false;

                mutations.forEach(m => {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === 1) {
                            hasNewNodes = true;
                            applyRulesToNode(n);
                        }
                    });
                });

                if (!hasNewNodes) {
                    applyAllRules();
                }
            }, 200);
        });

        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'id']
            });
        }
    } catch (e) {
        console.error('RTL Manager: observer failed', e);
    }

    // Open automatically after "Reload + Open Panel"
    let shouldOpenAfterReload = false;

    try {
        if (sessionStorage.getItem('rtlOpenAfterReload') === '1') {
            shouldOpenAfterReload = true;
            sessionStorage.removeItem('rtlOpenAfterReload');
        }
    } catch (e) {}

    // Launcher / auto-open panel
    try {
        const boot = () => {
            if (shouldOpenAfterReload) {
                setTimeout(() => {
                    try {
                        if (!hostElement) {
                            createPanel();
                        }

                        showStatus('⚙️ Panel opened after reload', false);
                    } catch (e) {
                        console.error('RTL Manager: auto-open failed', e);
                        ensureLauncher();
                    }
                }, 250);
            } else {
                ensureLauncher();
            }
        };

        if (document.body) {
            boot();
        } else {
            window.addEventListener('DOMContentLoaded', boot);
        }
    } catch (e) {
        console.error('RTL Manager: launcher boot failed', e);
    }

    console.log('RTL Manager Pro v9.4 loaded for', currentDomain);
})();
