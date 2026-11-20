migrate((app) => {
    if (app.findAllCollections().some((collection) => collection.name === "community_route_import_state")) return

    const collection = new Collection({
        type: "base",
        name: "community_route_import_state",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            new TextField({ name: "sourcePath", required: true, max: 255 }),
            new TextField({ name: "signature", required: true, max: 128 }),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_community_route_import_state_path ON community_route_import_state (sourcePath)",
        ],
    })
    app.save(collection)
})
