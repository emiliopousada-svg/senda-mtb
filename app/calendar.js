'use strict';

const CALENDAR_EVENTS_KEY = 'mtb_pro_calendar_events';
const CALENDAR_CATEGORIES = Object.freeze({
    route: { label: 'Ruta planificada', icon: '🚵' },
    meetup: { label: 'Quedada grupal', icon: '👥' },
    garage: { label: 'Garaje', icon: '🔧' }
});

function calendarDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calendarDateFromKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return calendarDateKey(date) === value ? date : null;
}

function calendarAddDays(date, days) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + days);
    return result;
}

function calendarCreateMockEvents(today = new Date()) {
    return [
        {
            id: 'mock-garage',
            category: 'garage',
            title: 'Garaje: Revisar líquido tubeless',
            date: calendarDateKey(calendarAddDays(today, 2)),
            time: '18:00',
            details: 'Mantenimiento · Bicicleta principal'
        },
        {
            id: 'mock-route',
            category: 'route',
            title: 'Ruta: Senda del Río Verdugo',
            date: calendarDateKey(calendarAddDays(today, 4)),
            time: '09:00',
            details: 'Ponte Caldelas · 42 km · 850 m+',
            weather: '☀️ 16°C · Soleado'
        },
        {
            id: 'mock-meetup',
            category: 'meetup',
            title: 'Quedada grupal: Enduro Ponte Caldelas',
            date: calendarDateKey(calendarAddDays(today, 5)),
            time: '08:30',
            details: '8 asistentes · Salida desde la plaza'
        }
    ];
}

function calendarNormalizeUserEvents(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    return value.filter(event => {
        if (!event || typeof event !== 'object') return false;
        const id = typeof event.id === 'string' ? event.id.trim() : '';
        const title = typeof event.title === 'string' ? event.title.trim().slice(0, 80) : '';
        const valid = id && !ids.has(id)
            && Object.prototype.hasOwnProperty.call(CALENDAR_CATEGORIES, event.category)
            && calendarDateFromKey(event.date)
            && typeof event.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.time)
            && title;
        if (!valid) return false;
        ids.add(id);
        return true;
    }).map(event => ({
        id: event.id.trim(),
        category: event.category,
        title: event.title.trim().slice(0, 80),
        date: event.date,
        time: event.time,
        details: typeof event.details === 'string' ? event.details.slice(0, 120) : '',
        weather: ''
    }));
}

function calendarBuildMonthCells(year, month, events = [], selectedDate = '', todayDate = calendarDateKey(new Date())) {
    const firstOfMonth = new Date(year, month, 1);
    const daysFromMonday = (firstOfMonth.getDay() + 6) % 7;
    const firstCell = new Date(year, month, 1 - daysFromMonday);
    const eventCategoriesByDate = new Map();
    events.forEach(event => {
        if (!event || !event.date || !CALENDAR_CATEGORIES[event.category]) return;
        const categories = eventCategoriesByDate.get(event.date) || [];
        if (!categories.includes(event.category)) categories.push(event.category);
        eventCategoriesByDate.set(event.date, categories);
    });

    return Array.from({ length: 42 }, (_, index) => {
        const date = calendarAddDays(firstCell, index);
        const key = calendarDateKey(date);
        return {
            date: key,
            day: date.getDate(),
            inCurrentMonth: date.getMonth() === month,
            selected: key === selectedDate,
            today: key === todayDate,
            categories: eventCategoriesByDate.get(key) || []
        };
    });
}

