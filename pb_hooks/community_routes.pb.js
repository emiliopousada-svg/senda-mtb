// Calcula en PocketBase la caja geográfica que usa el catálogo para filtrar candidatos.
function indexCommunityRouteBounds(e) {
    const internalWrite = e.hasSuperuserAuth() || !e.auth;
    if (!internalWrite && e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario de la ruta no coincide con la sesión.");
    }
    const ownerId = internalWrite ? e.record.getString("owner") : e.auth.id;
    if (!ownerId) throw new BadRequestError("La ruta debe tener un propietario.");
    const user = $app.findRecordById("users", ownerId);
    const nickname = user.getString("nickname").trim();
    if (!nickname) throw new BadRequestError("Configura un apodo antes de publicar rutas.");
    if (!internalWrite) e.record.set("createdBy", nickname);

    const shouldTrimTrack = e.record.isNew()
        || e.record.getString("trackJson") !== e.record.original().getString("trackJson");
    const communityRouteTrimMeters = 150;
    const communityRouteMaxPhotoBytes = 614400;

    function communityRouteDistance(a, b) {
        const rad = Math.PI / 180;
        const dLat = (b[0] - a[0]) * rad;
        const dLng = (b[1] - a[1]) * rad;
        const sinLat = Math.sin(dLat / 2);
        const sinLng = Math.sin(dLng / 2);
        const h = sinLat * sinLat + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * sinLng * sinLng;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function communityRouteTrimStart(lines, meters) {
        const result = lines.map(line => line.map(point => point.slice()));
        let remaining = meters;
        while (result.length && remaining > 0) {
            const line = result[0];
            if (line.length < 2) { result.shift(); continue; }
            let passed = 0;
            let index = 1;
            while (index < line.length) {
                const length = communityRouteDistance(line[index - 1], line[index]);
                if (passed + length >= remaining) break;
                passed += length;
                index++;
            }
            if (index >= line.length) {
                remaining -= passed;
                result.shift();
                continue;
            }
            const a = line[index - 1];
            const b = line[index];
            const length = communityRouteDistance(a, b) || 1;
            const fraction = Math.max(0, Math.min(1, (remaining - passed) / length));
            const cut = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
            result[0] = [cut].concat(line.slice(index));
            remaining = 0;
        }
        return result.filter(line => line.length > 1);
    }

    function communityRouteTrimEnds(lines) {
        let result = communityRouteTrimStart(lines, communityRouteTrimMeters);
        result = communityRouteTrimStart(
            result.slice().reverse().map(line => line.slice().reverse()),
            communityRouteTrimMeters
        ).reverse().map(line => line.slice().reverse());
        return result;
    }

    function communityRoutePhotoBytes(file) {
        const size = Number(file.size);
        if (!Number.isSafeInteger(size) || size < 4 || size > communityRouteMaxPhotoBytes) {
            throw new BadRequestError("La foto debe ser un JPEG válido de hasta 600 KB.");
        }

        const reader = file.reader.open();
        const bytes = [];
        try {
            while (bytes.length < size) {
                const chunk = new Uint8Array(Math.min(8192, size - bytes.length));
                const count = reader.read(chunk);
                if (!Number.isInteger(count) || count <= 0 || count > chunk.length) {
                    throw new BadRequestError("No se pudo verificar la foto.");
                }
                for (let i = 0; i < count; i++) bytes.push(Number(chunk[i]) & 255);
            }
        } finally {
            reader.close();
        }
        return bytes;
    }

    function communityRouteValidatePhotoMetadata(file) {
        const bytes = communityRoutePhotoBytes(file);
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
            throw new BadRequestError("La foto debe ser un JPEG válido.");
        }

        let offset = 2;
        while (offset < bytes.length) {
            if (bytes[offset] !== 0xff) throw new BadRequestError("La foto debe ser un JPEG válido.");
            while (offset < bytes.length && bytes[offset] === 0xff) offset++;
            if (offset >= bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");

            const marker = bytes[offset++];
            if (marker === 0xd9) return;
            if (marker === 0xda) {
                if (offset + 2 > bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");
                const scanLength = bytes[offset] * 256 + bytes[offset + 1];
                if (scanLength < 2 || offset + scanLength > bytes.length) {
                    throw new BadRequestError("La foto debe ser un JPEG válido.");
                }
                return;
            }
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (offset + 2 > bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");

            const segmentLength = bytes[offset] * 256 + bytes[offset + 1];
            if (segmentLength < 2 || offset + segmentLength > bytes.length) {
                throw new BadRequestError("La foto debe ser un JPEG válido.");
            }
            if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
                throw new BadRequestError("La foto contiene metadatos; vuelve a exportarla sin EXIF.");
            }
            offset += segmentLength;
        }

        throw new BadRequestError("La foto debe ser un JPEG válido.");
    }

    let lines;
    try { lines = JSON.parse(e.record.getString("trackJson")); }
    catch (error) { throw new BadRequestError("El trazado de la ruta no es JSON válido."); }
    if (!Array.isArray(lines)) throw new BadRequestError("El trazado de la ruta no es válido.");

    let rawCount = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) throw new BadRequestError("El trazado no es válido.");
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) throw new BadRequestError("El trazado contiene una coordenada no válida.");
            const lat = Number(point[0]), lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
            }
            point[0] = lat;
            point[1] = lng;
            rawCount++;
        }
    }
    if (rawCount < 2 || !lines.length || !lines[0].length || !lines[lines.length - 1].length) {
        throw new BadRequestError("El trazado debe tener al menos dos puntos.");
    }

    const firstPoint = lines[0][0];
    const lastLine = lines[lines.length - 1];
    const lastPoint = lastLine[lastLine.length - 1];
    let pois;
    try { pois = JSON.parse(e.record.getString("poisJson") || "[]"); }
    catch (error) { throw new BadRequestError("Los puntos de interés no son JSON válido."); }
    if (!Array.isArray(pois)) throw new BadRequestError("Los puntos de interés no son válidos.");
    let originalPois = [];
    if (!shouldTrimTrack) {
        try { originalPois = JSON.parse(e.record.original().getString("poisJson") || "[]"); }
        catch (error) { throw new BadRequestError("Los puntos de interés originales no son JSON válido."); }
        if (!Array.isArray(originalPois)) throw new BadRequestError("Los puntos de interés originales no son válidos.");
    }
    for (const poi of pois) {
        const lat = Number(poi && poi.lat);
        const lng = Number(poi && poi.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new BadRequestError("Los puntos de interés contienen coordenadas no válidas.");
        }
        const existedBefore = originalPois.some(originalPoi =>
            Number(originalPoi && originalPoi.lat) === lat && Number(originalPoi && originalPoi.lng) === lng
        );
        if ((shouldTrimTrack || !existedBefore)
            && (communityRouteDistance([lat, lng], firstPoint) <= communityRouteTrimMeters
                || communityRouteDistance([lat, lng], lastPoint) <= communityRouteTrimMeters)) {
            throw new BadRequestError("Los puntos de interés nuevos deben quedar a más de 150 metros de los extremos protegidos.");
        }
    }

    for (const photo of e.record.getUnsavedFiles("poiPhotos")) {
        communityRouteValidatePhotoMetadata(photo);
    }

    if (shouldTrimTrack) {
        lines = communityRouteTrimEnds(lines);
        if (!lines.length || lines.reduce((total, line) => total + line.length, 0) < 2) {
            throw new BadRequestError("La ruta es demasiado corta para publicarse después de ocultar sus extremos.");
        }
        e.record.set("trackJson", JSON.stringify(lines));
    }

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    let count = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) throw new BadRequestError("El trazado de la ruta no es válido.");
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) throw new BadRequestError("El trazado contiene una coordenada no válida.");
            const lat = Number(point[0]), lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
            }
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            count++;
        }
    }
    if (count < 2) throw new BadRequestError("El trazado debe tener al menos dos puntos.");

    e.record.set("minLat", minLat);
    e.record.set("maxLat", maxLat);
    e.record.set("minLng", minLng);
    e.record.set("maxLng", maxLng);

    // No se admite publicar dos veces la misma ruta: mismo trazado, o misma distancia y tiempo en movimiento.
    const owner = e.record.getString("owner");
    const movingTimeSec = Math.round(Number(e.record.get("movingTimeSec")) || 0);
    const distanceKm = Number(e.record.get("distanceKm")) || 0;
    const params = {
        owner: owner,
        id: e.record.id || "",
        track: e.record.getString("trackJson"),
        moving: movingTimeSec,
        dmin: distanceKm - 0.05,
        dmax: distanceKm + 0.05
    };
    let filter = "owner = {:owner} && id != {:id} && (trackJson = {:track}";
    if (movingTimeSec > 0 && distanceKm > 0) {
        filter += " || (movingTimeSec = {:moving} && distanceKm >= {:dmin} && distanceKm <= {:dmax})";
    }
    filter += ")";
    // Si la consulta falla, la publicación se aborta: no se acepta sin comprobar duplicados.
    const duplicates = $app.findRecordsByFilter("community_routes", filter, "", 1, 0, params) || [];
    if (duplicates.length) throw new BadRequestError("Esta ruta ya está publicada en la comunidad.");
    e.next();
}

onRecordCreateRequest(indexCommunityRouteBounds, "community_routes");
onRecordUpdateRequest(indexCommunityRouteBounds, "community_routes");
