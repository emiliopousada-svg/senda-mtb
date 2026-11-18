// Importador de rutas oficiales de Galicia.
// Lee pb_public/rutas/galicia cada cinco minutos. Los archivos permanecen en
// su sitio: sourcePath permite actualizar una ruta al modificar el fichero.
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
        const segments = [], trackNames = [];
        const segmentPattern = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
        let segment;
        while ((segment = segmentPattern.exec(text))) {
            const points = [], pointPattern = /<trkpt\b[^>]*\blat=["']([^"']+)["'][^>]*\blon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>|<trkpt\b[^>]*\blon=["']([^"']+)["'][^>]*\blat=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
            let match;
            while ((match = pointPattern.exec(segment[1]))) {
                const lat = match[1] || match[5], lng = match[2] || match[4], body = match[3] || match[6] || "";
                const elevation = /<ele\b[^>]*>([\s\S]*?)<\/ele>/i.exec(body);
                points.push(point(lat, lng, elevation ? plainText(elevation[1]) : null));
            }
            if (points.length) segments.push(points);
        }
        const name = /<trk\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text);
        return { name: cleanName(name ? plainText(name[1]) : fallback), segments };
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
    function importFile(owner, relativePath, root, ownerNickname, maxPoints, sourcePrefix) {
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
        let distanceM = 0, gain = 0;
        for (let lineIndex = 0; lineIndex < raw.length; lineIndex++) {
            const line = raw[lineIndex];
            for (let i = 1; i < line.length; i++) {
                distanceM += distance(line[i - 1], line[i]);
                if (line[i][2] != null && line[i - 1][2] != null && line[i][2] > line[i - 1][2]) gain += line[i][2] - line[i - 1][2];
            }
        }
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
        const sourcePath = sourcePrefix + relativePath;
        let record;
        try { record = $app.findFirstRecordByData("community_routes", "sourcePath", sourcePath); }
        catch (_) { record = new Record($app.findCollectionByNameOrId("community_routes")); }
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (let i = 0; i < points.length; i++) {
            minLat = Math.min(minLat, points[i][0]); maxLat = Math.max(maxLat, points[i][0]);
            minLng = Math.min(minLng, points[i][1]); maxLng = Math.max(maxLng, points[i][1]);
        }
        record.load({ owner: owner.id, createdBy: ownerNickname, title: parsed.name, province: "Galicia", activityType: "mtb", distanceKm: +(distanceM / 1000).toFixed(3), elevationGain: Math.round(gain), movingTimeSec: 0, trackJson: JSON.stringify(lines), poisJson: "[]", published: true, sourcePath: sourcePath, minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng });
        $app.save(record);
    }
    function scanAndImport() {
        const root = $os.getenv("COMMUNITY_IMPORT_DIR") || $filepath.join($os.getwd(), "pb_public", "rutas", "galicia");
        const ownerNickname = "SENDA-MTB";
        const maxPoints = 100000;
        const sourcePrefix = "galicia/";
        console.log("[rutas Galicia] iniciando escaneo de " + root);
        let owner;
        try { owner = $app.findFirstRecordByData("users", "nickname", ownerNickname); }
        catch (error) { console.log("[rutas Galicia] no se encuentra la cuenta " + ownerNickname + ": " + error); return; }
        let filesFound = 0;
        let routesImported = 0;
        function scan(directory, relativeDirectory) {
            let entries;
            try { entries = $os.readDir(directory); }
            catch (error) { console.log("[rutas Galicia] no se puede leer " + directory + ": " + error); return; }
            for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
                const entry = entries[entryIndex];
                const name = entry.name();
                const relativePath = relativeDirectory ? relativeDirectory + "/" + name : name;
                const fullPath = $filepath.join(directory, name);
                if (entry.isDir()) { scan(fullPath, relativePath); continue; }
                if (!/\.(gpx|kml|geojson)$/i.test(name)) continue;
                filesFound++;
                try { importFile(owner, relativePath, root, ownerNickname, maxPoints, sourcePrefix); routesImported++; console.log("[rutas Galicia] importada " + relativePath); }
                catch (error) { console.log("[rutas Galicia] error en " + relativePath + ": " + error); }
            }
        }
        scan(root, "");
        console.log("[rutas Galicia] escaneo terminado: " + routesImported + "/" + filesFound + " rutas importadas");
    }
    scanAndImport();
}
    // Cron jobs run after PocketBase has finished initializing the app context.
    // Calling run() here executes during hook loading and can panic on $app.
    cronAdd("importar_rutas_galicia", "*/5 * * * *", run);
})();
