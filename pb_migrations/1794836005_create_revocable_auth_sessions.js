function normalizeIndex(index) {
    return String(index || "")
        .replace(/["`\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function indexName(index) {
    const match = /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z0-9_]+))/i.exec(String(index || ""))
    return match ? (match[1] || match[2] || match[3] || match[4]).toLowerCase() : ""
}

function ensureAuthCollection(app, definition) {
    let collection = app.findAllCollections().find((item) => item.name === definition.name)
    if (!collection) {
        collection = new Collection(definition)
        app.save(collection)
        return
    }

    let changed = false
    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
        if (collection[rule] !== null) {
            collection[rule] = null
            changed = true
        }
    }

    for (const field of definition.fields) {
        const existing = collection.fields.getByName(field.name)
        if (!existing) {
            let fieldModel
            if (field.type === "text") fieldModel = new TextField(field)
            else if (field.type === "number") fieldModel = new NumberField(field)
            else if (field.type === "relation") fieldModel = new RelationField(field)
            else if (field.type === "bool") fieldModel = new BoolField(field)
            else throw new Error(`Unsupported field type: ${field.type}`)
            collection.fields.add(fieldModel)
            changed = true
        } else if (existing.type() !== field.type) {
            throw new Error(`${definition.name}.${field.name} must be a ${field.type} field`)
        } else if (field.collectionId && existing.collectionId !== field.collectionId) {
            throw new Error(`${definition.name}.${field.name} must reference ${field.collectionId}`)
        }

        if (existing && field.type === "number" && field.name === "expiresAt") {
            if (existing.max > 0 && existing.max < field.max) {
                existing.max = field.max
                changed = true
            }
            if (existing.min > field.min) {
                existing.min = field.min
                changed = true
            }
        }
        if (existing && field.type === "text" && ["tokenHash", "sourceTokenHash"].includes(field.name)
            && ((existing.max > 0 && existing.max < 64) || existing.min > 64)) {
            throw new Error(`${definition.name}.${field.name} constraints must allow 64-character SHA-256 hashes`)
        }
        if (existing && field.required === false && existing.required !== false) {
            existing.required = false
            changed = true
        }
    }

    for (const index of definition.indexes) {
        const name = indexName(index)
        const existingIndex = collection.indexes.findIndex(item => name && indexName(item) === name)
        if (existingIndex < 0) {
            collection.indexes.push(index)
            changed = true
        } else if (normalizeIndex(collection.indexes[existingIndex]) !== normalizeIndex(index)) {
            collection.indexes[existingIndex] = index
            changed = true
        }
    }

    if (changed) app.save(collection)
}

migrate((app) => {
    const users = app.findCollectionByNameOrId("users")

    let usersChanged = false
    if (users.authToken.duration > 120) {
        users.authToken.duration = 120
        usersChanged = true
    }
    if (users.passwordResetToken.duration > 1800) {
        users.passwordResetToken.duration = 1800
        usersChanged = true
    }
    if (usersChanged) app.save(users)

    ensureAuthCollection(app, {
        type: "base",
        name: "mtb_auth_sessions",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "owner", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
            { name: "tokenHash", type: "text", required: true, max: 64 },
            { name: "sourceTokenHash", type: "text", required: true, max: 64 },
            { name: "expiresAt", type: "number", required: true, min: 0, max: 9007199254740991, onlyInt: true },
            { name: "revoked", type: "bool", required: false },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_auth_sessions_token_hash ON mtb_auth_sessions (tokenHash)",
            "CREATE UNIQUE INDEX idx_mtb_auth_sessions_source_token_hash ON mtb_auth_sessions (sourceTokenHash)",
            "CREATE INDEX idx_mtb_auth_sessions_expiry ON mtb_auth_sessions (expiresAt)",
        ],
    })

    ensureAuthCollection(app, {
        type: "base",
        name: "mtb_auth_rate_limits",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
            { name: "bucketHash", type: "text", required: true, max: 64 },
            { name: "windowStartedAt", type: "number", required: true, min: 0, max: 9007199254740991, onlyInt: true },
            { name: "attemptCount", type: "number", required: false, min: 0, max: 1000000, onlyInt: true },
            { name: "pendingAttemptCount", type: "number", required: false, min: 0, max: 1000000, onlyInt: true },
            { name: "blockedUntil", type: "number", required: false, min: 0, max: 9007199254740991, onlyInt: true },
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_mtb_auth_rate_limits_bucket_hash ON mtb_auth_rate_limits (bucketHash)",
            "CREATE INDEX idx_mtb_auth_rate_limits_expiry ON mtb_auth_rate_limits (blockedUntil)",
        ],
    })

    let offset = 0
    while (true) {
        const records = app.findRecordsByFilter("users", "id != ''", "id", 500, offset)
        if (!records.length) break
        for (const record of records) {
            record.refreshTokenKey()
            app.save(record)
        }
        offset += records.length
    }
}, (_app) => {
    // Keep these collections on downgrade; they may predate this migration and contain live auth data.
})