function calendarEventsForDate(events, selectedDate, todayDate = calendarDateKey(new Date())) {
    const visibleEvents = selectedDate === todayDate
        ? events.filter(event => event.date >= todayDate)
        : events.filter(event => event.date === selectedDate);
    return [...visibleEvents].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

let calendarUserEvents = [];
let calendarMockEvents = [];
let calendarSelectedDate = calendarDateKey(new Date());
let calendarVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function calendarElement(id) {
    return document.getElementById(id);
}

function calendarShowStatus(message, state = '') {
    const status = calendarElement('calendar-status');
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function calendarLoadUserEvents() {
    try {
        const stored = localStorage.getItem(CALENDAR_EVENTS_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) throw new Error('La lista de eventos no es válida.');
        calendarUserEvents = calendarNormalizeUserEvents(parsed);
        if (calendarUserEvents.length !== parsed.length) {
            calendarShowStatus('Se omitieron eventos guardados con datos no válidos.', 'error');
        }
    } catch (error) {
        console.error('No se pudieron cargar los eventos del calendario:', error);
        calendarShowStatus('No se pudieron leer los eventos guardados en este dispositivo.', 'error');
    }
}

function calendarAllEvents() {
    return [...calendarMockEvents, ...calendarUserEvents];
}

function calendarFormatMonth(date) {
    const formatted = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date);
    return formatted.charAt(0).toLocaleUpperCase('es-ES') + formatted.slice(1);
}

function calendarFormatDay(dateKey) {
    const date = calendarDateFromKey(dateKey);
    if (!date) return '';
    return new Intl.DateTimeFormat('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    }).format(date).replace(/\./g, '');
}

function calendarRenderDays() {
    const grid = calendarElement('calendar-grid');
    const label = calendarElement('calendar-month-label');
    if (!grid || !label) return;
    label.textContent = calendarFormatMonth(calendarVisibleMonth);
    const todayDate = calendarDateKey(new Date());
    const events = calendarAllEvents();
    const cells = calendarBuildMonthCells(
        calendarVisibleMonth.getFullYear(),
        calendarVisibleMonth.getMonth(),
        events,
        calendarSelectedDate,
        todayDate
    );
    grid.replaceChildren(...cells.map(cell => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'calendar-day';
        if (!cell.inCurrentMonth) button.classList.add('outside-month');
        if (cell.selected) button.classList.add('selected');
        if (cell.today) button.classList.add('today');
        button.dataset.calendarDate = cell.date;
        button.setAttribute('aria-pressed', String(cell.selected));
        if (cell.today) button.setAttribute('aria-current', 'date');
        const eventCount = events.filter(event => event.date === cell.date).length;
        const dateLabel = new Intl.DateTimeFormat('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }).format(calendarDateFromKey(cell.date));
        const eventLabel = eventCount ? `, ${eventCount} ${eventCount === 1 ? 'evento' : 'eventos'}` : '';
        button.setAttribute('aria-label', `${dateLabel}${eventLabel}`);

        const number = document.createElement('span');
        number.className = 'calendar-day-number';
        number.textContent = String(cell.day);
        const dots = document.createElement('span');
        dots.className = 'calendar-day-dots';
        cell.categories.forEach(category => {
            const dot = document.createElement('span');
            dot.className = `calendar-dot calendar-dot-${category}`;
            dot.setAttribute('aria-hidden', 'true');
            dots.append(dot);
        });
        button.append(number, dots);
        return button;
    }));
}

function calendarRenderEvents() {
    const list = calendarElement('calendar-events-list');
    const context = calendarElement('calendar-events-context');
    if (!list || !context) return;
    const todayDate = calendarDateKey(new Date());
    const events = calendarEventsForDate(calendarAllEvents(), calendarSelectedDate, todayDate);
    context.textContent = calendarSelectedDate === todayDate
        ? 'Hoy y los próximos días'
        : `Para ${calendarFormatDay(calendarSelectedDate)}`;

    if (!events.length) {
        const empty = document.createElement('p');
        empty.className = 'calendar-empty';
        empty.textContent = 'No hay eventos para esta fecha. Pulsa + para añadir uno.';
        list.replaceChildren(empty);
        return;
    }

    list.replaceChildren(...events.map(event => {
        const category = CALENDAR_CATEGORIES[event.category];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'calendar-event-card';
        button.dataset.calendarEventDate = event.date;
        button.dataset.category = event.category;
        button.setAttribute('aria-label', `${event.title}, ${calendarFormatDay(event.date)} a las ${event.time}`);

        const icon = document.createElement('span');
        icon.className = 'calendar-event-icon';
        icon.textContent = category.icon;
        const copy = document.createElement('span');
        copy.className = 'calendar-event-copy';
        const title = document.createElement('strong');
        title.textContent = event.title;
        const meta = document.createElement('span');
        meta.className = 'calendar-event-meta';
        meta.textContent = `${calendarFormatDay(event.date)} · ${event.time}`;
        copy.append(title, meta);
        if (event.details) {
            const details = document.createElement('span');
            details.className = 'calendar-event-details';
            details.textContent = event.details;
            copy.append(details);
        }
        button.append(icon, copy);
        if (event.weather) {
            const weather = document.createElement('span');
            weather.className = 'calendar-weather';
            weather.textContent = event.weather;
            button.append(weather);
        }
        return button;
    }));
}

function calendarRender() {
    calendarRenderDays();
    calendarRenderEvents();
}

function calendarSelectDate(dateKey) {
    if (!calendarDateFromKey(dateKey)) return;
    calendarSelectedDate = dateKey;
    const date = calendarDateFromKey(dateKey);
    calendarVisibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    calendarRender();
}

function calendarChangeMonth(amount) {
    const nextMonth = new Date(calendarVisibleMonth.getFullYear(), calendarVisibleMonth.getMonth() + amount, 1);
    calendarVisibleMonth = nextMonth;
    calendarSelectedDate = calendarDateKey(nextMonth);
    calendarRender();
}

function calendarOpenCreateDialog() {
    const dialog = calendarElement('calendar-create-dialog');
    const form = calendarElement('calendar-form');
    const dateInput = calendarElement('calendar-event-date');
    const timeInput = calendarElement('calendar-event-time');
    if (!dialog || !form || !dateInput || !timeInput) return;
    form.reset();
    dateInput.value = calendarSelectedDate;
    timeInput.value = '09:00';
    const status = calendarElement('calendar-form-status');
    if (status) {
        status.textContent = '';
        delete status.dataset.state;
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    calendarElement('calendar-event-title')?.focus();
}

function calendarCloseCreateDialog() {
    const dialog = calendarElement('calendar-create-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
}

function calendarSaveEvent(event) {
    event.preventDefault();
    const categoryInput = calendarElement('calendar-event-category');
    const titleInput = calendarElement('calendar-event-title');
    const dateInput = calendarElement('calendar-event-date');
    const timeInput = calendarElement('calendar-event-time');
    const status = calendarElement('calendar-form-status');
    const category = categoryInput?.value;
    const title = String(titleInput?.value || '').trim().slice(0, 80);
    const date = String(dateInput?.value || '');
    const time = String(timeInput?.value || '');
    if (!CALENDAR_CATEGORIES[category] || !title || !calendarDateFromKey(date)
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        if (status) {
            status.textContent = 'Revisa la categoría, el título, la fecha y la hora.';
            status.dataset.state = 'error';
        }
        return;
    }

    const newEvent = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category,
        title,
        date,
        time,
        details: 'Evento añadido en este dispositivo'
    };
    const nextEvents = [...calendarUserEvents, newEvent];
    try {
        localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(nextEvents));
    } catch (error) {
        console.error('No se pudo guardar el evento del calendario:', error);
        if (status) {
            status.textContent = 'No se pudo guardar el evento en este dispositivo.';
            status.dataset.state = 'error';
        }
        return;
    }

    calendarUserEvents = nextEvents;
    calendarSelectedDate = date;
    const selected = calendarDateFromKey(date);
    calendarVisibleMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    calendarCloseCreateDialog();
    calendarShowStatus('Evento guardado en este dispositivo.', 'success');
    calendarRender();
}

function calendarOpenWorkspace() {
    toolsOpenWorkspace('calendar-workspace');
    calendarRender();
}

function calendarCloseWorkspace() {
    toolsCloseWorkspaces();
    document.querySelector('.tools-hub')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function calendarBindUI() {
    calendarElement('calendar-back')?.addEventListener('click', calendarCloseWorkspace);
    calendarElement('calendar-add')?.addEventListener('click', calendarOpenCreateDialog);
    calendarElement('calendar-prev')?.addEventListener('click', () => calendarChangeMonth(-1));
    calendarElement('calendar-next')?.addEventListener('click', () => calendarChangeMonth(1));
    calendarElement('calendar-grid')?.addEventListener('click', event => {
        const button = event.target.closest('[data-calendar-date]');
        if (button) calendarSelectDate(button.dataset.calendarDate);
    });
    calendarElement('calendar-events-list')?.addEventListener('click', event => {
        const button = event.target.closest('[data-calendar-event-date]');
        if (button) calendarSelectDate(button.dataset.calendarEventDate);
    });
    calendarElement('calendar-form')?.addEventListener('submit', calendarSaveEvent);
    calendarElement('calendar-cancel')?.addEventListener('click', calendarCloseCreateDialog);
    calendarElement('calendar-dialog-close')?.addEventListener('click', calendarCloseCreateDialog);

    calendarMockEvents = calendarCreateMockEvents(new Date());
    calendarLoadUserEvents();
    calendarRender();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calendarDateKey,
        calendarCreateMockEvents,
        calendarNormalizeUserEvents,
        calendarBuildMonthCells,
        calendarEventsForDate
    };
}

if (typeof document !== 'undefined') calendarBindUI();
