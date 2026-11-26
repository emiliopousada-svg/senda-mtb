# senda-mtb

App de ciclismo de montaña con GPS, registro de actividades, mapas offline, rutas GPX/KML/GeoJSON, estadísticas, sensores Bluetooth y funciones sociales.

Versión indicada en el proyecto: **0.2.56**

## Identidad y alcance

senda-mtb es un proyecto independiente y dedicado a MTB. Usa negro grafito y naranja deportivo, con azul eléctrico para navegación y trazados del mapa. El almacenamiento local usa `mtb_camboya_pro_db` y claves `mtb_pro_*`; no importa ni limpia datos de otras apps.

## Documentación del proyecto

El proyecto cuenta con especificaciones completas para cada área técnica y de producto:

- [Especificación de Producto (PRODUCT_SPEC.md)](PRODUCT_SPEC.md): Visión, pilares, mapa de pantallas, reglas funcionales y de negocio.
- [Arquitectura del Sistema (ARCHITECTURE.md)](ARCHITECTURE.md): Capas modulares, motores de dominio, flujo unidireccional y build.
- [Modelo de Datos (DATA_MODEL.md)](DATA_MODEL.md): Entidades y esquemas de IndexedDB y colecciones remotas de PocketBase.
- [Proveedores de Mapas y Política Offline (MAP_PROVIDERS.md)](MAP_PROVIDERS.md): Capas, condiciones de uso de teselas y límites offline.
- [Seguridad y Privacidad (SECURITY_AND_PRIVACY.md)](SECURITY_AND_PRIVACY.md): Aislamiento, permisos Android, Guardian Mode y protección de ubicación.
- [Plan de Pruebas (TEST_PLAN.md)](TEST_PLAN.md): Pruebas automatizadas, de hardware y criterios de aceptación por fase.
- [Historial de Cambios (CHANGELOG.md)](CHANGELOG.md): Registro de versiones y cambios del proyecto.
- [Plan de Extracción (EXTRACTION_PLAN.md)](EXTRACTION_PLAN.md): Trazabilidad de código y aislamiento respecto al repositorio original.
- [Guía de PocketBase (POCKETBASE.md)](POCKETBASE.md): Configuración de colecciones y hooks en el servidor independiente.

## Desarrollo

Requisitos: Node.js 22; para Android, JDK 21, Android SDK 36 y Gradle 8.13.

```sh
npm ci
npm test
npm run build
gradle -p android assembleDebug
```

`npm run build` prepara `www/` y sincroniza Capacitor con Android. El APK debug se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.

### APK en GitHub Actions y Releases

Cada subida a `main` ejecuta **senda-mtb checks** y publica el APK de pruebas como artefacto `senda-mtb-debug-apk`. Para generar un APK firmado de distribución y adjuntarlo a una GitHub Release, crea y sube una etiqueta `vX.Y.Z` que coincida con la versión de `package.json`. Después de publicar correctamente la Release, **Android signed APK** incrementa automáticamente la versión patch en `main` para preparar la siguiente (por ejemplo, de `1.4.2` a `1.4.3`). El workflow también conserva el APK firmado como artefacto de Actions; puede ejecutarse manualmente para generar el artefacto sin publicar una Release.

El APK firmado requiere estos secretos del repositorio en **Settings > Secrets and variables > Actions**:

- `MTB_SIGNING_KEYSTORE_BASE64`: almacén de claves de firma codificado en Base64.
- `MTB_SIGNING_STORE_PASSWORD`
- `MTB_SIGNING_KEY_ALIAS`
- `MTB_SIGNING_KEY_PASSWORD`

Para la nueva firma de release, crea un keystore PKCS12 dedicado; no reutilices ningún keystore debug. En PowerShell:

```powershell
keytool -genkeypair -v `
  -keystore "$env:USERPROFILE\.android\senda-mtb-release-v2.p12" `
  -storetype PKCS12 `
  -alias senda-mtb-release `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -dname "CN=senda-mtb release"
```

Cuando `keytool` lo solicite, usa contraseñas fuertes, únicas y de al menos 16 caracteres; no las incluyas en los argumentos del comando. Comprueba la huella del certificado:

