# PocketBase para MTB Camboya PRO

La instancia independiente de MTB Camboya PRO está publicada en `https://mtbpro.ddns.net` y es el servidor por defecto de la aplicación. No importes bases de datos, cuentas, ubicaciones, rutas ni rankings del proyecto mtb-camboya.

## Colecciones usadas

Los nombres siguientes se deducen de las llamadas API del cliente y los hooks incluidos. Este repositorio no contiene una configuración/exportación completa de colecciones para importarla directamente.

| Colección o recurso | Uso |
| --- | --- |
| `users` (auth) | Inicio de sesión, apodo, avatar JPEG, peso y edad. La migración de perfil limita listado/lectura/edición al titular y evita que el cliente asigne `groupCode`. |
| `mtb_user_preferences` | Un registro privado por usuario con sus preferencias de uso, sincronizadas entre dispositivos. No almacena credenciales, ubicaciones GPS, identificadores BLE ni teselas offline. |
| `routes` | Rutas y actividades privadas sincronizadas por propietario. |
| `map_pois` | Puntos de interés sincronizados por propietario. |
| `live_locations` | Ubicación temporal de participantes de grupo durante una grabación. |
| `mtb_groups`, `mtb_group_members`, `mtb_group_ranking_entries` | Grupos, membresías y resultados de clasificación; gestionados mediante hooks de grupos. |
| `community_routes`, `community_route_favorites`, `community_route_ratings`, `community_route_comments` | Rutas publicadas e interacciones sociales. |
| `community_segments`, `community_segment_efforts`, `community_route_efforts` | Segmentos y marcas de rendimiento de la comunidad. |
| `mtb_group_competitions`, `mtb_group_competition_entries`, `mtb_group_seasons`, `mtb_group_season_awards` | Colecciones propuestas para desafíos, ligas de cuatro semanas, participación e historial de campeones; requieren instalar el módulo competitivo antes de habilitar su interfaz de escritura. |

## Límites de acceso recomendados

- Exigir autenticación para operaciones sobre perfil, rutas y puntos privados. En `routes` y `map_pois`, permitir al usuario autenticado leer, crear, editar y borrar solo registros cuyo `owner` sea su ID.
- En `users`, impedir la lectura pública/listado de perfiles y limitar cambios al propio usuario. No exponer email, edad, peso ni `groupCode`. El archivo de avatar permanece accesible por URL directa para mostrarlo a miembros de grupos; si se necesita que también sea privado, habrá que habilitar archivos protegidos y cambiar la carga de avatares en el cliente y el flujo de grupos.
- Mantener `live_locations` inaccesible al público. Autorizar lectura solo a miembros del mismo grupo y escritura/borrado al propietario autenticado; borrar posiciones obsoletas.
- Mantener las colecciones internas de grupos con reglas cerradas. Usar exclusivamente los hooks `/api/mtb/groups/*`, que deben verificar autenticación, pertenencia y permisos de administración.
- Publicar solo las rutas comunitarias aprobadas. Validar la propiedad en cambios y borrados, y limitar rating, comentarios y favoritos a usuarios autenticados con reglas contra duplicados y suplantación.
- Aplicar reglas de propietario a esfuerzos y registros de rendimiento privados. Validar del lado del servidor relaciones, campos numéricos, límites, fechas y tasas de escritura.
- Mantener TLS, proteger credenciales administrativas, configurar copias de seguridad y actualizar PocketBase. No habilitar reglas públicas genéricas para simplificar la integración.

## Hooks del repositorio

`pb_hooks/` incluye hooks para apodos, POIs, grupos, limpieza de posiciones, rutas comunitarias, segmentos, rendimiento e interacciones sociales. Revísalos y pruébalos junto a las reglas de colección de `https://mtbpro.ddns.net`. Las colecciones de temporadas y desafíos siguen pendientes de despliegue; el código de cliente por sí solo no es una frontera de seguridad.

La migración `pb_migrations/1794829123_create_mtb_user_preferences.js` crea `mtb_user_preferences` con reglas que limitan lectura, creación, modificación y borrado al propietario autenticado. Despliega la migración en el directorio de datos de PocketBase y ejecútala con `pocketbase migrate up` (o inicia PocketBase con las migraciones automáticas habilitadas) antes de publicar la versión web que la utiliza.

La migración `pb_migrations/1794830184_add_private_user_profile_fields.js` añade, si faltan, `nickname` (máximo 32 caracteres), `weightKg` (0–250) y `age` (entero, 0–100), además de `avatar` (JPEG, máximo 256 KiB, miniaturas de 96 y 256 px). Cero representa un valor todavía no configurado; la app solo acepta peso de 25–250 kg y edad de 10–100 años. También deja el registro de `users` visible solo para su titular y permite actualizarlo solo al titular sin aceptar cambios de `groupCode`. El archivo de avatar no está protegido y puede descargarse con su URL directa, para que se muestre en grupos. No reemplaza campos ya existentes; comprueba tipos y límites en el panel PocketBase antes de aplicarla.

La migración `pb_migrations/1794835000_create_mtb_app_collections.js` crea las colecciones activas de rutas privadas, POIs, ubicaciones en vivo, grupos, clasificaciones, rutas comunitarias, segmentos, valoraciones, favoritos, comentarios y marcas. Añade `groupCode` a `users` si falta y mantiene cerradas las colecciones internas de grupos; las lecturas públicas se limitan a rutas comunitarias publicadas y sus marcas/interacciones. Crea solo colecciones que no existan y conserva las ya existentes sin corregir sus campos o reglas. La migración `pb_migrations/1794835001_add_community_route_poi_fields.js` añade los campos `poisJson` y `poiPhotos` a una colección `community_routes` ya creada si faltan. La migración `pb_migrations/1794835003_secure_live_location_access.js` actualiza las reglas existentes de `live_locations` para exigir pertenencia vigente al grupo. La migración `pb_migrations/1794835004_add_live_location_timestamps.js` añade los campos automáticos `created` y `updated` si faltan, necesarios para ordenar y expirar las ubicaciones. Ambas conservan los registros y campos compatibles. Haz una copia de seguridad antes de aplicar migraciones.

La app solicita la comunidad autónoma al publicar; conserva el nombre histórico del campo `province` en PocketBase para no romper rutas y clientes existentes. Consulta [CONFIGURAR-RUTAS-COMUNIDAD.md](./CONFIGURAR-RUTAS-COMUNIDAD.md) para desplegar y verificar los campos y hooks.

Las colecciones de retos y temporadas enumeradas arriba son propuestas y no las crea esta migración.

La app conserva estas preferencias localmente y las sincroniza al iniciar sesión y cuando cambian: avisos de ruta, vibración, rotación y estilo del mapa, controles grandes, circunferencia de rueda, objetivo semanal, FTP y FC máxima, orden/visibilidad de métricas y orden de tarjetas del inicio. Si hay cambios simultáneos, prevalece la última escritura sincronizada. Las ubicaciones recientes, los dispositivos Bluetooth y los mapas descargados siguen siendo específicos del dispositivo.

Los tracks comunitarios son datos públicos. El hook de rutas comunitarias recorta 150 m de los extremos y rechaza POIs próximos a esos extremos; reduce la exposición de domicilios pero no garantiza anonimato. Las fotos se procesan en el cliente; la instancia debe validar y limpiar metadatos del lado del servidor.

Antes de conectar un servidor nuevo, prueba las reglas con dos cuentas distintas, un usuario anónimo, un miembro y un no miembro de grupo, y un administrador de grupo. Confirma que un usuario no pueda leer/modificar datos privados de otro.
