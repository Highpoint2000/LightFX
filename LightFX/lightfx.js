//////////////////////////////////////////////////////////////////
//                                                              //
//  LIGHTFX SCRIPT FOR FM-DX-WEBSERVER               (V1.0)     //
//                                                              //
//  by Highpoint                     last update: 25.02.2026    //
//                                                              //
//  https://github.com/Highpoint2000/metricsmonitor             //
//                                                              //
//////////////////////////////////////////////////////////////////

const plugin_version = "1.0";
const plugin_name = "LightFX";
const pluginHomepageUrl = "https://github.com/Highpoint2000/LightFX/releases";
const pluginUpdateUrl = "https://raw.githubusercontent.com/Highpoint2000/LightFX/main/lightfx.js";

(() => {
    // ==========================================
    // 1. DEFAULT SETTINGS
    // ==========================================
    const DEFAULT_SETTINGS = {
        autoStart: false,       // Should LightFX start automatically on page load?
        origin: 'BC',           // BC = Bottom Center (Beam Origin)
        keepBg: true,           // Keep webserver background image visible
        colorOpacity: 0.5,      // Global transparency (Default 50%)
        dimming: 0.45,          // UI background dimming
        intensity: 1.6,         // Brightness multiplier
        baseOpacity: 0.05,      // Minimum glow (when quiet)
        blur: 25,               // Edge softness in px
        bassPulse: 0.4,         // Background bass pulse intensity
        reactivity: 1.5,        // Punch curve
        smoothing: 0.2          // Audio smoothing/falloff speed
    };

    const LFX_STORAGE_KEY = 'fmdx_lightfx_settings';
    let SETTINGS = { ...DEFAULT_SETTINGS };
    let isLightFxActive = false; // Current session state

    // 5-Band color & angle configuration
    const beamsConfig = [
        { id: 'eq1', color: '255, 30, 50' },   // Bass
        { id: 'eq2', color: '255, 150, 0' },   // Low-Mid
        { id: 'eq3', color: '50, 255, 50' },   // Mid
        { id: 'eq4', color: '0, 150, 255' },   // High-Mid
        { id: 'eq5', color: '200, 0, 255' }    // Treble
    ];

    let audioContext = null, analyser = null, dataArray = null, sourceNode = null;
    let animationId = null, overlay = null, checkInterval = null;
    const beamElements = [];
    const uiUpdaters = []; 

    // ==========================================
    // 2. LOAD / SAVE SETTINGS
    // ==========================================
    function loadSettings() {
        try {
            const saved = localStorage.getItem(LFX_STORAGE_KEY);
            if (saved) SETTINGS = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        } catch (e) {}
        
        isLightFxActive = SETTINGS.autoStart;
        applyCssVariables();
    }

    function saveSettings() {
        try { localStorage.setItem(LFX_STORAGE_KEY, JSON.stringify(SETTINGS)); } catch (e) {}
    }

    function applyCssVariables() {
        const root = document.documentElement;
        root.style.setProperty('--lfx-dimming', SETTINGS.dimming);
        root.style.setProperty('--lfx-blur', `${SETTINGS.blur}px`);
        root.style.setProperty('--lfx-global-opacity', SETTINGS.colorOpacity);
        
        if (analyser) analyser.smoothingTimeConstant = SETTINGS.smoothing;

        if (isLightFxActive) {
            document.body.classList.add('lfx-active');
            if (!SETTINGS.keepBg) {
                document.body.classList.add('lfx-hide-bg');
                if (overlay) overlay.style.backgroundColor = '#050505';
            } else {
                document.body.classList.remove('lfx-hide-bg');
                if (overlay) overlay.style.backgroundColor = 'transparent';
            }
        }
    }

    // ==========================================
    // 3. INJECT ORIGIN LOGIC & HTML
    // ==========================================
    function updateBeamOrigins(originMode) {
        let angles = [-72, -36, 0, 36, 72];
        let baseRot = 0;
        let pos = { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto' };

        switch(originMode) {
            case 'BC': pos.bottom = '-5vh'; pos.left = '50%'; baseRot = 0; break;
            case 'TC': pos.top = '-5vh'; pos.left = '50%'; baseRot = 180; break;
            case 'CL': pos.top = '50%'; pos.left = '-5vw'; baseRot = 90; break;
            case 'CR': pos.top = '50%'; pos.right = '-5vw'; baseRot = -90; break;
            case 'TL': pos.top = '-5vh'; pos.left = '-5vw'; baseRot = 135; break;
            case 'TR': pos.top = '-5vh'; pos.right = '-5vw'; baseRot = -135; break;
            case 'BL': pos.bottom = '-5vh'; pos.left = '-5vw'; baseRot = 45; break;
            case 'BR': pos.bottom = '-5vh'; pos.right = '-5vw'; baseRot = -45; break;
            case 'CC': pos.top = '50%'; pos.left = '50%'; angles = [0, 72, 144, 216, 288]; baseRot = 0; break; 
        }

        beamElements.forEach((beam, i) => {
            beam.anchor.style.top = pos.top;
            beam.anchor.style.bottom = pos.bottom;
            beam.anchor.style.left = pos.left;
            beam.anchor.style.right = pos.right;

            let finalAngle = angles[i] + baseRot;
            beam.anchor.style.transform = `rotate(${finalAngle}deg)`;
        });
    }

    function createBackgroundOverlay() {
        if (document.getElementById('lfx-overlay')) return;

        const style = document.createElement('style');
        style.innerHTML = `
            body.lfx-active #layout-container, body.lfx-active .main-container { background-color: rgba(0, 0, 0, var(--lfx-dimming, 0.45)) !important; transition: background-color 0.3s; }
            body.lfx-hide-bg, body.lfx-hide-bg html { background-color: transparent !important; background: transparent !important; }
            
            /* Overlay is hidden by default. Only visible when playing. */
            #lfx-overlay { opacity: 0; transition: opacity 0.4s ease-in-out; }
            body.lfx-is-playing #lfx-overlay { opacity: var(--lfx-global-opacity, 0.5); }

            .lfx-beam-anchor { position: absolute; width: 0; height: 0; z-index: 1; transition: all 0.3s ease; }
            .lfx-beam-blur-wrapper { position: absolute; bottom: 0; left: 0; width: 0; height: 0; filter: blur(var(--lfx-blur, 25px)); transform: translateZ(0); will-change: opacity; transition: filter 0.2s; }
            .lfx-beam-light { position: absolute; bottom: 0; left: -58.5vh; width: 117vh; height: 180vh; transform-origin: bottom center; clip-path: polygon(0 0, 100% 0, 50% 100%); will-change: transform; }
            
            /* --- MODAL STYLES --- */
            .lfx-modal-window { position: fixed; top: 100px; left: calc(50vw - 160px); width: 340px; background: var(--color-1, #121010); color: var(--color-3, #FFF); border: 1px solid var(--color-2, #333); border-radius: 8px; font-family: Arial, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 99999; display: none; flex-direction: column; max-height: 85vh; }
            .lfx-header { background: var(--color-2, #2A2A2A); padding: 10px 15px; border-bottom: 1px solid var(--color-2, #333); display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; cursor: grab; user-select: none; }
            .lfx-header:active { cursor: grabbing; }
            .lfx-header h2 { color: var(--color-5, #FFF); font-size: 1.2em; margin: 0; pointer-events: none; }
            .lfx-close-btn { background: transparent; color: var(--color-4, #E6C269); border: none; cursor: pointer; border-radius: 50%; width: 26px; height: 26px; font-size: 1.4em; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
            .lfx-close-btn:hover { background: var(--color-4, #E6C269); color: var(--color-1, #111); transform: rotate(90deg); }
            
            .lfx-modal-body { overflow-y: auto; padding: 15px 20px 20px; flex: 1; }
            .lfx-control-group { margin-top: 1.2em; }
            .lfx-control-group label { display: flex; justify-content: space-between; font-weight: bold; color: var(--color-4, #E6C269); text-transform: uppercase; font-size: 0.8em; margin-bottom: 0.5em; }
            
            /* MEDIUM SLIDER */
            .lfx-modal-body input[type=range].lfx-slider {
                -webkit-appearance: none !important; appearance: none !important;
                width: 100% !important; height: 8px !important; border-radius: 4px !important;
                background-image: none !important; outline: none !important; padding: 0 !important; 
                margin: 10px 0 !important; border: none !important; box-shadow: none !important;
            }
            .lfx-modal-body input[type=range].lfx-slider::-webkit-slider-thumb {
                -webkit-appearance: none !important; appearance: none !important;
                width: 18px !important; height: 18px !important; border-radius: 50% !important;
                background-color: var(--color-4, #E6C269) !important; background-image: none !important;
                border: 2px solid var(--color-1, #111) !important; cursor: pointer !important;
                transition: transform 0.1s !important; box-shadow: 0 0 4px rgba(0,0,0,0.5) !important;
            }
            .lfx-modal-body input[type=range].lfx-slider::-webkit-slider-thumb:hover { transform: scale(1.2) !important; }
            .lfx-modal-body input[type=range].lfx-slider::-moz-range-thumb {
                width: 18px !important; height: 18px !important; border-radius: 50% !important;
                background-color: var(--color-4, #E6C269) !important; background-image: none !important;
                border: 2px solid var(--color-1, #111) !important; cursor: pointer !important;
                transition: transform 0.1s !important; box-shadow: 0 0 4px rgba(0,0,0,0.5) !important;
            }
            .lfx-modal-body input[type=range].lfx-slider::-moz-range-thumb:hover { transform: scale(1.2) !important; }
            
            /* Toggle Switches */
            .lfx-switch-container { display: flex; align-items: center; justify-content: space-between; background: var(--color-2, #2A2A2A); padding: 0.8em; border-radius: 8px; border: 1px solid var(--color-1, #444); margin-top: 1em; }
            .lfx-switch-container span { color: var(--color-4, #E6C269); font-weight: bold; text-transform: uppercase; font-size: 0.8em; }
            .lfx-switch { position: relative; display: inline-block; width: 40px; height: 20px; }
            .lfx-switch input { opacity: 0; width: 0; height: 0; }
            .lfx-switch-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--color-1, #ccc); transition: .4s; border-radius: 20px; }
            .lfx-switch-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            .lfx-switch input:checked + .lfx-switch-slider { background-color: var(--color-4, #E6C269); }
            .lfx-switch input:checked + .lfx-switch-slider:before { transform: translateX(20px); }

            /* Origin Grid */
            .lfx-origin-control { display: flex; justify-content: space-between; align-items: center; margin-top: 1em; }
            .lfx-origin-label { font-weight: bold; color: var(--color-4, #E6C269); text-transform: uppercase; font-size: 0.8em; }
            .lfx-origin-grid { display: flex; flex-direction: column; gap: 4px; background: var(--color-2, #2A2A2A); padding: 8px; border-radius: 8px; border: 1px solid var(--color-1, #444); }
            .lfx-og-row { display: flex; gap: 4px; }
            .lfx-og-btn { width: 26px; height: 26px; background: var(--color-1, #111); border: 2px solid var(--color-1, #444); border-radius: 4px; cursor: pointer; transition: 0.2s; }
            .lfx-og-btn:hover { border-color: var(--color-4, #E6C269); }
            .lfx-og-btn.active { background: var(--color-4, #E6C269); border-color: #FFF; box-shadow: inset 0 0 5px rgba(0,0,0,0.8); }

            /* Reset Button */
            .lfx-reset-btn { width: 100%; padding: 10px; margin-top: 25px; background: var(--color-2, #333); color: var(--color-4, #E6C269); border: 1px solid var(--color-1, #444); border-radius: 6px; cursor: pointer; font-weight: bold; text-transform: uppercase; font-size: 0.8em; transition: 0.2s; }
            .lfx-reset-btn:hover { background: var(--color-4, #E6C269); color: var(--color-1, #111); }

            /* MOBILE HIDDEN RULES */
            @media (max-width: 768px) {
                #lfx-overlay, #lfx-settings-modal { display: none !important; }
                body.lfx-active #layout-container, body.lfx-active .main-container { background-color: transparent !important; }
            }
        `;
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'lfx-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            zIndex: '-1', pointerEvents: 'none', overflow: 'hidden', display: 'none'
        });
        document.body.appendChild(overlay);

        beamsConfig.forEach((config) => {
            const anchor = document.createElement('div');
            anchor.className = 'lfx-beam-anchor';

            const blurWrapper = document.createElement('div');
            blurWrapper.className = 'lfx-beam-blur-wrapper';

            const light = document.createElement('div');
            light.className = 'lfx-beam-light';
            light.style.background = `linear-gradient(to top, rgba(${config.color}, 1) 0%, rgba(${config.color}, 0.8) 50%, rgba(${config.color}, 0) 100%)`;

            blurWrapper.appendChild(light);
            anchor.appendChild(blurWrapper);
            overlay.appendChild(anchor);

            beamElements.push({ wrapper: blurWrapper, light: light, anchor: anchor, config: config });
        });

        updateBeamOrigins(SETTINGS.origin);
    }

    // ==========================================
    // 4. DRAGGABLE SETTINGS MODAL UI
    // ==========================================
    function createSettingsModal() {
        if (document.getElementById('lfx-settings-modal')) return;

        const modalContent = document.createElement('div');
        modalContent.id = 'lfx-settings-modal';
        modalContent.className = 'lfx-modal-window';

        const header = document.createElement('div');
        header.className = 'lfx-header';
        header.innerHTML = `<h2>LightFX Settings</h2>`;
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'lfx-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => modalContent.style.display = 'none';
        header.appendChild(closeBtn);

        const scrollArea = document.createElement('div');
        scrollArea.className = 'lfx-modal-body';

        // DRAG & DROP LOGIC
        let isDragging = false, startX, startY, initialX, initialY;

        header.addEventListener('mousedown', dragStart);
        header.addEventListener('touchstart', dragStart, { passive: true });

        function dragStart(e) {
            if (e.target === closeBtn) return;
            isDragging = true;
            if (e.type === 'touchstart') { startX = e.touches[0].clientX; startY = e.touches[0].clientY; } 
            else { startX = e.clientX; startY = e.clientY; }
            const rect = modalContent.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            
            document.addEventListener('mousemove', drag);
            document.addEventListener('touchmove', drag, { passive: false });
            document.addEventListener('mouseup', dragEnd);
            document.addEventListener('touchend', dragEnd);
        }

        function drag(e) {
            if (!isDragging) return;
            if (e.type === 'touchmove') e.preventDefault(); 
            let currentX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
            let currentY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            modalContent.style.left = (initialX + (currentX - startX)) + 'px';
            modalContent.style.top = (initialY + (currentY - startY)) + 'px';
        }

        function dragEnd() {
            isDragging = false;
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('touchmove', drag);
            document.removeEventListener('mouseup', dragEnd);
            document.removeEventListener('touchend', dragEnd);
        }

        const getCssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        
        const createSlider = (key, label, min, max, step, formatFn) => {
            const group = document.createElement('div');
            group.className = 'lfx-control-group';
            const lbl = document.createElement('label');
            const valSpan = document.createElement('span');
            valSpan.style.color = 'var(--color-3, #FFF)';
            lbl.textContent = label; lbl.appendChild(valSpan);
            
            const input = document.createElement('input');
            input.type = 'range'; input.className = 'lfx-slider'; input.min = min; input.max = max; input.step = step; input.value = SETTINGS[key];

            const updateUI = () => {
                input.value = SETTINGS[key]; 
                valSpan.textContent = formatFn ? formatFn(input.value) : input.value;
                const perc = (input.value - min) / (max - min) * 100;
                const cFill = getCssVar('--color-4', '#E6C269');
                const cBg = getCssVar('--color-2', '#555');
                input.style.setProperty('background', `linear-gradient(to right, ${cFill} ${perc}%, ${cBg} ${perc}%)`, 'important');
            };

            input.addEventListener('input', (e) => {
                SETTINGS[key] = parseFloat(e.target.value);
                updateUI(); applyCssVariables(); saveSettings();
            });

            updateUI();
            uiUpdaters.push(updateUI); 
            group.appendChild(lbl); group.appendChild(input);
            return group;
        };

        const createToggle = (key, label) => {
            const container = document.createElement('div');
            container.className = 'lfx-switch-container';
            container.innerHTML = `<span>${label}</span>
                <label class="lfx-switch"><input type="checkbox" ${SETTINGS[key] ? 'checked' : ''}><span class="lfx-switch-slider"></span></label>`;
            
            const checkbox = container.querySelector('input');
            checkbox.addEventListener('change', (e) => {
                SETTINGS[key] = e.target.checked;
                applyCssVariables(); saveSettings();
            });

            const updateUI = () => { checkbox.checked = SETTINGS[key]; };
            uiUpdaters.push(updateUI); 

            return container;
        };

        const originControl = document.createElement('div');
        originControl.className = 'lfx-origin-control';
        originControl.innerHTML = `
            <div class="lfx-origin-label" title="Origin point of the light beams">Beam Origin</div>
            <div class="lfx-origin-grid">
                <div class="lfx-og-row"><button class="lfx-og-btn" data-origin="TL" title="Top Left"></button><button class="lfx-og-btn" data-origin="TC" title="Top Center"></button><button class="lfx-og-btn" data-origin="TR" title="Top Right"></button></div>
                <div class="lfx-og-row"><button class="lfx-og-btn" data-origin="CL" title="Center Left"></button><button class="lfx-og-btn" data-origin="CC" title="Center 360° Star"></button><button class="lfx-og-btn" data-origin="CR" title="Center Right"></button></div>
                <div class="lfx-og-row"><button class="lfx-og-btn" data-origin="BL" title="Bottom Left"></button><button class="lfx-og-btn" data-origin="BC" title="Bottom Center"></button><button class="lfx-og-btn" data-origin="BR" title="Bottom Right"></button></div>
            </div>`;
        
        const updateOriginGridUI = () => {
            originControl.querySelectorAll('.lfx-og-btn').forEach(b => b.classList.remove('active'));
            const activeBtn = originControl.querySelector(`.lfx-og-btn[data-origin="${SETTINGS.origin}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        };

        originControl.querySelectorAll('.lfx-og-btn').forEach(btn => {
            btn.onclick = (e) => {
                SETTINGS.origin = e.target.dataset.origin;
                updateOriginGridUI();
                updateBeamOrigins(SETTINGS.origin);
                saveSettings();
            };
        });

        updateOriginGridUI();
        uiUpdaters.push(updateOriginGridUI);

        // UI ORDER:
        // 1. Origin
        scrollArea.appendChild(originControl); 
        // 2. Autostart
        scrollArea.appendChild(createToggle('autoStart', 'Enable Autostart'));
        // 3. Show Webserver Image
        scrollArea.appendChild(createToggle('keepBg', 'Show Webserver Image'));
        // 4. Beam Transparency
        scrollArea.appendChild(createSlider('colorOpacity', 'Beam Transparency (Opacity)', 0.1, 1.0, 0.05, v => `${Math.round(v*100)}%`));
        // Rest
        scrollArea.appendChild(createSlider('dimming', 'UI Background Dimming', 0, 1, 0.05, v => `${Math.round(v*100)}%`));
        scrollArea.appendChild(createSlider('intensity', 'Beam Brightness Boost', 0.5, 3.0, 0.1, v => `${v}x`));
        scrollArea.appendChild(createSlider('baseOpacity', 'Standby Glow', 0, 0.5, 0.05, v => `${Math.round(v*100)}%`));
        scrollArea.appendChild(createSlider('blur', 'Edge Softness (Blur)', 0, 50, 1, v => `${v}px`));
        scrollArea.appendChild(createSlider('bassPulse', 'Bass Pulse Glow', 0, 1, 0.05, v => `${Math.round(v*100)}%`));
        scrollArea.appendChild(createSlider('reactivity', 'Punch/Reactivity', 0.5, 3.0, 0.1, v => `Curve ${v}`));
        scrollArea.appendChild(createSlider('smoothing', 'Audio Smoothing', 0.05, 0.95, 0.05, v => `${Math.round(v*100)}%`));

        // RESET BUTTON - ONLY RESETS SLIDERS
        const resetBtn = document.createElement('button');
        resetBtn.className = 'lfx-reset-btn';
        resetBtn.textContent = 'Load Default Settings';
        resetBtn.onclick = () => {
            const sliderKeys = [
                'colorOpacity', 'dimming', 'intensity', 
                'baseOpacity', 'blur', 'bassPulse', 
                'reactivity', 'smoothing'
            ];
            
            sliderKeys.forEach(key => {
                SETTINGS[key] = DEFAULT_SETTINGS[key];
            });
            
            uiUpdaters.forEach(updateFn => updateFn()); 
            applyCssVariables();                        
            saveSettings();                             
        };
        scrollArea.appendChild(resetBtn);

        modalContent.appendChild(header);
        modalContent.appendChild(scrollArea);
        document.body.appendChild(modalContent);
    }

    // ==========================================
    // 5. UPDATE CHECKER (Like MetricsMonitor)
    // ==========================================
    function lfxCheckUpdate() {
        const isSetupPath = (window.location.pathname || "/").indexOf("/setup") >= 0;
        
        fetch(pluginUpdateUrl, { cache: "no-store" })
            .then((r) => r.text())
            .then((txt) => {
                let remoteVer = "Unknown";
                const match = txt.match(/const\s+plugin_version\s*=\s*['"]([^'"]+)['"]/);
                if (match) remoteVer = match[1];

                if (remoteVer !== "Unknown" && remoteVer !== plugin_version) {
                    console.log(`[LightFX] Update available: ${plugin_version} -> ${remoteVer}`);
                    
                    if (isSetupPath) {
                        const settingsContainer = document.getElementById("plugin-settings");
                        if (settingsContainer) {
                            settingsContainer.innerHTML += `<br><a href="${pluginHomepageUrl}" target="_blank" style="color:var(--color-4, #E6C269);">[${plugin_name}] Update: ${plugin_version} -> ${remoteVer}</a>`;
                        }
                    }
                    
                    const updateIcon = document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-puzzle-piece") || document.querySelector(".sidenav-content");
                    if (updateIcon) {
                        const redDot = document.createElement("span");
                        redDot.style.cssText = `display: block; width: 12px; height: 12px; border-radius: 50%; background-color: #FE0830; margin-left: 82px; margin-top: -12px;`;
                        updateIcon.appendChild(redDot);
                    }
                }
            })
            .catch((e) => { console.error(`[LightFX] Update check failed`, e); });
    }

    // ==========================================
    // 6. BUTTON INJECTION (MetricsMonitor Style)
    // ==========================================
    function createLightFxButton() {
        const buttonId = "lfx-header-btn";
        if (document.getElementById(buttonId)) return;

        // FIX: Using non-breaking spaces (\u00A0) to prevent line wrap in tooltip
        const tooltipText = `Plugin\u00A0Version:\u00A0${plugin_version}`;

        (function waitForFunction() {
            const maxWaitTime = 30000;
            let functionFound = false;

            const observer = new MutationObserver(() => {
                if (typeof addIconToPluginPanel === "function") {
                    observer.disconnect();
                    try { 
                        addIconToPluginPanel(buttonId, "LightFX", "solid", "lightbulb", tooltipText); 
                        functionFound = true; 
                        updateButtonState();
                    }
                    catch (e) { console.warn("LightFX: addIconToPluginPanel failed", e); }
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { 
                observer.disconnect(); 
                if (!functionFound) legacyButtonCreate(tooltipText); 
                updateButtonState();
            }, maxWaitTime);
        })();

        const style = document.createElement("style");
        style.innerHTML = `
            #${buttonId} { cursor: pointer; user-select: none; -webkit-user-select: none; }
            #${buttonId}:hover { color: var(--color-5, #E6C269); filter: brightness(120%); }
            #${buttonId}.active { background-color: var(--color-2, #2A2A2A) !important; color: var(--color-4, #E6C269) !important; }
            
            /* MOBILE HIDDEN RULES */
            @media (max-width: 768px) {
                #lfx-header-btn { display: none !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function legacyButtonCreate(tooltipText) {
        const buttonId = "lfx-header-btn";
        if (document.getElementById(buttonId)) return;
        if (document.querySelector(".dashboard-panel-plugin-list")) return; 

        if (typeof $ !== 'undefined') {
            const aButtonText = $("<strong>", { class: "aspectrum-text", html: "LightFX" });
            const aButton = $("<button>", { id: buttonId, class: "hide-phone bg-color-2", title: tooltipText });
            aButton.css({ "border-radius": "0px", "width": "100px", "height": "22px", "position": "relative", "margin-top": "16px", "margin-left": "5px", "right": "0px", "cursor": "pointer" });
            aButton.append(aButtonText);

            let buttonWrapper = $("#button-wrapper");
            if (buttonWrapper.length) {
                buttonWrapper.append(aButton);
            } else {
                const wrapperElement = $(".tuner-info");
                if (wrapperElement.length) {
                    buttonWrapper = $("<div>", { id: "button-wrapper", class: "button-wrapper" });
                    wrapperElement.append(buttonWrapper);
                    wrapperElement.append(document.createElement("br"));
                    buttonWrapper.append(aButton);
                }
            }
        }
    }

    function updateButtonState() {
        const btn = document.getElementById("lfx-header-btn");
        if (btn) {
            if (isLightFxActive) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }

    function toggleLightFx() {
        isLightFxActive = !isLightFxActive;
        updateButtonState();
        applyCssVariables();

        if (isLightFxActive) {
            overlay.style.display = 'block';
            if (audioContext && audioContext.state === 'running') startAnimation();
        } else {
            document.body.classList.remove('lfx-active');
            document.body.classList.remove('lfx-hide-bg');
            overlay.style.display = 'none';
            if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
        }
    }

    // ==========================================
    // 7. EVENT DELEGATION (CLICK VS. LONG-PRESS)
    // ==========================================
    let pressTimer = null, isLongPress = false, eventHandled = false;

    function handleStart(e) {
        const btn = e.target.closest('#lfx-header-btn');
        if (!btn) return;
        
        isLongPress = false; eventHandled = false; clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            isLongPress = true; eventHandled = true; 
            const modal = document.getElementById('lfx-settings-modal');
            if (modal) modal.style.display = 'flex';
        }, 500); 
    }

    function handleEnd(e) {
        const btn = e.target.closest('#lfx-header-btn');
        if (!btn) return;
        clearTimeout(pressTimer);
        if (!eventHandled) { toggleLightFx(); eventHandled = true; }
        if (e.type === 'touchend') e.preventDefault(); 
    }

    document.addEventListener('mousedown', handleStart);
    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchend', handleEnd, { passive: false });
    document.addEventListener('click', (e) => { if (e.target.closest('#lfx-header-btn')) { e.preventDefault(); e.stopPropagation(); } }, true);

    // ==========================================
    // 8. AUDIO ANALYZER
    // ==========================================
    function setupAudio() {
        if (!isLightFxActive) return;
        if (typeof Stream === "undefined" || !Stream || !Stream.Fallback || !Stream.Fallback.Player || !Stream.Fallback.Player.Amplification) return;

        const currentSource = Stream.Fallback.Player.Amplification;
        if (!currentSource || !currentSource.context) return;

        try {
            const ctx = currentSource.context;
            if (audioContext !== ctx) {
                audioContext = ctx;
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 4096; 
                analyser.smoothingTimeConstant = SETTINGS.smoothing; 
                analyser.minDecibels = -80; 
                analyser.maxDecibels = -15;
                dataArray = new Uint8Array(analyser.frequencyBinCount);
                sourceNode = null;
            }

            if (sourceNode !== currentSource) {
                sourceNode = currentSource;
                try { sourceNode.connect(analyser); if (!animationId && isLightFxActive) startAnimation(); } catch(e) {}
            }
        } catch (e) {}
    }

    function mmCompute5BandLevels(freqData, ctxSampleRate, analyserFftSize) {
        const binWidth = ctxSampleRate / analyserFftSize;
        function getPeakInBand(minFreq, maxFreq) {
            let startBin = Math.max(0, Math.floor(minFreq / binWidth));
            let endBin = Math.min(freqData.length - 1, Math.ceil(maxFreq / binWidth));
            let maxVal = 0;
            for (let i = startBin; i <= endBin; i++) { if (freqData[i] > maxVal) maxVal = freqData[i]; }
            return maxVal;
        }
        return [
            getPeakInBand(45, 100),       // Bass
            getPeakInBand(140, 560),      // Low-Mid
            getPeakInBand(590, 2050),     // Mid
            getPeakInBand(2090, 5600),    // High-Mid
            getPeakInBand(5650, 16000)    // Treble
        ];
    }

    // ==========================================
    // 9. RENDER LOOP (WITH PLAY STATE CHECK)
    // ==========================================
    function startAnimation() {
        if (animationId) cancelAnimationFrame(animationId);

        const EQ_NOISE_GATE = 30; 
        const bandWeights = [1.03, 1.05, 1.15, 1.3, 1.6];

        const loop = () => {
            animationId = requestAnimationFrame(loop);

            // Disable rendering on mobile devices to save battery and hide effect
            if (window.innerWidth <= 768) return;

            if (!isLightFxActive || !analyser || !dataArray || !overlay) return;
            
            // Only show lights if audio context is actively running (Play button pressed)
            const isStreamRunning = audioContext && audioContext.state === 'running';
            if (isStreamRunning) {
                if (!document.body.classList.contains('lfx-is-playing')) document.body.classList.add('lfx-is-playing');
            } else {
                if (document.body.classList.contains('lfx-is-playing')) document.body.classList.remove('lfx-is-playing');
                return; // Skip drawing to save resources when paused
            }

            analyser.getByteFrequencyData(dataArray);
            
            const currentSampleRate = audioContext.sampleRate || 48000;
            const bands5 = mmCompute5BandLevels(dataArray, currentSampleRate, analyser.fftSize);

            beamElements.forEach((beam, i) => {
                let targetPercent = 0;
                if (bands5 && bands5[i] != null) {
                    let rawValue = bands5[i];
                    if (rawValue <= EQ_NOISE_GATE) rawValue = 0;
                    else rawValue = (rawValue - EQ_NOISE_GATE) / (255 - EQ_NOISE_GATE);
                    
                    rawValue = Math.min(1.0, rawValue * bandWeights[i]);
                    targetPercent = Math.pow(rawValue, SETTINGS.reactivity);
                }

                let localOpacity = Math.min(1, (targetPercent * SETTINGS.intensity) + SETTINGS.baseOpacity);
                beam.wrapper.style.opacity = localOpacity; 
            });

            let bassValue = bands5[0] || 0;
            if (bassValue > EQ_NOISE_GATE && SETTINGS.bassPulse > 0) {
                let rawBass = (bassValue - EQ_NOISE_GATE) / (255 - EQ_NOISE_GATE);
                if (SETTINGS.keepBg) {
                    let alpha = Math.min(SETTINGS.bassPulse, rawBass * SETTINGS.bassPulse * 1.5); 
                    overlay.style.backgroundColor = `rgba(255, 20, 40, ${alpha})`;
                } else {
                    let maxRgb = Math.floor(SETTINGS.bassPulse * 255);
                    let glow = Math.min(maxRgb, rawBass * maxRgb * 1.5); 
                    overlay.style.backgroundColor = `rgb(${glow}, ${Math.floor(glow * 0.1)}, ${Math.floor(glow * 0.15)})`;
                }
            } else {
                overlay.style.backgroundColor = SETTINGS.keepBg ? 'transparent' : '#050505';
            }
        };

        loop();
    }

    // ==========================================
    // 10. INIT
    // ==========================================
    function init() {
        loadSettings();
        createBackgroundOverlay();
        createSettingsModal();
        createLightFxButton();
        
        applyCssVariables();
        if (isLightFxActive) {
            overlay.style.display = 'block';
            document.body.classList.add('lfx-active');
        }

        checkInterval = setInterval(setupAudio, 1000);
        
        // Start update check in the background
        setTimeout(lfxCheckUpdate, 3000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();