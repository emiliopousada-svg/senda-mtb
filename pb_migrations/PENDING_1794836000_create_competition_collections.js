// Migración: colecciones de retos grupales y temporadas
// Estado: PENDIENTE DE ACTIVAR — no se ejecuta todavía.
//
// Esta migración crea las colecciones propuestas para el módulo competitivo:
//   - mtb_group_competitions  (retos / desafíos de grupo)
//   - mtb_group_competition_entries (participaciones en un reto)
//   - mtb_group_seasons       (ligas de cuatro semanas)
//   - mtb_group_season_awards (historial de campeones)
//
// INSTRUCCIONES PARA ACTIVAR:
//   1. Despliega el código cliente (UI de retos) y los hooks de servidor correspondientes.
//   2. Renombra este archivo a 1794836000_create_competition_collections.js
//      (o el timestamp que proceda) para que PocketBase lo detecte como migración activa.
//   3. Haz una copia de seguridad del servidor antes de aplicar.
//   4. Ejecuta: pocketbase migrate up

/*
migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    const groups = app.findCollectionByNameOrId("mtb_groups")

    function collectionExists(name) {
        return app.findAllCollections().find(c => c.name === name) || null
    }
    function createIfMissing(definition) {
        if (collectionExists(definition.name)) return
        const collection = new Collection(definition)
        app.save(collection)
    }

    // Retos / desafíos grupales
    createIfMissing({
        type: "base",
        name: "mtb_group_competitions",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "name",        type: "text",   required: true, max: 80 },
            { name: "description", type: "text",   max: 500 },
            { name: "group",       type: "relation", required: true, maxSelect: 1, collectionId: groups.id, cascadeDelete: true },
            { name: "createdBy",   type: "relation", required: true, maxSelect: 1, collectionId: users.id,  cascadeDelete: false },
            { name: "startsAt",    type: "date",   required: true },
            { name: "endsAt",      type: "date",   required: true },
            { name: "targetKm",    type: "number", min: 0, max: 100000 },
            { name: "targetElevM", type: "number", min: 0, max: 100000 },
            { name: "status",      type: "select", maxSelect: 1, values: ["active", "finished", "cancelled"] },
        ],
    })

    const competitions = app.findCollectionByNameOrId("mtb_group_competitions")

    // Participaciones en un reto
    createIfMissing({
        type: "base",
        name: "mtb_group_competition_entries",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "competition", type: "relation", required: true, maxSelect: 1, collectionId: competitions.id, cascadeDelete: true },
            { name: "user",        type: "relation", required: true, maxSelect: 1, collectionId: users.id,        cascadeDelete: false },
            { name: "totalKm",     type: "number", min: 0, max: 100000 },
            { name: "totalElevM",  type: "number", min: 0, max: 100000 },
            { name: "routeCount",  type: "number", min: 0, max: 10000, onlyInt: true },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_comp_entries_comp_user ON mtb_group_competition_entries (competition, user)",
        ],
    })

    // Temporadas (ligas de cuatro semanas)
    createIfMissing({
        type: "base",
        name: "mtb_group_seasons",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "group",    type: "relation", required: true, maxSelect: 1, collectionId: groups.id, cascadeDelete: true },
            { name: "label",    type: "text",   required: true, max: 40 },
            { name: "startsAt", type: "date",   required: true },
            { name: "endsAt",   type: "date",   required: true },
            { name: "status",   type: "select", maxSelect: 1, values: ["active", "finished"] },
        ],
    })

    const seasons = app.findCollectionByNameOrId("mtb_group_seasons")

    // Historial de campeones por temporada
    createIfMissing({
        type: "base",
        name: "mtb_group_season_awards",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "season",    type: "relation", required: true, maxSelect: 1, collectionId: seasons.id, cascadeDelete: true },
            { name: "user",      type: "relation", required: true, maxSelect: 1, collectionId: users.id,   cascadeDelete: false },
            { name: "position",  type: "number", required: true, min: 1, max: 999, onlyInt: true },
            { name: "totalKm",   type: "number", min: 0, max: 100000 },
            { name: "totalElevM",type: "number", min: 0, max: 100000 },
            { name: "routeCount",type: "number", min: 0, max: 10000, onlyInt: true },
        ],
    })
})
*/
