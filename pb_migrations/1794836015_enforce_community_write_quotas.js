function quotaTrigger(name, table, quota, max, windowSeconds, message, when, operation) {
    const triggerEvent = operation || "INSERT";
    const whenClause = when ? `WHEN ${when}` : "";
    return `
        CREATE TRIGGER IF NOT EXISTS ${name}
        BEFORE ${triggerEvent} ON ${table}
        FOR EACH ROW
        ${whenClause}
        BEGIN
            DELETE FROM mtb_community_write_quota_events
            WHERE created_at < CAST(strftime('%s', 'now') AS INTEGER) - 86400;

            SELECT CASE WHEN (
                SELECT COUNT(*)
                FROM mtb_community_write_quota_events
                WHERE owner = NEW.owner
                    AND quota = '${quota}'
                    AND created_at >= CAST(strftime('%s', 'now') AS INTEGER) - ${windowSeconds}
            ) >= ${max}
            THEN RAISE(ABORT, '${message}') END;

            INSERT INTO mtb_community_write_quota_events (owner, quota, created_at)
            VALUES (NEW.owner, '${quota}', CAST(strftime('%s', 'now') AS INTEGER));
        END
    `;
}

migrate((app) => {
    const communityRoutes = app.findCollectionByNameOrId("community_routes");
    if (communityRoutes.fields.getByName("quotaExemptForLimit")) {
        throw new Error("community_routes.quotaExemptForLimit already exists; resolve before applying this migration");
    }
    communityRoutes.fields.add(new BoolField({ name: "quotaExemptForLimit", hidden: true }));
    app.save(communityRoutes);

    app.db().newQuery(`
        CREATE TABLE IF NOT EXISTS mtb_community_write_quota_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            quota TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `).execute();
    app.db().newQuery(`
        CREATE INDEX IF NOT EXISTS idx_mtb_community_write_quota_events_owner_quota_time
        ON mtb_community_write_quota_events (owner, quota, created_at)
    `).execute();

    app.db().newQuery(quotaTrigger(
        "mtb_community_comments_quota_guard",
        "community_route_comments",
        "social",
        10,
        3600,
        "Has alcanzado el límite de 10 comentarios o valoraciones por hora."
    )).execute();
    app.db().newQuery(quotaTrigger(
        "mtb_community_ratings_quota_guard",
        "community_route_ratings",
        "social",
        10,
        3600,
        "Has alcanzado el límite de 10 comentarios o valoraciones por hora."
    )).execute();
    app.db().newQuery(quotaTrigger(
        "mtb_community_routes_quota_guard",
        "community_routes",
        "route",
        5,
        86400,
        "Has alcanzado el límite de 5 rutas comunitarias por día.",
        "NEW.published = 1 AND NEW.quotaExemptForLimit IS NOT 1"
    )).execute();
    app.db().newQuery(quotaTrigger(
        "mtb_community_routes_publish_quota_guard",
        "community_routes",
        "route",
        5,
        86400,
        "Has alcanzado el límite de 5 rutas comunitarias por día.",
        "OLD.published IS NOT 1 AND NEW.published = 1 AND NEW.quotaExemptForLimit IS NOT 1",
        "UPDATE OF published"
    )).execute();
    app.db().newQuery(quotaTrigger(
        "mtb_groups_quota_guard",
        "mtb_groups",
        "group",
        1,
        86400,
        "Has alcanzado el límite de 1 grupo nuevo por día."
    )).execute();
    app.db().newQuery(`
        CREATE TRIGGER IF NOT EXISTS mtb_community_quota_user_delete_cleanup
        AFTER DELETE ON users
        FOR EACH ROW
        BEGIN
            DELETE FROM mtb_community_write_quota_events WHERE owner = OLD.id;
        END
    `).execute();
}, (app) => {
    for (const trigger of [
        "mtb_community_comments_quota_guard",
        "mtb_community_ratings_quota_guard",
        "mtb_community_routes_quota_guard",
        "mtb_community_routes_publish_quota_guard",
        "mtb_groups_quota_guard",
        "mtb_community_quota_user_delete_cleanup"
    ]) {
        app.db().newQuery(`DROP TRIGGER IF EXISTS ${trigger}`).execute();
    }
    app.db().newQuery("DROP TABLE IF EXISTS mtb_community_write_quota_events").execute();
    const communityRoutes = app.findCollectionByNameOrId("community_routes");
    communityRoutes.fields.removeByName("quotaExemptForLimit");
    app.save(communityRoutes);
})
