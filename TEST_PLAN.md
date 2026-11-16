# MTB CAMBOYA PRO — Plan de Pruebas y Criterios de Aceptación (TEST_PLAN.md)

**Versión:** 1.0  
**Fecha:** 16 de noviembre de 2026  
**Referencia:** Documento Maestro del Proyecto MTB CAMBOYA PRO  

---

## 1. Estrategia de Pruebas

Para asegurar la máxima robustez en una aplicación orientada a actividades al aire libre con condiciones adversas, la suite de pruebas combina:

1. **Pruebas Unitarias Automatizadas:** Ejecutadas en Node.js sin dependencias pesadas mediante el runner nativo `node --test`.
2. **Pruebas de Integración de Dominio:** Validación de algoritmos matemáticos y procesamiento de telemetría GPS/sensores con conjuntos de datos reales (ficheros FIT y GPX anonimizados).
3. **Pruebas de Hardware y Dispositivo (Android / Web):** Validación de permisos en tiempo de ejecución, desconexiones BLE, pérdida y recuperación de señal GPS y comportamiento en segundo plano con pantalla apagada.
4. **Pruebas de Aislamiento:** Verificación de que la app original y la versión PRO pueden convivir en el mismo terminal sin colisiones de base de datos ni interferencias en la caché.

---

## 2. Cobertura de Pruebas Unitarias (`npm test`)

Actualmente el proyecto cuenta con **50 pruebas unitarias automatizadas** que deben pasar limpiamente antes de cada commit o versión:

### 2.1. Motor Estadístico y Telemetría (`tests/statistics-engine.test.js`)
* Cálculo de distancia geodésica mediante la fórmula de Haversine.
* Filtrado de saltos de GPS imposibles (> 90 km/h) sin conectar puntos a través de la discontinuidad.
* Exclusión de saltos temporales y paradas de grabación en el cálculo de distancia y tiempo transcurrido.
* Suavizado de ruido barométrico y altimétrico para cálculo de desnivel positivo/negativo acumulado y VAM (Velocidad Ascensional Media).
* Clasificación de descensos sostenidos y prevención de invención de VAM sin tiempo de subida real.
* Distribución del tiempo en zonas cardíacas (Z1–Z5) y zonas de potencia Coggan (Z1–Z7).
* Rechazo explícito de entradas de actividad malformadas o inconsistentes.

### 2.2. Grabación GPS, Ciclo de Vida y Recuperación ante Cierre (`tests/recording-lifecycle.test.js`)
* Validación de borradores recuperables (`isDraftRecoverable`) tras cierre forzado de la app.
* Reconstrucción exacta de tramos (`buildSegments`) garantizando que una pausa manual o caída no dibuje líneas rectas erróneas entre los puntos de corte.
* Cálculo de velocidad geodésica (`gpsSpeedFromFix`) y filtrado de ruido parado (< 4 m) o saltos imposibles (> 25 m/s).
* Filtrado de altitud barométrica/vertical (`isUsableAltitude`) descartando lecturas con precisión deficiente (> 15 m) o variaciones irreales (> 5 m/s).
* Cálculo de rumbo geodésico (`bearingBetween`) en los 4 cuadrantes cardinales.
* Comportamiento adaptativo de umbrales de auto-pausa (12–30 m) y auto-reanudación (20–35 m) en función de la precisión GPS.
* Configuración de alta precisión GPS en marcha y bajo consumo en parada.

### 2.3. Mapas Offline y Control de Cuotas (`tests/offline-maps.test.js`)
* Validación de límites geográficos (`REGION_BOUNDS`) de las 18 regiones soportadas (España y Portugal continental).
* Estimación previa de número de teselas (`estimateRegionTileCount`) sin descargas innecesarias.
* Control del límite de seguridad (`MAX_TILES_PER_DOWNLOAD = 25000`) para prevenir bloqueos por desbordamiento.
* Generación de coordenadas TMS invertidas para el servidor del Instituto Geográfico Nacional (IGN).
* Cumplimiento estricto de la directiva de la OpenStreetMap Foundation (`ONLINE_TILE_OFFLINE_CACHE_ENABLED = false`).
* Verificación de constantes de almacenamiento (presupuesto de 256 MiB y reserva local de 128 MiB).
* Formateo localizado de bytes y tamaños en MiB.

### 2.3. Parser de Archivos Binarios FIT (`tests/fit-parser.test.js`)
* Extracción precisa de marcas de tiempo, coordenadas, altitud y pulsaciones desde streams binarios FIT estándar.
* Detección y división de tracks en discontinuidades largas de grabación.
* Tratamiento de archivos corruptos o truncados con emisión de mensajes de error legibles.

