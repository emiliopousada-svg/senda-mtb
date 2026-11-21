# PocketBase para senda-mtb

La instancia independiente de senda-mtb está publicada en `https://mtbpro.ddns.net` y es el servidor por defecto de la aplicación. No importes bases de datos, cuentas, ubicaciones, rutas ni rankings del proyecto senda-mtb.

## Colecciones usadas

Los nombres siguientes se deducen de las llamadas API del cliente y los hooks incluidos. Este repositorio no contiene una configuración/exportación completa de colecciones para importarla directamente.

| Colección o recurso | Uso |
| --- | --- |
| `users` (auth) | Inicio de sesión, apodo, avatar JPEG, peso, altura y edad. La migración de perfil limita listado/lectura/edición al titular y evita que el cliente asigne `groupCode`. |
| `mtb_user_preferences` | Un registro privado por usuario con sus preferencias de uso, sincronizadas entre dispositivos. Incluye los contactos de emergencia (nombre y teléfono). No almacena credenciales, ubicaciones GPS, identificadores BLE ni teselas offline. |
| `routes` | Rutas y actividades privadas sincronizadas por propietario. |
| `map_pois` | Puntos de interés sincronizados por propietario. |
| `live_locations` | Ubicación temporal de participantes de grupo durante una grabación. |
| `mtb_groups`, `mtb_group_members`, `mtb_group_ranking_entries` | Grupos, membresías y resultados de clasificación; gestionados mediante hooks de grupos. |
| `community_routes`, `community_route_favorites`, `community_route_ratings`, `community_route_comments` | Rutas publicadas e interacciones sociales. |
| `community_route_import_state` | Firmas privadas de los ficheros fuente importados como rutas comunitarias; la usa únicamente el hook del servidor. |
| `community_segments`, `community_segment_efforts`, `community_route_efforts` | Segmentos y marcas de rendimiento de la comunidad. |
| `mtb_group_challenges` | Desafíos de grupo (distancia, desnivel, salidas o tiempo con fechas). Cerrada: solo se usa desde los hooks de `/api/mtb/groups/*`. Las temporadas de cuatro semanas, los títulos y el palmarés se calculan a partir de `mtb_group_ranking_entries` y no necesitan colecciones propias. |

## Límites de acceso recomendados

- Exigir autenticación para operaciones sobre perfil, rutas y puntos privados. En `routes` y `map_pois`, permitir al usuario autenticado leer, crear, editar y borrar solo registros cuyo `owner` sea su ID.
- En `users`, impedir la lectura pública/listado de perfiles y limitar cambios al propio usuario. No exponer email, edad, peso ni `groupCode`. El archivo de avatar permanece accesible por URL directa para mostrarlo a miembros de grupos; si se necesita que también sea privado, habrá que habilitar archivos protegidos y cambiar la carga de avatares en el cliente y el flujo de grupos.
- Mantener `live_locations` inaccesible al público. Autorizar lectura solo a miembros del mismo grupo y escritura/borrado al propietario autenticado; borrar posiciones obsoletas.
- Mantener las colecciones internas de grupos con reglas cerradas. Usar exclusivamente los hooks `/api/mtb/groups/*`, que deben verificar autenticación, pertenencia y permisos de administración.
- Publicar solo las rutas comunitarias aprobadas. Validar la propiedad en cambios y borrados, y limitar rating, comentarios y favoritos a usuarios autenticados con reglas contra duplicados y suplantación.
- Aplicar reglas de propietario a esfuerzos y registros de rendimiento privados. Validar del lado del servidor relaciones, campos numéricos, límites, fechas y tasas de escritura.
- Mantener TLS, proteger credenciales administrativas, configurar copias de seguridad y actualizar PocketBase. No habilitar reglas públicas genéricas para simplificar la integración.

## Autenticación y sesiones

La app Android usa el origen `https://localhost` y se conecta a PocketBase con una cookie `__Host-mtb_session` `HttpOnly`, `Secure` y `SameSite=None`. La cookie contiene un secreto aleatorio; PocketBase solo almacena su SHA-256 en `mtb_auth_sessions`. Cada sesión vence a los 30 días y el cierre de sesión la revoca en el servidor. `onRealtimeSubscribeRequest` asocia la sesión autenticada al cliente SSE y `onRealtimeMessageSend` vuelve a validarla antes de entregar cada evento, por lo que una conexión abierta deja de recibir mensajes privados después de la revocación; estos hooks requieren una versión de PocketBase que los incluya (verificados en 0.23.12). El token JWT de PocketBase se usa únicamente en memoria para intercambiar el resultado del login mediante `POST /api/mtb/auth/session/exchange`; el backend limita su duración a 120 segundos, impide reutilizarlo y rechaza los JWT de usuario para el resto de rutas. Las contraseñas y la validación del login siguen a cargo del flujo de autenticación nativo de PocketBase.

