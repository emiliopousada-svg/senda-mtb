# senda-mtb — Modelo de Datos (DATA_MODEL.md)

**Versión:** 1.0 · **Fecha:** 24 de noviembre de 2026 · **Referencia:** Documento Maestro del Proyecto senda-mtb

---

## 1. Estrategia General de Persistencia

La persistencia de **senda-mtb** se reparte entre IndexedDB, `localStorage` y PocketBase. La disponibilidad sin conexión depende de cada función y de los datos guardados localmente; no todas las entidades se almacenan en IndexedDB.

1. **Rutas y grabaciones locales:** Se guardan en IndexedDB, incluyendo puntos GPS y datos de actividad. Las fotos asociadas a POI se almacenan aparte para no cargar todos los blobs al leer rutas.
2. **Datos auxiliares y preferencias:** `kv` guarda borradores de grabación, cachés y marcadores pendientes de algunos flujos de sincronización. Otras preferencias y algunos datos de perfil se guardan en `localStorage`.
3. **Sincronización:** La sincronización de rutas coordina los registros locales con PocketBase. No existe un object store `sync_queue` ni una cola genérica de mutaciones con el esquema `CREATE`/`UPDATE`/`DELETE`; los flujos usan campos de ruta y claves auxiliares concretas.

---

## 2. Persistencia Local

Versión actual de esquema: **2**. La base `mtb_camboya_pro_db` crea estos tres object stores en `app/storage.js`:

### 2.1. ObjectStore: `routes`
Usa `id` como clave primaria y contiene registros de ruta. Las salidas grabadas se representan como rutas con `kind: 'recorded'`; las rutas importadas usan `kind: 'imported'`. El registro habitual incluye `name`, `startedAt`, `movingTimeSec`, `distanceKm`, `elevationGain` y `points`. Los puntos se almacenan como arrays con coordenadas y, cuando existen, altitud, tiempo, frecuencia cardíaca, velocidad, cadencia y potencia. Los campos varían según el tipo y el origen de la ruta; no hay un esquema TypeScript rígido en IndexedDB.

### 2.2. ObjectStore: `kv`
Almacén clave-valor auxiliar, sin `keyPath`. Se usa, entre otros casos, para conservar el borrador de grabación y sus bloques de puntos (`draft` y `draft:points:<índice>`), cachés locales y marcadores de sincronización pendientes como `pendingDeletes` y `pendingGroupRankingDeletes`. No equivale a una cola genérica de cambios.

### 2.3. ObjectStore: `routePhotos`
Usa `routeId` como clave primaria. Guarda los blobs de fotos de los POI asociados a una ruta como elementos `{ index, photo }`; los metadatos de los POI permanecen en el registro de `routes`. La migración de la versión 1 a la 2 mueve los blobs existentes desde los registros de ruta a este store.

`activities`, `map_pois`, `bikes`, `components`, `emergency_contacts` y `sync_queue` **no son object stores** de esta base. Las actividades grabadas están representadas en `routes`; los POI personales se gestionan mediante PocketBase; el garaje y los contactos de seguridad se serializan en `localStorage`.

## 2.4. Otros datos locales

`localStorage` conserva preferencias y algunos datos de funcionalidad, por ejemplo:
* Garaje: `mtb_pro_garage` y `mtb_pro_garage_photo`.
* Contactos de seguridad y estado de sincronización: `mtb_pro_safety_contacts` y `mtb_pro_safety_contacts_unsynced`.
* Preferencias de navegación y seguimiento, además de marcas temporales y cursores de sincronización.

El acceso a `localStorage` no está centralizado en `app/storage.js`; las claves se leen y escriben desde los módulos que las usan.

---

## 3. Almacenamiento Remoto (PocketBase: `https://mtbpro.ddns.net`)

Las colecciones de PocketBase gestionan usuarios, sincronización y vida social de la comunidad:

| Colección | Tipo | Regla de Acceso | Finalidad |
| :--- | :--- | :--- | :--- |
| `users` | Auth | Registro privado (`id = @request.auth.id`; el cliente no puede cambiar `groupCode`) | Apodo (máx. 32), peso (25–250 kg) y edad (10–100 años) del titular; avatar JPEG descargable por URL para mostrarlo en grupos. |
| `mtb_user_preferences` | Base | Propietario autenticado (`owner = @request.auth.id`) | Preferencias JSON de la cuenta; un registro por propietario. |
| `routes` | Base | Propietario (`owner = @request.auth.id`) | Copia de seguridad en la nube de rutas privadas. |
| `map_pois` | Base | Propietario (`owner = @request.auth.id`) | Sincronización de puntos de interés personales. |
| `live_locations` | Base | Miembros autorizados del mismo grupo | Ubicación efímera para seguimiento grupal; lecturas y escrituras requieren membresía vigente, y se purga automáticamente por `live_cleanup.pb.js`. |
| `mtb_groups` | Base | Gestionado vía hooks `/api/mtb/groups/*` | Grupos privados de ciclistas, miembros y roles. |
| `mtb_group_members` | Base | Gestionado vía hooks | Pertenencia y permisos de administración. |
| `mtb_group_ranking_entries` | Base | Gestionado vía hooks | Resultados de actividades y clasificación del grupo. |
| `mtb_group_challenges` | Base | Solo mediante hooks `/api/mtb/groups/*`; reglas directas deshabilitadas | Retos de grupo, métrica, objetivo y periodo. |
| `community_routes` | Base | Lectura pública; escritura autenticada | Rutas comunitarias con comunidad autónoma, POIs y fotos (con recorte de 150 m en extremos para privacidad). El campo remoto `province` se conserva por compatibilidad. |
| `community_route_favorites`, `community_route_ratings`, `community_route_comments` | Base | Lectura pública limitada a rutas publicadas; escritura autenticada propia | Favoritos, valoraciones y comentarios. |
| `community_segments` | Base | Lectura pública; escritura autenticada | Trazados de segmentos competitivos. |
| `community_route_efforts`, `community_segment_efforts` | Base | Lectura pública limitada a trazados publicados; escritura autenticada propia | Récord histórico por persona y segmento, sin pertenencia a grupo. El cliente compara salidas locales no importadas y solo publica apodo y tiempo; la base de datos impide empeorar un récord existente. |
| `community_route_import_state` | Base | Sin acceso directo de cliente; uso interno del hook de importación | Firma y ruta de origen utilizadas para reconocer importaciones ya procesadas. |

---

## 4. Políticas de Retención y Privacidad

1. **Ubicaciones en Directo (`live_locations`):**
   * Se eliminan tras más de 5 minutos sin actualizarse; el cron comprueba las posiciones cada minuto.
   * La finalización de la actividad o salida del grupo emite un `DELETE` inmediato.
   * El cron del hook `live_cleanup.pb.js` borra registros sin actualizar en más de 5 minutos.
2. **Protección de Domicilio:**
   * Al publicar una ruta comunitaria, el hook de PocketBase recorta automáticamente **150 metros** del inicio y del final del track para evitar revelar la dirección residencial del ciclista.
   * Se rechazan POIs situados a menos de 150 metros de los extremos.
3. **Limpieza de Metadatos EXIF:**
   * Las fotos de ruta adjuntas son re-codificadas en cliente en formato WebP/JPEG desprovistas de metadatos de cámara y localización para evitar fugas de privacidad.

