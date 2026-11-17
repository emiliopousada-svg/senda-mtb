# Plan de extracción selectiva — senda-mtb

## Decisiones de proyecto

- Repositorio destino: `emiliopousada-svg/MTBPro` (privado, rama `main`, ya creado).
- El repositorio original `senda-mtb` se consulta en modo solo lectura y no recibe cambios.
- Plataformas: web y Android primero; el scaffold iOS se conserva para una segunda fase.
- Actividad: exclusivamente MTB.
- Mapas: cobertura global online; descargas offline solo con proveedores y zonas cuya licencia permita expresamente ese uso.
- Backend: PocketBase independiente en `https://mtbpro.ddns.net`; la aplicación lo usa como servidor predeterminado y no incluye credenciales.
- Identidad local PRO: IndexedDB `mtb_camboya_pro_db`, claves LocalStorage `mtb_pro_*`, base offline separada y caché Service Worker propia.

## Trazabilidad inicial

El repositorio MTBPro existente partió de una base funcional previa. Esta tabla registra el destino y el trabajo pendiente; no afirma que todos los módulos ya hayan pasado una auditoría exhaustiva.

| Área / origen candidato | Destino actual en PRO | Decisión | Estado |
| --- | --- | --- | --- |
| `config.js` | `app/config.js` | Adaptado | Identidad y valores MTB aislados; configuración por entorno (`production`, `staging`, `development`) elegida en compilación con `MTB_APP_ENV`. |
| `state.js` | `app/state.js` | Adaptar | Reutilizado; revisar modelos de actividad y recuperación de grabaciones. |
| `storage.js` | `app/storage.js` | Adaptar | Nueva base IndexedDB y fotos de ruta; revisar ciclo de migraciones y fallos. |
| `gps.js` | `app/gps.js` | Reutilizar y auditar | Integrado; falta matriz de precisión, pérdida de señal y segundo plano en dispositivos. |
| `recording.js` | `app/recording.js` | Reutilizar y auditar | MTB; falta validar pausa, reanudación y recuperación en Android real. |
| `map.js` / `offline-maps.js` | `app/map.js`, `app/offline-maps.js` | Adaptar | Capas globales online; descargas y cachés de terceros requieren revisión de términos. |
| `route-files.js` / `lib/fit.js` | `app/route-files.js`, `lib/fit.js` | Reutilizar y probar | GPX/FIT integrados; KML y GeoJSON pendientes de validar extremo a extremo. |
| `routes.js` / `route-following.js` / `route-photos.js` | `app/routes.js`, `app/route-following.js`, `app/route-photos.js` | Adaptar | Integrados; validar navegación, exportación y fotos en Android. |
| `statistics-engine.js` / `stats.js` | `app/statistics-engine.js`, `app/stats.js` | Reutilizar motor y rehacer UI | Dashboard y estadísticas usan actividades guardadas; ampliar cobertura de métricas. |
| `sensors.js` | `app/sensors.js` | Adaptar | BLE integrado; validar compatibilidad con sensores físicos. |
| `groups.js` / `community-*` | `app/groups.js`, `app/community-*` | Evaluar por módulo | Código presente; no activar hasta tener backend PRO, reglas y pruebas de autorización. |
| `cloud.js` | `app/cloud.js` | No copiar directamente | Cliente heredado adaptado con endpoint vacío; antes del backend, definir contratos y conflictos de sync. |
| `navigation.js`, `index.html`, estilos, PWA | `app/dashboard.*`, `app/navigation.js`, `index.html`, `app/styles.css`, `manifest.json`, `sw.js` | Reconstruir/adaptar | Interfaz PRO independiente con identidad MTB. |
| Configuración Capacitor | `capacitor.config.json`, `android/`, `ios/` | Independiente | IDs separados; iOS queda preparado sin validación de build en esta fase. |

## Dependencias actuales

Capacitor 8, Leaflet, Chart.js, `fit-file-parser`, plugins de geolocalización en segundo plano, Bluetooth LE, Filesystem, notificaciones, Share y esbuild ya están declarados en `package.json`. No se instala el SDK de PocketBase hasta definir e integrar el backend propio.

## Orden de trabajo

1. Asegurar identidad, almacenamiento, cachés y configuración independientes.
2. Mantener el núcleo GPS/grabación local-first y validar el comportamiento Android.
3. Revisar proveedores de mapas globales, atribución, caché y permisos offline antes de habilitar descargas.
4. Validar GPX/KML/GeoJSON/FIT, seguimiento, fotos y perfiles.
5. Consolidar estadísticas y sensores con datos reales.
6. Instalar y revisar las colecciones y reglas del PocketBase independiente antes de habilitar nuevas funciones competitivas.
7. Estabilizar web y Android; pasar a iOS en una segunda fase.

## Riesgos y límites conocidos

- OpenStreetMap estándar (`tile.openstreetmap.org`) no permite uso offline; se desactiva su persistencia local en PRO.
- OpenTopoMap, CyclOSM, Esri e IGN tienen condiciones propias que deben comprobarse antes de ofrecer descarga/caché offline persistente.
- La sincronización está deshabilitada por defecto al no haber servidor PRO configurado.
- La prueba local de compilación no sustituye las pruebas de GPS, BLE, mapas offline ni autorización en dispositivos/servidor real.

## Referencias

- Política oficial de teselas OSM: https://operations.osmfoundation.org/policies/tiles/
- Repositorio PRO: https://github.com/emiliopousada-svg/MTBPro

