migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    let trackJson = collection.fields.getByName("trackJson")
    let changed = false

    if (!trackJson) {
        trackJson = new TextField({ name: "trackJson", max: 262144 })
        collection.fields.add(trackJson)
        changed = true
    } else if (trackJson.type !== "text") {
        throw new Error("community_routes.trackJson must be a text field")
    }

    if (!trackJson.max || trackJson.max < 262144) {
        trackJson.max = 262144
        changed = true
    }

    if (changed) {
        app.save(collection)
    }
})
