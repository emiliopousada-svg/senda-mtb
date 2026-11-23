# Changelog

Todas las novedades y cambios relevantes de **senda-mtb** se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [0.2.36] - 2026-11-23

### Cambiado
* **Grupos:** al revocar el acceso desde la sesión o detectar el cambio de membresía, la interfaz desconecta inmediatamente el estado del grupo y muestra el flujo para volver a unirse.
* **Grupos:** la desconexión se conserva aunque falle la recarga posterior del grupo.

## [0.2.34] - 2026-03-26

### Añadido
* **Comunidad · Segmentos MTB:** catálogo cercano con la ruta asociada, podio de tres tiempos y mejor marca personal.
* **Récords de segmentos:** detección automática en las salidas guardadas no importadas; solo se publica el apodo y el tiempo, y el récord histórico no puede empeorar.

### Cambiado
* **Mapa:** el indicador GPS distingue estados de señal y los indicadores de métricas amplían su visualización al pulsarlos.
* **Perfil:** los controles de servidor y sincronización se apilan para no tapar el apodo.

## [0.2.33] - 2026-11-22

### Añadido
* **Perfil:** avatar opcional durante el registro; si no se sube una foto, se usa el icono de senda-mtb.
* **Sincronización:** acceso manual desde el encabezado del perfil, con estado azul en reposo y naranja durante la sincronización.

### Cambiado
* **Perfil:** el editor de datos físicos deja de incluir la carga del avatar y se elimina el aviso de rutas locales sin sesión.
* **Rutas comunitarias:** se retiran la clasificación y la publicación de marcas en las fichas de rutas; las funciones de segmentos se conservan.

## [0.2.32] - 2026-11-22

### Cambiado
* **Mapa horizontal:** se oculta el perfil en directo, se alinean los tres botones al grabar y se ajustan el banner superior y los controles laterales.

## [0.2.31] - 2026-11-22

### Añadido
* **Desafíos del grupo:** al finalizar, los miembros que alcanzaron la meta reciben una medalla en el palmarés; el desafío queda archivado.

### Cambiado
* **Perfil:** la localidad se integra en «Cuenta y sincronización» y el editor abre esa sección cuando hace falta.
* **Desafíos del grupo:** las metas ahora van de 10 a 20.000.
* **Mapa:** los controles laterales y el panel inferior se compactan en horizontal; los indicadores se distribuyen a ambos lados de los botones centrados.

## [0.2.30] - 2026-11-22

### Cambiado
* **Perfil:** Cuenta y sincronización agrupa los datos de sesión y perfil; el indicador del servidor queda junto al avatar y la sección Social muestra iconos de muestra.
* **Mapa:** los controles laterales reaparecen al tocar el mapa después de ocultarse, sin un botón lateral.
* **Entrenamiento:** se elimina el acceso «Configurar en Stats» de la tarjeta de perfil.

## [0.2.29] - 2026-11-20

### Cambiado
* **Mapa:** Distancia pasa al banner superior y Cadencia se incorpora al panel inferior.
* **Centro de control:** el panel de grabación permite ordenar y mostrar u ocultar Cadencia; las preferencias anteriores migran al nuevo conjunto de métricas.

---

## [0.2.28] - 2026-11-20

### Añadido
* **Mapa:** banner de actividad en directo y panel inferior rediseñado con métricas, perfil de altitud y controles de grabación.
* **Seguimiento:** las rutas guardadas y comunitarias vuelven al mapa al seleccionarlas; las fotos de POI se cargan en segundo plano.
* **Rutas comunitarias:** el importador conserva las firmas de los ficheros en PocketBase para detectar cambios entre ejecuciones.

### Cambiado
* **Mapa:** al grabar sin seguir una ruta, el perfil de altitud aparece dentro del panel inferior y permanece visible al plegarlo. El panel y los controles laterales vuelven a plegarse 20 segundos después de desplegarlos durante una actividad.
* **Navegación:** las transiciones entre páginas usan un deslizamiento horizontal de 320 ms con desaceleración suave.
* **Sincronización de cuenta:** las subidas de avatar y las actualizaciones de datos físicos conservan los cambios locales recientes y permiten borrar esos datos del perfil.
* **Recursos web:** se añaden verificaciones de integridad a dependencias externas y se ajusta la caché del service worker.

---

## [0.2.27] - 2026-11-20

