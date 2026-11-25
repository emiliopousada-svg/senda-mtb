// Fija en el servidor el alias público de los comentarios de rutas, igual que ya se hace con
// las marcas en community_performance.pb.js: el cliente no puede publicar con el nombre de otra
// persona porque el alias se deriva siempre del id de la cuenta autenticada.
// El handler es autosuficiente porque PocketBase ejecuta cada handler en un runtime aislado.
const normalizeCommunityAlias = (e) => {
    if (e.hasSuperuserAuth()) return e.next();
    if (!e.auth) throw new BadRequestError("Inicia sesión para publicar.");
    if (e.record.getString("owner") !== e.auth.id) {
        throw new BadRequestError("El propietario del registro no coincide con la sesión.");
    }
    if (e.record.isNew()) {
        const { enforceCommunityWriteQuota } = require(`${__hooks}/community_quota_utils.js`);
        enforceCommunityWriteQuota($app, e.auth.id, "social");
    }
    let user;
    try { user = $app.findRecordById("users", e.auth.id); }
    catch (error) { throw new BadRequestError("No se pudo encontrar la cuenta del propietario."); }
    const nickname = user.getString("nickname").trim();
    if (!nickname) throw new BadRequestError("Configura un apodo antes de publicar.");
    e.record.set("alias", nickname);
    e.next();
};

onRecordCreateRequest(normalizeCommunityAlias, "community_route_comments", "community_route_ratings");
onRecordUpdateRequest(normalizeCommunityAlias, "community_route_comments", "community_route_ratings");
