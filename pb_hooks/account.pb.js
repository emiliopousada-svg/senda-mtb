routerAdd("POST", "/api/mtb/account/delete", (e) => {
    try {
        const body = new DynamicModel({ password: "" });
        e.bindBody(body);
        if (typeof body.password !== "string" || !body.password) {
            return e.json(400, { message: "Escribe tu contraseña actual para confirmar el borrado." });
        }

        let result;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            if (!user.validatePassword(body.password)) {
                result = { status: 403, body: { message: "La contraseña no es correcta." } };
                return;
            }

            const ownedGroups = txApp.findRecordsByFilter(
                "mtb_groups",
                "owner = {:owner}",
                "",
                1,
                0,
                { owner: user.id }
            );
            if (ownedGroups.length) {
                result = {
                    status: 409,
                    body: { message: "Transfiere la administración o elimina tus grupos antes de borrar la cuenta." }
                };
                return;
            }

            for (const [collection, filter, params] of [
                ["live_locations", "owner = {:owner}", { owner: user.id }],
                ["mtb_group_members", "user = {:user}", { user: user.id }]
            ]) {
                while (true) {
                    const records = txApp.findRecordsByFilter(collection, filter, "", 200, 0, params);
                    if (!records.length) break;
                    records.forEach(record => txApp.delete(record));
                }
            }

            // Deleting the auth record cascades through its owner relations in PocketBase.
            txApp.delete(user);
            result = { status: 200, body: { ok: true } };
        });

        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(400, { message: err.message || "No se pudo eliminar la cuenta." });
    }
}, $apis.requireAuth("users"));
