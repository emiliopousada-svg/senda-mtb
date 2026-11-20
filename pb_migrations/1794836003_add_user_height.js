migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    if (!users.fields.getByName("heightCm")) {
        users.fields.add(new NumberField({
            name: "heightCm",
            min: 0,
            max: 230,
            onlyInt: true,
        }))
        app.save(users)
    }
})
