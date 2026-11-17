migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    if (app.findAllCollections().some((collection) => collection.name === "strava_connections")) return

    app.save(new Collection({
        type: "base",
        name: "strava_connections",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "owner", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
            { name: "athleteId", type: "text", max: 32 },
            { name: "athleteName", type: "text", max: 120 },
            { name: "accessToken", type: "text", max: 4096 },
            { name: "refreshToken", type: "text", max: 4096 },
            { name: "expiresAt", type: "number", min: 0, max: 9007199254740991, onlyInt: true },
            { name: "oauthState", type: "text", max: 64 },
            { name: "stateExpiresAt", type: "number", min: 0, max: 9007199254740991, onlyInt: true },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_strava_connections_owner ON strava_connections (owner)"],
    }))
}, (app) => {
    try { app.delete(app.findCollectionByNameOrId("strava_connections")) } catch (_) {}
})
