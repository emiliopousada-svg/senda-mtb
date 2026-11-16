const normalizeLiveLocationName = (e) => {
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para compartir tu posición.");
    if (e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario de la posición no coincide con la sesión.");
    }

    let user;
    try { user = $app.findRecordById("users", e.auth.id); }
    catch (error) { throw new BadRequestError("No se pudo encontrar la cuenta del propietario."); }
    const nickname = user.getString("nickname").trim();
    if (!nickname) throw new BadRequestError("Configura un apodo antes de compartir tu posición.");
    e.record.set("name", nickname);
    e.next();
};

onRecordCreateRequest(normalizeLiveLocationName, "live_locations");
onRecordUpdateRequest(normalizeLiveLocationName, "live_locations");
