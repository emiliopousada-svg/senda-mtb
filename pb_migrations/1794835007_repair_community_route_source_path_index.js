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
    // Las publicaciones normales no usan sourcePath y comparten el valor vacío.
    // Solo los registros importados desde archivos necesitan unicidad.
    collection.indexes.push("CREATE UNIQUE INDEX idx_community_routes_source_path ON community_routes (sourcePath) WHERE sourcePath != ''")
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("community_routes")
    collection.indexes = collection.indexes.filter((index) => !index.includes("idx_community_routes_source_path"))
    app.save(collection)
})
