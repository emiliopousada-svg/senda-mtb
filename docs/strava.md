# Integración con Strava

La conexión y subida de actividades se gestiona desde **Herramientas → Social**. La app solo sube una actividad grabada cuando la persona pulsa el botón; la privacidad predeterminada es **Solo yo**. No se sincronizan actividades automáticamente.

## Configuración de PocketBase

1. Crea una aplicación en [Strava API Settings](https://www.strava.com/settings/api).
2. En **Authorization Callback Domain**, indica el dominio que sirve PocketBase, sin protocolo ni ruta (por ejemplo, `mtbpro.ddns.net`).
3. En el entorno del proceso PocketBase configura estas variables:

   | Variable | Valor |
   | --- | --- |
   | `STRAVA_CLIENT_ID` | Client ID de la aplicación Strava |
   | `STRAVA_CLIENT_SECRET` | Client Secret de la aplicación Strava |
   | `STRAVA_REDIRECT_URI` | `https://mtbpro.ddns.net/api/mtb/strava/callback` |
   | `STRAVA_TOKEN_ENCRYPTION_KEY` | Clave aleatoria de exactamente 32 caracteres para cifrar los tokens |

   Genera la clave de cifrado en el servidor con un gestor de secretos o una fuente criptográfica segura. No la pongas en el repositorio, APK, logs ni respuesta de la API. Conserva una copia segura: cambiarla impide descifrar las conexiones ya guardadas.

4. Despliega `pb_hooks/strava.pb.js` y las migraciones de `pb_migrations/` junto con la versión compatible de PocketBase. Reinicia PocketBase para que cargue los hooks y aplique la migración `strava_connections`.
5. Comprueba que el callback público responde por HTTPS y que el servidor puede hacer solicitudes salientes a `www.strava.com`.

La colección `strava_connections` no admite acceso directo mediante la API de registros. Los endpoints propios validan la sesión PocketBase y solo operan sobre la conexión de esa persona. Los tokens de acceso y renovación se cifran antes de guardarse. El secreto de Strava nunca llega a la app.

## Flujo de uso

1. Inicia sesión en senda-mtb y abre **Herramientas → Social**.
2. Pulsa **Conectar con Strava**, revisa el permiso solicitado y autoriza la cuenta.
3. Al volver a la app, pulsa **Actualizar estado** si no aparece conectada.
4. Elige una salida grabada, decide su privacidad y pulsa **Subir a Strava**.

Se sube el track GPX con las marcas de tiempo de la grabación. Las fotos y POI de la ruta no se envían. Si Strava tarda en procesar el archivo, la app avisa y la actividad aparece al completarse el procesamiento.

## Endpoints del servidor

- `POST /api/mtb/strava/connect`: crea el estado OAuth y devuelve la URL de autorización.
- `GET /api/mtb/strava/callback`: valida el estado y canjea el código de autorización.
- `GET /api/mtb/strava/status`: devuelve únicamente si hay conexión y el nombre público de atleta.
- `POST /api/mtb/strava/upload`: sube un GPX de hasta 8 MB y devuelve el ID de procesamiento.
- `GET /api/mtb/strava/upload/{id}`: consulta el procesamiento de una subida.
- `POST /api/mtb/strava/disconnect`: revoca el permiso e intenta borrar los tokens.

La app solicita solo el alcance `activity:write`; no pide lectura del perfil o de actividades de Strava.
