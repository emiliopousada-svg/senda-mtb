# Configurar rutas de la comunidad

La app publica rutas en la colección PocketBase `community_routes`. El selector de publicación solicita la comunidad autónoma (y permite Ceuta y Melilla); para compatibilidad con los registros y el cliente existentes, el valor se guarda en el campo `province`.

## Campos necesarios para publicar fotos de POI

La colección debe incluir:

| Campo | Tipo | Configuración |
| --- | --- | --- |
| `poisJson` | Text | Opcional; máximo 131072 caracteres |
| `poiPhotos` | File | Opcional; máximo 5 archivos, 614400 bytes por archivo, solo `image/jpeg` |

`poisJson` contiene las ubicaciones y leyendas de las fotos y se envía en cada publicación. `poiPhotos` contiene los JPEG y se envía cuando la ruta incluye fotos. Si falta alguno de los campos en la colección, PocketBase puede rechazar la publicación.

## Reparar la colección del servidor

1. Haz una copia de seguridad de los datos de PocketBase.
2. Asegúrate de que `1794835000_create_mtb_app_collections.js` y `1794835001_add_community_route_poi_fields.js` estén en la carpeta `pb_migrations` que usa el servidor. Si la primera ya se aplicó, PocketBase la omitirá al ejecutar `migrate up`.
3. Ejecuta `pocketbase migrate up` con el mismo binario y directorio de datos que utiliza el servicio.
4. Reinicia PocketBase si corresponde y vuelve a intentar publicar.

Esta migración añade los campos cuando faltan y no sustituye campos existentes. Si un campo existe con un tipo incompatible, la migración se detiene para evitar modificar datos a ciegas; revisa ese campo en el panel antes de continuar.

La migración inicial `1794835000_create_mtb_app_collections.js` también define estos campos al crear `community_routes` desde cero. La migración de reparación cubre servidores donde la colección ya existía y la migración inicial la dejó intacta.

## Hooks

La publicación y la privacidad de la ruta también dependen de los hooks del repositorio. Copia los archivos necesarios desde `pb_hooks` a la carpeta de hooks configurada en el servidor (por defecto, `pb_hooks`) y reinicia PocketBase para cargarlos. No sobrescribas hooks existentes sin revisar primero los cambios.
