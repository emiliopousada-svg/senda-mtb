// Integración Strava: credenciales y tokens viven exclusivamente en el servidor.
// Los helpers están en strava_utils.js y se cargan con require() dentro de cada handler.

routerAdd("GET", "/api/mtb/strava/status", (e) => {
    const { stravaFindConnection } = require(`${__hooks}/strava_utils.js`)
    try {
        const connection = stravaFindConnection(e.auth.id)
        return e.json(200, {
            connected: !!(connection && connection.getString("refreshToken")),
            athleteName: connection ? connection.getString("athleteName") : "",
        })
    } catch (error) {
        return e.json(503, { message: error.message || "No se pudo consultar Strava." })
    }
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/mtb/strava/connect", (e) => {
    const { STRAVA_AUTHORIZE_URL, stravaConfig, stravaFindConnection, stravaSaveConnection } = require(`${__hooks}/strava_utils.js`)
    try {
        const config = stravaConfig()
        const state = $security.randomStringWithAlphabet(48, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        let connection = stravaFindConnection(e.auth.id)
        if (!connection) {
            connection = new Record($app.findCollectionByNameOrId("strava_connections"))
            connection.set("owner", e.auth.id)
        }
        connection.set("oauthState", state)
        connection.set("stateExpiresAt", Math.floor(Date.now() / 1000) + 600)
        stravaSaveConnection(connection)
        const query = [
            "client_id=" + encodeURIComponent(config.clientId),
            "redirect_uri=" + encodeURIComponent(config.redirectUri),
            "response_type=code",
            "approval_prompt=auto",
            "scope=" + encodeURIComponent("activity:write"),
            "state=" + encodeURIComponent(state),
        ].join("&")
        return e.json(200, { url: STRAVA_AUTHORIZE_URL + "?" + query })
    } catch (error) {
        return e.json(503, { message: error.message || "No se pudo iniciar la conexión con Strava." })
    }
}, $apis.requireAuth("users"))

routerAdd("GET", "/api/mtb/strava/callback", (e) => {
    const { STRAVA_TOKEN_URL, stravaConfig, stravaPostForm, stravaSaveConnection } = require(`${__hooks}/strava_utils.js`)
    const state = String(e.request.url.query().get("state") || "")
    const code = String(e.request.url.query().get("code") || "")
    const grantedScope = String(e.request.url.query().get("scope") || "")
    const denied = String(e.request.url.query().get("error") || "")
    const escapeHtml = (value) => String(value).replace(/[&<>\"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    })[character])
    const finish = (ok, message) => e.html(ok ? 200 : 400,
        "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>senda-mtb · Strava</title><body style=\"font:16px system-ui;background:#121212;color:#fff;padding:2rem;max-width:34rem;margin:auto\"><h1>" +
        (ok ? "Strava conectado" : "No se pudo conectar Strava") + "</h1><p>" + escapeHtml(message) + "</p><p>Vuelve a senda-mtb y pulsa «Actualizar estado».</p></body></html>")
    if (denied) return finish(false, "Has cancelado o rechazado el permiso.")
    if (!state || !code) return finish(false, "Falta la confirmación de Strava.")
    if (!grantedScope.split(/[\s,]+/).includes("activity:write")) {
        return finish(false, "Debes aceptar el permiso de escritura de actividades para conectar Strava.")
    }
    let connection
    try {
        connection = $app.findFirstRecordByData("strava_connections", "oauthState", state)
        if (connection.getInt("stateExpiresAt") < Date.now() / 1000) throw new Error("La autorización ha caducado; inténtalo de nuevo.")
        const config = stravaConfig()
        const token = stravaPostForm(STRAVA_TOKEN_URL, {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            grant_type: "authorization_code",
        })
        if (token.statusCode < 200 || token.statusCode >= 300 || !token.json?.access_token || !token.json?.refresh_token) {
            throw new Error("Strava no aceptó el intercambio de autorización.")
        }
        connection.set("athleteId", String(token.json.athlete?.id || ""))
        connection.set("athleteName", [token.json.athlete?.firstname, token.json.athlete?.lastname].filter(Boolean).join(" ").slice(0, 120))
        connection.set("accessToken", $security.encrypt(token.json.access_token, config.encryptionKey))
        connection.set("refreshToken", $security.encrypt(token.json.refresh_token, config.encryptionKey))
        connection.set("expiresAt", token.json.expires_at)
        connection.set("oauthState", "")
        connection.set("stateExpiresAt", 0)
        stravaSaveConnection(connection)
        return finish(true, "Ya puedes subir tus salidas grabadas.")
    } catch (error) {
        if (connection) {
            try { connection.set("oauthState", ""); connection.set("stateExpiresAt", 0); stravaSaveConnection(connection) } catch (_) {}
        }
        return finish(false, error.message || "Error durante la autorización.")
    }
})

routerAdd("POST", "/api/mtb/strava/upload", (e) => {
    const { STRAVA_API_URL, STRAVA_MAX_UPLOAD_BYTES, stravaConfig, stravaFindConnection, stravaGetAccessToken } = require(`${__hooks}/strava_utils.js`)
    try {
        const config = stravaConfig()
        const connection = stravaFindConnection(e.auth.id)
        if (!connection || !connection.getString("refreshToken")) return e.json(409, { message: "Conecta primero tu cuenta de Strava." })
        const body = e.requestInfo().body || {}
        const routeId = String(body.routeId || "")
        const name = String(body.name || "Salida MTB").trim().slice(0, 120) || "Salida MTB"
        const visibility = body.visibility === "followers_only" ? "followers_only" : "only_me"
        if (!/^\d{1,16}$/.test(routeId)) return e.json(400, { message: "La salida seleccionada no es válida." })
        const files = e.findUploadedFiles("file") || []
        if (files.length !== 1) return e.json(400, { message: "Adjunta un archivo GPX para la salida." })
        const gpx = files[0]
        if (gpx.size > STRAVA_MAX_UPLOAD_BYTES) return e.json(413, { message: "El archivo GPX supera el límite de 8 MB." })
        if (!/\.gpx$/i.test(gpx.name)) return e.json(400, { message: "El archivo adjunto debe tener formato GPX." })
        const token = stravaGetAccessToken(connection, config)
        const form = new FormData()
        form.append("file", gpx)
        form.append("data_type", "gpx")
        form.append("name", name)
        form.append("visibility", visibility)
        form.append("external_id", "senda-mtb-" + e.auth.id + "-" + routeId)
        const result = $http.send({
            url: STRAVA_API_URL + "/uploads",
            method: "POST",
            timeout: 45,
            headers: { Authorization: "Bearer " + token },
            body: form,
        })
        if (result.statusCode < 200 || result.statusCode >= 300) {
            return e.json(result.statusCode === 429 ? 429 : 502, { message: "Strava no aceptó el GPX. Comprueba la actividad e inténtalo de nuevo." })
        }
        return e.json(200, { uploadId: result.json?.id, status: result.json?.status || "processing" })
    } catch (error) {
        return e.json(503, { message: error.message || "No se pudo subir la actividad a Strava." })
    }
}, $apis.requireAuth("users"))

routerAdd("GET", "/api/mtb/strava/upload/{id}", (e) => {
    const { STRAVA_API_URL, stravaConfig, stravaFindConnection, stravaGetAccessToken } = require(`${__hooks}/strava_utils.js`)
    try {
        if (!/^\d+$/.test(e.request.pathValue("id"))) return e.json(400, { message: "Subida no válida." })
        const config = stravaConfig()
        const connection = stravaFindConnection(e.auth.id)
        if (!connection || !connection.getString("refreshToken")) return e.json(409, { message: "Conecta primero tu cuenta de Strava." })
        const token = stravaGetAccessToken(connection, config)
        const result = $http.send({
            url: STRAVA_API_URL + "/uploads/" + e.request.pathValue("id"),
            method: "GET",
            timeout: 15,
            headers: { Authorization: "Bearer " + token },
        })
        if (result.statusCode < 200 || result.statusCode >= 300) return e.json(502, { message: "No se pudo consultar el procesamiento de Strava." })
        return e.json(200, { status: result.json?.status || "", error: result.json?.error || "", activityId: result.json?.activity_id || null })
    } catch (error) {
        return e.json(503, { message: error.message || "No se pudo consultar el procesamiento de Strava." })
    }
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/mtb/strava/disconnect", (e) => {
    const { stravaConfig, stravaFindConnection } = require(`${__hooks}/strava_utils.js`)
    const connection = stravaFindConnection(e.auth.id)
    if (!connection) return e.json(200, { connected: false })
    try {
        const config = stravaConfig()
        const accessToken = connection.getString("accessToken")
        if (accessToken) {
            const token = $security.decrypt(accessToken, config.encryptionKey)
            $http.send({
                url: "https://www.strava.com/oauth/deauthorize?access_token=" + encodeURIComponent(token),
                method: "POST",
                timeout: 15,
            })
        }
    } catch (error) {
        // A disconnect from the app still removes the local credentials if Strava is unreachable.
        console.warn("No se pudo revocar inmediatamente el permiso de Strava:", error.message)
    }
    $app.delete(connection)
    return e.json(200, { connected: false })
}, $apis.requireAuth("users"))
