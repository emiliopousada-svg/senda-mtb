// Repara la colección de estado del importador cuando se creó antes sin sus campos.
// Los campos quedan opcionales para conservar registros preexistentes al migrar.
migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_route_import_state")
    let changed = false

    const sourcePath = collection.fields.getByName("sourcePath")
    if (!sourcePath) {
        collection.fields.add(new TextField({ name: "sourcePath", max: 255 }))
        changed = true
    } else if (sourcePath.type() !== "text") {
        throw new Error("community_route_import_state.sourcePath must be a text field")
    } else if (sourcePath.max !== 255) {
        sourcePath.max = 255
        changed = true
    }

    const signature = collection.fields.getByName("signature")
    if (!signature) {
        collection.fields.add(new TextField({ name: "signature", max: 128 }))
        changed = true
    } else if (signature.type() !== "text") {
        throw new Error("community_route_import_state.signature must be a text field")
    } else if (signature.max !== 128) {
        signature.max = 128
        changed = true
    }

    const indexName = "idx_community_route_import_state_path"
    const index = "CREATE UNIQUE INDEX " + indexName
        + " ON community_route_import_state (sourcePath) WHERE sourcePath != ''"
    if (!collection.indexes.some((item) => item.includes(indexName))) {
        collection.indexes.push(index)
        changed = true
    }

    if (changed) app.save(collection)
})
