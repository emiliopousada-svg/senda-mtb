'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const navigationSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'navigation.js'), 'utf8');

function navigationContext(offsets, widths) {
    const swiper = {
        children: offsets.map((offsetLeft, index) => ({
            offsetLeft,
            getBoundingClientRect: () => ({ width: widths[index] })
        })),
        style: {}
    };
    const context = vm.createContext({
        $: () => swiper,
        document: {
            addEventListener() {},
            querySelectorAll() { return []; },
            documentElement: { clientWidth: widths[0] },
            body: { dataset: {} }
        },
        window: {
            addEventListener() {},
            innerWidth: widths[0]
        },
        requestAnimationFrame(callback) { callback(); },
        ResizeObserver: undefined,
        console: { error() {}, warn() {} }
    });
    vm.runInContext(navigationSource, context);
    return { context, swiper };
}

test('page navigation translates to each page actual offset', () => {
    const offsets = [0, 390, 780, 1170, 1560, 1950, 2340];
    const widths = [390, 390, 412, 390, 428, 390, 390];
    const { context, swiper } = navigationContext(offsets, widths);

    offsets.forEach((offset, index) => {
        context.setSwiperPosition(index);
        assert.equal(swiper.style.transform, `translate3d(-${offset}px,0,0)`);
    });
});
