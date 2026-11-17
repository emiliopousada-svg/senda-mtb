# senda-mtb

App de ciclismo de montaña con GPS, registro de actividades, mapas offline, rutas GPX/KML/GeoJSON, estadísticas, sensores Bluetooth y funciones sociales.

Versión indicada en el proyecto: **0.2.0**

## Identidad y alcance

senda-mtb 0.2.0 es un proyecto independiente y dedicado a MTB. Usa negro grafito y naranja deportivo, con azul eléctrico para navegación y trazados del mapa. El almacenamiento local usa `mtb_camboya_pro_db` y claves `mtb_pro_*`; no importa ni limpia datos de otras apps.

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

Cada subida a `main` ejecuta **senda-mtb checks** y publica el APK de pruebas como artefacto `senda-mtb-debug-apk`. Para generar un APK firmado de distribución y adjuntarlo a una GitHub Release, crea y sube una etiqueta `vX.Y.Z` que coincida con la versión de `package.json`. Después de publicar correctamente la Release, **Android signed APK** incrementa automáticamente la versión patch en `main` para preparar la siguiente (por ejemplo, `0.2.0` a `0.2.1`). El workflow también conserva el APK firmado como artefacto de Actions; puede ejecutarse manualmente para generar el artefacto sin publicar una Release.

El APK firmado requiere estos secretos del repositorio en **Settings > Secrets and variables > Actions**:

- `MTB_SIGNING_KEYSTORE_BASE64`: almacén de claves de firma codificado en Base64.
- `MTB_SIGNING_STORE_PASSWORD`
- `MTB_SIGNING_KEY_ALIAS`
- `MTB_SIGNING_KEY_PASSWORD`

Usa siempre el mismo almacén de claves para que Android permita instalar actualizaciones sobre la app y conservar sus datos. Para reutilizar el almacén debug local en Windows, puedes copiar su Base64 al portapapeles con:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.android\debug.keystore")) | Set-Clipboard
```

El almacén debug predeterminado usa la contraseña `android` y el alias `androiddebugkey`; guarda esos valores como secretos también. No subas el almacén de claves al repositorio. Si la app instalada tiene otra firma, Android no permitirá actualizarla con esta clave.

La aplicación apunta al PocketBase independiente `https://mtbpro.ddns.net`. Consulta [POCKETBASE.md](POCKETBASE.md) para las colecciones y reglas requeridas. No se incluyen credenciales ni datos del proyecto de origen.

## iOS

El proyecto iOS está generado para `com.emiliopousada.sendamtb`, nombre `senda-mtb` y despliegue mínimo iOS 15. El acceso a ubicación en uso y en segundo plano y Bluetooth declara sus textos de permiso en `ios/App/App/Info.plist`. Revisa los mensajes y valida el comportamiento en un dispositivo antes de publicar.

Para compilarlo se necesita macOS con Xcode 26 o posterior:

```sh
npm ci
npm run build
npx cap open ios
```

Abre el proyecto `ios/App/App.xcodeproj`, selecciona un simulador o iPhone, firma la app en Xcode y compila. La configuración aún no se ha validado con Xcode en macOS.

