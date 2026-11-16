# MTB CAMBOYA PRO — Modelo de Datos (DATA_MODEL.md)

**Versión:** 1.0  
**Fecha:** 16 de noviembre de 2026  
**Referencia:** Documento Maestro del Proyecto MTB CAMBOYA PRO  

---

## 1. Estrategia General de Persistencia

El modelo de datos de **MTB Camboya PRO** sigue el principio de **local-first con sincronización asíncrona e idempotente**:
1. **Persistencia Local Primaria:** Todas las entidades (actividades, rutas, perfiles de bicis, telemetría y puntos de interés) se guardan íntegramente en la base de datos local **IndexedDB** (`mtb_camboya_pro_db`). La aplicación es 100% funcional sin conexión.
2. **Optimización de Telemetría GPS:** Para evitar sobrecargar la base de datos remota con millones de filas, los puntos GPS y lecturas de sensores no se almacenan como filas individuales en el backend. Se empaquetan en arrays binarios o estructuras JSON compactas asociadas al registro de la actividad.
3. **Sincronización Idempotente:** Toda mutación local pendiente de sincronización genera un registro en la cola `sync_queue` con un identificador UUID único (`clientId`), marca temporal y tipo de acción (`CREATE`, `UPDATE`, `DELETE`).

---

## 2. Almacenamiento Local (IndexedDB: `mtb_camboya_pro_db`)

Versión actual de esquema: **2** (con soporte de migraciones automáticas).

### 2.1. ObjectStore: `activities`
Almacena las salidas grabadas por el ciclista en el dispositivo:
```typescript
interface ActivityRecord {
  id: string;                    // UUID local único
  clientId?: string;             // Identificador de sincronización idempotente
  title: string;                 // Nombre asignado a la salida
  activityType: 'mtb';           // Tipo de actividad
  startedAt: number;             // Timestamp Unix (ms)
  endedAt: number;               // Timestamp Unix (ms)
  elapsedTimeSec: number;        // Tiempo total transcurrido
  movingTimeSec: number;         // Tiempo en movimiento (sin pausas)
  distanceMeters: number;        // Distancia total acumulada
  elevationGainMeters: number;   // Desnivel positivo filtrado (paso mínimo 3 m)
  elevationLossMeters: number;   // Desnivel negativo acumulado
  maxSpeedMs: number;            // Velocidad máxima válida (<= 25 m/s)
  avgSpeedMs: number;            // Velocidad media en movimiento
  maxAltitude: number;           // Altitud máxima (m)
  minAltitude: number;           // Altitud mínima (m)
  vam: number;                   // Velocidad Ascensional Media (m/h) en tramos sostenidos
  
  // Asignación de material (Garaje)
  bikeId?: string;               // ID de la bicicleta asignada
  
  // Telemetría detallada
  track: Array<{
    lat: number;
    lng: number;
    ele?: number;
    time: number;                // Timestamp Unix (ms)
    acc?: number;                // Precisión horizontal (m)
    speed?: number;              // Velocidad instantánea (m/s)
    hr?: number;                 // Frecuencia cardíaca (bpm)
    cadence?: number;            // Cadencia de pedaleo (rpm)
    power?: number;              // Potencia instantánea (W)
    segmentBreak?: boolean;      // Salto por pausa o pérdida de señal
  }>;
  
  // Métricas agregadas de sensores
  sensors?: {
    avgHr?: number;
    maxHr?: number;
    avgPower?: number;
    maxPower?: number;
    normalizedPower?: number;
    avgCadence?: number;
    hrZonesSec?: number[];       // Tiempo en Z1-Z5 (segundos)
    powerZonesSec?: number[];    // Tiempo en Z1-Z7 (segundos)
  };
  
  syncStatus: 'pending' | 'synced' | 'local_only';
  remoteId?: string;             // ID asignado por PocketBase
  updatedAt: number;
}
```

