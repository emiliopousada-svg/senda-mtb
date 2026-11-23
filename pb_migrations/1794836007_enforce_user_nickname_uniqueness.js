migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    const nickname = users.fields.getByName("nickname")
    if (!nickname || nickname.type() !== "text") {
        throw new Error("users.nickname must be a text field before adding its unique index")
    }

    users.indexes = users.indexes.filter((index) => !index.includes("idx_users_nickname_lower"))
    users.indexes.push("CREATE UNIQUE INDEX idx_users_nickname_lower ON users (lower(nickname)) WHERE nickname != ''")
    app.save(users)
}, (app) => {
    const users = app.findCollectionByNameOrId("users")
    users.indexes = users.indexes.filter((index) => !index.includes("idx_users_nickname_lower"))
    app.save(users)
})