### Añadido
* **Perfil físico:** campo de altura sincronizado con PocketBase y guardado localmente para futuras estimaciones.

### Cambiado
* **Inicio:** las estadísticas se refrescan tras cargar las rutas locales y recuperar un borrador de grabación.
* **Perfil:** la sincronización actualiza los campos sin cambios locales y conserva ediciones y snapshots más recientes pendientes de subida.
* **Rutas comunitarias:** el importador de Galicia comprueba metadatos cada cinco minutos e importa solo ficheros nuevos o modificados.
* **Caché sin conexión:** cada versión del service worker usa una caché identificada por el hash del propio worker; el build falla si deja marcadores sin sustituir.

## [0.2.24] - 2026-11-19

### Añadido
* **Centro de control:** iconos de Facebook, Instagram y TikTok en Social, sin enlaces ni conexiones externas.

### Cambiado
* **Rutas comunitarias:** se retira el catálogo oficial de Galicia y se conserva el acceso a las rutas favoritas.
* **PocketBase:** la app recupera la configuración cuando el servidor guardado no es válido.

### Eliminado
* **Strava:** se retiran la integración, sus hooks y la dependencia del cliente. Se conserva la migración existente y los datos de PocketBase.

## [0.2.14] - 2026-11-18

### Cambiado
* **Inicio:** la cabecera del saludo se reorganiza: marca y estados de red/GPS arriba, avatar junto al saludo con un resumen de la última salida y accesos a Centro de control y Cockpit con el mismo ancho.
* **Navegación:** el botón Atrás Android cierra primero las ventanas abiertas del Centro de control y los diálogos antes de navegar hacia atrás.
* **Salida:** al volver a Inicio se pide confirmación antes de cerrar la app y se informa claramente si hay una grabación activa.

## [0.2.13] - 2026-11-18

### Añadido
* **Strava:** conexión OAuth desde herramientas sociales, almacenamiento cifrado de credenciales en PocketBase y subida de salidas grabadas como GPX.
* **Rutas comunitarias de Galicia:** importación automática desde carpetas del servidor, incluyendo subcarpetas; se amplía la lectura de tracks y archivos GPX grandes.
* **Inicio:** vista de la última ruta sobre terreno satélite con relieve 3D.

### Cambiado
* **Rutas:** las fichas se adaptan al ancho de la pantalla móvil.
* **Importación:** el escaneo de rutas de Galicia se ejecuta desde una tarea programada y muestra diagnósticos en el registro.

### Corregido
* **Strava:** se valida correctamente la ausencia de la clave de cifrado y se escapa el mensaje del callback antes de mostrarlo en HTML.

## [0.2.9] - 2026-11-17

### Cambiado
* **Repositorio:** se actualizan el enlace de soporte de la app y la documentación a `emiliopousada-svg/senda-mtb`.

## [0.2.8] - 2026-11-17

### Cambiado
* **Icono de la app:** se adopta el emblema de montaña, sendero y rueda en Android, iOS, la PWA y el acceso de la barra lateral. Se añade una variante con margen seguro para máscaras adaptables y se renueva la caché web.

## [0.2.7] - 2026-11-17

### Cambiado
* **Consumo y sincronización:** las ubicaciones de grupo se consultan cuando se abre el mapa o la comunidad; los puntos compartidos se sondean periódicamente solo con el mapa visible y se elimina el refresco global de Seguridad.
* **GPS:** tras descartar un salto imposible se reinicia el punto de referencia para recuperar una velocidad válida en la siguiente lectura.

## [0.2.6] - 2026-11-17

### Añadido
* **Calendario:** vista mensual y creación local de eventos para rutas, quedadas y mantenimiento.
* **Perfil deportivo:** actividad histórica, bicicleta del Garaje, logros verificables, datos de rendimiento y localidad guardada en el dispositivo.
* **Centro de control:** espacio Social para futuras integraciones y acceso unificado a grabación, sensores, cartografía, mapas sin conexión y ajustes.

### Cambiado
* **Seguridad:** los contactos se gestionan desde un formulario plegable y el primero guardado queda preseleccionado para preparar el SOS; la ubicación en directo se configura en Ajustes varios.
* **Navegación y comunidad:** se ajusta el carrusel entre pantallas y se muestran avatares con nombre para compañeros conectados.

## [0.2.5] - 2026-11-17

