// Calcula en PocketBase la caja geográfica que usa el catálogo para filtrar candidatos.
function indexCommunityRouteBounds(e) {
    const {
        communityRouteBounds,
        communityRouteDistance,
        communityRouteDistanceMeters,
        communityRouteTrimEnds
    } = require(`${__hooks}/community_routes_utils.js`);
    const isSuperuser = e.hasSuperuserAuth();
    if (!isSuperuser && !e.auth) {
        throw new BadRequestError("Inicia sesión para publicar rutas.");
    }
    const internalWrite = isSuperuser;
    e.record.set("quotaExemptForLimit", isSuperuser);
    if (!internalWrite && e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario de la ruta no coincide con la sesión.");
    }
    if (!internalWrite) {
        const originalSourcePath = e.record.isNew() ? "" : e.record.original().getString("sourcePath");
        if (e.record.getString("sourcePath") !== originalSourcePath) {
            throw new BadRequestError("El origen de la ruta no se puede modificar.");
        }
    }
    const ownerId = internalWrite ? e.record.getString("owner") : e.auth.id;
    if (!ownerId) throw new BadRequestError("La ruta debe tener un propietario.");
    const user = $app.findRecordById("users", ownerId);
    const nickname = user.getString("nickname").trim();
    if (!nickname) throw new BadRequestError("Configura un apodo antes de publicar rutas.");
    if (!internalWrite && !user.getBool("verified")) {
        throw new BadRequestError("Verifica tu correo electrónico para publicar rutas.");
    }
    if (!internalWrite) e.record.set("createdBy", nickname);

    const originalRecord = e.record.isNew() ? null : e.record.original();
    const shouldTrimTrack = !originalRecord
        || e.record.getString("trackJson") !== originalRecord.getString("trackJson");
    const trackLocked = Boolean(originalRecord
        && (originalRecord.getBool("trackLocked") || originalRecord.getBool("published")));
    if (originalRecord && shouldTrimTrack && trackLocked) {
        throw new BadRequestError("El trazado no se puede modificar después de publicar la ruta.");
    }
    e.record.set("trackLocked", trackLocked || e.record.getBool("published"));
    const communityRouteTrimMeters = 150;
    const communityRouteMaxPhotoBytes = 614400;

    function communityRoutePhotoBytes(file) {
        const size = Number(file.size);
        if (!Number.isSafeInteger(size) || size < 4 || size > communityRouteMaxPhotoBytes) {
            throw new BadRequestError("La foto debe ser un JPEG válido de hasta 600 KB.");
        }

        const reader = file.reader.open();
        const bytes = new Uint8Array(size);
        let offset = 0;
        try {
            while (offset < size) {
                const chunk = new Uint8Array(Math.min(8192, size - offset));
                const count = reader.read(chunk);
                if (!Number.isInteger(count) || count <= 0 || count > chunk.length) {
                    throw new BadRequestError("No se pudo verificar la foto.");
                }
                bytes.set(chunk.subarray(0, count), offset);
                offset += count;
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
            if (marker === 0xd9) {
                if (offset !== bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");
                return;
            }
            if (marker === 0xda) {
                if (offset + 2 > bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");
                const scanLength = bytes[offset] * 256 + bytes[offset + 1];
                if (scanLength < 2 || offset + scanLength > bytes.length) {
                    throw new BadRequestError("La foto debe ser un JPEG válido.");
                }
                offset += scanLength;
                let nextMarkerFound = false;
                while (offset < bytes.length) {
                    if (bytes[offset] !== 0xff) { offset++; continue; }
                    const markerStart = offset;
                    offset++;
                    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
                    if (offset >= bytes.length) throw new BadRequestError("La foto debe ser un JPEG válido.");
                    const scanMarker = bytes[offset];
                    if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
                        offset++;
                        continue;
                    }
                    offset = markerStart;
                    nextMarkerFound = true;
                    break;
                }
                if (!nextMarkerFound) throw new BadRequestError("La foto debe ser un JPEG válido.");
                continue;
            }
            if (marker === 0x01) continue;
            if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
                throw new BadRequestError("La foto debe ser un JPEG válido.");
            }
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
        lines = communityRouteTrimEnds(lines, communityRouteTrimMeters);
        if (!lines.length || lines.reduce((total, line) => total + line.length, 0) < 2) {
            throw new BadRequestError("La ruta es demasiado corta para publicarse después de ocultar sus extremos.");
        }
        e.record.set("trackJson", JSON.stringify(lines));
    }

    const distanceMeters = communityRouteDistanceMeters(lines);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 100000000) {
        throw new BadRequestError("El trazado no permite calcular una distancia válida.");
    }
    e.record.set("distanceKm", Math.round(distanceMeters) / 1000);
    e.record.set("movingTimeSec", 0);

    const sourcePath = e.record.getString("sourcePath");
    const originalSourcePath = shouldTrimTrack ? "" : e.record.original().getString("sourcePath");
    let elevationGain = 0;
    if (sourcePath && sourcePath === originalSourcePath
        && sourcePath.indexOf("galicia/") === 0 && nickname === "SENDA-MTB") {
        elevationGain = Number(e.record.original().get("elevationGain"));
        if (!Number.isFinite(elevationGain) || elevationGain < 0) elevationGain = 0;
    }
    e.record.set("elevationGain", elevationGain);

    const bounds = communityRouteBounds(lines);
    if (bounds.error === "invalid-line") throw new BadRequestError("El trazado de la ruta no es válido.");
    if (bounds.error === "invalid-point") throw new BadRequestError("El trazado contiene una coordenada no válida.");
    if (bounds.error === "out-of-range") throw new BadRequestError("El trazado contiene una coordenada fuera de rango.");
    if (bounds.count < 2) throw new BadRequestError("El trazado debe tener al menos dos puntos.");

    e.record.set("minLat", bounds.minLat);
    e.record.set("maxLat", bounds.maxLat);
    e.record.set("minLng", bounds.minLng);
    e.record.set("maxLng", bounds.maxLng);

    const isNewPublication = e.record.getBool("published")
        && (!originalRecord || !originalRecord.getBool("published"));
    const owner = e.record.getString("owner");
    const ownerChanged = originalRecord && owner !== originalRecord.getString("owner");
    if (!originalRecord || shouldTrimTrack || isNewPublication || ownerChanged) {
        // Las métricas declaradas por el cliente no son una clave fiable para detectar duplicados.
        const params = {
            owner: owner,
            id: e.record.id || "",
            track: e.record.getString("trackJson")
        };
        const filter = "owner = {:owner} && id != {:id} && trackJson = {:track}";
        // Si la consulta falla, la publicación se aborta: no se acepta sin comprobar duplicados.
        const duplicates = $app.findRecordsByFilter("community_routes", filter, "", 1, 0, params) || [];
        if (duplicates.length) throw new BadRequestError("Esta ruta ya está publicada en la comunidad.");
    }
    if (!internalWrite && isNewPublication) {
        const { enforceCommunityWriteQuota } = require(`${__hooks}/community_quota_utils.js`);
        enforceCommunityWriteQuota($app, owner, "route");
    }
    e.next();
}

onRecordCreateRequest(indexCommunityRouteBounds, "community_routes");
onRecordUpdateRequest(indexCommunityRouteBounds, "community_routes");
