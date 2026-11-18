// Importador de rutas oficiales de Galicia.
// Lee pb_public/rutas/galicia cada cinco minutos. Los archivos permanecen en
// su sitio: sourcePath permite actualizar una ruta al modificar el fichero.
(function () {
    const ROOT = $os.getenv("COMMUNITY_IMPORT_DIR") || $filepath.join($os.getwd(), "pb_public", "rutas", "galicia");
    const OWNER_NICKNAME = "SENDA-MTB";
    const SOURCE_PREFIX = "galicia/";
    const MAX_POINTS = 100000;

    function decodeXml(value) {
        return String(value || "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({
            "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"
        }[entity]));
    }
    function plainText(value) { return decodeXml(String(value || "").replace(/<[^>]*>/g, "")).trim(); }
    function cleanName(name) { return String(name || "Ruta de Galicia").trim().slice(0, 100) || "Ruta de Galicia"; }
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
            String(match[1]).trim().split(/\s+/).forEach((coordinate) => {
                const values = coordinate.split(",");
                if (values.length >= 2) points.push(point(values[1], values[0], values[2]));
            });
            if (points.length) segments.push(points);
        }
        const name = /<Document\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text) || /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(text);
        return { name: cleanName(name ? plainText(name[1]) : fallback), segments };
    }
    function parseGeoJson(text, fallback) {
        const input = JSON.parse(text), segments = [];
        function visit(value) {
            if (!value) return;
            if (value.type === "FeatureCollection") return value.features.forEach(visit);
            if (value.type === "Feature") return visit(value.geometry);
            if (value.type === "GeometryCollection") return value.geometries.forEach(visit);
            if (value.type === "LineString") segments.push(value.coordinates.map((p) => point(p[1], p[0], p[2])));
            if (value.type === "MultiLineString") value.coordinates.forEach((line) => segments.push(line.map((p) => point(p[1], p[0], p[2]))));
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
        const result = lines.map((line) => line.slice()); let left = meters;
        while (result.length && left > 0) {
            const line = result[0]; if (line.length < 2) { result.shift(); continue; }
            let index = 1, passed = 0;
            while (index < line.length && passed + distance(line[index - 1], line[index]) < left) { passed += distance(line[index - 1], line[index]); index++; }
            if (index >= line.length) { left -= passed; result.shift(); continue; }
            const a = line[index - 1], b = line[index], ratio = Math.max(0, Math.min(1, (left - passed) / (distance(a, b) || 1)));
            result[0] = [[a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]].concat(line.slice(index)); left = 0;
        }
        return result.filter((line) => line.length > 1);
    }
    function importFile(owner, relativePath) {
        const lower = relativePath.toLowerCase();
        const text = String($os.readFile($filepath.join(ROOT, relativePath)));
        const fallback = relativePath.split("/").pop().replace(/\.[^.]+$/, "");
        const parsed = lower.endsWith(".gpx") ? parseGpx(text, fallback) : lower.endsWith(".kml") ? parseKml(text, fallback) : parseGeoJson(text, fallback);
        const raw = parsed.segments.filter((line) => line.length > 1);
        const count = raw.reduce((total, line) => total + line.length, 0);
        if (count < 2 || count > MAX_POINTS) throw new Error("el track debe contener entre 2 y " + MAX_POINTS + " puntos");
        let distanceM = 0, gain = 0;
        raw.forEach((line) => line.slice(1).forEach((p, index) => { distanceM += distance(line[index], p); if (p[2] != null && line[index][2] != null && p[2] > line[index][2]) gain += p[2] - line[index][2]; }));
        let lines = trimStart(raw, 150); lines = trimStart(lines.slice().reverse().map((line) => line.slice().reverse()), 150).reverse().map((line) => line.slice().reverse());
        const points = lines.flat(); if (points.length < 2) throw new Error("ruta demasiado corta después del recorte de privacidad");
        const sourcePath = SOURCE_PREFIX + relativePath;
        let record;
        try { record = $app.findFirstRecordByData("community_routes", "sourcePath", sourcePath); }
        catch (_) { record = new Record($app.findCollectionByNameOrId("community_routes")); }
        record.load({ owner: owner.id, createdBy: OWNER_NICKNAME, title: parsed.name, province: "Galicia", activityType: "mtb", distanceKm: +(distanceM / 1000).toFixed(3), elevationGain: Math.round(gain), movingTimeSec: 0, trackJson: JSON.stringify(lines), poisJson: "[]", published: true, sourcePath: sourcePath, minLat: Math.min.apply(null, points.map((p) => p[0])), maxLat: Math.max.apply(null, points.map((p) => p[0])), minLng: Math.min.apply(null, points.map((p) => p[1])), maxLng: Math.max.apply(null, points.map((p) => p[1])) });
        $app.save(record);
    }
    function run() {
        let owner;
        try { owner = $app.findFirstRecordByData("users", "nickname", OWNER_NICKNAME); }
        catch (_) { console.log("[rutas Galicia] falta la cuenta " + OWNER_NICKNAME); return; }
        function scan(directory, relativeDirectory) {
            let entries;
            try { entries = $os.readDir(directory); }
            catch (error) { console.log("[rutas Galicia] no se puede leer " + directory + ": " + error); return; }
            entries.forEach((entry) => {
                const name = entry.name();
                const relativePath = relativeDirectory ? relativeDirectory + "/" + name : name;
                const fullPath = $filepath.join(directory, name);
                if (entry.isDir()) { scan(fullPath, relativePath); return; }
                if (!/\.(gpx|kml|geojson|json)$/i.test(name)) return;
                try { importFile(owner, relativePath); console.log("[rutas Galicia] importada " + relativePath); }
                catch (error) { console.log("[rutas Galicia] error en " + relativePath + ": " + error); }
            });
        }
        scan(ROOT, "");
    }
    cronAdd("importar_rutas_galicia", "*/5 * * * *", run);
    run();
})();
