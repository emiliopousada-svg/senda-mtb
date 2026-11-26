'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const statsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'stats.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('statistics evolution omits the route comparison block', () => {
    assert.doesNotMatch(indexSource, /stats-route-compare|Comparación de rutas/);
    assert.doesNotMatch(statsSource, /statsRouteComparisonChart|statsRenderRouteComparison/);
});

test('route analysis cache can be invalidated after activity metadata changes', () => {
    const start = statsSource.indexOf('let statsAnalysisCache = new WeakMap();');
    const end = statsSource.indexOf('\nfunction statsAggregate(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    let analyses = 0;
    const context = vm.createContext({
        statsHeartRateMax: 190,
        statsPowerFtp: 250,
        STATS_HR_ZONES: [],
        STATS_POWER_ZONES: [],
        MTBStatisticsEngine: {
            analyzeRoute(route) {
                analyses++;
                return { activityType: route.activityType };
            }
        }
    });
    vm.runInContext(statsSource.slice(start, end), context);

    const route = { activityType: 'mtb' };
    assert.equal(context.statsAnalyzeRoute(route).activityType, 'mtb');
    route.activityType = 'road';
    assert.equal(context.statsAnalyzeRoute(route).activityType, 'mtb');
    context.statsInvalidateRouteAnalysis(route);
    assert.equal(context.statsAnalyzeRoute(route).activityType, 'road');
    assert.equal(analyses, 2);
});

test('sensor statistics are part of MTB performance and the sensor tab is removed', () => {
    const tabsStart = indexSource.indexOf('<nav class="stats-tabs"');
    const tabsEnd = indexSource.indexOf('</nav>', tabsStart);
    const performanceStart = indexSource.indexOf('<section class="stats-slide" aria-label="Rendimiento MTB">');
    const nextSlide = indexSource.indexOf('<section class="stats-slide"', performanceStart + 1);
    assert.notEqual(tabsStart, -1);
    assert.notEqual(tabsEnd, -1);
    assert.notEqual(performanceStart, -1);
    assert.notEqual(nextSlide, -1);

    const tabs = indexSource.slice(tabsStart, tabsEnd);
    const performance = indexSource.slice(performanceStart, nextSlide);
    assert.doesNotMatch(tabs, /Sensores/);
    assert.equal((indexSource.match(/class="stats-slide" aria-label=/g) || []).length, 4);
    assert.match(performance, /id="stats-hr-zones"/);
    assert.match(performance, /id="stats-power-zones"/);
    assert.match(performance, /id="stats-profile-route"/);
});

test('selecting an activity updates the profile, MTB charts and sensor summary to that activity', () => {
    const start = statsSource.indexOf('function statsRenderMtb(analyses) {');
    const end = statsSource.indexOf('\nfunction statsProfilePointText(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const elements = new Map();
    const text = new Map();
    const makeChart = () => ({ data: { labels: [], datasets: [{ data: [] }] }, update() {} });
    const charts = {
        statsProfileChart: makeChart(),
        statsMtbSpeedChart: makeChart(),
        statsGradeChart: makeChart(),
        statsClimbTimeChart: makeChart(),
        statsVamChart: makeChart()
    };
    const selector = {
        value: 'route-b',
        options: [],
        replaceChildren(...options) { this.options = options; },
        add(option) { this.options.push(option); }
    };
    elements.set('stats-profile-route', selector);
    const aggregateInputs = [];
    const performanceInputs = [];
    const context = vm.createContext({
        $: id => elements.get(id) || null,
        Option: class Option {
            constructor(text, value) { this.text = text; this.value = value; }
        },
        fmtDate: () => 'fecha',
        fmtDur: seconds => `${seconds}s`,
        statsAggregate(analyses) {
            aggregateInputs.push(analyses.map(item => item.route.id));
            return analyses[0] ? analyses[0].summary : {
                climbSpeed: null, downhillSpeed: null, vam: null, meanGrade: null, maxGrade: null,
                climbTimeSec: 0, downhillTimeSec: 0, descentSampleCount: 0, descentM: 0,
                ascentSampleCount: 0, ascentM: 0, maxAltitude: null, minAltitude: null,
                gradeDistanceKm: 0, gradeDistributionKm: {
                    steepDownhill: 0, downhill: 0, flat: 0, climb: 0, steepClimb: 0
                }
            };
        },
        statsRenderPerformance(summary, analyses) {
            performanceInputs.push({ summary, routeIds: analyses.map(item => item.route.id) });
        },
        statsSetText(id, value) { text.set(id, value); },
        statsValue(value, decimals, unit) {
            return Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '--';
        },
        statsUpdateChart(chart, labels, values) {
            if (!chart) return;
            chart.data.labels = labels;
            chart.data.datasets[0].data = values;
        },
        ...charts
    });
    vm.runInContext(
        `${statsSource.slice(start, end)}
        globalThis.testStatsRenderMtb = statsRenderMtb;
        globalThis.testStatsRenderSelectedMtbRoute = statsRenderSelectedMtbRoute;`,
        context
    );

    const makeAnalysis = (id, values, profile = [{ x: 0, y: 100 }]) => ({
        route: { id, name: `Ruta ${id}`, startedAt: '2026-11-20' },
        profile,
        ...values.summary,
        summary: values.summary
    });
    const routeA = makeAnalysis('route-a', {
        summary: {
            climbSpeed: 5, downhillSpeed: 9, vam: 300, meanGrade: 4, maxGrade: 14,
            climbTimeSec: 600, downhillTimeSec: 300, descentSampleCount: 1, descentM: 100,
            ascentSampleCount: 1, ascentM: 150, maxAltitude: 500, minAltitude: 200,
            gradeDistanceKm: 2,
            gradeDistributionKm: { steepDownhill: 0, downhill: 0, flat: 1, climb: 1, steepClimb: 0 }
        }
    });
    const routeB = makeAnalysis('route-b', {
        summary: {
            climbSpeed: 8, downhillSpeed: 12, vam: 720, meanGrade: 6, maxGrade: 20,
            climbTimeSec: 1200, downhillTimeSec: 450, descentSampleCount: 1, descentM: 240,
            ascentSampleCount: 1, ascentM: 320, maxAltitude: 900, minAltitude: 300,
            gradeDistanceKm: 4,
            gradeDistributionKm: { steepDownhill: 1, downhill: 1, flat: 0, climb: 1, steepClimb: 1 }
        }
    }, [{ x: 0, y: 300 }, { x: 5, y: 900 }]);

    context.testStatsRenderMtb([routeA, routeB]);

    assert.deepEqual(JSON.parse(JSON.stringify(aggregateInputs)), [['route-b']]);
    assert.deepEqual(JSON.parse(JSON.stringify(performanceInputs.map(item => item.routeIds))), [['route-b']]);
    assert.equal(text.get('st-climb-speed'), '8.0 km/h');
    assert.deepEqual(Array.from(charts.statsProfileChart.data.datasets[0].data), routeB.profile);
    assert.deepEqual(Array.from(charts.statsMtbSpeedChart.data.datasets[0].data), [8, 12]);
    assert.deepEqual(Array.from(charts.statsGradeChart.data.datasets[0].data), [1, 1, 0, 1, 1]);
    assert.deepEqual(Array.from(charts.statsClimbTimeChart.data.datasets[0].data), [20, 7.5]);
    assert.deepEqual(Array.from(charts.statsVamChart.data.labels), ['Ruta route-b']);
    assert.deepEqual(Array.from(charts.statsVamChart.data.datasets[0].data), [720]);

    context.testStatsRenderSelectedMtbRoute(routeA);

    assert.deepEqual(JSON.parse(JSON.stringify(aggregateInputs[1])), ['route-a']);
    assert.deepEqual(JSON.parse(JSON.stringify(performanceInputs[1].routeIds)), ['route-a']);
    assert.equal(text.get('st-climb-speed'), '5.0 km/h');
    assert.deepEqual(Array.from(charts.statsMtbSpeedChart.data.datasets[0].data), [5, 9]);
    assert.deepEqual(Array.from(charts.statsVamChart.data.datasets[0].data), [300]);
});

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
