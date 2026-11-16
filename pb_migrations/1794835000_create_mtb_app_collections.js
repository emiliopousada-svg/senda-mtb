function collectionExists(app, name) {
    return app.findAllCollections().find(collection => collection.name === name) || null
}

function createCollectionIfMissing(app, definition) {
    const existing = collectionExists(app, definition.name)
    if (existing) return existing

    const collection = new Collection(definition)
    app.save(collection)
    return collection
}

function relationField(name, collectionId, required = true, cascadeDelete = true) {
    return {
        name,
        type: "relation",
        required,
        maxSelect: 1,
        collectionId,
        cascadeDelete,
    }
}

function numberField(name, min, max, onlyInt = false) {
    const field = { name, type: "number", min, max }
    if (onlyInt) field.onlyInt = true
    return field
}

migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    if (!users.fields.getByName("groupCode")) {
        users.fields.add(new TextField({ name: "groupCode", max: 15 }))
        app.save(users)
    }

    const ownerOnly = '@request.auth.id != "" && owner = @request.auth.id'
    const ownerCreate = '@request.auth.id != "" && @request.body.owner = @request.auth.id'
    const ownerUpdate = `${ownerOnly} && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)`
    const liveLocationMemberRule = '@request.auth.id != "" && @request.auth.groupCode != "" && groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id'
    const liveLocationCreateRule = '@request.auth.id != "" && @request.auth.groupCode != "" && @request.body.owner = @request.auth.id && @request.body.groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= @request.body.groupCode && @collection.mtb_group_members.user ?= @request.auth.id'
    const liveLocationUpdateRule = '@request.auth.id != "" && owner = @request.auth.id && groupCode = @request.auth.groupCode && @request.body.owner:changed = false && @request.body.groupCode:changed = false && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id'

    createCollectionIfMissing(app, {
        type: "base",
        name: "routes",
        listRule: ownerOnly,
        viewRule: ownerOnly,
        createRule: ownerCreate,
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            { name: "clientId", type: "number", required: true, min: 0, max: 9007199254740991, onlyInt: true },
            { name: "name", type: "text", required: true, max: 120 },
            { name: "createdBy", type: "text", max: 32 },
            { name: "kind", type: "text", max: 24 },
            { name: "startedAt", type: "date" },
            numberField("movingTimeSec", 0, 604800),
            numberField("distanceKm", 0, 100000),
            numberField("elevationGain", 0, 100000),
            numberField("hrAvg", 0, 250),
            { name: "activityType", type: "text", max: 32 },
            {
                name: "track",
                type: "file",
                required: true,
                maxSelect: 1,
                maxSize: 26214400,
                mimeTypes: ["application/json"],
            },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_routes_owner_client_id ON routes (owner, clientId)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "map_pois",
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: ownerCreate,
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            { name: "clientId", type: "text", required: true, max: 64 },
            {
                name: "type",
                type: "select",
                required: true,
                maxSelect: 1,
                values: ["fountain", "bar", "food"],
            },
            { name: "name", type: "text", required: true, max: 100 },
            numberField("lat", -90, 90),
            numberField("lng", -180, 180),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_map_pois_owner_client_id ON map_pois (owner, clientId)",
        ],
    })

    const groups = createCollectionIfMissing(app, {
        type: "base",
        name: "mtb_groups",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "name", type: "text", required: true, max: 40 },
            relationField("owner", users.id),
            {
                name: "icon",
                type: "file",
                maxSelect: 1,
                maxSize: 262144,
                mimeTypes: ["image/jpeg"],
            },
            { name: "inviteCode", type: "text", required: true, min: 12, max: 12 },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_groups_invite_code ON mtb_groups (inviteCode)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "mtb_group_members",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            relationField("group", groups.id),
            relationField("user", users.id),
            { name: "nickname", type: "text", max: 32 },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_group_members_group_user ON mtb_group_members (group, user)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "live_locations",
        listRule: liveLocationMemberRule,
        viewRule: liveLocationMemberRule,
        createRule: liveLocationCreateRule,
        updateRule: liveLocationUpdateRule,
        deleteRule: '@request.auth.id != "" && owner = @request.auth.id',
        fields: [
            relationField("owner", users.id),
            relationField("groupCode", groups.id),
            { name: "name", type: "text", required: true, max: 32 },
            numberField("lat", -90, 90),
            numberField("lon", -180, 180),
            numberField("accuracy", 0, 10000),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_live_locations_owner ON live_locations (owner)",
            "CREATE INDEX idx_live_locations_group_code ON live_locations (groupCode)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "mtb_group_ranking_entries",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            relationField("group", groups.id),
            relationField("owner", users.id),
            { name: "clientId", type: "number", required: true, min: 1, max: 9007199254740991, onlyInt: true },
            numberField("distanceKm", 0, 1000),
            numberField("movingTimeSec", 0, 604800, true),
            numberField("maxSpeedKmh", 0, 150),
            numberField("elevationGain", 0, 10000),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_group_ranking_entries_owner_client ON mtb_group_ranking_entries (group, owner, clientId)",
        ],
    })

    const communityRoutes = createCollectionIfMissing(app, {
        type: "base",
        name: "community_routes",
        listRule: "published = true",
        viewRule: "published = true",
        createRule: ownerCreate,
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            { name: "title", type: "text", required: true, max: 100 },
            { name: "province", type: "text", required: true, max: 80 },
            { name: "locality", type: "text", max: 80 },
            { name: "description", type: "text", max: 500 },
            {
                name: "difficulty",
                type: "select",
                maxSelect: 1,
                values: ["easy", "moderate", "hard", "very-hard"],
            },
            { name: "activityType", type: "text", max: 32 },
            numberField("distanceKm", 0, 100000),
            numberField("elevationGain", 0, 100000),
            numberField("movingTimeSec", 0, 604800, true),
            { name: "performedAt", type: "date" },
            { name: "trackJson", type: "text", required: true, max: 262144 },
            { name: "poisJson", type: "text", max: 131072 },
            { name: "published", type: "bool" },
            {
                name: "poiPhotos",
                type: "file",
                maxSelect: 5,
                maxSize: 614400,
                mimeTypes: ["image/jpeg"],
            },
            numberField("minLat", -90, 90),
            numberField("maxLat", -90, 90),
            numberField("minLng", -180, 180),
            numberField("maxLng", -180, 180),
        ],
        indexes: [
            "CREATE INDEX idx_community_routes_published ON community_routes (published)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_segments",
        listRule: "route.published = true",
        viewRule: "route.published = true",
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && route.published = true',
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("route", communityRoutes.id),
            { name: "title", type: "text", required: true, max: 80 },
            { name: "trackJson", type: "text", required: true },
            numberField("distanceKm", 0, 1000),
        ],
        indexes: [
            "CREATE INDEX idx_community_segments_route ON community_segments (route)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_route_efforts",
        listRule: "route.published = true",
        viewRule: "route.published = true",
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && route.published = true',
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("route", communityRoutes.id),
            { name: "alias", type: "text", required: true, max: 32 },
            numberField("elapsedSeconds", 1, 86400, true),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_community_route_efforts_owner_route ON community_route_efforts (owner, route)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_segment_efforts",
        listRule: "segment.route.published = true",
        viewRule: "segment.route.published = true",
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && segment.route.published = true',
        updateRule: ownerUpdate,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("segment", app.findCollectionByNameOrId("community_segments").id),
            { name: "alias", type: "text", required: true, max: 32 },
            numberField("elapsedSeconds", 1, 86400, true),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_community_segment_efforts_owner_segment ON community_segment_efforts (owner, segment)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_route_favorites",
        listRule: ownerOnly,
        viewRule: ownerOnly,
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && route.published = true',
        updateRule: null,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("route", communityRoutes.id),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_community_route_favorites_owner_route ON community_route_favorites (owner, route)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_route_ratings",
        listRule: "route.published = true",
        viewRule: "route.published = true",
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && route.published = true',
        updateRule: `${ownerUpdate} && route.published = true`,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("route", communityRoutes.id),
            numberField("rating", 1, 5, true),
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_community_route_ratings_owner_route ON community_route_ratings (owner, route)",
        ],
    })

    createCollectionIfMissing(app, {
        type: "base",
        name: "community_route_comments",
        listRule: "route.published = true",
        viewRule: "route.published = true",
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && route.published = true',
        updateRule: null,
        deleteRule: ownerOnly,
        fields: [
            relationField("owner", users.id),
            relationField("route", communityRoutes.id),
            { name: "alias", type: "text", required: true, max: 32 },
            { name: "comment", type: "text", required: true, max: 500 },
        ],
        indexes: [
            "CREATE INDEX idx_community_route_comments_route ON community_route_comments (route)",
        ],
    })
})
