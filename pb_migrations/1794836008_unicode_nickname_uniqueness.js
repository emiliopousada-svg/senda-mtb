function userNicknameKey(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .normalize("NFKC")
        .toLowerCase()
        .normalize("NFKC")
}

migrate((app) => {
    const users = app.findCollectionByNameOrId("users")
    const nickname = users.fields.getByName("nickname")
    if (!nickname || nickname.type() !== "text") {
        throw new Error("users.nickname must be a text field before adding its normalized unique index")
    }

    const records = app.findAllRecords("users")
    const nicknameOwners = Object.create(null)
    for (const record of records) {
        const key = userNicknameKey(record.getString("nickname"))
        if (!key) continue
        if (Object.prototype.hasOwnProperty.call(nicknameOwners, key)) {
            throw new Error(
                "Cannot enforce normalized nickname uniqueness; records "
                + nicknameOwners[key] + " and " + record.id
                + " have colliding nicknames"
            )
        }
        nicknameOwners[key] = record.id
    }

    const nicknameKey = users.fields.getByName("nicknameKey")
    if (nicknameKey && nicknameKey.type() !== "text") {
        throw new Error("users.nicknameKey must be a text field")
    }
    if (!nicknameKey) {
        users.fields.add(new TextField({ name: "nicknameKey", max: 256, hidden: true }))
        app.save(users)
    }

    for (const record of app.findAllRecords("users")) {
        record.set("nicknameKey", userNicknameKey(record.getString("nickname")))
        app.save(record)
    }

    users.indexes = users.indexes.filter((index) =>
        !index.includes("idx_users_nickname_lower")
        && !index.includes("idx_users_nickname_key")
    )
    users.indexes.push(
        "CREATE UNIQUE INDEX idx_users_nickname_key ON users (nicknameKey) WHERE nicknameKey != ''"
    )
    app.save(users)
}, (app) => {
    const users = app.findCollectionByNameOrId("users")
    users.indexes = users.indexes.filter((index) => !index.includes("idx_users_nickname_key"))
    if (!users.indexes.some((index) => index.includes("idx_users_nickname_lower"))) {
        users.indexes.push(
            "CREATE UNIQUE INDEX idx_users_nickname_lower ON users (lower(nickname)) WHERE nickname != ''"
        )
    }
    users.fields.removeByName("nicknameKey")
    app.save(users)
})
