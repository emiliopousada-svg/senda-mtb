cronAdd("limpiar_cuotas_comunitarias", "*/15 * * * *", () => {
    $app.db()
        .newQuery(`
            DELETE FROM mtb_community_write_quota_events
            WHERE created_at < CAST(strftime('%s', 'now') AS INTEGER) - 86400
        `)
        .execute();
});
