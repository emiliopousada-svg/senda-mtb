const VERIFIED_RULE_PREFIX = "(@request.auth.verified = true) && ("
const COMMUNITY_COLLECTIONS = [
    "live_locations",
    "community_routes",
    "community_segments",
    "community_route_efforts",
    "community_segment_efforts",
    "community_route_favorites",
    "community_route_ratings",
    "community_route_comments"
]
const WRITE_RULES = ["createRule", "updateRule", "deleteRule"]

function requireVerified(rule) {
    if (typeof rule !== "string") return rule
    if (rule === "") throw new Error("A public empty write rule must be reviewed before requiring email verification")
    if (rule.startsWith(VERIFIED_RULE_PREFIX) && rule.endsWith(")")) return rule
    return VERIFIED_RULE_PREFIX + rule + ")"
}

function removeVerified(rule) {
    if (typeof rule !== "string" || !rule.startsWith(VERIFIED_RULE_PREFIX) || !rule.endsWith(")")) return rule
    return rule.slice(VERIFIED_RULE_PREFIX.length, -1)
}

migrate((app) => {
    COMMUNITY_COLLECTIONS.forEach((name) => {
        const collection = app.findCollectionByNameOrId(name)
        let changed = false
        WRITE_RULES.forEach((ruleName) => {
            const rule = requireVerified(collection[ruleName])
            if (rule !== collection[ruleName]) {
                collection[ruleName] = rule
                changed = true
            }
        })
        if (changed) app.save(collection)
    })
}, (app) => {
    COMMUNITY_COLLECTIONS.forEach((name) => {
        const collection = app.findCollectionByNameOrId(name)
        let changed = false
        WRITE_RULES.forEach((ruleName) => {
            const rule = removeVerified(collection[ruleName])
            if (rule !== collection[ruleName]) {
                collection[ruleName] = rule
                changed = true
            }
        })
        if (changed) app.save(collection)
    })
})