### 2.3. Resiliencia de Persistencia Local (`tests/storage-upgrade.test.js`)
* Cierre ordenado de conexiones IndexedDB activas (`onversionchange`) cuando otra pestaña o worker solicita una subida de versión de esquema.
* Detección y aviso cuando una pestaña antigua bloquea la migración (`onblocked`).

### 2.4. Service Worker y Caché Offline (`tests/service-worker.test.js`)
* Validación de intercepción segura de rutas del App Shell (`index.html`, estilos, scripts locales).
* Exclusión estricta de caché para respuestas privadas, cabeceras `no-store` o respuestas variables con `Vary: *`.

### 2.5. Rendimiento Comunitario y Segmentos (`tests/community-performance.test.js`)
* Coincidencia precisa de un track GPS contra un trazado de ruta de referencia (incluso recorrido en sentido inverso).
* Identificación de esfuerzos en segmentos personales dentro de una actividad más larga.
* Rechazo de tracks que no cubren el recorrido completo o que se desvían de la tolerancia geográfica permitida.
* Rechazo de tracks sin marcas de tiempo (evitando estimaciones falsas de tiempo en esfuerzo).

### 2.6. Consistencia de Versión (`tests/version-consistency.test.js`)
* Comprobación automática de que la versión declarada en `package.json` coincide exactamente con `app/config.js` y `README.md`.

---

## 3. Matriz de Pruebas por Fase del Roadmap

| Fase | Área | Prueba / Criterio de Aceptación | Método |
| :--- | :--- | :--- | :--- |
| **0** | **Build & Aislamiento** | Compilación de `www/` limpia, sustitución de CDN por ficheros locales, empaquetado de módulos ES con esbuild. Convivencia con app original sin colisión de DB. | Automatizado (`npm run build`) y manual en Android. |
| **1** | **Persistencia** | Guardado de actividad en IndexedDB tras corte forzado de energía o cierre de app. Recuperación íntegra de la sesión. | Manual / Test de stress en navegador y emulador. |
| **2** | **GPS & Grabación** | Salida en bicicleta de 60 min con pantalla apagada en Android: cero pérdidas de señal no registradas; auto-pausa y auto-reanudación dentro de los márgenes configurados. | Prueba de campo real con APK debug. |
| **3** | **Mapas & Offline** | Carga de mapa sin conexión a internet en zona previamente descargada (IGN); bloqueo de descargas masivas sobre OSM estándar. | Prueba en modo avión. |
| **4** | **Rutas & Seguimiento** | Importación de fichero GPX externo de >100 km; renderizado de perfil altimétrico en menos de 500 ms; aviso acústico y visual de desvío al separarse >60 m. | Emulador GPS / Ruta simulada. |
| **5** | **Sensores BLE** | Emparejamiento simultáneo de banda cardíaca y sensor de cadencia; reconexión automática tras apagar y encender el Bluetooth del móvil en menos de 10 s. | Dispositivos BLE reales (Polar/Garmin). |
| **6** | **Competición** | Creación de grupo, publicación de temporada de 4 semanas, cálculo de ranking y exclusión de actividades duplicadas o con velocidades inverosímiles. | Backend PocketBase de pruebas. |
| **7** | **Guardian Mode** | Disparo de botón SOS con generación de enlace universal de coordenadas; aviso por superación de tiempo previsto de salida. | Validación funcional con contactos de prueba. |
| **8** | **Garaje** | Imputación automática de km de salida a bicicleta seleccionada; salto de notificación al alcanzar el límite de uso de cadena (ej. 2000 km). | Pruebas de integración de datos. |
| **9** | **Comunidad & Eventos**| Creación de evento de salida; inscripción de participantes; visualización de punto de encuentro en el mapa con navegación. | Interfaz web y Android. |
| **10** | **CAMBOYA AI** | Solicitud de análisis de última actividad: respuesta fundamentada estrictamente en los datos de la salida, sin alucinación de métricas. | Casos de prueba de prompts contextuales. |
| **11** | **QA & Publicación** | Generación de APK Release firmado, análisis de seguridad estático, consumo de batería en grabación continua <8% por hora. | Profiler Android Studio. |
| **12** | **Adaptación iOS** | Compilación y arranque en simulador y dispositivo iPhone con permisos de ubicación en uso / background y Bluetooth validados. | Xcode en macOS. |

---

## 4. Criterio de Salida de Fase

Ninguna fase del desarrollo se considerará completada si:
1. Alguno de los 29 tests unitarios falla o se desactiva.
2. Existen llamadas directas no autorizadas entre la capa de presentación y el almacenamiento o backend.
3. Se detecta cualquier fuga de datos, clave o reutilización de caché respecto a la aplicación original.
