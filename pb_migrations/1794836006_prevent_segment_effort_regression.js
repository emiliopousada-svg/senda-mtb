migrate((app) => {
    app.db().newQuery(`
        CREATE TRIGGER IF NOT EXISTS community_segment_efforts_best_time_guard
        BEFORE UPDATE OF elapsedSeconds ON community_segment_efforts
        FOR EACH ROW
        WHEN NEW.elapsedSeconds > OLD.elapsedSeconds
        BEGIN
            SELECT RAISE(ABORT, 'The best segment time cannot be increased.');
        END
    `).execute()
}, (app) => {
    app.db().newQuery(
        "DROP TRIGGER IF EXISTS community_segment_efforts_best_time_guard"
    ).execute()
})