### Añadido
* **Cockpit:** el velocímetro cambia de color según la velocidad (azul, verde, amarillo, naranja y rojo), con transiciones suaves; los iconos de pulso, cadencia y potencia se iluminan al conectar sus sensores.
* **Compañeros cerca:** avatares con nombre; al pulsar uno, el mapa centra y abre la posición de ese compañero.

### Cambiado
* **Cockpit:** encabezado rediseñado, estado de grabación visible en verde y controles de Inicio alineados con los indicadores.
* **Mapa:** panel de métricas y perfil de altitud en directo más compactos; la atribución cartográfica permanece visible.
* **Navegación:** Inicio aparece primero al abrir la app y el orden del carrusel sigue el menú inferior.

## [0.2.4] - 2026-11-17

### Añadido
* **Garaje:** en Más herramientas, con la foto de tu bici arriba y su nombre. Registra revisiones y mantenimiento (revisión general, cadena, frenos, neumáticos, suspensión, transmisión, líquido tubeless, lavado y engrase u otro) con fecha, coste y notas. Cuenta los kilómetros desde la última revisión general con las salidas grabadas, avisa cuando toca según el intervalo que elijas (1000 km por defecto) y muestra los kilómetros desde el último cambio de cada pieza. Los datos se guardan en el móvil.
* **Relieve 3D en "Tu mapa":** la pantalla de inicio muestra la última ruta como un relieve en 3D que se puede girar; si la ruta no tiene altitud, se mantiene el trazado en 2D.
* Pruebas `tests/garage.test.js`, `tests/route-relief.test.js`, `tests/status-bar.test.js` y `tests/dashboard-greeting.test.js`.

### Cambiado
* **Barra de estado:** una franja negra bajo la barra del teléfono deja siempre visibles la hora, la cobertura y la batería. El mapa y las páginas empiezan debajo, y en Android los iconos de la barra son siempre claros (SystemBars `DARK`).
* **Caché sin conexión:** el service worker incluye también `recording-panel.js`, `cockpit.js`, `safety.js`, `route-relief.js`, `garage.js` y `tools.js`.
* **Cuenta:** el formulario de acceso funciona con Intro, evita envíos dobles y tiene etiquetas y autocompletado.
* Se añade el icono `icon-192.png` y `icon-512.png` pasa a medir 512 px.

### Eliminado
* **Senda AI:** se quitan la tarjeta y el panel de ejemplo de Más herramientas.
* **Sitios de comida en el mapa:** ya no se pueden marcar. Los que ya estaban guardados se siguen viendo y se pueden borrar.

### Corregido
* **Saludo de inicio:** al arrancar la app ya no aparece el error «Cloud is not defined». Mientras carga la sesión, el saludo y la foto de perfil usan el apodo y la foto guardados. El error también impedía activar el indicador de conexión, que vuelve a funcionar.

## [0.2.3] - 2026-11-17

### Añadido
* **Configuración por entorno:** `app/config.js` define los entornos `production`, `staging` y `development` (servidor PocketBase, uso de http local y modo depuración). `scripts/prepare-web.js` elige el entorno con `MTB_APP_ENV` y, opcionalmente, el servidor con `MTB_CLOUD_SERVER`; por defecto compila para producción. Ver la sección Entornos del README.
* La compilación rechaza entornos desconocidos, URLs no válidas y releases (`vX.Y.Z`) que no sean de producción.
* Ajustes muestra el entorno junto a la versión cuando no es producción.
* Pruebas `tests/app-config.test.js`.
* **Sensores Bluetooth registrados:** pulsómetro, cadencia, potenciómetro y velocímetro recuerdan el último dispositivo conectado. Mientras estén activados se conectan solos al abrir la app, al volver a ella, al empezar a grabar y tras perder la conexión (reintentos cada 5-30 s, sin abrir el selector ni gastar batería con la app en segundo plano sin grabar). Ajustes > Sensores muestra los registrados con la opción Olvidar para elegir otro. El pulsómetro guardado por versiones anteriores se conserva.
* Pruebas `tests/sensors.test.js`.

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
* **Rutas duplicadas en la comunidad:** una ruta ya publicada no se puede volver a publicar; la app actualiza la publicación existente y el hook `community_routes.pb.js` rechaza duplicados del mismo autor (mismo trazado, o misma distancia y tiempo en movimiento).
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

