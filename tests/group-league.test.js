'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
    entryTimeMs,
    groupRankingSummaryFromEntries,
    getSeasonInfo,
    getSeasonInfoByNumber,
    validateChallengeInput,
    challengeProgress,
    challengeStatus,
    seasonTitles,
    groupActivityFeed,
    segmentLeadsByUser
} = require('../pb_hooks/groups_utils.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function entry(owner, daysAgo, values = {}) {
    return {
        owner,
        clientId: NOW - daysAgo * DAY,
        distanceKm: 20,
        elevationGain: 400,
        movingTimeSec: 3600,
        maxSpeedKmh: 40,
        ...values
    };
}

test('entryTimeMs usa el clientId de la salida y, si no es válido, la fecha de creación', () => {
    assert.equal(entryTimeMs({ clientId: NOW - DAY }, NOW), NOW - DAY);
    assert.equal(entryTimeMs({ clientId: 42, created: '2026-11-10 08:00:00.000Z' }, NOW), Date.UTC(2026, 10, 10, 8));
    assert.ok(Number.isNaN(entryTimeMs({ clientId: 42 }, NOW)));
});

test('el ranking de temporada cuenta marcas sin campo created (bug del ranking a cero)', () => {
    const season = getSeasonInfo(NOW);
    const summary = groupRankingSummaryFromEntries([entry('ana', 1), entry('ana', 2), entry('brais', 400)], { season });
    assert.ok(summary.ana, 'Ana debe aparecer en la temporada');
    assert.equal(summary.ana.activityCount, 2);
    assert.ok(summary.ana.leaguePoints > 0);
    assert.equal(summary.brais, undefined, 'las salidas de otra temporada no cuentan');
});

test('getSeasonInfoByNumber devuelve temporadas pasadas cerradas', () => {
    const current = getSeasonInfo(NOW);
    const previous = getSeasonInfoByNumber(current.seasonNumber - 1, NOW);
    assert.equal(previous.seasonNumber, current.seasonNumber - 1);
    assert.equal(previous.finished, true);
    assert.equal(getSeasonInfoByNumber(current.seasonNumber, NOW).finished, false);
});

test('validateChallengeInput normaliza y rechaza desafíos inválidos', () => {
    const ok = validateChallengeInput({ name: '  100   km ', metric: 'distance', target: 100.04, endsAt: '2026-11-30' }, NOW);
    assert.equal(ok.name, '100 km');
    assert.equal(ok.target, 100);
    assert.equal(ok.startsAtMs, NOW);
    assert.equal(ok.endsAtMs, Date.UTC(2026, 10, 30) + DAY - 1, 'la fecha de fin es inclusiva');
    assert.equal(validateChallengeInput({ name: 'Salidas', metric: 'activities', target: 2.2, endsAt: '2026-11-30' }, NOW).target, 3);

    assert.throws(() => validateChallengeInput({ name: 'ab', metric: 'distance', target: 10, endsAt: '2026-11-30' }, NOW), /nombre/);
    assert.throws(() => validateChallengeInput({ name: 'Reto', metric: 'saltos', target: 10, endsAt: '2026-11-30' }, NOW), /tipo/);
    assert.throws(() => validateChallengeInput({ name: 'Reto', metric: 'distance', target: 0, endsAt: '2026-11-30' }, NOW), /objetivo/);
    assert.throws(() => validateChallengeInput({ name: 'Reto', metric: 'distance', target: 10, endsAt: '2026-11-01' }, NOW), /fin/);
    assert.throws(() => validateChallengeInput({ name: 'Reto', metric: 'distance', target: 10, endsAt: '2027-06-01' }, NOW), /máximo/);
});

test('challengeProgress suma solo las salidas del grupo dentro de las fechas', () => {
    const challenge = { metric: 'distance', target: 50, startsAtMs: NOW - 10 * DAY, endsAtMs: NOW + 10 * DAY };
    const members = [{ userId: 'ana', nickname: 'Ana' }, { userId: 'brais', nickname: 'Brais' }];
    const progress = challengeProgress(challenge, [
        entry('ana', 5, { distanceKm: 30 }),
        entry('ana', 2, { distanceKm: 25 }),
        entry('ana', 20, { distanceKm: 100 }),
        entry('intruso', 1, { distanceKm: 500 }),
        entry('brais', 1, { distanceKm: 10 })
    ], members);
    assert.deepEqual(progress.map(item => item.userId), ['ana', 'brais']);
    assert.equal(progress[0].value, 55);
    assert.equal(progress[0].percent, 100);
    assert.equal(progress[0].completed, true);
    assert.equal(progress[0].completedAtMs, NOW - 2 * DAY);
    assert.equal(progress[1].percent, 20);
    assert.equal(progress[1].completed, false);

    assert.equal(challengeStatus(challenge, NOW), 'active');
    assert.equal(challengeStatus(challenge, NOW - 20 * DAY), 'upcoming');
    assert.equal(challengeStatus(challenge, NOW + 20 * DAY), 'finished');
});

