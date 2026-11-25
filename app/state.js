'use strict';

//  ESTADO GLOBAL
// ============================================================
let map = null, userMarker = null, routePolyline = null, routePolylines = [], routePolylinePointCount = 0;
let routePolylinePoints = [], routePolylineLastPoint = null, savedRouteLayer = null, offlineTileLayer = null;
let routeRenderedPointCount = 0;
const MAX_ROUTE_RENDER_POINTS = 250;
let activeMapStyle = null, mapStyleLayers = {};
let isRecording = false, isPaused = false, bgActive = false;
let autoPaused = false, autoPauseInterval = null;
let autoPauseAnchor = null, autoPauseLastPosition = null, autoPauseLastMovementAt = null;
let autoPauseResumeCandidate = null;
let recordingActivityType = 'mtb';
let movingMs = 0, segStart = null, timerInterval = null, draftInterval = null;
let totalDistance = 0, elev = makeElevTracker();
let points = [], lastAccepted = null, resumeBreak = false, startedAt = null;
let lastLat = null, lastLon = null, lastAccuracy = null, lastPositionAt = 0, following = true, firstFix = false, lastPosSave = 0;
let lastHeading = null; // Último rumbo GPS válido; se conserva al detenerse.
let lastCourseFix = null; // Posición de referencia para calcular el rumbo si el GPS nativo no lo da.
let currentHr = null;
let currentCadence = null, currentPower = null, currentBleSpeed = null, currentBleSpeedAt = 0;
let lastCscReading = null;
let rideBattery = null, nativeBatteryInfo = null, batteryCheckInterval = null;
let rideAdvisoryToken = 0, batteryPollAt = 0;
const batteryWarnings = new Set();
let mapRotationEnabled = true;
let savedRoutes = [];
let followedRoute = null, offRouteState = false;
let routeProfileCoords = [], routeProfilePointCount = 0;
let offRouteAudioContext = null;
let statsPeriod = 'weekly';
let statsChart = null;

const btnStart = $('btn-start'), btnStop = $('btn-stop');
const lblStart = $('lbl-start'), icoStart = $('ico-start');

// ============================================================
