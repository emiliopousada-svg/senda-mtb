migrate((app) => {
    const definitions = [
        { collection: "routes", field: "createdBy", ownerField: "owner" },
        { collection: "map_pois", field: "createdBy", ownerField: "owner" },
        { collection: "community_routes", field: "createdBy", ownerField: "owner" },
        { collection: "community_segments", field: "createdBy", ownerField: "owner" },
        { collection: "community_route_ratings", field: "alias", ownerField: "owner" },
        { collection: "community_route_comments", field: "alias", ownerField: "owner" },
        { collection: "community_route_efforts", field: "alias", ownerField: "owner" },
        { collection: "community_segment_efforts", field: "alias", ownerField: "owner" },
        { collection: "live_locations", field: "name", ownerField: "owner" },
        { collection: "mtb_group_members", field: "nickname", ownerField: "user" },
    ]

    definitions.forEach((definition) => {
        const collection = app.findCollectionByNameOrId(definition.collection)
        let field = collection.fields.getByName(definition.field)
        let changed = false
        if (!field) {
            field = new TextField({ name: definition.field, max: 32 })
            collection.fields.add(field)
            changed = true
        } else if (field.type() !== "text") {
            throw new Error(definition.collection + "." + definition.field + " must be a text field")
        } else if (field.max > 0 && field.max < 32) {
            field.max = 32
            changed = true
        }
        if (changed) app.save(collection)
    })

    const nicknames = new Map()
    const nicknameFor = (ownerId) => {
        if (!ownerId) return ""
        if (!nicknames.has(ownerId)) {
            const user = app.findRecordById("users", ownerId)
            nicknames.set(ownerId, user.getString("nickname").trim().slice(0, 32))
        }
        return nicknames.get(ownerId)
    }

    definitions.forEach((definition) => {
        const pageSize = 200
        let offset = 0
        while (true) {
            const records = app.findRecordsByFilter(
                definition.collection,
                'id != ""',
                "id",
                pageSize,
                offset
            )
            if (!records.length) break
            records.forEach((record) => {
                const nickname = nicknameFor(record.getString(definition.ownerField))
                if (nickname && record.getString(definition.field) !== nickname) {
                    record.set(definition.field, nickname)
                    app.save(record)
                }
            })
            offset += records.length
            if (records.length < pageSize) break
        }
    })
})
