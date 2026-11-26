'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const statsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'stats.js'), 'utf8');

function periodButton(period) {
    const classes = new Set();
    const attributes = {};
    return {
        dataset: { dashboardPeriod: period },
        attributes,
        classes,
        classList: {
            toggle(name, active) {
                if (active) classes.add(name);
                else classes.delete(name);
            }
        },
        setAttribute(name, value) { attributes[name] = value; }
    };
}

test('home performance period switches between weekly and monthly', () => {
    const buttons = [periodButton('weekly'), periodButton('monthly')];
    const context = vm.createContext({
        dashboardRenderCount: 0,
        document: {
            querySelectorAll(selector) {
                return selector === '[data-dashboard-period]' ? buttons : [];
            }
        }
    });
    vm.runInContext(statsSource, context);
    vm.runInContext('statsRenderDashboard = () => { dashboardRenderCount += 1; }', context);

    vm.runInContext("statsSetDashboardPeriod('monthly')", context);

    assert.equal(vm.runInContext('statsDashboardPeriod', context), 'monthly');
    assert.equal(buttons[0].classes.has('active'), false);
    assert.equal(buttons[0].attributes['aria-pressed'], 'false');
    assert.equal(buttons[1].classes.has('active'), true);
    assert.equal(buttons[1].attributes['aria-pressed'], 'true');
    assert.equal(context.dashboardRenderCount, 1);

    vm.runInContext("statsSetDashboardPeriod('yearly')", context);
    assert.equal(vm.runInContext('statsDashboardPeriod', context), 'monthly');
    assert.equal(context.dashboardRenderCount, 1);
});

test('home performance chart changes bucket labels and count for the selected period', () => {
    const buttons = [periodButton('weekly'), periodButton('monthly')];
    const elements = new Map([
        'home-week-distance', 'home-week-ascent', 'home-week-time', 'home-week-speed',
        'home-week-goal-input', 'home-week-goal-progress', 'home-week-goal-caption',
        'home-week-rides', 'home-week-ride-count', 'home-week-activity-km',
        'home-performance-title', 'home-performance-foot-label', 'home-distance-chart'
    ].map(id => [id, {
        textContent: '',
        value: '',
        setAttribute(name, value) { this[name] = value; }
    }]));
    const now = new Date();
    const routes = [
        { startedAt: new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString(), distanceKm: 12 },
        { startedAt: now.toISOString(), distanceKm: 8 }
    ];
    const chart = {
        data: { labels: [], datasets: [{ data: [] }] },
        updates: 0,
        update() { this.updates++; }
    };
    const context = vm.createContext({
        document: {
            activeElement: null,
            querySelectorAll(selector) {
                return selector === '[data-dashboard-period]' ? buttons : [];
            }
        },
        localStorage: { getItem: () => '100' },
        savedRoutes: routes,
        fmtDur: seconds => `${seconds}s`,
        MTBStatisticsEngine: {
            analyzeRoute(route) { return { route, distanceKm: route.distanceKm }; },
            aggregate(analyses) {
                return {
                    distanceKm: analyses.reduce((sum, item) => sum + item.distanceKm, 0),
                    ascentSampleCount: 0,
                    ascentM: 0,
                    movingTimeSec: 0,
                    averageSpeed: null,
                    rideCount: analyses.length
                };
            }
        },
        $(id) { return elements.get(id) || null; },
        dashboardRender() {}
    });
    vm.runInContext(statsSource, context);
    context.fakeDashboardChart = chart;
    vm.runInContext('statsDashboardChart = fakeDashboardChart', context);

    vm.runInContext('statsRenderDashboard()', context);
    assert.deepEqual(Array.from(chart.data.labels), ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
    assert.equal(elements.get('home-performance-title').textContent, 'Rendimiento semanal');
    assert.equal(elements.get('home-performance-foot-label').textContent, 'Salidas esta semana');

    vm.runInContext("statsSetDashboardPeriod('monthly')", context);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    assert.equal(chart.data.labels.length, Math.ceil(daysInMonth / 7));
    assert.equal(chart.data.labels[0], 'S1');
    assert.equal(chart.data.datasets[0].data.reduce((sum, value) => sum + value, 0), 20);
    assert.equal(elements.get('home-performance-title').textContent, 'Rendimiento mensual');
    assert.equal(elements.get('home-performance-foot-label').textContent, 'Salidas este mes');
    assert.equal(elements.get('home-distance-chart')['aria-label'], 'Distancia recorrida por semana este mes');
});
