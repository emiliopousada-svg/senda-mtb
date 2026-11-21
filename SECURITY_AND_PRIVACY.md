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

* El cliente no conserva JWT de PocketBase en `localStorage`. El login nativo de PocketBase entrega un JWT solo en memoria para intercambiarlo por la cookie `__Host-mtb_session`, que es `HttpOnly`, `Secure` y `SameSite=None`.
* El servidor guarda solo el hash SHA-256 del secreto de sesión, aplica una expiración de 30 días y revoca la sesión al cerrar sesión. La migración rota las claves de token antiguas y limita a 120 segundos los JWT usados para el intercambio.
* Las mutaciones con cookie requieren el origen exacto `https://localhost`; el límite de intentos de contraseña es 10 por cuenta e IP en 15 minutos. El WebView Android acepta cookies de terceros únicamente para que la cookie segura alcance el servidor PocketBase cross-site.
* La recuperación depende del envío de correo configurado en la instancia PocketBase; el repositorio no incluye una pantalla de recuperación. Configura y verifica la entrega de mensajes en el servidor antes de ofrecer ese flujo.

