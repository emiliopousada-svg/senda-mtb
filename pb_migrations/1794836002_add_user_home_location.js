migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    let homeLocation = users.fields.getByName("homeLocation")

    if (!homeLocation) {
        homeLocation = new TextField({
            name: "homeLocation",
            max: 80,
        })
        users.fields.add(homeLocation)
        app.save(users)
        return
    }

    if (homeLocation.type() !== "text") {
        throw new Error("users.homeLocation must be a text field")
    }
    if (homeLocation.max !== 80) {
        homeLocation.max = 80
        app.save(users)
    }
})
