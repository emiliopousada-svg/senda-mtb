# Changelog

Todas las novedades y cambios relevantes de **senda-mtb** se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Sin publicar]

### Añadido
* **Configuración por entorno:** `app/config.js` define los entornos `production`, `staging` y `development` (servidor PocketBase, uso de http local y modo depuración). `scripts/prepare-web.js` elige el entorno con `MTB_APP_ENV` y, opcionalmente, el servidor con `MTB_CLOUD_SERVER`; por defecto compila para producción. Ver la sección Entornos del README.
* La compilación rechaza entornos desconocidos, URLs no válidas y releases (`vX.Y.Z`) que no sean de producción.
* Ajustes muestra el entorno junto a la versión cuando no es producción.
* Pruebas `tests/app-config.test.js`.

### Cambiado
* **Mapa: panel inferior único.** Las métricas (km/h, distancia, desnivel, pulso, tiempo en movimiento…) pasan de la parte superior a un panel abajo, encima de la navegación, que incluye también Comenzar/Pausar ruta, Dejar de seguir ruta y Finalizar. En horizontal, métricas y botones van en una sola fila.
* Hasta 5 métricas se muestran en una fila; con más, en dos filas equilibradas.
* Los gráficos de desnivel (perfil de la ruta seguida y perfil en directo) van justo encima del panel; los botones laterales y el zoom quedan arriba. La atribución del mapa se coloca siempre encima de todo lo apilado abajo.
* **Contactos de emergencia en la cuenta:** se guardan en tus preferencias privadas de PocketBase y se recuperan al iniciar sesión en otro móvil. Los que ya tenías en el móvil se suben la primera vez; al cambiar de cuenta no se heredan los de otro usuario.
* El interruptor "Compartir ubicación en directo con mi grupo" pasa a la tarjeta "Durante la salida".
* **Grabar exige cuenta:** para comenzar una ruta hay que tener la sesión iniciada y el apodo elegido; si falta, se ofrece ir directamente a Ajustes > Cuenta.
* En horizontal las columnas de iconos se compactan para no quedar bajo la barra de navegación.

### Eliminado
* **Aviso de salida (Seguridad):** se quitan la duración prevista, el margen de retraso, el temporizador, el aviso local programado y la casilla de detección de caídas (no disponible). Una protección pendiente de versiones anteriores se cancela sola.
* **Botones de seguridad y SOS del mapa:** ya no aparecen al grabar. La seguridad de ruta sigue disponible en Herramientas.
* **Tiempo total en el mapa:** ya no se muestra ni se puede elegir en las métricas del mapa (las preferencias guardadas con él se limpian solas). El Cockpit y las estadísticas siguen mostrando el tiempo total.

### Corregido
* **Inicio en móvil:** la tarjeta de bienvenida quedaba detrás de la barra de estado del teléfono (hora, batería, notch). Ahora deja libre la altura real de la barra en cada dispositivo, usando `env(safe-area-inset-top)` y la variable `--safe-area-inset-top` que inyecta Capacitor.

---

## [0.2.2] - 2026-11-17

### Añadido
* **Comunidad operativa:** las pestañas Desafíos, Logros y Actividad ya funcionan con datos del servidor.
  * **Desafíos de grupo:** cualquier miembro crea retos de distancia, desnivel, salidas o tiempo con fecha de fin; se muestra el progreso de cada miembro. El creador o el administrador del grupo pueden borrarlos.
  * **Temporada activa:** clasificación de la temporada de cuatro semanas con barra de progreso y días restantes.
  * **Títulos y palmarés:** campeón, King of the Mountain, Fastest Rider, Climbing Beast y Most Consistent, historial de las últimas 12 temporadas y medallero.
  * **Actividad del grupo:** salidas compartidas, récords del grupo y desafíos creados o completados.
  * **Ranking de segmentos:** la categoría de segmentos muestra cuántos segmentos lidera cada miembro.
* Hook `pb_hooks/group_league.pb.js` y migración `1794836000_create_group_challenges.js` (ver POCKETBASE.md).

### Cambiado
* **Nombre senda-mtb en Android:** nombre de la app bajo el icono y título de la actividad (`strings.xml`), diálogo de salida (`MainActivity.java`), notificaciones de grabación en segundo plano, batería, SOS y aviso de ruta, encabezado de estadísticas, aviso de actualización, creador de los GPX exportados y comentario del service worker.
* **Nombre senda-mtb en iOS:** nombre visible de la app (`CFBundleDisplayName`) y textos de los permisos de ubicación, ubicación en segundo plano y Bluetooth en `Info.plist`.

### Corregido
* El ranking de temporada salía siempre a cero porque `mtb_group_ranking_entries` no tenía fecha de creación; ahora se usa la fecha de la salida.
* Crear un grupo sin icono fallaba en el servidor ("request Content-Type isn't multipart/form-data").
* `app/community-hub.js` no estaba en la caché offline del service worker.
* `POCKETBASE.md` indicaba que las colecciones de temporadas y desafíos seguían pendientes de despliegue; ya están en producción.

### Eliminado
* Migración pendiente `PENDING_1794836000_create_competition_collections.js`, sustituida por la nueva.

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

