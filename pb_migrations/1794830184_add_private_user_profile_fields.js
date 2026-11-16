function addUserFieldIfMissing(users, name, field) {
    if (!users.fields.getByName(name)) users.fields.add(field)
}

migrate((app) => {
    const users = app.findCollectionByNameOrId("users")

    addUserFieldIfMissing(users, "nickname", new TextField({
        name: "nickname",
        max: 32,
    }))
    addUserFieldIfMissing(users, "weightKg", new NumberField({
        name: "weightKg",
        min: 0,
        max: 250,
    }))
    addUserFieldIfMissing(users, "age", new NumberField({
        name: "age",
        min: 0,
        max: 100,
        onlyInt: true,
    }))
    addUserFieldIfMissing(users, "avatar", new FileField({
        name: "avatar",
        maxSelect: 1,
        maxSize: 262144,
        mimeTypes: ["image/jpeg"],
        thumbs: ["96x96", "256x256"],
    }))

    users.listRule = '@request.auth.id != "" && id = @request.auth.id'
    users.viewRule = '@request.auth.id != "" && id = @request.auth.id'
    users.createRule = '@request.body.groupCode:isset = false'
    users.updateRule = '@request.auth.id != "" && id = @request.auth.id && @request.body.groupCode:isset = false'

    app.save(users)
})