```powershell
keytool -list -v `
  -keystore "$env:USERPROFILE\.android\senda-mtb-release-v2.p12" `
  -storetype PKCS12 `
  -alias senda-mtb-release
```

En **Settings > Secrets and variables > Actions**, actualiza los cuatro secretos anteriores con el keystore nuevo, su Base64, el alias `senda-mtb-release` y las contraseñas. Si tienes GitHub CLI autenticada, puedes enviar el Base64 directamente como secreto sin imprimirlo:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.android\senda-mtb-release-v2.p12")) | gh secret set MTB_SIGNING_KEYSTORE_BASE64
```

Configura además la variable de Actions `MTB_SIGNING_CERT_SHA256` con el SHA-256 del certificado, en 64 caracteres hexadecimales sin dos puntos. La workflow compara esa huella con el keystore antes de firmar.

Guarda una copia de recuperación cifrada y con acceso restringido fuera de Actions. No subas el keystore ni sus contraseñas al repositorio. La clave actual de release solo está disponible en los secretos existentes de Actions; no se puede recuperar desde la interfaz de GitHub. Al cambiar a la nueva firma, Android no permitirá actualizar las instalaciones firmadas con la anterior: habrá que desinstalar y reinstalar la app. Esto borra sus datos locales; exporta o sincroniza lo que quieras conservar antes de desinstalar. Después de la transición, conserva siempre el nuevo keystore para futuras actualizaciones.

La aplicación apunta al PocketBase independiente `https://mtbpro.ddns.net`. Consulta [POCKETBASE.md](POCKETBASE.md) para las colecciones y reglas requeridas. No se incluyen credenciales ni datos del proyecto de origen.

## Entornos

La configuración que cambia según el entorno está en `APP_ENVIRONMENTS`, dentro de `app/config.js`. `npm run prepare-web` (y `npm run build`) elige el entorno con la variable `MTB_APP_ENV`; si no se indica, compila para producción.

| `MTB_APP_ENV` | Servidor PocketBase | Uso |
| --- | --- | --- |
| `production` (por defecto) | `https://mtbpro.ddns.net` | APK de pruebas, APK firmado y releases. |
| `staging` | El que indiques en `MTB_CLOUD_SERVER` (obligatorio, HTTPS) | Probar contra un PocketBase de pruebas sin tocar datos reales. |
| `development` | `http://127.0.0.1:8090` o `MTB_CLOUD_SERVER` | Desarrollo en el navegador con `pocketbase serve` local. Solo en este entorno se admite `http://` y únicamente para `localhost`/`127.0.0.1`. |

```sh
# Linux / macOS
MTB_APP_ENV=staging MTB_CLOUD_SERVER=https://pruebas.example.com npm run build
MTB_APP_ENV=development npm run prepare-web
```

```powershell
# Windows PowerShell
$env:MTB_APP_ENV = 'staging'; $env:MTB_CLOUD_SERVER = 'https://pruebas.example.com'; npm run build
```

La compilación falla si el entorno no existe, si `staging` no tiene servidor o si la URL no es válida. Las etiquetas `vX.Y.Z` solo se compilan en producción y sin `MTB_CLOUD_SERVER`. Fuera de producción, Ajustes muestra el entorno junto a la versión (por ejemplo, `v0.2.35 (build local) · Pruebas`). Android bloquea el tráfico `http://`, así que en el móvil usa `staging` con un servidor HTTPS; `development` es para el navegador. Si sirves `index.html` sin compilar, la app usa producción.

## iOS

La plataforma iOS no está incluida en este repositorio. Para generarla se necesita macOS con Xcode 26 o posterior. Ejecuta `npx cap add ios` solo si todavía no existe la carpeta `ios/`.

Después, compila y abre el proyecto generado:

```sh
npm ci
npx cap add ios # solo la primera vez
npm run build
npx cap open ios
```

Antes de publicar, configura y revisa en `ios/App/App/Info.plist` los textos de permiso para ubicación y Bluetooth, además de la firma y el destino de despliegue. Esta configuración aún no se ha validado con Xcode en macOS.

