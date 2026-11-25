# senda-mtb — Seguridad y Privacidad (SECURITY_AND_PRIVACY.md)

**Versión:** 1.0  
**Fecha:** 16 de noviembre de 2026  
**Referencia:** Documento Maestro del Proyecto senda-mtb  

---

## 1. Principio Fundamental de Aislamiento

> [!IMPORTANT]
> **Aislamiento Total del Repositorio y Datos Originales:**
> El proyecto original `senda-mtb` permanece completamente intacto. No se comparten secretos, claves privadas, bases de datos, tokens de sesión, identificadores de aplicación, nombres de caché de Service Worker ni instancias de servidor entre ambas aplicaciones.

### Checklist de Aislamiento Técnico:
* **Identificador de Aplicación Android:** `com.emiliopousada.sendamtb` (frente a `com.emiliopousada.mtbcamboya`).
* **Base de Datos Local:** `mtb_camboya_pro_db` (IndexedDB versión 2 independiente).
* **Almacenamiento Local (LocalStorage):** Claves con prefijo exclusivo `mtb_pro_*`.
* **Caché PWA / Service Worker:** Nombre y espacio de nombres de caché independientes para evitar colisiones en navegadores que visiten ambos dominios.
* **Backend Cloud:** Instancia independiente de PocketBase en `https://mtbpro.ddns.net` con sus propias tablas y credenciales maestras.

---

## 2. Modelo de Permisos y Privilegios en el Dispositivo

La aplicación solicita únicamente los permisos estrictamente necesarios para su funcionamiento, siguiendo el principio de mínimo privilegio:

### 2.1. Android (`AndroidManifest.xml`)
* `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`: Necesarios para la adquisición de coordenadas GPS de alta precisión en ruta.
* `FOREGROUND_SERVICE` y `FOREGROUND_SERVICE_LOCATION`: Permiten mantener la grabación de la ruta activa con la pantalla apagada o con la aplicación en segundo plano, informando al usuario mediante una notificación persistente.
* `BLUETOOTH_SCAN` y `BLUETOOTH_CONNECT` (Android 12+ / API 31+) con flags de no derivación de ubicación física para telemetría de sensores.
* `WAKE_LOCK`: Evita la suspensión del procesador durante la grabación activa.
* `POST_NOTIFICATIONS`: Alertas de desvío de ruta, mantenimiento del garaje y avisos de Guardian Mode.
* `usesCleartextTraffic="false"`: Bloquea a nivel de sistema operativo cualquier conexión HTTP no cifrada.

---

## 3. Guardian Mode y Manejo de Ubicación en Directo

El modo de seguridad Guardian Mode introduce capacidades críticas de salvaguarda física para el ciclista solitario:

1. **Consentimiento Explícito:**
   * La compartición de ubicación en tiempo real requiere activación consciente por parte del usuario.
   * La interfaz indica claramente cuándo la posición se está transmitiendo y a través de qué canal.
2. **Ciclo de Vida Efímero de las Coordenadas:**
   * Las posiciones transmitidas en vivo (`live_locations`) son temporales y se eliminan inmediatamente tras finalizar la salida o abandonar el grupo.
   * El backend cuenta con un cron de purga (`live_cleanup.pb.js`) que elimina registros que no hayan recibido actualizaciones en 30 minutos.
3. **Descargo de Responsabilidad SOS:**
   * Los contactos de emergencia (nombre y teléfono) se guardan en las preferencias privadas de la cuenta (`mtb_user_preferences`, solo accesibles por su propietario) para no tener que volver a introducirlos en otro dispositivo. Sin sesión iniciada se guardan solo en el móvil.
   * La aplicación advierte explícitamente que el mensaje SOS por WhatsApp depende de cobertura celular y batería suficiente en el terminal móvil. No sustituye un dispositivo de rescate satelital dedicado (ej. Garmin inReach / SPOT) en zonas remotas sin señal.

---

## 4. Protección de Datos Personales y Comunidad

