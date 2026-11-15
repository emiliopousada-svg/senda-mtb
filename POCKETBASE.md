# PocketBase para MTB Camboya PRO

La instancia independiente de MTB Camboya PRO está publicada en `https://mtbpro.ddns.net` y es el servidor por defecto de la aplicación. No importes bases de datos, cuentas, ubicaciones, rutas ni rankings del proyecto mtb-camboya.

## Colecciones usadas

Los nombres siguientes se deducen de las llamadas API del cliente y los hooks incluidos. Este repositorio no contiene una configuración/exportación completa de colecciones para importarla directamente.

| Colección o recurso | Uso |
| --- | --- |
| `users` (auth) | Inicio de sesión, apodo, avatar y perfil privado. |
| `routes` | Rutas y actividades privadas sincronizadas por propietario. |
| `map_pois` | Puntos de interés sincronizados por propietario. |
| `live_locations` | Ubicación temporal de participantes de grupo durante una grabación. |
| `mtb_groups`, `mtb_group_members`, `mtb_group_rankings`, `mtb_group_ranking_entries` | Grupos, membresías y clasificaciones; gestionados mediante hooks de grupos. |
| `community_routes`, `community_route_favorites`, `community_route_ratings`, `community_route_comments` | Rutas publicadas e interacciones sociales. |
| `community_segments`, `community_segment_efforts`, `community_route_efforts`, `community_performance` | Segmentos y esfuerzos usados para el rendimiento de la comunidad. |
| `mtb_group_competitions`, `mtb_group_competition_entries`, `mtb_group_seasons`, `mtb_group_season_awards` | Colecciones propuestas para desafíos, ligas de cuatro semanas, participación e historial de campeones; requieren instalar el módulo competitivo antes de habilitar su interfaz de escritura. |

## Límites de acceso recomendados

- Exigir autenticación para operaciones sobre perfil, rutas y puntos privados. En `routes` y `map_pois`, permitir al usuario autenticado leer, crear, editar y borrar solo registros cuyo `owner` sea su ID.
- En `users`, impedir la lectura pública/listado de perfiles y limitar cambios al propio usuario. No exponer email, edad, peso, avatar privado ni `groupCode`.
- Mantener `live_locations` inaccesible al público. Autorizar lectura solo a miembros del mismo grupo y escritura/borrado al propietario autenticado; borrar posiciones obsoletas.
- Mantener las colecciones internas de grupos con reglas cerradas. Usar exclusivamente los hooks `/api/mtb/groups/*`, que deben verificar autenticación, pertenencia y permisos de administración.
- Publicar solo las rutas comunitarias aprobadas. Validar la propiedad en cambios y borrados, y limitar rating, comentarios y favoritos a usuarios autenticados con reglas contra duplicados y suplantación.
- Aplicar reglas de propietario a esfuerzos y registros de rendimiento privados. Validar del lado del servidor relaciones, campos numéricos, límites, fechas y tasas de escritura.
- Mantener TLS, proteger credenciales administrativas, configurar copias de seguridad y actualizar PocketBase. No habilitar reglas públicas genéricas para simplificar la integración.

## Hooks del repositorio

`pb_hooks/` incluye hooks para apodos, POIs, grupos, limpieza de posiciones, rutas comunitarias, segmentos, rendimiento e interacciones sociales. Revísalos y pruébalos junto a las reglas de colección de `https://mtbpro.ddns.net`. Las colecciones de temporadas y desafíos siguen pendientes de despliegue; el código de cliente por sí solo no es una frontera de seguridad.

Los tracks comunitarios son datos públicos. El hook de rutas comunitarias recorta 150 m de los extremos y rechaza POIs próximos a esos extremos; reduce la exposición de domicilios pero no garantiza anonimato. Las fotos se procesan en el cliente; la instancia debe validar y limpiar metadatos del lado del servidor.

Antes de conectar un servidor nuevo, prueba las reglas con dos cuentas distintas, un usuario anónimo, un miembro y un no miembro de grupo, y un administrador de grupo. Confirma que un usuario no pueda leer/modificar datos privados de otro.
