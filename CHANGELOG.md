# Changelog

Todas las novedades y cambios relevantes de **senda-mtb** se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Sin publicar]

### Cambiado
* **Nombre senda-mtb en Android:** nombre de la app bajo el icono y título de la actividad (`strings.xml`), diálogo de salida (`MainActivity.java`), notificaciones de grabación en segundo plano, batería, SOS y aviso de ruta, encabezado de estadísticas, aviso de actualización, creador de los GPX exportados y comentario del service worker.

---

## [0.2.1] - 2026-11-17

Primera release publicada de la serie 0.2. Incluye todos los cambios de 0.2.0; la compilación de la etiqueta `v0.2.0` falló en las pruebas por la codificación rota de `index.html` y el BOM de `package.json`, ya corregidos.

---

## [0.2.0] - 2026-11-17

### Cambiado
* **Renombrado de la app:** `senda-brava` / `MTBPro` → **`senda-mtb`** en todos los archivos del proyecto (HTML, JS, CSS, JSON, Markdown, workflows de CI/CD).
* **AI renombrada:** `Camboya AI` → `Senda AI` en interfaz, documentación y casos de prueba.
* **Workflows de GitHub Actions actualizados:** `mtbpro-checks.yml` renombrado a `senda-mtb-checks.yml`; artefactos y títulos de release actualizados al nuevo nombre.
* **Identificador de la app:** `com.emiliopousada.mtbcamboyapro` → `com.emiliopousada.sendamtb` en `android/app/build.gradle` (`namespace` y `applicationId`), `capacitor.config.json`, `strings.xml`, paquete Java y bundle id de iOS. Android la trata como una app nueva: no actualiza la instalada con el identificador anterior ni conserva sus datos locales.

### Añadido
* **Banner de servidor caído:** Al arrancar, la app comprueba la disponibilidad del servidor PocketBase (`/api/health`) y muestra un aviso rojo persistente si no hay conexión, con reintento automático cada 30 s.
* **Mensajes de error mejorados en grupos:** Cuando los hooks de PocketBase (`/api/mtb/groups/*`) no están cargados (error 404), se muestra un mensaje claro pidiendo reiniciar PocketBase con `pb_hooks/` activos.
* **Migración esqueleto para retos/temporadas:** `pb_migrations/PENDING_1794836000_create_competition_collections.js` — colecciones `mtb_group_competitions`, `mtb_group_competition_entries`, `mtb_group_seasons` y `mtb_group_season_awards` listas para activar cuando el módulo esté implementado.

### Corregido
* **Codificación de `index.html`:** el renombrado guardó el archivo con doble codificación (textos como `Â¡Hola`, `prÃ³xima` e iconos rotos); se restaura UTF-8 correcto.
* **Logo del menú lateral:** muestra `senda-mtb` en lugar de `senda-brava`.
* **Avatar en Inicio:** pasa a la esquina superior derecha de la tarjeta principal y crece de 64 a 84 px en móvil y de 68 a 96 px en pantallas grandes.
* **CI con la suite completa:** `senda-mtb checks` ejecuta `npm test` en cada push y PR, incluida la prueba de consistencia de versión.
* **Versión unificada en 0.2.0:** README, `app/config.js` y `package-lock.json` coinciden con `package.json`; se elimina el BOM de `package.json` que hacía fallar la prueba de consistencia de versión.
* **Sincronización de preferencias:** El error cuando falta la colección `mtb_user_preferences` ya muestra un toast específico en lugar de fallar silenciosamente.
* **Hooks de grupos:** Crear grupo, unirse, renovar código y eliminar grupo muestran mensajes de error claros y accionables ante cualquier fallo de red o de hooks del servidor.

---

## [0.1.0] - 2026-11-16

### Añadido
* **Aislamiento Total de Proyecto:**
  * Creación del scaffold independiente para senda-mtb bajo el paquete Android `com.emiliopousada.sendamtb`.
  * Base de datos local aislada en IndexedDB (`mtb_camboya_pro_db`, esquema v2) y claves de almacenamiento con prefijo exclusivo `mtb_pro_*`.
  * Configuración de backend dedicada en `https://mtbpro.ddns.net` con hooks de PocketBase en `pb_hooks/`.
* **Identidad Visual Premium:**
  * Paleta oficial de colores: Fondo Negro grafito (`#101318`), Panel oscuro (`#202630`), Naranja deportivo (`#FF7417`) y Azul eléctrico (`#00B8FF`).
