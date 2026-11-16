migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    const trackJson = collection.fields.getByName("trackJson")

    if (!trackJson || trackJson.type !== "text") {
        throw new Error("community_routes.trackJson must be an existing text field")
    }

    if (!trackJson.max || trackJson.max < 262144) {
        trackJson.max = 262144
        app.save(collection)
    }
})
