migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    const poisJson = collection.fields.getByName("poisJson")
    const poiPhotos = collection.fields.getByName("poiPhotos")

    if (poisJson && poisJson.type !== "text") {
        throw new Error("community_routes.poisJson must be a text field")
    }
    if (poiPhotos && poiPhotos.type !== "file") {
        throw new Error("community_routes.poiPhotos must be a file field")
    }

    let changed = false
    if (!poisJson) {
        collection.fields.add(new TextField({ name: "poisJson", max: 131072 }))
        changed = true
    }
    if (!poiPhotos) {
        collection.fields.add(new FileField({
            name: "poiPhotos",
            maxSelect: 5,
            maxSize: 614400,
            mimeTypes: ["image/jpeg"],
        }))
        changed = true
    }

    if (changed) app.save(collection)
})
