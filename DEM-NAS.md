# DEM de España en NAS — Senda MTB

## Alcance

Esta rama añade herramientas de preparación y publicación de DEM. No modifica `main`, PocketBase, GPS, mapas, autenticación ni la lógica de grabación. La aplicación móvil todavía no consume este manifiesto: esa integración requiere una fase posterior y pruebas del lector COG en Android.

## Fuente oficial

- IGN/CNIG, PNOA-MDT05 primera cobertura.
- Modelo digital del **terreno** (clase suelo), malla de 5 m.
- Entrega oficial COG (Cloud Optimized GeoTIFF).
- Península, Baleares, Ceuta y Melilla: ETRS89; Canarias: REGCAN95.
- Alturas ortométricas.
- Licencia del catálogo: CC BY 4.0; conservar atribución IGN.

Catálogo: https://centrodedescargas.cnig.es/CentroDescargas/modelos-digitales-elevaciones  
Ficha MDT05: https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt05-primera-cobertura

**Nota de vigencia:** MDT05 es una primera cobertura con datos históricos. El catálogo también publica MDT02 (segunda cobertura, 2 m, incompleta) y MDT50 cm (tercera cobertura, 0,5 m). Esta rama usa MDT05 por ser el producto nacional de 5 m elegido, no porque sea el dato más reciente en cada zona.

## Organización NAS

Crear carpeta compartida `senda-dem`:

```text
senda-dem/
├── data/
│   ├── files/             # COG originales, una sola copia por hoja
│   └── manifest.json      # índice público agrupado por comunidad
└── deploy/
    ├── docker-compose.yml
    └── nginx.conf
```

No almacenar COG en Git, APK ni PocketBase.

## Completar el inventario oficial

`dem/ign-mdt05-manifest.json` es una plantilla vacía, no una lista de descargas verificada. Añadir una entrada por COG oficial:

```json
{
  "id": "mdt05-hoja-0001",
  "filename": "PNOA-MDT05-ETRS89-HU29-0001-LID.TIF",
  "url": "https://URL-DIRECTA-OFICIAL-DEL-COG",
  "bytes": 22733127,
  "sha256": "64-caracteres-hexadecimales-verificados",
  "regions": ["galicia"],
  "bounds": [-9.5, 41.8, -6.7, 43.8]
}
```

- `bytes`: tamaño exacto.
- `sha256`: checksum calculado sobre el archivo oficial.
- `regions`: todas las comunidades autónomas que intersecta la hoja MTN50. No asignar por nombre solamente.
- Si una hoja cruza límites, asociarla a todas las regiones afectadas; el COG se almacena una sola vez.
- No usar enlaces temporales de sesión, cesta o CAPTCHA.
- Verificar CRS, NoData, geotransformación y estructura COG con GDAL en muestras de Península y Canarias.

El catálogo IGN informa de 1.525 ficheros MDT05 en COG; esto no significa que estén descargados.

## Descarga y verificación

Requiere Node.js 20+. En Windows:

```powershell
$env:DEM_ROOT = "Z:\\senda-dem\\data"
$env:DEM_MANIFEST = ".\\dem\\ign-mdt05-manifest.json"
node .\\scripts\\download-dem-cog.mjs --region all
node .\\scripts\\download-dem-cog.mjs --region galicia --check
```

En Linux/NAS:

```bash
DEM_ROOT=/volume1/docker/senda-dem/data \\
DEM_MANIFEST=./dem/ign-mdt05-manifest.json \\
node scripts/download-dem-cog.mjs --region all
```

El descargador exige HTTPS, nombre seguro, tamaño y SHA-256; descarga secuencialmente; usa archivos temporales `.part`; verifica antes de renombrar; conserva los archivos válidos y puede reintentarse. Genera `data/manifest.json` solo al terminar sin errores.

## Publicación HTTP

Copiar `deploy/dem-nas/` al NAS. Definir `DEM_DATA_PATH` en `.env` apuntando a `data/`, y ejecutar:

```bash
docker compose up -d
curl http://IP_DEL_NAS:8092/health
curl http://IP_DEL_NAS:8092/manifest.json
```

Servicio estático, solo lectura y con soporte HTTP Range para lecturas parciales COG. No exponer 8092 directamente a Internet: publicar solo mediante proxy inverso HTTPS del NAS, con límites y monitorización.

## Regiones

Andalucía, Aragón, Asturias, Illes Balears, Canarias, Cantabria, Castilla-La Mancha, Castilla y León, Cataluña, Ceuta, Extremadura, Galicia, La Rioja, Comunidad de Madrid, Melilla, Región de Murcia, Navarra, País Vasco y Comunitat Valenciana.

## Aceptación

1. Confirmar que el manifiesto público solo enumera archivos instalados.
2. Verificar tamaño y SHA-256 de cada COG.
3. Probar GET/HEAD y `Range: bytes=0-16383` (respuesta 206).
4. Validar COG con `gdalinfo` en Península y Canarias.
5. Probar descarga Android, espacio, cancelación, reintento y lectura offline antes de activar la integración en la app.
6. No desplegar ni cambiar producción desde esta rama.

## Estado

Rama con infraestructura y descargador preparados. Falta generar y verificar el inventario completo de URLs, checksums y asignación autonómica desde el catálogo oficial. No se ha accedido al NAS ni se han descargado los 1.525 COG.
