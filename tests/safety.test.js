'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { safetyNormalizePhone, safetyBuildWhatsAppUrl, safetyBuildSOSMessage } = require('../app/safety.js');

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
