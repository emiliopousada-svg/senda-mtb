migrate((app) => {
    const collection = app.findCollectionByNameOrId("routes")
    const track = collection.fields.getByName("track")

    if (!track) throw new Error("routes.track field is missing")
    if (track.type() !== "file") throw new Error("routes.track must be a file field")

    if (!track.protected) {
        track.protected = true
        app.save(collection)
    }
})
