// Utilidades de Strava. Se cargan con require() desde dentro de cada handler de strava.pb.js
// (PocketBase ejecuta cada handler en un runtime aislado y no ve las constantes ni funciones del archivo).
const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
const STRAVA_TOKEN_URL = "https://www.strava.com/api/v3/oauth/token"
const STRAVA_API_URL = "https://www.strava.com/api/v3"
const STRAVA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const STRAVA_CALLBACK_PATH = "/api/mtb/strava/callback"

function stravaConfig() {
    const clientId = $os.getenv("STRAVA_CLIENT_ID")
    const clientSecret = $os.getenv("STRAVA_CLIENT_SECRET")
    const redirectUri = $os.getenv("STRAVA_REDIRECT_URI")
    const encryptionKey = $os.getenv("STRAVA_TOKEN_ENCRYPTION_KEY")
    if (!clientId || !clientSecret || !redirectUri || !encryptionKey || encryptionKey.length !== 32) {
        throw new Error("Strava aún no está configurado en el servidor.")
    }
    if (!/^https:\/\/[^/?#]+\/api\/mtb\/strava\/callback$/.test(redirectUri)) {
        throw new Error("STRAVA_REDIRECT_URI debe ser HTTPS y apuntar al callback de Strava configurado.")
    }
    return { clientId, clientSecret, redirectUri, encryptionKey }
}

function stravaPostForm(url, values) {
    const body = Object.keys(values).map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key]))).join("&")
    return $http.send({
        url,
        method: "POST",
        timeout: 15,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })
}

function stravaFindConnection(userId) {
    try { return $app.findFirstRecordByData("strava_connections", "owner", userId) }
    catch (_) { return null }
}

function stravaSaveConnection(connection) {
    $app.save(connection)
    return connection
}

function stravaGetAccessToken(connection, config) {
    if (connection.getInt("expiresAt") > Date.now() / 1000 + 60) {
        return $security.decrypt(connection.getString("accessToken"), config.encryptionKey)
    }
    const refreshed = stravaPostForm(STRAVA_TOKEN_URL, {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
            refresh_token: $security.decrypt(connection.getString("refreshToken"), config.encryptionKey),
    })
    if (refreshed.statusCode < 200 || refreshed.statusCode >= 300 || !refreshed.json?.access_token || !refreshed.json?.refresh_token) {
        throw new Error("Strava rechazó la renovación del permiso. Vuelve a conectar la cuenta.")
    }
    connection.set("accessToken", $security.encrypt(refreshed.json.access_token, config.encryptionKey))
    connection.set("refreshToken", $security.encrypt(refreshed.json.refresh_token, config.encryptionKey))
    connection.set("expiresAt", refreshed.json.expires_at)
    stravaSaveConnection(connection)
    return refreshed.json.access_token
}

module.exports = {
    STRAVA_AUTHORIZE_URL,
    STRAVA_TOKEN_URL,
    STRAVA_API_URL,
    STRAVA_MAX_UPLOAD_BYTES,
    STRAVA_CALLBACK_PATH,
    stravaConfig,
    stravaPostForm,
    stravaFindConnection,
    stravaSaveConnection,
    stravaGetAccessToken,
}
