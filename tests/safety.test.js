'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { safetyNormalizePhone, safetyNormalizeContacts, safetyBuildWhatsAppUrl, safetyBuildSOSMessage } = require('../app/safety.js');

function loadSafetyUi(initialContacts = []) {
    class FakeElement {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.listeners = {};
            this.attributes = {};
            this.hidden = false;
        }

        addEventListener(type, listener) { this.listeners[type] = listener; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        focus() {}
    }

    const elements = new Map();
    const getElement = id => {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
    };
    const storage = new Map();
    if (initialContacts.length) {
        storage.set('mtb_pro_safety_contacts', JSON.stringify(initialContacts));
    }
    const openedUrls = [];
    const context = {
        console,
        document: {
            getElementById: getElement,
            createElement: () => new FakeElement(),
            querySelector: () => new FakeElement()
        },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        module: { exports: {} },
        window: {
            addEventListener() {},
            setInterval() {},
            open: url => {
                openedUrls.push(url);
                return {};
            },
            Capacitor: null
        }
    };
    const source = fs.readFileSync(path.join(__dirname, '../app/safety.js'), 'utf8');
    vm.runInNewContext(source, context);
    return { getElement, openedUrls };
}

test('emergency phone numbers are normalized to international format', () => {
    assert.equal(safetyNormalizePhone('+34 (600) 123-456'), '+34600123456');
    assert.equal(safetyNormalizePhone('0600123456'), null);
    assert.equal(safetyNormalizePhone('not a phone'), null);
});

test('WhatsApp composer URL encodes the SOS message and validates its recipient', () => {
    const url = safetyBuildWhatsAppUrl(
        { phone: '+34600123456' },
        'Necesito ayuda\nUbicación: https://maps.google.com/?q=40.1,-3.2'
    );
    assert.match(url, /^https:\/\/wa\.me\/34600123456\?text=/);
    assert.match(decodeURIComponent(url), /Necesito ayuda/);
    assert.throws(() => safetyBuildWhatsAppUrl({ phone: '123' }, 'SOS'), /formato internacional/);
});

test('SOS message labels the last known location and handles a missing fix', () => {
    const withLocation = safetyBuildSOSMessage({
        lat: 40.1,
        lon: -3.2,
        updatedAt: Date.now(),
        accuracy: 18
    });
    assert.match(withLocation, /Última ubicación conocida/);
    assert.match(withLocation, /maps\.google\.com\/\?q=40\.1,-3\.2/);
    assert.match(withLocation, /precisión aproximada ±18 m/);

    const withoutLocation = safetyBuildSOSMessage({});
    assert.match(withoutLocation, /no dispone de una ubicación conocida/);
    assert.doesNotMatch(withoutLocation, /maps\.google\.com/);
});

test('emergency contact lists drop invalid entries, duplicates and extras', () => {
    assert.deepEqual(safetyNormalizeContacts(null), []);
    assert.deepEqual(safetyNormalizeContacts([
        { name: ' Ana ', phone: '+34 600 123 456' },
        { name: 'Otra', phone: '+34600123456' },
        { name: 'Sin teléfono', phone: '' },
        { name: 'Luis', phone: '34611222333' }
    ]), [
        { name: 'Ana', phone: '+34600123456' },
        { name: 'Luis', phone: '+34611222333' }
    ]);
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, phone: `+3460000000${i}` }));
    assert.equal(safetyNormalizeContacts(many).length, 5);
});

test('emergency contact form collapses after saving and can be reopened', () => {
    const { getElement } = loadSafetyUi();
    const form = getElement('safety-contact-form');
    const addButton = getElement('safety-add-contact');
    const callLink = getElement('safety-call-contact');
    const list = getElement('safety-contact-list');

    assert.equal(form.hidden, false);
    assert.equal(addButton.hidden, true);
    assert.equal(callLink.hidden, true);
    getElement('safety-contact-name').value = 'Ana';
    getElement('safety-contact-phone').value = '+34 600 123 456';
    form.listeners.submit({ preventDefault() {} });

    assert.equal(form.hidden, true);
    assert.equal(addButton.hidden, false);
    assert.equal(callLink.hidden, false);
    assert.equal(callLink.href, 'tel:+34600123456');
    assert.match(callLink.textContent, /Ana/);
    assert.match(list.children[0].children[0].textContent, /Ana · \+34600123456/);

    addButton.listeners.click();
    assert.equal(form.hidden, false);
    assert.equal(addButton.hidden, true);
});

test('group live-location setting appears in miscellaneous settings, not during-ride safety', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const settingsStart = html.indexOf('id="misc-settings-workspace"');
    const settingsEnd = html.indexOf('id="calendar-workspace"', settingsStart);
    const safetyStart = html.indexOf('<h3 id="safety-active-title">Emergencias</h3>');
    const safetyEnd = html.indexOf('</section>', safetyStart);

    assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
    assert.ok(html.slice(settingsStart, settingsEnd).includes('id="safety-group-sharing"'));
    assert.ok(safetyStart >= 0 && safetyEnd > safetyStart);
    assert.doesNotMatch(html.slice(safetyStart, safetyEnd), /id="safety-group-sharing"/);
    assert.doesNotMatch(html.slice(safetyStart, safetyEnd), /safety-group-status|safety-last-location|safety-location-link/);
});

test('emergency form preselects the first saved contact for WhatsApp SOS', () => {
    const { getElement, openedUrls } = loadSafetyUi([
        { name: 'Ana', phone: '+34600123456' },
        { name: 'Luis', phone: '+34611222333' }
    ]);

    assert.equal(getElement('safety-sos-contact').value, '0');
    getElement('safety-send-sos').listeners.click();

    assert.match(openedUrls[0], /^https:\/\/wa\.me\/34600123456\?text=/);
    assert.match(getElement('safety-status').textContent, /pulsa Enviar/);
});
