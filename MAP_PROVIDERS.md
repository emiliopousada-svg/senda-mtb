# senda-mtb — Proveedores de Mapas y Política Offline (MAP_PROVIDERS.md)

**Versión:** 1.0  
**Fecha:** 25 de noviembre de 2026<br>
**Referencia:** Documento Maestro del Proyecto senda-mtb  

---

## 1. Alcance Cartográfico

senda-mtb proporciona **cobertura cartográfica global**, adaptada a las necesidades específicas de la práctica del ciclismo de montaña (curvas de nivel, sendas, pistas forestales, altimetría y orografía).

---

## 2. Catálogo de Capas y Proveedores

| Capa | Proveedor | URL / Plantilla | Cobertura | Tipo | Licencia / Condiciones |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Topográfico IGN** | Instituto Geográfico Nacional (España) | `https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/{z}/{x}/{ty}.jpeg` | España | TMS Raster | Reutilización bajo condiciones IGN y licencia compatible con CC-BY 4.0. Estas condiciones no acreditan por sí solas una tasa o volumen permitido para el endpoint TMS; la descarga offline está habilitada en la app, pendiente de verificar límites de servicio específicos. |
| **Topográfico Global** | OpenTopoMap | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` | Mundial | Raster | CC-BY-SA. El proveedor permite integración en aplicaciones si no se sobrecarga con descargas masivas; no ofrece garantía de disponibilidad. Solo visualización online en la app. |
| **Ciclismo / MTB** | CyclOSM | `https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png` | Mundial | Raster | © OpenStreetMap contributors, CyclOSM. El proveedor indica caché de unas horas para el estilo por defecto; no se asume permiso para almacenamiento offline permanente. |
| **Estándar OSM** | OpenStreetMap Foundation | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Mundial | Raster | ODbL © OpenStreetMap contributors. La política del servidor estándar prohíbe descarga masiva y uso offline. |
| **Satélite Ortofoto** | Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Mundial | Satélite | Servicio público consultado online. El item oficial indica que no está destinado a exportar teselas para uso offline; la app no ofrece descarga offline de esta capa. |

---

## 3. Política de Uso de Teselas y Descargas Offline

> [!CAUTION]
> **Las condiciones dependen del proveedor y del servicio concreto.** Una licencia de datos (por ejemplo, CC-BY u ODbL) no equivale por sí sola a permiso para descargar masivamente desde cualquier servidor de teselas.

### 3.1. Reglas de Implementación en MTBPro:
1. **OpenStreetMap Estándar (`tile.openstreetmap.org`):**
   * Se usa para visualización online; la app no ofrece descargas offline ni precarga de este proveedor.
   * La política prohíbe descarga masiva y uso offline, exige atribución visible, identificación de la aplicación y respeto de las cabeceras de caché HTTP.
   * La app nativa añade `senda-mtb` al User-Agent mediante `appendUserAgent` en `capacitor.config.json`; en web se usa el User-Agent normal del navegador.
2. **Descargas offline IGN España:**
   * IGN publica una licencia de uso compatible con CC-BY 4.0 y su política de datos remite a la Orden FOM/2807/2015. No se ha verificado una tasa máxima ni un permiso específico de descarga masiva para el endpoint TMS usado por la app. Los límites de la app son salvaguardas locales, no una autorización del proveedor.
   * Límite de seguridad de almacenamiento: **256 MB** (`MAX_DOWNLOADED_IGN_BYTES = 256 * 1024 * 1024`).
   * Reserva mínima de almacenamiento en el dispositivo: **128 MB** (`OFFLINE_STORAGE_RESERVE_BYTES = 128 * 1024 * 1024`).
   * Cada descarga se limita a **25.000 teselas**, el total almacenado a **30.000**, y la implementación usa **tres solicitudes concurrentes sin intervalo fijo**. Si IGN responde HTTP 429, la descarga se detiene y se debe reintentar más tarde. No se debe describir esta estrategia como una tasa aprobada por IGN hasta confirmar sus condiciones.
3. **Otros estilos online (OpenTopoMap, CyclOSM, Esri):**
   * Se usan para visualizar las teselas necesarias para la vista actual; no se ofrece descarga offline desde estos proveedores.
   * El item oficial de Esri World Imagery está marcado como público y atribuye las imágenes a Esri, Vantor, Earthstar Geographics y GIS User Community. Su licencia indica que la capa no está destinada a exportar teselas offline. La disponibilidad pública no implica uso ilimitado ni sustituye los términos del servicio; no se ha encontrado un requisito de clave para la visualización online de esta URL.
   * La caché persistente propia de teselas online en IndexedDB está desactivada. El almacenamiento HTTP normal del navegador/WebView es independiente y debe respetar las cabeceras del servidor.
   * La base de datos puede conservar teselas online heredadas de versiones anteriores. No se usan sin conexión, se muestran como inactivas y se eliminan mediante «Borrar mapas».
4. **Estrategia a Medio/Largo Plazo (Cartografía Vectorial Offline):**
   * Para descargas offline a escala global fuera de España, el proyecto adoptará paquetes de teselas vectoriales offline (formato PMTiles o MBTiles basados en OpenMapTiles / Protomaps) servidos desde infraestructura propia o empaquetados por región, garantizando coste cero de servidor y velocidad nativa en el dispositivo.

---

## 4. Atribución Legal Obligatoria

Toda pantalla que muestre mapas renderizados con Leaflet en senda-mtb incluye la atribución correspondiente en el pie del visor:

* **IGN:** `© Instituto Geográfico Nacional de España`
* **OSM / CyclOSM / OpenTopoMap:** `© Colaboradores de OpenStreetMap, SRTM | Estilo CyclOSM / OpenTopoMap`
* **Esri World Imagery:** `Tiles © Esri, Vantor, Earthstar Geographics, and the GIS User Community`

## 5. Fuentes y revisión de condiciones

Fuentes oficiales consultadas el **25 de noviembre de 2026**; las condiciones pueden cambiar y deben revisarse antes de ampliar las descargas offline:

* [Política de uso de teselas OSMF](https://operations.osmfoundation.org/policies/tiles/) (aplica al servidor estándar `tile.openstreetmap.org`, no automáticamente a todos los proveedores basados en OSM).
* [Información y condiciones de OpenTopoMap](https://opentopomap.org/about) (uso en aplicaciones condicionado a no sobrecargar el servidor con descargas masivas).
* [Información de CyclOSM](https://www.cyclosm.org/) (describe caché temporal para el estilo por defecto; no confirma permiso general de descarga offline permanente).
* [Política de datos IGN](https://www.ign.es/web/ign/portal/politica-datos) y [licencia IGN](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf). No se encontró en estas referencias un límite de tasa específico para el endpoint TMS utilizado por la app.
* [Item oficial Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9), que publica la atribución y las restricciones de exportación offline del servicio.