* **Canalización de Build y Empaquetado:**
  * Script `scripts/prepare-web.js` para generación de `www/` con dependencias 100% locales (Leaflet, Leaflet-Rotate, Chart.js) para funcionamiento offline sin depender de CDNs externas.
  * Compilación con **esbuild** de módulos ES (`src/ble.js`, `src/fit-parser.mjs`, `src/native-app.mjs`) a formato IIFE autónomo.
* **Motor Matemático y Estadístico (`app/statistics-engine.js`):**
  * Cálculo geodésico de distancias con la fórmula de Haversine.
  * Algoritmos de filtrado de ruido GPS (> 90 km/h) y suavizado altimétrico con umbral mínimo de 3 metros.
  * Cálculo de VAM (Velocidad Ascensional Media en m/h) y clasificación automática de subidas y descensos.
  * Distribución del tiempo en 5 zonas de frecuencia cardíaca y 7 zonas de potencia Coggan.
* **Parser Binario de Ficheros FIT (`src/fit-parser.mjs`):**
  * Soporte de importación de salidas grabadas con ciclocomputadores Garmin, Wahoo y Bryton.
* **Telemetría Bluetooth Low Energy (`src/ble.js` y `app/sensors.js`):**
  * Soporte nativo multiplexado en Android/Capacitor para Pulsómetro (HRM `0x180D`), Sensores de Cadencia y Velocidad (CSC `0x1816`) y Potenciómetros (Cycling Power `0x1818`).
* **Grabación GPS, Background y Resiliencia de Ciclo de Vida (Fase 2):**
  * Servicio en primer plano (*Foreground Service*) de tipo `location` en Android mediante `@capacitor-community/background-geolocation` para grabación continua con pantalla apagada.
  * Persistencia inmediata de borrador en IndexedDB en eventos `visibilitychange: hidden` y `pagehide` para evitar pérdida de datos ante cierres forzados por el sistema operativo o falta de batería.
  * Reconstrucción limpia de tramos de ruta (`buildSegments`) y marcado de salto (`resumeBreak`) al recuperar grabaciones interrumpidas sin dibujar líneas artificiales a través del vacío.
  * Filtrado geodésico de precisión GPS (`MAX_ACC_M = 30`), descarte de rebotes en parada (`MIN_STEP_M = 4`) y rechazo de velocidades imposibles (`MAX_SPEED_MS = 25`).
  * Filtrado barométrico y de altitud vertical (`isUsableAltitude`) con descarte de variaciones verticales anómalas (> 5 m/s).
* **Consolidación de Mapas Offline y Control de Cuotas (Fase 3):**
  * Catálogo unificado de 18 regiones con coordenadas geográficas verificadas en `REGION_BOUNDS` (todas las CC.AA. de España, Baleares, Canarias y Portugal continental).
  * Función de estimación previa de teselas y tamaño (`estimateRegionTileCount`) con aviso en la interfaz en tiempo real antes de descargar.
  * Protección proactiva contra desbordamiento de cuota: bloqueo preventivo del botón de descarga si una combinación región/zoom supera las 25.000 teselas (`MAX_TILES_PER_DOWNLOAD`).
  * Aplicación estricta de las políticas de uso de proveedores (`ONLINE_TILE_OFFLINE_CACHE_ENABLED = false` para salvaguardar las directrices de la OpenStreetMap Foundation).
  * Control transaccional atómico de presupuesto en IndexedDB (256 MiB máximos con reserva de 128 MiB para el dispositivo).
* **Suite de Pruebas Automatizadas:**
  * 50 tests unitarios integrados con `node --test` verificando ciclo de vida GPS, telemetría, mapas offline, importación de archivos, resistencia a cierres en IndexedDB y caché del Service Worker.
* **Documentación Maestra del Proyecto:**
  * `PRODUCT_SPEC.md`: Especificación funcional completa, pantallas y pilares del producto.
  * `ARCHITECTURE.md`: Capas del sistema, flujos unidireccionales y módulos de dominio.
  * `DATA_MODEL.md`: Esquemas de persistencia local en IndexedDB y colecciones remotas en PocketBase.
  * `MAP_PROVIDERS.md`: Catálogo de capas cartográficas, atribuciones y políticas de uso offline.
  * `SECURITY_AND_PRIVACY.md`: Política de seguridad, permisos de Android y Guardian Mode.
  * `TEST_PLAN.md`: Matriz de pruebas por fases del roadmap y criterios de aceptación.
  * `CHANGELOG.md`: Historial de versiones y cambios.