### 2.2. ObjectStore: `routes`
Rutas importadas (GPX, KML, GeoJSON, FIT) o planificadas para navegación:
```typescript
interface RouteRecord {
  id: string;                    // UUID local
  name: string;                  // Nombre de la ruta
  description?: string;
  distanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  coordinates: Array<[number, number, number?]>; // [lat, lng, ele]
  waypoints?: Array<{
    lat: number;
    lng: number;
    name: string;
    sym?: string;
    desc?: string;
  }>;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### 2.3. ObjectStore: `map_pois`
Puntos de interés personales o guardados:
```typescript
interface MapPoiRecord {
  id: string;
  name: string;
  category: 'water' | 'shelter' | 'danger' | 'viewpoint' | 'workshop' | 'generic';
  lat: number;
  lng: number;
  ele?: number;
  description?: string;
  photoId?: string;
  createdAt: number;
}
```

### 2.4. ObjectStore: `bikes` y `components` (Módulo Garaje)
```typescript
interface BikeRecord {
  id: string;
  name: string;
  type: 'xc' | 'trail' | 'enduro' | 'downhill' | 'gravel' | 'emtb';
  weightKg?: number;
  initialDistanceKm: number;     // Kilómetros previos antes de registrar en la app
  totalDistanceKm: number;       // Kilómetros acumulados
  totalHours: number;            // Horas acumuladas
  photoUrl?: string;
  active: boolean;
  createdAt: number;
}

interface BikeComponentRecord {
  id: string;
  bikeId: string;
  type: 'chain' | 'front_tire' | 'rear_tire' | 'front_brake_pads' | 'rear_brake_pads' | 'fork' | 'rear_shock' | 'cassette';
  name: string;
  installedAtDate: number;
  currentDistanceKm: number;
  currentHours: number;
  maxDistanceKmThreshold?: number; // Alerta de desgaste recomendada
  maxHoursThreshold?: number;      // Alerta de mantenimiento horario (ej. suspensiones 50h/200h)
  history: Array<{
    date: number;
    action: 'installed' | 'inspected' | 'serviced' | 'replaced';
    cost?: number;
    notes?: string;
  }>;
}
```

### 2.5. ObjectStore: `emergency_contacts` (Guardian Mode)
```typescript
interface EmergencyContactRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}
```

---

## 3. Almacenamiento Remoto (PocketBase: `https://mtbpro.ddns.net`)

Las colecciones de PocketBase gestionan usuarios, sincronización y vida social de la comunidad:

| Colección | Tipo | Regla de Acceso | Finalidad |
| :--- | :--- | :--- | :--- |
| `users` | Auth | Registro privado (`id = @request.auth.id`; el cliente no puede cambiar `groupCode`) | Apodo (máx. 32), peso (25–250 kg) y edad (10–100 años) del titular; avatar JPEG descargable por URL para mostrarlo en grupos. |
| `routes` | Base | Propietario (`owner = @request.auth.id`) | Copia de seguridad en la nube de rutas privadas. |
| `map_pois` | Base | Propietario (`owner = @request.auth.id`) | Sincronización de puntos de interés personales. |
| `live_locations` | Base | Miembros de grupo autenticados | Ubicación efímera para seguimiento grupal en ruta (purgada automáticamente por `live_cleanup.pb.js`). |
| `mtb_groups` | Base | Gestionado vía hooks `/api/mtb/groups/*` | Grupos privados de ciclistas, miembros y roles. |
| `mtb_group_members` | Base | Gestionado vía hooks | Pertenencia y permisos de administración. |
| `mtb_group_ranking_entries` | Base | Gestionado vía hooks | Resultados de actividades y clasificación del grupo. |
| `community_routes` | Base | Lectura pública; escritura autenticada | Rutas comunitarias (con recorte de 150 m en extremos para privacidad). |
| `community_route_favorites`, `community_route_ratings`, `community_route_comments` | Base | Lectura pública limitada a rutas publicadas; escritura autenticada propia | Favoritos, valoraciones y comentarios. |
| `community_segments` | Base | Lectura pública; escritura autenticada | Trazados de segmentos competitivos. |
| `community_route_efforts`, `community_segment_efforts` | Base | Lectura pública limitada a trazados publicados; escritura autenticada propia | Marcas de tiempo de rutas y segmentos. |

---

## 4. Políticas de Retención y Privacidad

1. **Ubicaciones en Directo (`live_locations`):**
   * Tienen un tiempo de vida (TTL) máximo de 12 horas.
   * La finalización de la actividad o salida del grupo emite un `DELETE` inmediato.
   * El cron del hook `live_cleanup.pb.js` borra registros sin actualizar en más de 30 minutos.
2. **Protección de Domicilio:**
   * Al publicar una ruta comunitaria, el hook de PocketBase recorta automáticamente **150 metros** del inicio y del final del track para evitar revelar la dirección residencial del ciclista.
   * Se rechazan POIs situados a menos de 150 metros de los extremos.
3. **Limpieza de Metadatos EXIF:**
   * Las fotos de ruta adjuntas son re-codificadas en cliente en formato WebP/JPEG desprovistas de metadatos de cámara y localización para evitar fugas de privacidad.
