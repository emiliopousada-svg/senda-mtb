const ACCOUNT_DELETE_PASSWORD_QUOTA = "account_delete_password";
const ACCOUNT_DELETE_PASSWORD_ATTEMPT_LIMIT = 5;
const ACCOUNT_DELETE_PASSWORD_WINDOW_SECONDS = 15 * 60;

routerAdd("POST", "/api/mtb/account/logout", (e) => {
    try {
        e.auth.refreshTokenKey();
        $app.save(e.auth);
        return e.json(200, { ok: true });
    } catch (err) {
        const summary = String(err && err.message || "unknown error")
            .replace(/[\r\n]+/g, " ")
            .slice(0, 200);
        console.error("[account/logout] Unexpected failure:", summary);
        return e.json(500, { message: "No se pudo cerrar sesión en todos los dispositivos." });
    }
}, $apis.requireAuth("users"));

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
            const failedAttempts = {};
            txApp.db()
                .newQuery(`
                    SELECT COUNT(*) AS total
                    FROM mtb_community_write_quota_events
                    WHERE owner = {:owner}
                        AND quota = {:quota}
                        AND created_at >= CAST(strftime('%s', 'now') AS INTEGER) - {:windowSeconds}
                `)
                .bind({
                    owner: user.id,
                    quota: ACCOUNT_DELETE_PASSWORD_QUOTA,
                    windowSeconds: ACCOUNT_DELETE_PASSWORD_WINDOW_SECONDS
                })
                .one(failedAttempts);
            if (Number(failedAttempts.total) >= ACCOUNT_DELETE_PASSWORD_ATTEMPT_LIMIT) {
                result = {
                    status: 429,
                    body: { message: "Has superado el límite de intentos. Vuelve a probar más tarde." }
                };
                return;
            }

            if (!user.validatePassword(body.password)) {
                txApp.db()
                    .newQuery(`
                        INSERT INTO mtb_community_write_quota_events (owner, quota, created_at)
                        VALUES ({:owner}, {:quota}, CAST(strftime('%s', 'now') AS INTEGER))
                    `)
                    .bind({ owner: user.id, quota: ACCOUNT_DELETE_PASSWORD_QUOTA })
                    .execute();
                result = { status: 403, body: { message: "La contraseña no es correcta." } };
                return;
            }

            txApp.db()
                .newQuery(`
                    DELETE FROM mtb_community_write_quota_events
                    WHERE owner = {:owner} AND quota = {:quota}
                `)
                .bind({ owner: user.id, quota: ACCOUNT_DELETE_PASSWORD_QUOTA })
                .execute();

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
        const status = Number.isInteger(err && err.status)
            && err.status >= 400 && err.status < 500
            ? err.status
            : 500;
        if (status === 500) {
            const summary = String(err && err.message || "unknown error")
                .replace(/[\r\n]+/g, " ")
                .slice(0, 200);
            console.error("[account/delete] Unexpected failure:", summary);
        }
        return e.json(status, { message: "No se pudo eliminar la cuenta." });
    }
}, $apis.requireAuth("users"));