test('seasonTitles reparte los cinco títulos de la temporada', () => {
    const season = getSeasonInfo(NOW);
    const titles = seasonTitles([
        entry('ana', 1, { distanceKm: 40, elevationGain: 1200, maxSpeedKmh: 45 }),
        entry('brais', 1, { distanceKm: 60, elevationGain: 300, maxSpeedKmh: 62 }),
        entry('carme', 1, { distanceKm: 15, elevationGain: 300, maxSpeedKmh: 30 }),
        entry('carme', 2, { distanceKm: 15, elevationGain: 300, maxSpeedKmh: 30 }),
        entry('carme', 3, { distanceKm: 15, elevationGain: 300, maxSpeedKmh: 30 })
    ], season, { ana: 'Ana', brais: 'Brais', carme: 'Carme' });
    const winners = Object.fromEntries(titles.map(title => [title.key, title.winner && title.winner.nickname]));
    assert.deepEqual(Object.keys(winners).sort(), ['champion', 'climbingBeast', 'fastestRider', 'kingOfTheMountain', 'mostConsistent']);
    assert.equal(winners.kingOfTheMountain, 'Ana');
    assert.equal(winners.climbingBeast, 'Ana');
    assert.equal(winners.fastestRider, 'Brais');
    assert.equal(winners.mostConsistent, 'Carme');
    assert.ok(winners.champion);
    assert.ok(seasonTitles([], season).every(title => title.winner === null));
});

test('groupActivityFeed mezcla salidas, desafíos y récords del grupo', () => {
    const feed = groupActivityFeed([
        entry('ana', 3, { distanceKm: 30 }),
        entry('brais', 1, { distanceKm: 50 })
    ], [{
        id: 'c1', name: '100 km', createdBy: 'ana', createdAtMs: NOW - 2 * DAY,
        progress: [{ userId: 'brais', nickname: 'Brais', completed: true, completedAtMs: NOW - DAY / 2 }]
    }], { ana: 'Ana', brais: 'Brais' }, { limit: 10 });
    assert.deepEqual(feed.map(item => item.type), ['challenge-completed', 'activity', 'challenge-created', 'activity']);
    assert.deepEqual(feed[1].groupRecords, ['distance']);
    assert.deepEqual(feed[3].groupRecords, [], 'la primera salida no marca récord');
    assert.equal(groupActivityFeed([entry('ana', 1), entry('ana', 2), entry('ana', 3)], [], {}, { limit: 2 }).length, 2);
});

test('segmentLeadsByUser cuenta los segmentos donde cada ciclista tiene el mejor tiempo', () => {
    const leads = segmentLeadsByUser([
        { segment: 's1', owner: 'ana', elapsedSeconds: 300 },
        { segment: 's1', owner: 'brais', elapsedSeconds: 280 },
        { segment: 's2', owner: 'ana', elapsedSeconds: 120 },
        { segment: 's3', owner: 'ana', elapsedSeconds: 0 }
    ]);
    assert.deepEqual(leads, { brais: 1, ana: 1 });
});

test('la migración añade fechas al ranking y crea mtb_group_challenges una sola vez', () => {
    let up;
    const fields = [];
    const saved = [];
    const collections = [];
    const ranking = {
        name: 'mtb_group_ranking_entries',
        fields: { getByName: name => fields.find(field => field.name === name) || null, add: field => fields.push(field) }
    };
    const app = {
        findCollectionByNameOrId(name) {
            if (name === 'mtb_group_ranking_entries') return ranking;
            return { id: name + '_id', name };
        },
        findAllCollections: () => collections,
        save(collection) { saved.push(collection); if (collection.name === 'mtb_group_challenges') collections.push(collection); }
    };
    class AutodateField { constructor(definition) { Object.assign(this, definition); } type() { return 'autodate'; } }
    class Collection { constructor(definition) { Object.assign(this, definition); } }
    const context = vm.createContext({ AutodateField, Collection, migrate(callback) { up = callback; } });
    const file = path.join(__dirname, '..', 'pb_migrations', '1794836000_create_group_challenges.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    up(app);
    assert.deepEqual(fields.map(field => field.name), ['created', 'updated']);
    const challenges = collections.find(collection => collection.name === 'mtb_group_challenges');
    assert.ok(challenges);
    assert.equal(challenges.listRule, null);
    assert.deepEqual(Array.from(challenges.fields, field => field.name), ['group', 'createdBy', 'name', 'metric', 'target', 'startsAt', 'endsAt', 'created', 'updated']);

    const savesAfterFirstRun = saved.length;
    up(app);
    assert.equal(saved.length, savesAfterFirstRun, 'la segunda ejecución no cambia nada');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'pb_migrations', 'PENDING_1794836000_create_competition_collections.js')));
});
