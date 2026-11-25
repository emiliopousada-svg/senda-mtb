# senda-mtb — Especificación de Producto (PRODUCT_SPEC.md)

**Versión:** 1.0  
**Fecha:** 16 de noviembre de 2026  
**Referencia:** Documento Maestro del Proyecto senda-mtb  

---

## 1. Visión y Pilares

senda-mtb es una aplicación multiplataforma (Web/PWA y Android nativo vía Capacitor) orientada exclusivamente al ciclismo de montaña (MTB). Diseñada con enfoque *local-first*, garantiza máxima fiabilidad en la navegación y registro de datos en entornos sin cobertura móvil.

El producto se estructura en tres pilares esenciales:
1. **PEDALEAR:** Planificación, cartografía global, seguimiento de rutas, registro GPS resiliente y seguridad mediante Guardian Mode.
2. **MEJORAR:** Análisis fisiológico y de rendimiento, telemetría de sensores Bluetooth LE (pulso, cadencia, velocidad, potencia) y gestión integral de bicicletas y componentes (Garaje).
3. **COMPETIR Y COMPARTIR:** Comunidad de montaña, ligas por temporadas, segmentos locales, retos individuales y por equipos, eventos y seguimiento grupal en tiempo real.

---

## 2. Sistema de Diseño e Identidad Visual

La interfaz está optimizada para lectura en exteriores con alta luminosidad y manejo táctil en marcha mediante guantes o soporte de manillar:

* **Paleta Oficial:**
  * **Negro grafito (`#101318`):** Fondo de aplicación y contraste máximo.
  * **Panel oscuro (`#202630`):** Superficies elevadas, tarjetas, diálogos y paneles flotantes.
  * **Naranja deportivo (`#FF7417`):** Acciones primarias, botones de grabación, llamadas a la acción y acentos energéticos.
  * **Azul eléctrico (`#00B8FF`):** Trazados de rutas activas, métricas secundarias, navegación y telemetría.
  * **Blanco puro (`#FFFFFF`):** Tipografía principal y valores destacados de telemetría.
  * **Gris suave (`#A1A1AA`):** Metadatos, etiquetas secundarias y textos de apoyo.
* **Componentes UI:**
  * Tarjetas táctiles con esquinas redondeadas de 14 a 18 px.
  * Botones con objetivo táctil mínimo de 48x48 dp.
  * Controles de grabación sobredimensionados para evitar pulsaciones erróneas.
  * Indicadores de estado visuales e inequívocos para GPS (precisión en metros), sensores BLE y sincronización.

---

## 3. Arquitectura de Pantallas y Navegación

La aplicación se articula sobre una barra de navegación inferior de 5 accesos principales, con paneles secundarios accesibles mediante navegación contextual:

### 3.1. Pestañas Principales

1. **Inicio (Dashboard / Centro de Control):**
   * Resumen de actividad semanal (km, desnivel acumulado, tiempo en movimiento).
   * Tarjeta de última actividad realizada con mini-mapa y métricas clave.
   * Acceso rápido destacado a "Grabar Salida" o "Seguir Ruta".
   * Estado de sincronización en la nube y conectividad.
   * Acceso directo a estado de Guardian Mode.

2. **Rutas (Biblioteca y Exploración):**
   * Pestaña "Mis Rutas": Rutas locales guardadas, historial de actividades y favoritos.
   * Pestaña "Comunidad": Rutas públicas aprobadas y compartidas por otros ciclistas.
   * Importador de tracks (GPX, KML, GeoJSON, FIT).
   * Planificador de rutas y visor de perfiles altimétricos con pendientes porcentuales.

3. **Mapa (Cartografía y Navegación):**
   * Visor cartográfico a pantalla completa con soporte de rotación según rumbo (bearing).
   * Selector de capas: Topográfica (IGN España / OpenTopoMap), Ciclismo (CyclOSM), Estándar y Satélite (ESRI).
   * Puntos de Interés (POIs) orientados a MTB: fuentes de agua, refugios, pasos técnicos, miradores y talleres.
   * Panel de navegación flotante: perfil de elevación dinámico, distancia restante y avisos de desvío.
   * Gestor de mapas descargados y almacenamiento offline.

