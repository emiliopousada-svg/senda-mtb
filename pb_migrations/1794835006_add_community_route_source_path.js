migrate((app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    let field = collection.fields.getByName("sourcePath")
    if (!field) {
        field = new TextField({ name: "sourcePath", max: 255, hidden: true })
        collection.fields.add(field)
    } else if (field.type() !== "text") {
        throw new Error("community_routes.sourcePath must be a text field")
    }
    collection.indexes = collection.indexes.filter((index) => !index.includes("idx_community_routes_source_path"))
    collection.indexes.push("CREATE UNIQUE INDEX idx_community_routes_source_path ON community_routes (sourcePath) WHERE sourcePath != ''")
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    const field = collection.fields.getByName("sourcePath")
    if (field) collection.fields.removeById(field.id)
    collection.indexes = collection.indexes.filter((index) => !index.includes("idx_community_routes_source_path"))
    app.save(collection)
})
