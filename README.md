# MTB Camboya PRO

App de ciclismo de montaña con GPS, registro de actividades, mapas offline, rutas GPX/KML/GeoJSON, estadísticas, sensores Bluetooth y funciones sociales.

Versión indicada en el proyecto: **0.1.0**

## Identidad y alcance

MTB Camboya PRO 0.1.0 es un proyecto independiente y dedicado a MTB. Usa negro grafito y naranja deportivo, con azul eléctrico para navegación y trazados del mapa. El almacenamiento local usa `mtb_camboya_pro_db` y claves `mtb_pro_*`; no importa ni limpia datos de otras apps.

## Desarrollo

Requisitos: Node.js 22; para Android, JDK 21, Android SDK 36 y Gradle 8.13.

```sh
npm ci
npm test
npm run build
gradle -p android assembleDebug
```

`npm run build` prepara `www/` y sincroniza Capacitor con Android. El APK debug se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.

La aplicación apunta al PocketBase independiente `https://mtbpro.ddns.net`. Consulta [POCKETBASE.md](POCKETBASE.md) para las colecciones y reglas requeridas. No se incluyen credenciales ni datos del proyecto de origen.

## iOS

El proyecto iOS está generado para `com.emiliopousada.mtbcamboyapro`, nombre `MTB Camboya PRO` y despliegue mínimo iOS 15. El acceso a ubicación en uso y en segundo plano y Bluetooth declara sus textos de permiso en `ios/App/App/Info.plist`. Revisa los mensajes y valida el comportamiento en un dispositivo antes de publicar.

Para compilarlo se necesita macOS con Xcode 26 o posterior:

```sh
npm ci
npm run build
npx cap open ios
```

Abre el proyecto `ios/App/App.xcodeproj`, selecciona un simulador o iPhone, firma la app en Xcode y compila. La configuración aún no se ha validado con Xcode en macOS.
