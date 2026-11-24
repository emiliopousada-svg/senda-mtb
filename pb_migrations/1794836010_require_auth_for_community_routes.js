const rules = {
    community_routes: {
        list: '@request.auth.id != "" && published = true',
        view: '@request.auth.id != "" && published = true',
        previousList: "published = true",
        previousView: "published = true",
    },
    community_segments: {
        list: '@request.auth.id != "" && route.published = true',
        view: '@request.auth.id != "" && route.published = true',
        previousList: "route.published = true",
        previousView: "route.published = true",
    },
    community_route_efforts: {
        list: '@request.auth.id != "" && route.published = true',
        view: '@request.auth.id != "" && route.published = true',
        previousList: "route.published = true",
        previousView: "route.published = true",
    },
    community_segment_efforts: {
        list: '@request.auth.id != "" && segment.route.published = true',
        view: '@request.auth.id != "" && segment.route.published = true',
        previousList: "segment.route.published = true",
        previousView: "segment.route.published = true",
    },
    community_route_ratings: {
        list: '@request.auth.id != "" && route.published = true',
        view: '@request.auth.id != "" && route.published = true',
        previousList: "route.published = true",
        previousView: "route.published = true",
    },
    community_route_comments: {
        list: '@request.auth.id != "" && route.published = true',
        view: '@request.auth.id != "" && route.published = true',
        previousList: "route.published = true",
        previousView: "route.published = true",
    },
};

migrate((app) => {
    Object.entries(rules).forEach(([name, access]) => {
        const collection = app.findCollectionByNameOrId(name);
        if (collection.listRule === access.list && collection.viewRule === access.view) return;
        collection.listRule = access.list;
        collection.viewRule = access.view;
        app.save(collection);
    });
}, (app) => {
    Object.entries(rules).forEach(([name, access]) => {
        const collection = app.findCollectionByNameOrId(name);
        if (collection.listRule === access.previousList && collection.viewRule === access.previousView) return;
        collection.listRule = access.previousList;
        collection.viewRule = access.previousView;
        app.save(collection);
    });
});
