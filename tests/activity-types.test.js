const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const configSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'config.js'), 'utf8');
const routesSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');

function activityTypesContext() {
    const start = configSource.indexOf('const ACTIVITY_TYPES = {');
    const end = configSource.indexOf('\nasync function promptRequiredRouteName(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const context = vm.createContext({ document: { getElementById() {} } });
    vm.runInContext([
        configSource.slice(start, end),
        'globalThis.testActivityTypes = ACTIVITY_TYPES;',
        'globalThis.testActivityTypeForRoute = activityTypeForRoute;',
        'globalThis.testActivityTypeFromName = activityTypeFromName;',
        'globalThis.testRouteActivityPrefix = routeActivityPrefix;'
    ].join('\n'), context);
    return context;
}

test('activity catalog includes the requested types and preserves name-based route detection', () => {
    const context = activityTypesContext();
    const expectedTypes = ['mtb', 'hiking', 'road', 'horse', 'running'];

    assert.deepEqual(Object.keys(context.testActivityTypes), expectedTypes);
    for (const activityType of expectedTypes) {
        const prefix = context.testRouteActivityPrefix(activityType);
        assert.ok(prefix);
        assert.equal(context.testActivityTypeFromName(`${prefix}Ruta de prueba`), activityType);
        assert.equal(context.testActivityTypeForRoute({ name: `${prefix}Ruta de prueba` }), activityType);
    }
});

test('explicit route activity types take precedence and unknown values fall back to the name', () => {
    const context = activityTypesContext();
    const roadPrefix = context.testRouteActivityPrefix('road');
    const hikingPrefix = context.testRouteActivityPrefix('hiking');

    assert.equal(context.testActivityTypeForRoute({ activityType: 'running', name: `${roadPrefix}Ruta` }), 'running');
    assert.equal(context.testActivityTypeForRoute({ activityType: 'legacy', name: `${hikingPrefix}Ruta` }), 'hiking');
    assert.equal(context.testActivityTypeForRoute({ name: 'Ruta antigua' }), null);
});

test('route activity filter includes every catalog type and preserves a valid selection', () => {
    const config = activityTypesContext();
    const start = routesSource.indexOf('function routesFillActivityFilter(');
    const end = routesSource.indexOf('\nfunction renderSavedRoutes(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const context = vm.createContext({
        ACTIVITY_TYPES: config.testActivityTypes,
        Option: class {
            constructor(text, value) {
                this.text = text;
                this.value = value;
            }
        }
    });
    vm.runInContext(
        `${routesSource.slice(start, end)}\nglobalThis.testFillActivityFilter = routesFillActivityFilter;`,
        context
    );

    const select = {
        value: 'road',
        options: [],
        replaceChildren(...options) { this.options = options; }
    };
    context.testFillActivityFilter(select);

    assert.deepEqual(select.options.map(option => option.value), [
        'all', ...Object.keys(config.testActivityTypes), 'other'
    ]);
    assert.deepEqual(select.options.slice(1, -1).map(option => option.text), [
        '🚵 MTB', '🥾 Senderismo', '🚴 Carretera', '🐎 Caballo', '🏃 Correr'
    ]);
    assert.equal(select.value, 'road');

    select.value = 'removed-type';
    context.testFillActivityFilter(select);
    assert.equal(select.value, 'all');
});
