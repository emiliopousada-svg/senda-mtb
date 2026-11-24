# Configurar rutas de la comunidad

La app publica rutas en la colección PocketBase `community_routes`. El selector de publicación solicita la comunidad autónoma (y permite Ceuta y Melilla); para compatibilidad con los registros y el cliente existentes, el valor se guarda en el campo `province`.

## Campos necesarios para publicar fotos de POI

La colección debe incluir:

| Campo | Tipo | Configuración |
| --- | --- | --- |
| `trackJson` | Text | Obligatorio; máximo 262144 caracteres |
| `poisJson` | Text | Opcional; máximo 131072 caracteres |
| `poiPhotos` | File | Opcional; máximo 5 archivos, 614400 bytes por archivo, solo `image/jpeg` |

`poisJson` contiene las ubicaciones y leyendas de las fotos y se envía en cada publicación. `poiPhotos` contiene los JPEG y se envía cuando la ruta incluye fotos. Si falta alguno de los campos en la colección, PocketBase puede rechazar la publicación.

## Reparar la colección del servidor

1. Haz una copia de seguridad de los datos de PocketBase.
2. Asegúrate de que las migraciones `1794835000_create_mtb_app_collections.js`, `1794835001_add_community_route_poi_fields.js` y `1794835002_expand_community_route_track_json.js` estén en la carpeta `pb_migrations` que usa el servidor. La última amplía `trackJson` en colecciones existentes; PocketBase omitirá las migraciones ya aplicadas al ejecutar `migrate up`.
3. Ejecuta `pocketbase migrate up` con el mismo binario y directorio de datos que utiliza el servicio.
4. Reinicia PocketBase si corresponde y vuelve a intentar publicar.

Esta migración añade los campos cuando faltan y no sustituye campos existentes. Si un campo existe con un tipo incompatible, la migración se detiene para evitar modificar datos a ciegas; revisa ese campo en el panel antes de continuar.

La migración inicial define los límites al crear `community_routes` desde cero. Las migraciones posteriores reparan colecciones existentes sin reemplazar los datos.

## Exigir sesión para consultar rutas comunitarias

La app requiere iniciar sesión para explorar, guardar o descargar rutas comunitarias. Para aplicar el mismo requisito en el servidor:

1. Haz una copia de seguridad de PocketBase.
2. Copia `pb_migrations/1794836010_require_auth_for_community_routes.js` a la carpeta `pb_migrations` del servidor.
3. Ejecuta `pocketbase migrate up` con el mismo binario y directorio de datos que usa el servicio. Si las migraciones automáticas están habilitadas, reiniciar PocketBase también las aplicará.
4. Comprueba que sin sesión no se obtiene ninguna ruta publicada y que con una cuenta autenticada sí se pueden consultar.

La migración actualiza las reglas existentes de lectura de `community_routes`, `community_segments`, `community_route_efforts`, `community_segment_efforts`, `community_route_ratings` y `community_route_comments`. Conserva los registros y exige también que la ruta relacionada siga publicada. `community_route_favorites` ya limita la lectura a su propietario. No hace falta modificar `pb_hooks/` ni editar reglas manualmente en el panel.

## Hooks

La publicación y la privacidad de la ruta también dependen de los hooks del repositorio. Copia los archivos necesarios desde `pb_hooks` a la carpeta de hooks configurada en el servidor (por defecto, `pb_hooks`) y reinicia PocketBase para cargarlos. No sobrescribas hooks existentes sin revisar primero los cambios.

`community_routes.pb.js` también impide que un usuario publique dos veces la misma ruta: rechaza la publicación si ya tiene otra con el mismo trazado recortado, o con la misma distancia (±50 m) y el mismo tiempo en movimiento. Tras actualizar el hook, reinicia PocketBase.

## Importación automática de rutas oficiales de Galicia

El hook `community_routes_galicia_import.pb.js` comprueba cada cinco minutos los metadatos de los GPX, KML y GeoJSON que existan en `pb_public/rutas/galicia` y sus subcarpetas (por ejemplo, `tracks/`), e importa solo archivos nuevos o modificados. Si el volumen se monta en otra ruta dentro del contenedor, define `COMMUNITY_IMPORT_DIR` con esa ruta interna. PocketBase JSVM ofrece lectura y consulta de metadatos del sistema de archivos, pero no un watcher de cambios; el sondeo mantiene hasta cinco minutos de demora. Tras reiniciar PocketBase, el primer escaneo vuelve a procesar todos los archivos.

Las rutas se asignan a la cuenta cuyo apodo exacto es `SENDA-MTB`; créala antes de activar el hook. El archivo se conserva para permitir actualizaciones: al modificarlo, se actualiza su publicación gracias al campo interno `sourcePath`. Los fallos se escriben en el log de PocketBase y no impiden importar los demás archivos.

Instala también las migraciones `1794835006_add_community_route_source_path.js` y `1794835007_repair_community_route_source_path_index.js`, copia ambos hooks `community_routes.pb.js` y `community_routes_galicia_import.pb.js` al directorio `pb_hooks` del servidor y reinicia el contenedor. De momento solo se procesa Galicia.
