# Catálogo de rutas de Galicia

PocketBase sirve este directorio como contenido estático desde `pb_public`, bajo
`https://<servidor>/rutas/galicia/`. El hook
`community_routes_galicia_import.pb.js` lee los tracks de este directorio y los
publica en el catálogo normal de rutas de la comunidad. La app ya no consulta
`catalogo.json` directamente; se conserva como índice de referencia de los tracks.

El catálogo inicial contiene 23 tracks PR-G del producto Senderos FEDME del
CNIG. Los tracks originales se conservan en KML y llevan atribución CC BY 4.0.
Son senderos homologados para senderismo; su idoneidad y permisos para MTB no se
han verificado. La app muestra este aviso antes de guardarlos.

## Añadir rutas

1. Copia el archivo GPX o KML a `tracks/` con un nombre estable.
2. Añade una entrada a `catalogo.json`:

```json
{
  "id": "ruta-xures",
  "title": "Ruta Xurés",
  "province": "Ourense",
  "locality": "Lobios",
  "distanceKm": 32.4,
  "elevationGain": 840,
  "track": "tracks/ruta-xures.gpx",
  "source": "https://url-oficial-del-track-o-ficha",
  "attribution": "Xunta de Galicia",
  "license": "Condiciones de reutilización indicadas por la fuente"
}
```

3. Mantén la atribución y licencia de cada fuente. No publiques tracks de
plataformas o autores si no autorizan su redistribución.

El índice solo acepta GPX o KML dentro de `tracks/` y enlaces HTTPS en `source`. Cada
archivo se limita a 10 MB. Mantén `schemaVersion` en `1` para este formato.

## Fuente inicial recomendada

Los tracks iniciales proceden del catálogo oficial de [Senderos FEDME del
CNIG](https://centrodedescargas.cnig.es/CentroDescargas/senderos-fedme-kml).
El CNIG indica que los itinerarios los aporta FEDME y se ofrecen bajo CC BY 4.0;
para obras derivadas pide el reconocimiento «Obra derivada de FEDME 2020-2026
CC-BY 4.0 FEDME». Verifica las condiciones y estado de cada trazado antes de
usarlo en bicicleta.

La Xunta también ofrece un visor con tracks de rutas cicloturistas de interés
paisajístico, actualizado en 2025 y con más de 3.900 km: <https://mapas.xunta.gal/visores/galiciaenbici/>.
No se han copiado esos archivos al catálogo porque hace falta confirmar la
licencia de redistribución específica de cada track.
