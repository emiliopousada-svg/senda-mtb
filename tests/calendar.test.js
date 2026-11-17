'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
    calendarDateKey,
    calendarCreateMockEvents,
    calendarNormalizeUserEvents,
    calendarBuildMonthCells,
    calendarEventsForDate
} = require('../app/calendar.js');

function loadCalendarUi() {
    class FakeElement {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.listeners = {};
            this.attributes = {};
            this.className = '';
            this.classList = {
                add: name => { this.className = `${this.className} ${name}`.trim(); }
            };
            this.open = false;
        }

        addEventListener(type, listener) { this.listeners[type] = listener; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        focus() {}
        reset() {}
        showModal() { this.open = true; }
        close() { this.open = false; }
        scrollIntoView() {}
    }

    const elements = new Map();
    const getElement = key => {
        if (!elements.has(key)) elements.set(key, new FakeElement());
        return elements.get(key);
    };
    const storage = new Map();
    const context = {
        console,
        document: {
            getElementById: getElement,
            createElement: () => new FakeElement(),
            querySelector: getElement
        },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        },
        module: { exports: {} }
    };
    const source = fs.readFileSync(path.join(__dirname, '../app/calendar.js'), 'utf8');
    vm.runInNewContext(source, context);
    return { getElement, storage };
}

test('calendar month grid starts on Monday and includes adjacent-month days', () => {
    const cells = calendarBuildMonthCells(2026, 10, [], '', '2026-11-17');
    assert.equal(cells.length, 42);
    assert.equal(cells[0].date, '2026-10-26');
    assert.equal(cells[0].inCurrentMonth, false);
    assert.equal(cells[6].date, '2026-11-01');
    assert.equal(cells[6].inCurrentMonth, true);
    assert.equal(cells.find(cell => cell.date === '2026-11-17').today, true);
});

test('calendar example events have realistic MTB categories and upcoming dates', () => {
    const today = new Date(2026, 10, 17);
    const events = calendarCreateMockEvents(today);
    assert.deepEqual(events.map(event => event.category), ['garage', 'route', 'meetup']);
    assert.deepEqual(events.map(event => event.date), ['2026-11-19', '2026-11-21', '2026-11-22']);
    assert.match(events[1].weather, /16°C/);
});

test('calendar filters to a selected date and shows upcoming events for today', () => {
    const events = calendarCreateMockEvents(new Date(2026, 10, 17));
    assert.deepEqual(
        calendarEventsForDate(events, '2026-11-17', '2026-11-17').map(event => event.id),
        ['mock-garage', 'mock-route', 'mock-meetup']
    );
    assert.deepEqual(
        calendarEventsForDate(events, '2026-11-21', '2026-11-17').map(event => event.id),
        ['mock-route']
    );
    assert.equal(calendarDateKey(new Date(2026, 10, 17)), '2026-11-17');
});

test('calendar stored events reject invalid dates, categories and times', () => {
    const events = calendarNormalizeUserEvents([
        { id: 'good', category: 'route', title: 'Ruta', date: '2026-11-21', time: '09:00' },
        { id: 'bad-date', category: 'route', title: 'Fecha', date: '2026-02-31', time: '09:00' },
        { id: 'bad-category', category: 'other', title: 'Tipo', date: '2026-11-21', time: '09:00' },
        { id: 'bad-time', category: 'garage', title: 'Hora', date: '2026-11-21', time: '25:00' }
    ]);
    assert.deepEqual(events.map(event => event.id), ['good']);
});

test('calendar day selection filters events and new events persist locally', () => {
    const { getElement, storage } = loadCalendarUi();
    const grid = getElement('calendar-grid');
    const list = getElement('calendar-events-list');
    assert.equal(grid.children.length, 42);
    assert.equal(list.children.length, 3);

    const routeDate = list.children.find(item => item.dataset.category === 'route');
    if (routeDate) {
        grid.listeners.click({
            target: { closest: () => ({ dataset: { calendarDate: routeDate.dataset.calendarEventDate } }) }
        });
        assert.equal(list.children.length, 1);
        assert.match(list.children[0].children[1].children[0].textContent, /Río Verdugo/);
    }

    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 8);
    const eventDateKey = calendarDateKey(eventDate);
    getElement('calendar-add').listeners.click();
    assert.equal(getElement('calendar-create-dialog').open, true);
    getElement('calendar-event-category').value = 'meetup';
    getElement('calendar-event-title').value = 'Quedada del grupo';
    getElement('calendar-event-date').value = eventDateKey;
    getElement('calendar-event-time').value = '10:30';
    getElement('calendar-form').listeners.submit({ preventDefault() {} });

    assert.equal(getElement('calendar-create-dialog').open, false);
    const saved = JSON.parse(storage.get('mtb_pro_calendar_events'));
    assert.equal(saved[0].title, 'Quedada del grupo');
    assert.equal(saved[0].date, eventDateKey);
    assert.equal(list.children.length, 1);
    assert.match(list.children[0].children[1].children[0].textContent, /Quedada del grupo/);
});

test('calendar is available from tools without changing the six-item bottom navigation', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const tools = fs.readFileSync(path.join(__dirname, '../app/tools.js'), 'utf8');
    const navigation = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];
    assert.match(html, /data-tool="calendar"[^>]*>[\s\S]*Calendario/);
    assert.match(html, /id="calendar-workspace"[\s\S]*id="calendar-create-dialog"/);
    assert.match(tools, /case 'calendar':[\s\S]*calendarOpenWorkspace\(\)/);
    assert.ok(html.indexOf('app/calendar.js') < html.indexOf('app/tools.js'));
    assert.deepEqual(
        [...navigation.matchAll(/<span>(Inicio|Rutas|Mapa|Comunidad|Stats|Perfil)<\/span>/g)].map(match => match[1]),
        ['Inicio', 'Rutas', 'Mapa', 'Comunidad', 'Stats', 'Perfil']
    );
});