4. **Comunidad (Competición y Social):**
   * Clasificaciones y ligas privadas por grupo (temporadas de 4 semanas).
   * Rankings independientes: kilometraje, desnivel positivo, regularidad y segmentos.
   * Segmentos de montaña: trazado, mejores tiempos, récord personal (PR) y esfuerzos.
   * Grupos MTB y seguimiento de compañeros en directo (*Live Tracking*).
   * Calendario de eventos y salidas colectivas.

5. **Stats (Análisis y Rendimiento):**
   * Evolución cronológica de volumen y desnivel.
   * Métricas de ascenso: VAM (Velocidad Ascensional Media en m/h) y clasificación de subidas.
   * Zonas de Frecuencia Cardíaca (Z1–Z5) configurables según Frecuencia Cardíaca Máxima o de Reserva.
   * Zonas de Potencia Coggan (Z1–Z7) calculadas a partir del FTP del ciclista.
   * Historial de récords personales (mayor distancia, mayor desnivel, mejor VAM, potencia máxima en intervalos).

### 3.2. Secciones y Paneles Secundarios

* **Guardian Mode (Seguridad):** Configuración de contactos SOS, temporizador de seguridad de salida y compartición de enlace de ubicación en vivo.
* **Garaje & Mantenimiento:** Registro de bicicletas, componentes (cadena, cubiertas, pastillas, suspensión) y alertas de desgaste por horas/km.
* **Sensores & Conexiones:** Escaneo y emparejamiento BLE de pulsómetro, sensores de cadencia/velocidad (CSC) y potenciómetro.

---

## 4. Especificación Funcional Detallada

### 4.1. Grabación GPS y Navegación
* **Filtrado de señal:** Descarte automático de fixes con precisión peor a 30 metros (`MAX_ACC_M = 30`).
* **Filtro de rebote:** Distancia mínima entre puntos de 4 metros (`MIN_STEP_M = 4`) para evitar dispersión en paradas.
* **Corte por velocidad inverosímil:** Descarte de saltos superiores a 90 km/h (`MAX_SPEED_MS = 25`).
* **Auto-pausa inteligente:** Detección de parada tras 20 segundos sin avance con precisión GPS adecuada.
* **Avisos de navegación:** Detección de fuera de ruta a 60 metros (`OFFROUTE_M = 60`) y reincorporación a 30 metros (`BACKONROUTE_M = 30`).

### 4.2. Guardian Mode (Seguridad en Ruta)
* **Lista de contactos de emergencia:** Máximo de 3 contactos con teléfono y correo.
* **Temporizador de llegada:** El ciclista define la duración estimada; si se sobrepasa el tiempo límite más un margen de cortesía (30 min) sin detener la grabación, se genera una alerta visual y acústica en el móvil antes de activar protocolos externos.
* **Botón SOS de un toque:** Genera un mensaje predefinido con coordenadas exactas en enlace universal (Google Maps / OpenStreetMap).
* **Consentimiento y privacidad:** Los enlaces de localización son efímeros y solo accesibles durante la actividad autorizada.

### 4.3. Garaje y Mantenimiento
* **Registro de Bicicletas:** Nombre, apodo, disciplina (Rally/XC, Trail, Enduro, Downhill, Gravel, e-MTB), peso y fecha de adquisición.
* **Telemetría de Componentes:**
  * Transmisión (Cadena, Cassette, Plato).
  * Frenos (Pastillas delanteras/traseras, Discos, Líquido).
  * Suspensión (Horquilla: revisión de 50h y 200h; Amortiguador trasero).
  * Neumáticos (Cubierta delantera/trasera, líquido tubeless).
* **Asignación automática:** La actividad grabada imputa sus kilómetros y horas a la bicicleta seleccionada.

---

## 5. Reglas de Negocio y Criterios de Calidad

1. **Prioridad Local-First:** Una salida grabada en el móvil nunca se pierde por falta de cobertura, caída del backend o fallo de batería. Se persiste punto a punto en IndexedDB.
2. **Aislamiento Absoluto:** Ningún dato, credencial, caché o llamada se comparte con la infraestructura del proyecto legado `senda-mtb`.
3. **Competición Transparente:** Las clasificaciones excluyen trayectos con velocidades anómalas o inconsistencias temporales en ficheros FIT/GPX.

