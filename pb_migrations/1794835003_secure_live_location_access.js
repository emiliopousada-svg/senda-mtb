migrate((app) => {
    const collection = app.findCollectionByNameOrId("live_locations")
    const memberRule = '@request.auth.id != "" && @request.auth.groupCode != "" && groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id'
    const createRule = '@request.auth.id != "" && @request.auth.groupCode != "" && @request.body.owner = @request.auth.id && @request.body.groupCode = @request.auth.groupCode && @collection.mtb_group_members.group ?= @request.body.groupCode && @collection.mtb_group_members.user ?= @request.auth.id'
    const updateRule = '@request.auth.id != "" && owner = @request.auth.id && groupCode = @request.auth.groupCode && @request.body.owner:changed = false && @request.body.groupCode:changed = false && @collection.mtb_group_members.group ?= groupCode && @collection.mtb_group_members.user ?= @request.auth.id'

    let changed = false
    if (collection.listRule !== memberRule) {
        collection.listRule = memberRule
        changed = true
    }
    if (collection.viewRule !== memberRule) {
        collection.viewRule = memberRule
        changed = true
    }
    if (collection.createRule !== createRule) {
        collection.createRule = createRule
        changed = true
    }
    if (collection.updateRule !== updateRule) {
        collection.updateRule = updateRule
        changed = true
    }
    const deleteRule = '@request.auth.id != "" && owner = @request.auth.id'
    if (collection.deleteRule !== deleteRule) {
        collection.deleteRule = deleteRule
        changed = true
    }

    if (changed) app.save(collection)
})
