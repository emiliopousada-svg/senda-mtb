migrate((app) => {
    function routeDistanceMeters(lines) {
        if (!Array.isArray(lines)) throw new Error("community route trackJson must be an array")

        const radians = Math.PI / 180
        let distanceMeters = 0
        let pointCount = 0
        for (const line of lines) {
            if (!Array.isArray(line)) throw new Error("community route trackJson contains an invalid line")
            for (let i = 0; i < line.length; i++) {
                const point = line[i]
                if (!Array.isArray(point) || point.length < 2) {
                    throw new Error("community route trackJson contains an invalid coordinate")
                }
                const lat = Number(point[0])
                const lng = Number(point[1])
                if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                    throw new Error("community route trackJson contains an out-of-range coordinate")
                }
                if (i > 0) {
                    const previous = line[i - 1]
                    const previousLat = Number(previous[0])
                    const previousLng = Number(previous[1])
                    const lat1 = previousLat * radians
                    const lat2 = lat * radians
                    const deltaLat = (lat - previousLat) * radians
                    const deltaLng = (lng - previousLng) * radians
                    const h = Math.sin(deltaLat / 2) ** 2 +
                        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
                    distanceMeters += 6371000 * 2 * Math.atan2(
                        Math.sqrt(Math.min(1, h)),
                        Math.sqrt(Math.max(0, 1 - h))
                    )
                }
                pointCount++
            }
        }

        if (pointCount < 2 || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 100000000) {
            throw new Error("community route trackJson does not have a valid distance")
        }
        return distanceMeters
    }

    const pageSize = 200
    let offset = 0
    while (true) {
        const records = app.findRecordsByFilter("community_routes", 'id != ""', "id", pageSize, offset)
        if (!records.length) break
        for (const record of records) {
            let lines
            try {
                lines = JSON.parse(record.getString("trackJson"))
            } catch (error) {
                throw new Error("community route " + record.id + " has invalid trackJson")
            }
            const distanceKm = Math.round(routeDistanceMeters(lines)) / 1000
            const sourcePath = record.getString("sourcePath")
            const ownerId = record.getString("owner")
            let ownerNickname = ""
            if (ownerId) ownerNickname = app.findRecordById("users", ownerId).getString("nickname").trim()
            const hasTrustedElevation = sourcePath.indexOf("galicia/") === 0
                && ownerNickname === "SENDA-MTB"
            const elevationGain = Number(record.get("elevationGain"))
            let changed = false

            if (Number(record.get("distanceKm")) !== distanceKm) {
                record.set("distanceKm", distanceKm)
                changed = true
            }
            if (Number(record.get("movingTimeSec")) !== 0) {
                record.set("movingTimeSec", 0)
                changed = true
            }
            if (!hasTrustedElevation && Number(record.get("elevationGain")) !== 0) {
                record.set("elevationGain", 0)
                changed = true
            } else if (hasTrustedElevation && (!Number.isFinite(elevationGain) || elevationGain < 0)) {
                record.set("elevationGain", 0)
                changed = true
            }
            if (changed) app.save(record)
        }
        offset += records.length
        if (records.length < pageSize) break
    }
})
