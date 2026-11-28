'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const communityRouteUtils = require('../pb_hooks/community_routes_utils.js');

test('community route create hook trims the track and calculates its bounds', () => {
    let createHandler;
    let handlerInvoked = false;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return {
                    getString: name => name === 'nickname' ? 'Rider' : '',
                    getBool: name => name === 'verified'
                };
            },
            findRecordsByFilter() { return []; }
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'community_routes') createHandler = handler;
        },
        onRecordUpdateRequest() {},
        __hooks: 'hooks',
        require(name) {
            if (name === 'hooks/community_routes_utils.js') {
                assert.equal(handlerInvoked, true);
                return communityRouteUtils;
            }
            assert.equal(name, 'hooks/community_quota_utils.js');
            return { enforceCommunityWriteQuota() {} };
        }
    });
    const hook = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'community_routes.pb.js'),
        'utf8'
    );
    vm.runInContext(hook, context);

    const values = {
        owner: 'user123',
        quotaExemptForLimit: true,
        trackJson: JSON.stringify([[[0, 0], [0.001, 0.001], [0.5, 0.5]]]),
        poisJson: '[]',
        published: true
    };
    let nextCalled = false;
    handlerInvoked = true;
    createHandler({
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: {
            isNew: () => true,
            getString(name) { return values[name] || ''; },
            get(name) { return values[name]; },
            getBool(name) { return values[name] === true; },
            getUnsavedFiles() { return []; },
            set(name, value) { values[name] = value; }
        },
        next() { nextCalled = true; }
    });

    assert.equal(nextCalled, true);
    assert.equal(values.createdBy, 'Rider');
    assert.equal(values.trackLocked, true);
    assert.equal(values.quotaExemptForLimit, false);
    const trimmed = JSON.parse(values.trackJson);
    assert.ok(trimmed[0].length >= 2);
    assert.ok(trimmed[0][0][0] > 0);
    assert.equal(Number.isFinite(values.minLat), true);
    assert.equal(Number.isFinite(values.maxLat), true);
    assert.equal(Number.isFinite(values.minLng), true);
    assert.equal(Number.isFinite(values.maxLng), true);
});

test('community route trimming interpolates altitude at both synthetic endpoints', () => {
    const create = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.trackJson = JSON.stringify([[
        [0, 0, 100],
        [0.001, 0.001, 200],
        [0.5, 0.5, 300]
    ]]);

    assert.equal(create(values), true);

    const [trimmed] = JSON.parse(values.trackJson);
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    const middle = trimmed.slice(1, -1);
    assert.equal(first.length, 3);
    assert.equal(last.length, 3);
    assert.ok(first[2] > 100 && first[2] < 200);
    assert.ok(last[2] > 200 && last[2] < 300);
    assert.equal(middle.length, 1);
});

function communityRouteHookWith(
    findRecordsByFilter,
    uploadedFiles = [],
    nickname = 'Rider',
    enforceQuota = () => {},
    auth = { id: 'user123' },
    verified = true
) {
    let createHandler;
    let updateHandler;
    let handlerInvoked = false;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById() {
                return {
                    getString: name => name === 'nickname' ? nickname : '',
                    getBool: name => name === 'verified' && verified
                };
            },
            findRecordsByFilter
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'community_routes') createHandler = handler;
        },
        onRecordUpdateRequest(handler, name) {
            if (name === 'community_routes') updateHandler = handler;
        },
        __hooks: 'hooks',
        require(name) {
            if (name === 'hooks/community_routes_utils.js') {
                assert.equal(handlerInvoked, true);
                return communityRouteUtils;
            }
            assert.equal(name, 'hooks/community_quota_utils.js');
            return { enforceCommunityWriteQuota: enforceQuota };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'community_routes.pb.js'), 'utf8'), context);
    const invoke = (handler, values, isNew, originalValues) => {
        let nextCalled = false;
        handlerInvoked = true;
        handler({
            hasSuperuserAuth: () => false,
            auth,
            record: {
                id: '',
                isNew: () => isNew,
                original() {
                    return {
                        getString(name) {
                            return originalValues[name] === undefined ? '' : String(originalValues[name]);
                        },
                        get(name) { return originalValues[name]; },
                        getBool(name) { return originalValues[name] === true; }
                    };
                },
                getString(name) { return values[name] === undefined ? '' : String(values[name]); },
                get(name) { return values[name]; },
                getBool(name) { return values[name] === true; },
                getUnsavedFiles(name) {
                    assert.equal(name, 'poiPhotos');
                    return uploadedFiles;
                },
                set(name, value) { values[name] = value; }
            },
            next() { nextCalled = true; }
        });
        return nextCalled;
    };
    const create = values => invoke(createHandler, values, true, values);
    create.update = (values, originalValues) => invoke(updateHandler, values, false, originalValues);
    return create;
}

