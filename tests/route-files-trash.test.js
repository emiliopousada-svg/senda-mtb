'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const routeFilesSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'route-files.js'), 'utf8');
const start = routeFilesSource.indexOf('function routeToGpx(');
const end = routeFilesSource.indexOf('\nfunction xmlLocalName(', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

test('multi-route GPX export contains every route as a separate escaped track', () => {
    const context = vm.createContext({
        xmlEsc(value) {
            return String(value).replace(/[<>&'"]/g, character => ({
                '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
            })[character]);
        }
    });
    vm.runInContext(routeFilesSource.slice(start, end), context);

    const gpx = context.routesToGpx([
        { name: 'Ridge & trail', points: [[40, -3, 100, null, null, null]] },
        { name: 'Forest', points: [[41, -4, 200, null, null, null]] }
    ]);

    assert.equal((gpx.match(/<trk>/g) || []).length, 2);
    assert.match(gpx, /<name>Ridge &amp; trail<\/name>/);
    assert.match(gpx, /<name>Forest<\/name>/);
    assert.equal((gpx.match(/<gpx\b/g) || []).length, 1);
    assert.equal((gpx.match(/<\/gpx>/g) || []).length, 1);
});

test('GPX export skips invalid coordinates', () => {
    const context = vm.createContext({
        xmlEsc: String
    });
    vm.runInContext(routeFilesSource.slice(start, end), context);

    const gpx = context.routeToGpx({
        name: 'GPS route',
        points: [[40, -3, 100, null, null, null], null, [41, -4, 200, null, null, null]]
    });
    assert.doesNotMatch(gpx, /lat="null"|lon="null"/);
    assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
});
