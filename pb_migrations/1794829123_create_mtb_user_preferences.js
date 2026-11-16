migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    const collection = new Collection({
        type: "base",
        name: "mtb_user_preferences",
        listRule: '@request.auth.id != "" && owner = @request.auth.id',
        viewRule: '@request.auth.id != "" && owner = @request.auth.id',
        createRule: '@request.auth.id != "" && owner = @request.auth.id',
        updateRule: '@request.auth.id != "" && owner = @request.auth.id',
        deleteRule: '@request.auth.id != "" && owner = @request.auth.id',
        fields: [
            {
                name: "owner",
                type: "relation",
                required: true,
                maxSelect: 1,
                collectionId: users.id,
                cascadeDelete: true,
            },
            {
                name: "preferences",
                type: "json",
                required: true,
                maxSize: 65536,
            },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_user_preferences_owner ON mtb_user_preferences (owner)",
        ],
    })

    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("mtb_user_preferences")
    app.delete(collection)
})
