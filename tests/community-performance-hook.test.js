'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadHandlers() {
    const sources = {};
    const hookContext = vm.createContext({
        onRecordCreateRequest(handler, ...collections) {
            for (const collection of collections) sources[`create:${collection}`] = handler.toString();
        },
        onRecordUpdateRequest(handler, ...collections) {
            for (const collection of collections) sources[`update:${collection}`] = handler.toString();
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'community_performance.pb.js'), 'utf8'),
        hookContext
    );

    const app = {
        findRecordById(collection) {
            if (collection === 'users') {
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            }
            if (collection === 'community_routes') {
                return {
                    getBool: name => name === 'published',
                    getString: name => name === 'trackJson'
                        ? JSON.stringify([[[0, 0], [0, 0.01]]])
                        : ''
                };
            }
            if (collection === 'community_segments') {
                return {
                    getString: name => ({
                        route: 'route123',
                        trackJson: JSON.stringify([[[0, 0], [0, 0.01]]])
                    })[name] || ''
                };
            }
            throw new Error(`Unexpected collection: ${collection}`);
        }
    };

    return Object.fromEntries(Object.entries(sources).map(([key, source]) => [
        key,
        vm.runInContext(`(${source})`, vm.createContext({
            BadRequestError: class BadRequestError extends Error {},
            $app: app
        }))
    ]));
}

function createEvent(collection) {
    const values = {
        owner: 'user123',
        route: 'route123',
        segment: 'segment123',
        elapsedSeconds: 60
    };
    return {
        collection: { name: collection },
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: {
            getString: name => values[name] || '',
            get: name => values[name],
            set(name, value) { values[name] = value; }
        },
        values,
        nextCalled: false,
        next() { this.nextCalled = true; }
    };
}

test('community effort hooks calculate route and segment distances in isolated handlers', () => {
    const handlers = loadHandlers();

    for (const collection of ['community_route_efforts', 'community_segment_efforts']) {
        const event = createEvent(collection);
        handlers[`create:${collection}`](event);
        assert.equal(event.values.alias, 'Rider');
        assert.equal(event.nextCalled, true);
    }
});
