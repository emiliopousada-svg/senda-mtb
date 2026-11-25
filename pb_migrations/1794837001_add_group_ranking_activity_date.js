migrate((app) => {
    const ranking = app.findCollectionByNameOrId("mtb_group_ranking_entries")
    const activityAt = ranking.fields.getByName("activityAt")

    if (!activityAt) {
        ranking.fields.add(new DateField({ name: "activityAt" }))
        app.save(ranking)
    } else if (activityAt.type() !== "date") {
        throw new Error("mtb_group_ranking_entries.activityAt must be a date field")
    }
})
