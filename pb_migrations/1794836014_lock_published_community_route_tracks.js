migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    let field = collection.fields.getByName("trackLocked")
    let changed = false
    if (!field) {
        field = new BoolField({ name: "trackLocked", hidden: true })
        collection.fields.add(field)
        changed = true
    } else if (field.type() !== "bool") {
        throw new Error("community_routes.trackLocked must be a bool field")
    }
    if (changed) app.save(collection)

    const pageSize = 200
    let offset = 0
    while (true) {
        const records = app.findRecordsByFilter("community_routes", 'id != ""', "id", pageSize, offset)
        if (!records.length) break
        for (const record of records) {
            if (!record.getBool("trackLocked")) {
                record.set("trackLocked", true)
                app.save(record)
            }
        }
        offset += records.length
        if (records.length < pageSize) break
    }
}, (app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    const field = collection.fields.getByName("trackLocked")
    if (field) {
        collection.fields.removeById(field.id)
        app.save(collection)
    }
})
