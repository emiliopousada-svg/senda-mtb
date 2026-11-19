'use strict';

// ============================================================
//  MINI CLIMBPRO — Detector de subidas del recorrido
//  Analiza la ruta UNA sola vez en O(N) al pulsar «Seguir ruta».
//  Durante la marcha solo compara la distancia actual con los
//  límites de la subida ya calculada → impacto en rendimiento: cero.
// ============================================================

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        // Expone las funciones clave en el ámbito global para que
        // route-following.js y gps.js puedan llamarlas directamente.
        const api = factory();
        root.detectClimbs   = api.detectClimbs;
        root.climbProgress  = api.climbProgress;
        root.setRouteClimbs = api.setRouteClimbs;
        root.renderClimbProgress = api.renderClimbProgress;
        root.clearClimbProgress  = api.clearClimbProgress;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // ── Constantes configurables ──────────────────────────────
    const DEFAULT_MIN_GAIN_M      = 80;   // desnivel mínimo para considerar una subida
    const DEFAULT_MIN_LENGTH_M    = 400;  // longitud mínima en metros
    const DEFAULT_MIN_GRADE_PCT   = 3;    // pendiente media mínima (%)
    const DEFAULT_SMOOTHING_WIN   = 7;    // ventana para suavizado de altitud (puntos)
    const DEFAULT_DROP_TOLERANCE_M = 15;  // bajada máxima tolerable dentro de una subida

    // ── Distancia haversine (metros) entre dos puntos [lat, lon] ─
    function haversineM(a, b) {
        const R = 6371000;
        const r = Math.PI / 180;
        const dLat = (b[0] - a[0]) * r;
        const dLon = (b[1] - a[1]) * r;
        const s = Math.sin(dLat / 2) ** 2
            + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    // ── Suavizado de altitud con media móvil centrada ─────────
    function smoothAltitudes(alts, window) {
        const half = Math.floor(window / 2);
        return alts.map((_, i) => {
            let sum = 0, count = 0;
            for (let j = Math.max(0, i - half); j <= Math.min(alts.length - 1, i + half); j++) {
                if (Number.isFinite(alts[j])) { sum += alts[j]; count++; }
            }
            return count ? sum / count : alts[i];
        });
    }

    /**
     * detectClimbs(points, options)
     * @param {Array} points  — array de puntos de ruta: [lat, lon, alt, ...]
     * @param {Object} options — { minGainM, minLengthM, minGradePercent, smoothingWindow, dropToleranceM }
     * @returns {Array} climbs — [{ number, startDistM, endDistM, startAlt, endAlt, gainM, lengthM, avgGrade }]
     */
    function detectClimbs(points, options) {
        options = options || {};
        const minGainM      = options.minGainM       != null ? options.minGainM       : DEFAULT_MIN_GAIN_M;
        const minLengthM    = options.minLengthM     != null ? options.minLengthM     : DEFAULT_MIN_LENGTH_M;
        const minGrade      = options.minGradePercent != null ? options.minGradePercent : DEFAULT_MIN_GRADE_PCT;
        const smoothWin     = options.smoothingWindow != null ? options.smoothingWindow : DEFAULT_SMOOTHING_WIN;
        const dropTol       = options.dropToleranceM  != null ? options.dropToleranceM  : DEFAULT_DROP_TOLERANCE_M;

        if (!Array.isArray(points) || points.length < 2) return [];

        // 1. Extraer altitudes y calcular distancias acumuladas
        const n    = points.length;
        const rawAlts = points.map(p => (p[2] != null && Number.isFinite(Number(p[2]))) ? Number(p[2]) : NaN);
        const alts    = smoothAltitudes(rawAlts, smoothWin);

        const cumDist = new Float64Array(n); // metros acumulados desde el inicio
        for (let i = 1; i < n; i++) {
            cumDist[i] = cumDist[i - 1] + haversineM(points[i - 1], points[i]);
        }

        // 2. Escaneo forward: detectar tramos de ascenso sostenido
        //    La máquina de estados tolera pequeñas bajadas (dropTol).
        const rawClimbs = [];
        let climbStart  = -1;
        let peakAlt     = NaN;
        let peakIdx     = -1;
        let baseAlt     = NaN;

        for (let i = 0; i < n; i++) {
            const z = alts[i];
            if (!Number.isFinite(z)) continue;

            if (climbStart === -1) {
                // Inicio potencial de subida
                climbStart = i;
                peakAlt    = z;
                peakIdx    = i;
                baseAlt    = z;
                continue;
            }

            if (z > peakAlt) {
                peakAlt = z;
                peakIdx = i;
            } else if (z < peakAlt - dropTol) {
                // Bajada significativa: cerrar segmento si cumple criterios
                const gain   = peakAlt - baseAlt;
                const length = cumDist[peakIdx] - cumDist[climbStart];
                if (gain >= minGainM && length >= minLengthM) {
                    rawClimbs.push({ startIdx: climbStart, endIdx: peakIdx });
                }
                // Reiniciar desde el valle
                climbStart = i;
                peakAlt    = z;
                peakIdx    = i;
                baseAlt    = z;
            } else if (z < baseAlt && peakAlt - baseAlt < minGainM) {
                // Antes de consolidarse la subida, conserva la vaguada más baja.
                climbStart = i;
                peakAlt    = z;
                peakIdx    = i;
                baseAlt    = z;
            }
        }
        // Cerrar en el último pico, aunque la ruta termine después del descenso.
        if (climbStart !== -1 && Number.isFinite(alts[n - 1])) {
            const gain = peakAlt - baseAlt;
            const length = cumDist[peakIdx] - cumDist[climbStart];
            if (gain >= minGainM && length >= minLengthM) {
                rawClimbs.push({ startIdx: climbStart, endIdx: peakIdx });
            }
        }

        // 3. Filtrar por pendiente media y construir objetos finales
        const climbs = [];
        for (const seg of rawClimbs) {
            const startAlt  = alts[seg.startIdx];
            const endAlt    = alts[seg.endIdx];
            const gainM     = endAlt - startAlt;
            const lengthM   = cumDist[seg.endIdx] - cumDist[seg.startIdx];
            if (lengthM < 1) continue;
            const avgGrade  = (gainM / lengthM) * 100;
            if (avgGrade < minGrade) continue;

            climbs.push({
                number:     climbs.length + 1,
                startDistM: cumDist[seg.startIdx],
                endDistM:   cumDist[seg.endIdx],
                startAlt:   Math.round(startAlt * 10) / 10,
                endAlt:     Math.round(endAlt * 10) / 10,
                gainM:      Math.round(gainM * 10) / 10,
                lengthM:    Math.round(lengthM),
                avgGrade:   Math.round(avgGrade * 10) / 10
            });
        }

        // Re-numerar por orden de aparición
        climbs.forEach((c, i) => { c.number = i + 1; });
        return climbs;
    }

    /**
     * climbProgress(climbs, currentDistM)
     * Calcula el estado de progreso en la subida activa.
     * Solo compara números → impacto nulo en rendimiento.
     *
     * @param {Array}  climbs       — array devuelto por detectClimbs
     * @param {number} currentDistM — distancia recorrida en metros
     * @returns {{ active, progressM, remainingM, remainingGainM, percentComplete }|null}
     */
    function climbProgress(climbs, currentDistM) {
        if (!Array.isArray(climbs) || !climbs.length || !Number.isFinite(currentDistM)) {
            return { active: null };
        }
        for (const c of climbs) {
            if (currentDistM >= c.startDistM && currentDistM <= c.endDistM) {
                const progressM     = currentDistM - c.startDistM;
                const remainingM    = Math.max(0, c.endDistM - currentDistM);
                const pct           = c.lengthM > 0 ? Math.min(1, progressM / c.lengthM) : 0;
                const remainGainM   = Math.max(0, Math.round(c.gainM * (1 - pct)));
                return {
                    active:          c,
                    progressM:       Math.round(progressM),
                    remainingM:      Math.round(remainingM),
                    remainingGainM:  remainGainM,
                    percentComplete: pct
                };
            }
        }
        return { active: null };
    }

    // ── Estado interno del módulo (accesible solo aquí) ───────
    let _climbs = [];
    let _lastActiveClimbNumber = null;
    let _lastAnnouncedClimbDone = null;

    /** Guarda las subidas detectadas (llamado desde route-following.js). */
    function setRouteClimbs(climbs) {
        _climbs = Array.isArray(climbs) ? climbs : [];
        _lastActiveClimbNumber = null;
        _lastAnnouncedClimbDone = null;
    }

    /** Limpia las subidas al dejar de seguir la ruta. */
    function clearClimbProgress() {
        _climbs = [];
        _lastActiveClimbNumber = null;
        _lastAnnouncedClimbDone = null;
        const el = typeof document !== 'undefined' && document.getElementById('climb-progress');
        if (el) el.hidden = true;
    }

    /**
     * renderClimbProgress(currentDistM)
     * Actualiza el widget #climb-progress en el DOM.
     * Se llama desde renderGpsVisualUpdate() en gps.js.
     */
    function renderClimbProgress(currentDistM) {
        const el = typeof document !== 'undefined' && document.getElementById('climb-progress');
        if (!el) return;

        const state = climbProgress(_climbs, currentDistM);
        if (!state.active) {
            if (_lastActiveClimbNumber !== null) {
                if (typeof announceRouteVoice === 'function' && _lastAnnouncedClimbDone !== _lastActiveClimbNumber) {
                    announceRouteVoice('Subida coronada.');
                    _lastAnnouncedClimbDone = _lastActiveClimbNumber;
                }
                _lastActiveClimbNumber = null;
            }
            el.hidden = true;
            return;
        }

        const c   = state.active;
        if (_lastActiveClimbNumber !== c.number) {
            _lastActiveClimbNumber = c.number;
            _lastAnnouncedClimbDone = null;
            if (typeof announceRouteVoice === 'function') {
                const kmText = (c.lengthM / 1000).toFixed(1).replace('.', ' coma ');
                announceRouteVoice(`Comienza subida ${c.number} de ${_climbs.length}. ${kmText} kilómetros al ${Math.round(c.avgGrade)} por ciento.`);
            }
        }
        const pct = Math.round(state.percentComplete * 100);

        const labelEl     = document.getElementById('climb-label');
        const fillEl      = document.getElementById('climb-bar-fill');
        const remainEl    = document.getElementById('climb-remaining');

        if (labelEl) {
            labelEl.textContent = `Subida ${c.number}/${_climbs.length}  ·  ${(c.lengthM / 1000).toFixed(1)} km  al ${c.avgGrade.toFixed(1)} %`;
        }
        if (fillEl) {
            fillEl.style.width = pct + '%';
        }
        if (remainEl) {
            const remKm  = state.remainingM >= 1000
                ? (state.remainingM / 1000).toFixed(1) + ' km'
                : state.remainingM + ' m';
            remainEl.textContent = `Quedan ${remKm} · +${state.remainingGainM} m`;
        }

        el.hidden = false;
    }

    // ── Exportaciones ─────────────────────────────────────────
    return {
        detectClimbs,
        climbProgress,
        setRouteClimbs,
        clearClimbProgress,
        renderClimbProgress
    };
});
