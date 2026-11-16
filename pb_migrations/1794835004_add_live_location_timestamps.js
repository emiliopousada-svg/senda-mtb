migrate((app) => {
    const collection = app.findCollectionByNameOrId("live_locations")
    let changed = false

    const fields = [
        { name: "created", onCreate: true, onUpdate: false },
        { name: "updated", onCreate: true, onUpdate: true },
    ]

    fields.forEach((definition) => {
        let field = collection.fields.getByName(definition.name)
        if (!field) {
            collection.fields.add(new AutodateField(definition))
            changed = true
            return
        }

        if (field.type() !== "autodate") {
            throw new Error("live_locations." + definition.name + " must be an autodate field")
        }
        if (field.onCreate !== definition.onCreate || field.onUpdate !== definition.onUpdate) {
            field.onCreate = definition.onCreate
            field.onUpdate = definition.onUpdate
            changed = true
        }
    })

    if (changed) app.save(collection)
})