const duplicateRouteValues = () => ({
    owner: 'user123',
    trackJson: JSON.stringify([[[0, 0], [0.001, 0.001], [0.5, 0.5]]]),
    poisJson: '[]',
    distanceKm: 42.3,
    movingTimeSec: 7200,
    published: true
});

test('community route hook rejects publishing the same route twice', () => {
    const queries = [];
    const create = communityRouteHookWith((collection, filter, sort, limit, offset, params) => {
        queries.push({ collection, filter, params });
        return [{ id: 'existing' }];
    });
    const values = duplicateRouteValues();
    values.distanceKm = 99999;
    values.elevationGain = 99999;
    values.movingTimeSec = 604800;
    assert.throws(() => create(values), /ya está publicada/);
    assert.equal(queries[0].collection, 'community_routes');
    assert.match(queries[0].filter, /owner = \{:owner\}/);
    assert.match(queries[0].filter, /trackJson = \{:track\}/);
    assert.doesNotMatch(queries[0].filter, /movingTimeSec|distanceKm/);
    assert.equal(queries[0].params.owner, 'user123');
    assert.equal(queries[0].params.track, values.trackJson);
    assert.ok(values.distanceKm > 78 && values.distanceKm < 79);
    assert.equal(values.elevationGain, 0);
    assert.equal(values.movingTimeSec, 0);
});

test('community route hook accepts a route that is not yet published', () => {
    const create = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    assert.equal(create(values), true);
    assert.ok(values.distanceKm > 78 && values.distanceKm < 79);
    assert.equal(values.elevationGain, 0);
    assert.equal(values.movingTimeSec, 0);
});

test('community route hook rejects unauthenticated writes independently of collection rules', () => {
    const create = communityRouteHookWith(() => [], [], 'Rider', () => {}, null);

    assert.throws(() => create(duplicateRouteValues()), /Inicia sesión/);
});

test('community route hook rejects unverified users independently of collection rules', () => {
    const create = communityRouteHookWith(() => [], [], 'Rider', () => {}, { id: 'user123' }, false);

    assert.throws(() => create(duplicateRouteValues()), /Verifica tu correo/);
});

test('community route hook rejects a publication when the owner quota is exhausted', () => {
    const create = communityRouteHookWith(
        () => [],
        [],
        'Rider',
        () => { throw new Error('route quota reached'); }
    );

    assert.throws(() => create(duplicateRouteValues()), /route quota reached/);
});

test('community route hook rejects client changes to the server-owned source path', () => {
    const create = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.sourcePath = 'galicia/routes/forged.gpx';

    assert.throws(() => create(values), /origen de la ruta no se puede modificar/);
});

test('community route hook preserves official elevation but ignores client edits', () => {
    const save = communityRouteHookWith(() => [], [], 'SENDA-MTB');
    const values = duplicateRouteValues();
    values.sourcePath = 'galicia/routes/official.gpx';
    values.elevationGain = 99999;
    const originalValues = { ...values, elevationGain: 120 };

    assert.equal(save.update(values, originalValues), true);
    assert.equal(values.elevationGain, 120);
});

test('community route hook freezes a published track, including after unpublishing', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    assert.equal(save(values), true);
    assert.equal(values.trackLocked, true);

    const publishedValues = { ...values };
    values.published = false;
    assert.equal(save.update(values, publishedValues), true);
    assert.equal(values.trackLocked, true);

    const unpublishedValues = { ...values };
    values.trackJson = JSON.stringify([[[0, 0], [0.002, 0.002], [0.5, 0.5]]]);
    assert.throws(() => save.update(values, unpublishedValues), /no se puede modificar después de publicar/);
});

test('community route hook allows changing a draft track before publishing it', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.published = false;
    assert.equal(save(values), true);
    assert.equal(values.trackLocked, false);

    const draftValues = { ...values };
    values.trackJson = JSON.stringify([[[0, 0], [0.002, 0.002], [0.5, 0.5]]]);
    assert.equal(save.update(values, draftValues), true);
    assert.equal(values.trackLocked, false);

    const editedDraft = { ...values };
    values.published = true;
    assert.equal(save.update(values, editedDraft), true);
    assert.equal(values.trackLocked, true);
});

test('community route import refuses changing a locked published geometry', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'community_routes_galicia_import.pb.js'),
        'utf8'
    );
    const helperEnd = source.indexOf('(function ()');
    const context = vm.createContext({});
    vm.runInContext(source.slice(0, helperEnd), context);
    const record = {
        getBool(name) { return name === 'trackLocked'; },
        getString(name) { return name === 'trackJson' ? 'old-track' : ''; }
    };

    assert.equal(context.communityRouteImportTrackIsLocked(record, 'new-track'), true);
    assert.equal(context.communityRouteImportTrackIsLocked(record, 'old-track'), false);
    assert.equal(context.communityRouteImportTrackIsLocked({
        getBool() { return false; },
        getString() { return 'old-track'; }
    }, 'new-track'), false);
});

