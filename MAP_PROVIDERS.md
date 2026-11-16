# MTB CAMBOYA PRO — Proveedores de Mapas y Política Offline (MAP_PROVIDERS.md)

**Versión:** 1.0  
**Fecha:** 16 de noviembre de 2026  
**Referencia:** Documento Maestro del Proyecto MTB CAMBOYA PRO  

---

## 1. Alcance Cartográfico

MTB Camboya PRO proporciona **cobertura cartográfica global**, adaptada a las necesidades específicas de la práctica del ciclismo de montaña (curvas de nivel, sendas, pistas forestales, altimetría y orografía).

---

## 2. Catálogo de Capas y Proveedores

| Capa | Proveedor | URL / Plantilla | Cobertura | Tipo | Licencia / Condiciones |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Topográfico IGN** | Instituto Geográfico Nacional (España) | `https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/{z}/{x}/{ty}.jpeg` | España | TMS Raster | CC-BY 4.0 IGN. Permite uso y descarga controlada. |
| **Topográfico Global** | OpenTopoMap | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` | Mundial | Raster | CC-BY-SA (OpenStreetMap, SRTM). Uso online. |
| **Ciclismo / MTB** | CyclOSM | `https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png` | Mundial | Raster | © OpenStreetMap contributors, CyclOSM. Especializado en vías ciclistas y senderos. |
| **Estándar OSM** | OpenStreetMap Foundation | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Mundial | Raster | ODbL © OpenStreetMap contributors. |
| **Satélite Ortofoto** | ESRI World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Mundial | Satélite | Términos de servicio de ArcGIS Online para visualización de mapas base. |

---

## 3. Política Estricta de Uso de Teselas y Descargas Offline

> [!CAUTION]
> **Prohibición de descarga masiva en OpenStreetMap estándar:**
> La política oficial de uso de teselas de la OSMF (*Tile Usage Policy*: https://operations.osmfoundation.org/policies/tiles/) prohíbe taxativamente la descarga masiva de teselas (*bulk downloading*) o el uso de su servidor gratuito estándar para aplicaciones de almacenamiento offline o raspado de mapas.

### 3.1. Reglas de Implementación en MTBPro:
1. **OpenStreetMap Estándar (`tile.openstreetmap.org`):**
   * Se utiliza **exclusivamente en streaming en directo** con conectividad activa.
   * La aplicación **bloquea activamente** cualquier intento de volcado offline o precarga masiva sobre este dominio.
2. **Descargas Offline Autorizadas (IGN España):**
   * La descarga de teselas por cuadrícula geográfica para uso sin conexión se limita a proveedores que lo autoricen expresamente, como el IGN (Instituto Geográfico Nacional de España).
   * Límite de seguridad de almacenamiento: **256 MB** (`MAX_DOWNLOADED_IGN_BYTES = 256 * 1024 * 1024`).
   * Reserva mínima de almacenamiento en el dispositivo: **128 MB** (`OFFLINE_STORAGE_RESERVE_BYTES = 128 * 1024 * 1024`).
   * La descarga se realiza de forma espaciada, respetando tiempos de espera entre peticiones para evitar saturar los servidores de la infraestructura pública.
3. **Estrategia a Medio/Largo Plazo (Cartografía Vectorial Offline):**
   * Para descargas offline a escala global fuera de España, el proyecto adoptará paquetes de teselas vectoriales offline (formato PMTiles o MBTiles basados en OpenMapTiles / Protomaps) servidos desde infraestructura propia o empaquetados por región, garantizando coste cero de servidor y velocidad nativa en el dispositivo.

---

## 4. Atribución Legal Obligatoria

Toda pantalla que muestre mapas renderizados con Leaflet en MTB Camboya PRO incluye la atribución correspondiente en el pie del visor:

* **IGN:** `© Instituto Geográfico Nacional de España`
* **OSM / CyclOSM / OpenTopoMap:** `© Colaboradores de OpenStreetMap, SRTM | Estilo CyclOSM / OpenTopoMap`
* **ESRI:** `Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`
