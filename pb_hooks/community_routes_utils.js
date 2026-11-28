function communityRouteDistance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLng = (b[1] - a[1]) * rad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * sinLng * sinLng;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function communityRouteDistanceMeters(lines) {
    let distanceMeters = 0;
    for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
            distanceMeters += communityRouteDistance(line[i - 1], line[i]);
        }
    }
    return distanceMeters;
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
        const longitudeDelta = ((b[1] - a[1] + 540) % 360) - 180;
        let longitude = a[1] + longitudeDelta * fraction;
        if (longitude > 180) longitude -= 360;
        else if (longitude < -180) longitude += 360;
        const cut = [a[0] + (b[0] - a[0]) * fraction, longitude];
        if (a.length > 2 || b.length > 2) {
            const startAltitude = a[2] == null ? null : Number(a[2]);
            const endAltitude = b[2] == null ? null : Number(b[2]);
            cut.push(Number.isFinite(startAltitude) && Number.isFinite(endAltitude)
                ? startAltitude + (endAltitude - startAltitude) * fraction
                : null);
        }
        result[0] = [cut].concat(line.slice(index));
        remaining = 0;
    }
    return result.filter(line => line.length > 1);
}

function communityRouteTrimEnds(lines, meters) {
    let result = communityRouteTrimStart(lines, meters);
    result = communityRouteTrimStart(
        result.slice().reverse().map(line => line.slice().reverse()),
        meters
    ).reverse().map(line => line.slice().reverse());
    return result;
}

function communityRouteBounds(lines) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    let count = 0;
    for (const line of lines) {
        if (!Array.isArray(line)) return { error: "invalid-line" };
        for (const point of line) {
            if (!Array.isArray(point) || point.length < 2) return { error: "invalid-point" };
            const lat = Number(point[0]), lng = Number(point[1]);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
                return { error: "out-of-range" };
            }
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            count++;
        }
    }
    return { minLat, maxLat, minLng, maxLng, count };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        communityRouteBounds,
        communityRouteDistance,
        communityRouteDistanceMeters,
        communityRouteTrimEnds
    };
}
