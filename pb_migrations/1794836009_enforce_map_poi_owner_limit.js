migrate((app) => {
    const collection = app.findCollectionByNameOrId("map_pois")
    const quotaExempt = collection.fields.getByName("quotaExemptForLimit")
    if (quotaExempt) {
        throw new Error("map_pois.quotaExemptForLimit already exists; resolve before applying this migration")
    }
    collection.fields.add(new BoolField({ name: "quotaExemptForLimit", hidden: true }))
    app.save(collection)

    app.db().newQuery(`
        CREATE TRIGGER IF NOT EXISTS map_pois_owner_limit_guard
        BEFORE INSERT ON map_pois
        FOR EACH ROW
        WHEN NEW.quotaExemptForLimit IS NOT 1
            AND (SELECT COUNT(*) FROM map_pois WHERE owner = NEW.owner) >= 500
        BEGIN
            SELECT RAISE(ABORT, 'map_pois_owner_limit_reached');
        END
    `).execute()
}, (app) => {
    app.db().newQuery(
        "DROP TRIGGER IF EXISTS map_pois_owner_limit_guard"
    ).execute()

    const collection = app.findCollectionByNameOrId("map_pois")
    collection.fields.removeByName("quotaExemptForLimit")
    app.save(collection)
})
