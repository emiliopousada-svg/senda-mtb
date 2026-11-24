'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('community route create hook trims the track and calculates its bounds', () => {
    let createHandler;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            },
            findRecordsByFilter() { return []; }
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'community_routes') createHandler = handler;
        },
        onRecordUpdateRequest() {}
    });
    const hook = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'community_routes.pb.js'),
        'utf8'
    );
    vm.runInContext(hook, context);

    const values = {
        owner: 'user123',
        trackJson: JSON.stringify([[[0, 0], [0.001, 0.001], [0.5, 0.5]]]),
        poisJson: '[]'
    };
    let nextCalled = false;
    createHandler({
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: {
            isNew: () => true,
            getString(name) { return values[name] || ''; },
            get(name) { return values[name]; },
            getUnsavedFiles() { return []; },
            set(name, value) { values[name] = value; }
        },
        next() { nextCalled = true; }
    });

    assert.equal(nextCalled, true);
    assert.equal(values.createdBy, 'Rider');
    const trimmed = JSON.parse(values.trackJson);
    assert.ok(trimmed[0].length >= 2);
    assert.ok(trimmed[0][0][0] > 0);
    assert.equal(Number.isFinite(values.minLat), true);
    assert.equal(Number.isFinite(values.maxLat), true);
    assert.equal(Number.isFinite(values.minLng), true);
    assert.equal(Number.isFinite(values.maxLng), true);
});

function communityRouteHookWith(findRecordsByFilter, uploadedFiles = []) {
    let createHandler;
    let updateHandler;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById() { return { getString: name => name === 'nickname' ? 'Rider' : '' }; },
            findRecordsByFilter
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'community_routes') createHandler = handler;
        },
        onRecordUpdateRequest(handler, name) {
            if (name === 'community_routes') updateHandler = handler;
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'community_routes.pb.js'), 'utf8'), context);
    const invoke = (handler, values, isNew, originalValues) => {
        let nextCalled = false;
        handler({
            hasSuperuserAuth: () => false,
            auth: { id: 'user123' },
            record: {
                id: '',
                isNew: () => isNew,
                original() {
                    return {
                        getString(name) {
                            return originalValues[name] === undefined ? '' : String(originalValues[name]);
                        }
                    };
                },
                getString(name) { return values[name] === undefined ? '' : String(values[name]); },
                get(name) { return values[name]; },
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
    movingTimeSec: 7200
});

test('community route hook rejects publishing the same route twice', () => {
    const queries = [];
    const create = communityRouteHookWith((collection, filter, sort, limit, offset, params) => {
        queries.push({ collection, filter, params });
        return [{ id: 'existing' }];
    });
    assert.throws(() => create(duplicateRouteValues()), /ya está publicada/);
    assert.equal(queries[0].collection, 'community_routes');
    assert.match(queries[0].filter, /owner = \{:owner\}/);
    assert.match(queries[0].filter, /movingTimeSec = \{:moving\}/);
    assert.equal(queries[0].params.owner, 'user123');
    assert.equal(queries[0].params.moving, 7200);
});

test('community route hook accepts a route that is not yet published', () => {
    const create = communityRouteHookWith(() => []);
    assert.equal(create(duplicateRouteValues()), true);
});

test('community route update keeps its trimmed track and existing POIs intact', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
    values.poisJson = JSON.stringify([{ lat: 0.0012, lng: 0.0012 }]);
    assert.equal(save(values), true);

    const storedTrack = values.trackJson;
    assert.equal(save.update(values, { ...values }), true);
    assert.equal(values.trackJson, storedTrack);
});

test('community route update trims only when the track changes', () => {
    const save = communityRouteHookWith(() => []);
    const values = duplicateRouteValues();
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