test('community route update keeps its trimmed track and existing POIs intact', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.published = false;
    values.poisJson = JSON.stringify([{ lat: 0.0012, lng: 0.0012 }]);
    assert.equal(save(values), true);

    const storedTrack = values.trackJson;
    assert.equal(save.update(values, { ...values }), true);
    assert.equal(values.trackJson, storedTrack);
});

test('community route metadata updates skip duplicate scans but publication still checks', () => {
    let duplicateChecks = 0;
    const save = communityRouteHookWith(() => {
        duplicateChecks++;
        return [];
    });
    const values = duplicateRouteValues();
    values.published = false;
    assert.equal(save(values), true);
    assert.equal(duplicateChecks, 1);

    const originalValues = { ...values };
    values.title = 'Updated title';
    assert.equal(save.update(values, originalValues), true);
    assert.equal(duplicateChecks, 1);

    values.published = true;
    assert.equal(save.update(values, originalValues), true);
    assert.equal(duplicateChecks, 2);
});

test('community route update trims only when the track changes', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.published = false;
    assert.equal(save(values), true);

    const originalValues = { ...values };
    const changedTrack = JSON.stringify([[[0, 0], [0.002, 0.002], [0.5, 0.5]]]);
    values.trackJson = changedTrack;
    values.poisJson = JSON.stringify([{ lat: 0.0001, lng: 0.0001 }]);
    assert.throws(() => save.update(values, originalValues), /más de 150 metros/);

    values.poisJson = '[]';
    assert.equal(save.update(values, originalValues), true);
    assert.notEqual(values.trackJson, changedTrack);

    const trimmedTrack = values.trackJson;
    assert.equal(save.update(values, { ...values }), true);
    assert.equal(values.trackJson, trimmedTrack);
});

test('community route update checks new POIs against the existing protected endpoints', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    assert.equal(save(values), true);

    const originalValues = { ...values };
    values.poisJson = JSON.stringify([{ lat: 0.00096, lng: 0.00096 }]);
    assert.throws(() => save.update(values, originalValues), /extremos protegidos/);
});

test('community route update preserves existing endpoint POIs while validating new ones', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.poisJson = JSON.stringify([{ lat: 0.0012, lng: 0.0012 }]);
    assert.equal(save(values), true);

    const originalValues = { ...values };
    values.poisJson = JSON.stringify([
        { lat: 0.0012, lng: 0.0012 },
        { lat: 0.2, lng: 0.2 }
    ]);
    assert.equal(save.update(values, originalValues), true);
});

function jpegFile(bytes) {
    let offset = 0;
    return {
        size: bytes.length,
        reader: {
            open() {
                return {
                    read(buffer) {
                        assert.equal(ArrayBuffer.isView(buffer), true);
                        const count = Math.min(buffer.length, bytes.length - offset);
                        for (let i = 0; i < count; i++) buffer[i] = bytes[offset++];
                        return count;
                    },
                    close() {}
                };
            }
        }
    };
}

test('community route hook rejects new photos containing EXIF metadata', () => {
    const exifJpeg = [
        0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08,
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0xff, 0xda, 0x00, 0x02, 0xff, 0xd9
    ];
    const save = communityRouteHookWith(() => [], [jpegFile(exifJpeg)]);

    assert.throws(() => save(duplicateRouteValues()), /contiene metadatos/);
});

test('community route hook rejects EXIF metadata after the first JPEG scan', () => {
    const exifAfterScan = [
        0xff, 0xd8,
        0xff, 0xda, 0x00, 0x02, 0x11, 0x22,
        0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0xff, 0xda, 0x00, 0x02, 0x33,
        0xff, 0xd9
    ];
    const save = communityRouteHookWith(() => [], [jpegFile(exifAfterScan)]);

    assert.throws(() => save(duplicateRouteValues()), /contiene metadatos/);
});

test('community route hook accepts a re-encoded JPEG without metadata', () => {
    const cleanJpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9];
    const save = communityRouteHookWith(() => [], [jpegFile(cleanJpeg)]);

    assert.equal(save(duplicateRouteValues()), true);
});

test('community route hook rejects bytes appended after JPEG EOI', () => {
    const cleanJpegWithTrailingData = [
        0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9, 0x00
    ];
    const save = communityRouteHookWith(() => [], [jpegFile(cleanJpegWithTrailingData)]);

    assert.throws(() => save(duplicateRouteValues()), /JPEG válido/);
});

test('community route hook aborts publishing when the duplicate check fails', () => {
    const create = communityRouteHookWith(() => { throw new Error('db busy'); });
    assert.throws(() => create(duplicateRouteValues()), /db busy/);
});