La migración `pb_migrations/1794836005_create_revocable_auth_sessions.js` crea las colecciones internas cerradas, reduce a 30 minutos la duración máxima del token de restablecimiento de contraseña y rota las claves de token existentes para invalidar JWT antiguos. `pb_hooks/auth_sessions.pb.js` aplica cookies, protección CSRF por origen, revocación y límites de intentos de contraseña (10 por cuenta e IP cada 15 minutos). `pb_hooks/auth_sessions_utils.js` contiene las operaciones compartidas. El downgrade conserva las colecciones de sesiones y límites para no borrar datos preexistentes que la migración haya adoptado.

Antes de activar el nuevo cliente, despliega la migración y todos los hooks, y configura PocketBase para permitir únicamente el origen `https://localhost` (por ejemplo, añade `--origins https://localhost` al comando `pocketbase serve`; no dejes `*`). Reinicia el servidor y luego publica/instala el cliente nuevo. La app Android habilita cookies de terceros en su WebView porque la API está en otro sitio; el servidor sigue aceptando credenciales solo desde el origen anterior. Si PocketBase está detrás de un proxy, configura sus proxies de confianza para que el límite por IP use la dirección del cliente real.

El endpoint `POST /api/mtb/groups/rankings/share` recibe el `groupId` confirmado por el cliente y lo compara con el grupo activo del usuario y su membresía antes de guardar resultados.

El proyecto no incluye una pantalla de recuperación de contraseña. El endpoint de restablecimiento de PocketBase conserva su flujo de email y sus tokens quedan limitados a 30 minutos; la entrega de correo y los templates deben configurarse en la instancia. Esta configuración remota no está versionada en este repositorio.

## Hooks del repositorio

`pb_hooks/` incluye hooks para apodos, POIs, grupos, limpieza de posiciones, rutas comunitarias, segmentos, rendimiento e interacciones sociales. Cada handler se ejecuta en un contexto aislado: los helpers deben definirse dentro del handler o cargarse con `require()` desde él. Revísalos y pruébalos junto a las reglas de colección de `https://mtbpro.ddns.net`. La colección de desafíos y el hook de la liga de grupo están desplegados en producción desde la versión 0.2.2; el código de cliente por sí solo no es una frontera de seguridad.

La migración `pb_migrations/1794829123_create_mtb_user_preferences.js` crea `mtb_user_preferences` con reglas que limitan lectura, creación, modificación y borrado al propietario autenticado. Despliega la migración en el directorio de datos de PocketBase y ejecútala con `pocketbase migrate up` (o inicia PocketBase con las migraciones automáticas habilitadas) antes de publicar la versión web que la utiliza.

La migración `pb_migrations/1794830184_add_private_user_profile_fields.js` añade, si faltan, `nickname` (máximo 32 caracteres), `weightKg` (0–250) y `age` (entero, 0–100), además de `avatar` (JPEG, máximo 256 KiB, miniaturas de 96 y 256 px). Cero representa un valor todavía no configurado; la app solo acepta peso de 25–250 kg y edad de 10–100 años. También deja el registro de `users` visible solo para su titular y permite actualizarlo solo al titular sin aceptar cambios de `groupCode`. El archivo de avatar no está protegido y puede descargarse con su URL directa, para que se muestre en grupos. No reemplaza campos ya existentes; comprueba tipos y límites en el panel PocketBase antes de aplicarla.

La migración `pb_migrations/1794836003_add_user_height.js` añade `heightCm` (entero, 0–230) a `users` si falta. La app acepta alturas de 120–230 cm y la conserva en el perfil para futuras estimaciones; las potencias mostradas actualmente siguen requiriendo datos del potenciómetro.

La migracion `pb_migrations/1794836004_create_community_route_import_state.js` crea la coleccion interna cerrada que conserva las firmas de los ficheros de Galicia entre ejecuciones del cron. Despliega las migraciones y el hook `community_routes_galicia_import.pb.js` juntos; sin esta coleccion, el importador no puede guardar el estado de cambios.

