// Liga de grupo: desafíos y marcas de tiempo del ranking.
// - Añade created/updated a mtb_group_ranking_entries (no existían, y el ranking por
//   temporada descartaba todas las marcas). Las marcas antiguas usan su clientId como fecha.
// - Crea mtb_group_challenges. Solo se accede mediante los hooks de /api/mtb/groups/*.
// Las temporadas y los títulos se calculan a partir de las marcas; no necesitan colecciones.
migrate((app) => {
    const ranking = app.findCollectionByNameOrId("mtb_group_ranking_entries")
    let rankingChanged = false
    ;[
        { name: "created", onCreate: true, onUpdate: false },
        { name: "updated", onCreate: true, onUpdate: true },
    ].forEach((definition) => {
        const field = ranking.fields.getByName(definition.name)
        if (!field) {
            ranking.fields.add(new AutodateField(definition))
            rankingChanged = true
        } else if (field.type() !== "autodate") {
            throw new Error("mtb_group_ranking_entries." + definition.name + " must be an autodate field")
        }
    })
    if (rankingChanged) app.save(ranking)

    if (app.findAllCollections().find(collection => collection.name === "mtb_group_challenges")) return

    const users = app.findCollectionByNameOrId("users")
    const groups = app.findCollectionByNameOrId("mtb_groups")
    const challenges = new Collection({
        type: "base",
        name: "mtb_group_challenges",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "group", type: "relation", required: true, maxSelect: 1, collectionId: groups.id, cascadeDelete: true },
            { name: "createdBy", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
            { name: "name", type: "text", required: true, min: 3, max: 60 },
            { name: "metric", type: "select", required: true, maxSelect: 1, values: ["distance", "elevation", "activities", "time"] },
            { name: "target", type: "number", required: true, min: 0, max: 1000000 },
            { name: "startsAt", type: "date", required: true },
            { name: "endsAt", type: "date", required: true },
            { name: "created", type: "autodate", onCreate: true, onUpdate: false },
            { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [
            "CREATE INDEX idx_mtb_group_challenges_group ON mtb_group_challenges (`group`)",
        ],
    })
    app.save(challenges)
}, (app) => {
    // The collection may have existed before this migration; preserve it and its data on rollback.
})