1. **Privacidad del Domicilio (Trimming de Rutas Comunitarias):**
   * El hook de backend `community_routes.pb.js` recorta automáticamente **150 metros** del inicio y del final de cualquier trazado GPS publicado para evitar que se identifique la vivienda o punto habitual de salida del usuario.
   * Se descartan los POIs situados a menos de 150 metros de dichos extremos.
2. **Anonimización de Archivos Multimedia:**
   * Las fotos adjuntadas a rutas son re-procesadas en el cliente, eliminando metadatos EXIF sensibles (marcas de cámara, fecha exacta y coordenadas de disparo incrustadas).
3. **Perfiles de Usuario:**
   * El perfil privado (`email`, edad, peso, avatar privado y `groupCode`) está protegido por reglas de PocketBase que impiden el listado público o la lectura por terceros no autorizados.

---

## 5. Comunicaciones y Red

* Todas las conexiones hacia el backend de PocketBase se realizan obligatoriamente bajo **HTTPS / TLS 1.3**.
* La función cliente `cloudApi()` implementa validación estricta de dominios, control de cabeceras, rechazo de redirecciones inesperadas y `cache: 'no-store'` para evitar que respuestas con datos privados queden registradas en cachés compartidas del navegador.

## 6. Autenticación y Sesiones

* En web/PWA, el cliente conserva el token bearer de PocketBase en `localStorage` para mantener la sesión y lo envía en la cabecera `Authorization`. Cualquier JavaScript que se ejecute en el origen de la aplicación puede leerlo. La CSP reduce la superficie de inyección, pero no protege el token frente a un XSS efectivo ni frente a extensiones con acceso al sitio. Esta exposición no constituye por sí misma evidencia de un XSS explotable.
* En la aplicación nativa, el token se guarda mediante SecureStorage; los tokens heredados de `localStorage` se migran y se eliminan del almacenamiento web. El token sigue disponible en memoria mientras se ejecuta la aplicación.
* PocketBase renueva la sesión al restaurarla y antes de sincronizar rutas. La duración y expiración efectiva del token dependen de la configuración desplegada; el cliente no las establece. Una respuesta 401 elimina la sesión local.
* Al cerrar sesión, `logoutCloudAccount()` detiene la actividad del grupo y elimina las credenciales locales. No envía una solicitud de revocación a PocketBase; no hay una función de cierre de sesión global. Borrar el token de este dispositivo no invalida otros tokens.
* `sessionStorage` reduciría la persistencia entre sesiones del navegador, pero no impediría que JavaScript del mismo origen leyera el token. Una cookie `HttpOnly; Secure; SameSite` con proxy compatible reduciría esa exposición, pero requiere soporte del backend y cambios en el flujo de autenticación. La revocación global también requiere soporte explícito del servidor.
* El repositorio no distribuye hooks, migraciones ni configuración que acrediten políticas propias de expiración o rotación de tokens, validación de origen o límites de intentos de contraseña. Esas propiedades dependen de la configuración de PocketBase desplegada y no se afirman aquí.
* La recuperación depende del envío de correo configurado en la instancia PocketBase; el repositorio no incluye una pantalla de recuperación. Configura y verifica la entrega de mensajes en el servidor antes de ofrecer ese flujo.
* El perfil permite borrar la cuenta mediante un endpoint autenticado que vuelve a validar la contraseña y elimina el registro de usuario dentro de una transacción. PocketBase elimina en cascada los datos relacionados con ese usuario. Para no borrar datos compartidos de terceros, el endpoint rechaza cuentas que todavía administran grupos; hay que transferir o eliminar cada grupo antes. Las rutas, estadísticas y preferencias almacenadas únicamente en el dispositivo se conservan; se limpia la caché local del avatar de la cuenta. La instancia desplegada debe incluir `pb_hooks/account.pb.js` para ofrecer esta función. La eliminación de la base activa no purga copias de seguridad ni registros operativos: su retención depende del operador del servidor.