La migración `pb_migrations/1794835000_create_mtb_app_collections.js` crea las colecciones activas de rutas privadas, POIs, ubicaciones en vivo, grupos, clasificaciones, rutas comunitarias, segmentos, valoraciones, favoritos, comentarios y marcas. Añade `groupCode` a `users` si falta y mantiene cerradas las colecciones internas de grupos; las lecturas públicas se limitan a rutas comunitarias publicadas y sus marcas/interacciones. Crea solo colecciones que no existan y conserva las ya existentes sin corregir sus campos o reglas. La migración `pb_migrations/1794835001_add_community_route_poi_fields.js` añade los campos `poisJson` y `poiPhotos` a una colección `community_routes` ya creada si faltan. La migración `pb_migrations/1794835003_secure_live_location_access.js` actualiza las reglas existentes de `live_locations` para exigir pertenencia vigente al grupo. La migración `pb_migrations/1794835004_add_live_location_timestamps.js` añade los campos automáticos `created` y `updated` si faltan, necesarios para ordenar y expirar las ubicaciones. Ambas conservan los registros y campos compatibles. Haz una copia de seguridad antes de aplicar migraciones.

La migración `pb_migrations/1794835005_add_author_nicknames.js` añade campos de apodo a rutas, POIs, ubicaciones en vivo, contenido comunitario y membresías de grupo, y actualiza la autoría de los registros existentes usando el apodo actual de su propietario. Despliega también los hooks de `pb_hooks/` para que PocketBase imponga el apodo del usuario autenticado en las nuevas escrituras. El campo `owner` o equivalente sigue siendo el vínculo técnico de permisos y no se sustituye por el apodo. Haz una copia de seguridad y aplica la migración en el servidor antes de desplegar esta versión de la app.

La app solicita la comunidad autónoma al publicar; conserva el nombre histórico del campo `province` en PocketBase para no romper rutas y clientes existentes. Consulta [CONFIGURAR-RUTAS-COMUNIDAD.md](./CONFIGURAR-RUTAS-COMUNIDAD.md) para desplegar y verificar los campos y hooks.

La migración `pb_migrations/1794836000_create_group_challenges.js` añade los campos automáticos `created` y `updated` a `mtb_group_ranking_entries` (las marcas antiguas usan como fecha el `clientId` de la salida) y crea `mtb_group_challenges`. El hook `pb_hooks/group_league.pb.js` publica, para el grupo del usuario autenticado:

| Ruta | Uso |
| --- | --- |
| `GET /api/mtb/groups/challenges` | Temporada activa, clasificación y desafíos con el progreso de cada miembro. |
| `POST /api/mtb/groups/challenges` | Crea un desafío (`name`, `metric`, `target`, `endsAt`; cualquier miembro, máximo 20 activos). |
| `POST /api/mtb/groups/challenges/delete` | Borra un desafío (`id`; solo su creador o el administrador del grupo). |
| `GET /api/mtb/groups/awards` | Títulos de la temporada, palmarés de las últimas 12 temporadas y medallero. |
| `GET /api/mtb/groups/activity` | Actividad del grupo de los últimos 90 días. |

### Desplegar la liga de grupo

1. Haz una copia de seguridad de `pb_data`.
2. Copia `pb_hooks/` (incluidos `groups_utils.js`, `groups.pb.js` y `group_league.pb.js`) y `pb_migrations/` al servidor.
3. Ejecuta `pocketbase migrate up` (o reinicia con las migraciones automáticas activas).
4. Reinicia PocketBase y comprueba que `GET /api/mtb/groups/challenges` responde `401` sin sesión y `200` con un usuario que pertenece a un grupo.

La app conserva estas preferencias localmente y las sincroniza al iniciar sesión y cuando cambian: avisos de ruta, vibración, rotación y estilo del mapa, controles grandes, circunferencia de rueda, objetivo semanal, FTP y FC máxima, orden/visibilidad de métricas y contactos de emergencia (nombre y teléfono, hasta 5). Si hay cambios simultáneos, prevalece la última escritura sincronizada. Las ubicaciones recientes, los dispositivos Bluetooth y los mapas descargados siguen siendo específicos del dispositivo.

Los tracks comunitarios son datos públicos. El hook de rutas comunitarias recorta 150 m de los extremos y rechaza POIs próximos a esos extremos; reduce la exposición de domicilios pero no garantiza anonimato. Las fotos se procesan en el cliente; la instancia debe validar y limpiar metadatos del lado del servidor.

Antes de conectar un servidor nuevo, prueba las reglas con dos cuentas distintas, un usuario anónimo, un miembro y un no miembro de grupo, y un administrador de grupo. Confirma que un usuario no pueda leer/modificar datos privados de otro.

