migrate((app) => {
    const ranking = app.findCollectionByNameOrId("mtb_group_ranking_entries")
    const routes = app.findCollectionByNameOrId("routes")
    let changed = false

    const routeField = ranking.fields.getByName("route")
    if (!routeField) {
        ranking.fields.add(new RelationField({
            name: "route",
            required: false,
            maxSelect: 1,
            collectionId: routes.id,
            cascadeDelete: true,
        }))
        changed = true
    } else if (routeField.type() !== "relation" || routeField.collectionId !== routes.id) {
        throw new Error("mtb_group_ranking_entries.route must relate to routes")
    }

    const routeSyncedAtField = ranking.fields.getByName("routeSyncedAt")
    if (!routeSyncedAtField) {
        ranking.fields.add(new DateField({ name: "routeSyncedAt" }))
        changed = true
    } else if (routeSyncedAtField.type() !== "date") {
        throw new Error("mtb_group_ranking_entries.routeSyncedAt must be a date field")
    }

    if (changed) app.save(ranking)
})
