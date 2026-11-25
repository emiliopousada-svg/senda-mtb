function communityRouteImportTrackIsLocked(record, nextTrackJson) {
    return Boolean(record.getBool("trackLocked") || record.getBool("published"))
        && record.getString("trackJson") !== nextTrackJson;
}

// Importador de rutas oficiales de Galicia.
// Comprueba metadatos cada cinco minutos e importa solo archivos nuevos o modificados.
// Los archivos permanecen en su sitio; sourcePath identifica cada publicación importada.
(function () {
function run() {
    function decodeXml(value) {
        return String(value || "").replace(/&(?:amp|lt|gt|quot|apos);/g, function (entity) {
            if (entity === "&amp;") return "&";
            if (entity === "&lt;") return "<";
            if (entity === "&gt;") return ">";
            if (entity === "&quot;") return '"';
            return "'";
        });
    }
    function plainText(value) { return decodeXml(String(value || "").replace(/<[^>]*>/g, "")).trim(); }
    function cleanName(name) { return String(name || "Ruta de Galicia").trim().slice(0, 100) || "Ruta de Galicia"; }
    function readUtf8(path) {
        const data = $os.readFile(path);
        if (typeof data === "string") return data;
        if (!data || typeof data.length !== "number") throw new Error("no se pudo leer el archivo como texto");
        const chunks = [];
        for (let i = 0; i < data.length;) {
            const first = Number(data[i++]) & 255;
            let codePoint;
            if (first < 0x80) codePoint = first;
            else if ((first & 0xe0) === 0xc0 && i < data.length) codePoint = ((first & 0x1f) << 6) | ((Number(data[i++]) & 0x3f));
            else if ((first & 0xf0) === 0xe0 && i + 1 < data.length) codePoint = ((first & 0x0f) << 12) | ((Number(data[i++]) & 0x3f) << 6) | (Number(data[i++]) & 0x3f);
            else if ((first & 0xf8) === 0xf0 && i + 2 < data.length) codePoint = ((first & 0x07) << 18) | ((Number(data[i++]) & 0x3f) << 12) | ((Number(data[i++]) & 0x3f) << 6) | (Number(data[i++]) & 0x3f);
            else throw new Error("el archivo contiene texto UTF-8 inválido");
            if (codePoint <= 0xffff) chunks.push(String.fromCharCode(codePoint));
            else {
                codePoint -= 0x10000;
                chunks.push(String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff)));
            }
        }
        return chunks.join("");
    }
    function point(lat, lng, ele) {
        lat = Number(lat); lng = Number(lng); ele = Number(ele);
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error("coordenada fuera de rango");
        return [lat, lng, isFinite(ele) ? ele : null];
    }
    function parseGpx(text, fallback) {
        const segments = [];
        function parsePoints(container, tagName) {
            const points = [];
            const pattern = new RegExp("<" + tagName + "\\b([^>]*)>([\\s\\S]*?)<\\/" + tagName + "\\s*>|<" + tagName + "\\b([^>]*)\\/>", "gi");
            let match;
            while ((match = pattern.exec(container))) {
                const attrs = match[1] || match[3] || "", body = match[2] || "";
                const latMatch = /\blat=[\"']([^\"']+)[\"']/i.exec(attrs);
                const lngMatch = /\blon=[\"']([^\"']+)[\"']/i.exec(attrs);
                if (!latMatch || !lngMatch) continue;
                const elevation = /<ele\b[^>]*>([\s\S]*?)<\/ele\s*>/i.exec(body);
                points.push(point(latMatch[1], lngMatch[1], elevation ? plainText(elevation[1]) : null));
            }
            return points;
        }
        const segmentPattern = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
        let segment;
        while ((segment = segmentPattern.exec(text))) {
            const points = parsePoints(segment[1], "trkpt");
            if (points.length) segments.push(points);
        }
        if (!segments.length) {
            const routePattern = /<rte\b[^>]*>([\s\S]*?)<\/rte\s*>/gi;
            let route;
            while ((route = routePattern.exec(text))) {
                const points = parsePoints(route[1], "rtept");
                if (points.length) segments.push(points);
            }
        }
        const name = /<trk\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text);
        const routeName = name || /<rte\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text);
        return { name: cleanName(routeName ? plainText(routeName[1]) : fallback), segments };
    }
    function parseKml(text, fallback) {
        const segments = [], pattern = /<LineString\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi;
        let match;
        while ((match = pattern.exec(text))) {
            const points = [];
            const coordinates = String(match[1]).trim().split(/\s+/);
            for (let coordinateIndex = 0; coordinateIndex < coordinates.length; coordinateIndex++) {
                const coordinate = coordinates[coordinateIndex];
                const values = coordinate.split(",");
                if (values.length >= 2) points.push(point(values[1], values[0], values[2]));
            }
            if (points.length) segments.push(points);
        }
        const name = /<Document\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text) || /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text);
        return { name: cleanName(name ? plainText(name[1]) : fallback), segments };
    }
    function parseGeoJson(text, fallback) {
        const input = JSON.parse(text), segments = [];
        function visit(value) {
            if (!value) return;
            if (value.type === "FeatureCollection") {
                for (let i = 0; i < value.features.length; i++) visit(value.features[i]);
                return;
            }
            if (value.type === "Feature") return visit(value.geometry);
            if (value.type === "GeometryCollection") {
                for (let i = 0; i < value.geometries.length; i++) visit(value.geometries[i]);
                return;
            }
            if (value.type === "LineString") {
                const line = [];
                for (let i = 0; i < value.coordinates.length; i++) {
                    const p = value.coordinates[i]; line.push(point(p[1], p[0], p[2]));
                }
                segments.push(line);
            }
            if (value.type === "MultiLineString") {
                for (let lineIndex = 0; lineIndex < value.coordinates.length; lineIndex++) {
                    const sourceLine = value.coordinates[lineIndex], line = [];
                    for (let i = 0; i < sourceLine.length; i++) {
                        const p = sourceLine[i]; line.push(point(p[1], p[0], p[2]));
                    }
                    segments.push(line);
                }
            }
        }
        visit(input);
        return { name: cleanName(input.name || (input.properties && input.properties.name) || fallback), segments };
    }
    function distance(a, b) {
        const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function trimStart(lines, meters) {
        const result = [];
        for (let i = 0; i < lines.length; i++) result.push(lines[i].slice());
        let left = meters;
        while (result.length && left > 0) {
            const line = result[0]; if (line.length < 2) { result.shift(); continue; }
            let index = 1, passed = 0;
            while (index < line.length && passed + distance(line[index - 1], line[index]) < left) { passed += distance(line[index - 1], line[index]); index++; }
            if (index >= line.length) { left -= passed; result.shift(); continue; }
            const a = line[index - 1], b = line[index], ratio = Math.max(0, Math.min(1, (left - passed) / (distance(a, b) || 1)));
            result[0] = [[a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]].concat(line.slice(index)); left = 0;
        }
        const filtered = [];
        for (let i = 0; i < result.length; i++) if (result[i].length > 1) filtered.push(result[i]);
        return filtered;
    }
    function fitTrackJson(lines, maxChars) {
        let step = 1, json = JSON.stringify(lines);
        while (json.length > maxChars) {
            step *= 2;
            const compact = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i], sampled = [];
                for (let j = 0; j < line.length; j += step) sampled.push(line[j]);
                if (line.length > 1 && sampled[sampled.length - 1] !== line[line.length - 1]) sampled.push(line[line.length - 1]);
                if (sampled.length > 1) compact.push(sampled);
            }
            if (!compact.length) throw new Error("no se pudo reducir la geometría de la ruta");
            json = JSON.stringify(compact);
            lines = compact;
        }
        return { lines: lines, json: json };
    }
    function importFile(owner, relativePath, root, ownerNickname, maxPoints, sourcePrefix, signature) {
        const lower = relativePath.toLowerCase();
        const text = readUtf8($filepath.join(root, relativePath));
        const fallback = relativePath.split("/").pop().replace(/\.[^.]+$/, "");
        const parsed = lower.endsWith(".gpx") ? parseGpx(text, fallback) : lower.endsWith(".kml") ? parseKml(text, fallback) : parseGeoJson(text, fallback);
        const raw = [];
        let count = 0;
        for (let i = 0; i < parsed.segments.length; i++) {
            if (parsed.segments[i].length > 1) { raw.push(parsed.segments[i]); count += parsed.segments[i].length; }
        }
        if (count < 2 || count > maxPoints) throw new Error("el track debe contener entre 2 y " + maxPoints + " puntos");
        let lines = trimStart(raw, 150);
        const reversed = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const reversedLine = [];
            for (let j = lines[i].length - 1; j >= 0; j--) reversedLine.push(lines[i][j]);
            reversed.push(reversedLine);
        }
        const trimmedReversed = trimStart(reversed, 150), restored = [];
        for (let i = trimmedReversed.length - 1; i >= 0; i--) {
            const restoredLine = [];
            for (let j = trimmedReversed[i].length - 1; j >= 0; j--) restoredLine.push(trimmedReversed[i][j]);
            restored.push(restoredLine);
        }
        lines = restored;
        const points = [];
        for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines[i].length; j++) points.push(lines[i][j]);
        if (points.length < 2) throw new Error("ruta demasiado corta después del recorte de privacidad");
        const fittedTrack = fitTrackJson(lines, 250000);
        lines = fittedTrack.lines;
        let distanceM = 0, gain = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            for (let i = 1; i < line.length; i++) {
                distanceM += distance(line[i - 1], line[i]);
                if (line[i][2] != null && line[i - 1][2] != null && line[i][2] > line[i - 1][2]) {
                    gain += line[i][2] - line[i - 1][2];
                }
            }
        }
        const sourcePath = sourcePrefix + relativePath;
        function saveImportState() {
            let state;
            try { state = $app.findFirstRecordByData("community_route_import_state", "sourcePath", sourcePath); }
            catch (_) { state = new Record($app.findCollectionByNameOrId("community_route_import_state")); }
            state.set("sourcePath", sourcePath);
            state.set("signature", signature);
            $app.save(state);
        }
        let record;
        let existingRoute = true;
        try { record = $app.findFirstRecordByData("community_routes", "sourcePath", sourcePath); }
        catch (_) {
            existingRoute = false;
            record = new Record($app.findCollectionByNameOrId("community_routes"));
        }
        if (existingRoute && communityRouteImportTrackIsLocked(record, fittedTrack.json)) {
            console.log("[rutas Galicia] " + relativePath + ": la geometría publicada es inmutable; cambio omitido.");
            saveImportState();
            return;
        }
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (let i = 0; i < points.length; i++) {
            minLat = Math.min(minLat, points[i][0]); maxLat = Math.max(maxLat, points[i][0]);
            minLng = Math.min(minLng, points[i][1]); maxLng = Math.max(maxLng, points[i][1]);
        }
        record.load({ owner: owner.id, createdBy: ownerNickname, title: parsed.name, province: "Galicia", activityType: "mtb", distanceKm: +(distanceM / 1000).toFixed(3), elevationGain: Math.round(gain), movingTimeSec: 0, trackJson: fittedTrack.json, trackLocked: true, poisJson: "[]", published: true, quotaExemptForLimit: true, sourcePath: sourcePath, minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng });
        $app.save(record);
        saveImportState();
    }
    function scanAndImport() {
        const root = $os.getenv("COMMUNITY_IMPORT_DIR") || $filepath.join($os.getwd(), "pb_public", "rutas", "galicia");
        const ownerNickname = "SENDA-MTB";
        const maxPoints = 100000;
        const sourcePrefix = "galicia/";
        const files = [];
        let scanComplete = true;
        console.log("[rutas Galicia] comprobando cambios en " + root);
        function scan(directory, relativeDirectory) {
            let entries;
            try { entries = $os.readDir(directory); }
            catch (error) {
                console.log("[rutas Galicia] no se puede leer " + directory + ": " + error);
                scanComplete = false;
                return;
            }
            for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
                const entry = entries[entryIndex];
                const name = entry.name();
                const relativePath = relativeDirectory ? relativeDirectory + "/" + name : name;
                const fullPath = $filepath.join(directory, name);
                if (entry.isDir()) { scan(fullPath, relativePath); continue; }
                if (!/\.(gpx|kml|geojson)$/i.test(name)) continue;
                try {
                    const info = $os.stat(fullPath);
                    const signature = String(info.size()) + ":" + String(info.modTime().unixNano());
                    files.push({ relativePath: relativePath, signature: signature });
                } catch (error) {
                    console.log("[rutas Galicia] no se pueden leer los metadatos de " + relativePath + ": " + error);
                    scanComplete = false;
                }
            }
        }
        scan(root, "");
        if (!scanComplete) console.log("[rutas Galicia] Escaneo incompleto; se procesaran los archivos legibles y se reintentara el resto en la proxima comprobacion.");
        const changedFiles = files.filter(function (file) {
            const sourcePath = sourcePrefix + file.relativePath;
            try {
                const state = $app.findFirstRecordByData("community_route_import_state", "sourcePath", sourcePath);
                return state.getString("signature") !== file.signature;
            } catch (_) { return true; }
        });
        if (!changedFiles.length) {
            console.log("[rutas Galicia] sin cambios; no hace falta importar rutas");
            return;
        }
        console.log("[rutas Galicia] " + changedFiles.length + " archivo(s) nuevo(s) o modificado(s)");
        const ownerId = String($os.getenv("COMMUNITY_IMPORT_OWNER_ID") || "").trim();
        if (!ownerId) {
            console.log("[rutas Galicia] falta COMMUNITY_IMPORT_OWNER_ID; no se importarán rutas");
            return;
        }
        let owner;
        try { owner = $app.findRecordById("users", ownerId); }
        catch (error) { console.log("[rutas Galicia] no se encuentra el propietario configurado: " + error); return; }
        if (owner.getString("nickname").trim().toLowerCase() !== ownerNickname.toLowerCase()) {
            console.log("[rutas Galicia] COMMUNITY_IMPORT_OWNER_ID no corresponde a la cuenta " + ownerNickname);
            return;
        }
        let routesImported = 0;
        for (let i = 0; i < changedFiles.length; i++) {
            const file = changedFiles[i];
            try {
                importFile(owner, file.relativePath, root, ownerNickname, maxPoints, sourcePrefix, file.signature);
                routesImported++;
                console.log("[rutas Galicia] importada " + file.relativePath);
            } catch (error) {
                console.log("[rutas Galicia] error en " + file.relativePath + ": " + error);
            }
        }
        console.log("[rutas Galicia] comprobación terminada: " + routesImported + "/" + changedFiles.length + " cambios importados");
    }
    scanAndImport();
}
    // Cron jobs run after PocketBase has finished initializing the app context.
    // Calling run() here executes during hook loading and can panic on $app.
    cronAdd("importar_rutas_galicia", "*/5 * * * *", run);
})();
