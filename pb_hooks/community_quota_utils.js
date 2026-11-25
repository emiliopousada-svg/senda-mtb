const COMMUNITY_WRITE_QUOTAS = {
    social: {
        max: 10,
        windowSeconds: 3600,
        message: "Has alcanzado el límite de 10 comentarios o valoraciones por hora."
    },
    route: {
        max: 5,
        windowSeconds: 86400,
        message: "Has alcanzado el límite de 5 rutas comunitarias por día."
    },
    group: {
        max: 1,
        windowSeconds: 86400,
        message: "Has alcanzado el límite de 1 grupo nuevo por día."
    }
};

function enforceCommunityWriteQuota(app, ownerId, quotaName) {
    const quota = COMMUNITY_WRITE_QUOTAS[quotaName];
    if (!quota) throw new Error("La cuota comunitaria solicitada no existe.");

    const result = new DynamicModel({ total: 0 });
    app.db()
        .newQuery(`
            SELECT COUNT(*) AS total
            FROM mtb_community_write_quota_events
            WHERE owner = {:owner}
                AND quota = {:quota}
                AND created_at >= CAST(strftime('%s', 'now') AS INTEGER) - {:windowSeconds}
        `)
        .bind({ owner: ownerId, quota: quotaName, windowSeconds: quota.windowSeconds })
        .one(result);

    if (Number(result.total) >= quota.max) {
        const error = new BadRequestError(quota.message);
        error.clientMessage = quota.message;
        throw error;
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { COMMUNITY_WRITE_QUOTAS, enforceCommunityWriteQuota };
}
