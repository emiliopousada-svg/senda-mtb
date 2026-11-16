function normalizeRouteAuthor(e) {
    if (e.hasSuperuserAuth()) return e.next()
    if (!e.auth) throw new BadRequestError("Inicia sesión para guardar rutas.")
    if (e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario de la ruta no coincide con la sesión.")
    }

    const user = $app.findRecordById("users", e.auth.id)
    const nickname = user.getString("nickname").trim()
    if (!nickname) throw new BadRequestError("Configura un apodo antes de guardar rutas.")
    e.record.set("createdBy", nickname)
    e.next()
}

onRecordCreateRequest(normalizeRouteAuthor, "routes")
onRecordUpdateRequest(normalizeRouteAuthor, "routes")
