# MTB PRO — estado de las funciones premium

Este inventario separa lo que ya funciona en esta versión de lo que depende de servicios, permisos o trabajo posterior.

## Decisiones técnicas

- Mantener JavaScript, HTML y CSS con Capacitor 8, Leaflet y Chart.js durante la primera fase; estabilizar el núcleo antes de valorar una migración de framework.
- Separar presentación, lógica de dominio y acceso a datos. Reducir dependencias cruzadas entre módulos y documentar sus interfaces.
- Consolidar servicios comunes para GPS, archivos, permisos, conectividad y sincronización en iteraciones compatibles con la aplicación actual.
- Mantener las actividades locales disponibles sin conexión y sincronizarlas cuando la red vuelva, sin perder cambios locales.
- Usar únicamente backend e identidad propios de MTBPro, sin compartir PocketBase, credenciales o datos con MTB Camboya.

| Función | Estado |
| --- | --- |
| Panel de grabación configurable | Implementado: ordenar y mostrar u ocultar métricas (incluye velocidad media, cadencia y potencia); preferencias guardadas en el dispositivo. |
| Perfil de elevación durante la grabación | Implementado: perfil SVG en directo y altitud reciente cuando hay lecturas GPS válidas. |
| Objetivo semanal del inicio | Implementado: objetivo de distancia editable y barra de progreso local. |
| Perfil de elevación interactivo | Disponible: el perfil de ruta permite seleccionar puntos y el mapa sincroniza la posición. |
| Navegación por voz | Implementadas indicaciones habladas al desviarse y al volver a la ruta mediante síntesis de voz del dispositivo. Aún no ofrece instrucciones giro a giro. |
| Capas globales del mapa | Disponibles online: topográfica, ciclismo, callejero y satélite; selector rápido dentro del mapa. |
| Mapas offline por regiones | Disponible para regiones de España y Portugal mediante el proveedor IGN compatible. La cobertura mundial depende de proveedores que autoricen descarga y uso offline. |
| Comparación de rutas | Implementada: compara perfiles de altitud y métricas de dos rutas guardadas. |
| Récords y logros | Ya disponible para récords personales y medallas. |
| Panel de sensores Bluetooth | Ya disponible; necesita un sensor BLE compatible y permisos del dispositivo. |
| Clasificaciones de grupos | Ya disponible cuando se configura un backend PocketBase propio y la cuenta tiene acceso. |
| Menú Comunidad | Implementado con seis pestañas: Ranking, Segmentos, Desafíos, Mi grupo, Logros y Actividad. |
| Navegación principal | Cinco accesos inferiores (Inicio, Rutas, Mapa, Comunidad y Stats); Seguridad, Garaje, CAMBOYA AI, Calendario, Sensores y Ajustes se reúnen en Más herramientas. Seguridad, Garaje y Calendario son accesos conceptuales hasta que se implementen. |
| Liga privada de cuatro semanas | Diseño y puntuación base documentados; requiere desplegar colecciones, validadores, temporadas e historial del módulo competitivo en PocketBase antes de habilitar escrituras. |
| Modo nocturno automático | Pendiente de programación horaria; la interfaz actual mantiene el tema oscuro. |
| Transiciones entre pantallas | Disponibles en el carrusel de páginas, con soporte de movimiento reducido del sistema. |
| Vibración de grabación | Implementada al iniciar, pausar, reanudar y finalizar cuando el dispositivo ofrece vibración y la preferencia está activa. |
| GPS y conexión | Indicadores visibles de estado GPS y conexión online/offline en el inicio. |
| Reordenación del dashboard | Implementada para métricas y tarjetas; guarda el orden localmente. |
| Gráficos interactivos | Chart.js para evolución, perfiles y comparación. |
| Diseño adaptable y estados de red | Incluye tamaños móvil/tablet/escritorio y mensajes de conexión, error, permisos y datos no disponibles en las áreas correspondientes. |

## Próximas funciones PRO

Estas propuestas forman parte del alcance de producto. No se deben mostrar como funciones operativas hasta que exista la implementación y, cuando corresponda, el soporte del servidor.

### Inteligencia de entrenamiento

- Mantener VAM, zonas de frecuencia cardíaca y zonas de potencia basadas en datos medidos. Las zonas de potencia requieren FTP configurado por el ciclista.
- Incorporar TSS y las tendencias CTL, ATL y TSB solo con muestras de potencia suficientes, FTP válido, cobertura temporal comprobable e historial adecuado. Indicar la cobertura y el periodo disponible; si faltan datos, mostrar “sin datos suficientes”.
- No presentar VO₂ como medición. Cualquier estimación futura requerirá un método documentado, datos válidos y una etiqueta explícita de estimación.
- El entrenador inteligente será descriptivo y prudente: cambios de volumen/desnivel, mejora en un segmento y periodos de menor actividad. No formular diagnósticos ni recomendaciones médicas.

### Competiciones avanzadas

- Extender las ligas privadas con categorías de nivel, copas mensuales, temporadas, equipos, campeonatos, récords históricos y Hall of Fame.
- Permitir clasificaciones por edad únicamente si el usuario decide compartirla y según su visibilidad configurada. La categoría de bicicleta también será voluntaria y editable.
- Añadir duelo directo: elegir un miembro y un segmento para comparar mejores tiempos, velocidad, desnivel y evolución. Comparar actividades será otra vista, basada en actividades verificadas y métricas disponibles en ambas.
- Las clasificaciones oficiales requieren validación en PocketBase, control de duplicados, privacidad por grupo e historial auditable. La interfaz no debe fabricar temporadas, resultados ni puntos cuando falte el esquema del servidor.

### Guardian Mode y seguridad del ciclista

- Diseñar una sesión con contacto(s) de emergencia, duración prevista, confirmación de llegada, ubicación compartida y coordenadas fáciles de comunicar.
- Hacer visible el último momento de conexión y distinguir pérdida de señal, falta de GPS y emergencia confirmada. La ausencia de señal por sí sola no prueba una caída.
- Las alertas por demora deben permitir confirmar que todo está bien y cancelar falsos positivos. La detección de caída será opcional, dependiente de sensores compatibles y nunca la única vía de aviso.
- Mostrar de antemano si la sesión depende de conexión, permisos y seguimiento en segundo plano. No afirmar que un contacto está siguiendo la ruta hasta confirmar el envío y recepción real en un backend independiente.

### Inteligencia y planificación de rutas

- Crear búsqueda con distancia, desnivel, pendientes, circularidad, proximidad, favoritos, listas y rutas recomendadas; permitir comparar alternativas y planificar con varios puntos.
- Separar siempre dificultad física de dificultad técnica. La técnica y el tipo de terreno solo se puntuarán cuando haya etiquetas o datos de superficie fiables; en otro caso se mostrarán como desconocidos.
- Route Score deberá explicar sus factores (distancia, ascenso, pendientes y, si existen, datos técnicos), mostrar los datos ausentes y evitar aparentar precisión universal. No sustituye la dificultad técnica local ni una evaluación del sendero.
- La navegación giro a giro y el recálculo necesitan un proveedor/servicio de rutas compatible. Una línea GPX por sí sola no contiene instrucciones fiables de giro ni permite inferir el terreno.

### Fotografía y diario de aventuras

- Asociar fotografías y vídeos a una actividad o ruta; permitir notas del diario, lugares favoritos y álbumes por salida.
- Mostrar las fotos geolocalizadas sobre el mapa y generar un resumen visual con mapa, distancia, desnivel, duración y fotografía principal.
- Crear una tarjeta de actividad para compartir, con vista previa y control explícito de los datos incluidos.
- La ubicación precisa, las fotos y los vídeos serán privados por defecto. Antes de compartir, permitir ocultar coordenadas, elegir imágenes y revisar la tarjeta. Los archivos multimedia deben almacenarse aparte de los registros GPS y con límites de tamaño claros.
- Si una imagen no tiene coordenadas válidas o el usuario no concede permiso para leerlas, permitir asociarla manualmente sin inventar la ubicación.

### Inteligencia artificial MTB

- El inicio incluye una tarjeta conceptual de CAMBOYA AI; las respuestas son ejemplos y el formulario no envía información mientras el servicio no esté conectado.
- Ofrecer un asistente conectado a un servicio propio para explicar estadísticas, comparar actividades, resumir salidas, detectar tendencias y ayudar a planificar entrenamientos o temporadas.
- Recomendar rutas solo a partir de preferencias y datos disponibles (distancia, desnivel, dificultad física y técnica conocida); explicar por qué se recomienda cada ruta y señalar los datos que faltan.
- Ayudar a preparar desafíos de grupo como borradores revisables por un administrador. No publicar retos ni modificar clasificaciones automáticamente.
- Mantener los cálculos deterministas de métricas (por ejemplo, distancia y desnivel) en el motor de la aplicación/servidor. La IA interpreta esos resultados y no debe inventar mediciones, diagnosticar ni presentar estimaciones como hechos.
- El servicio será independiente del PocketBase original y usará credenciales únicamente en el servidor. Antes de enviar actividades, fotos, ubicación o datos de perfil, informar qué se comparte y pedir consentimiento explícito; permitir usar las funciones locales sin activar el asistente.
- Diseñar el servicio para responder con cautela cuando el historial sea corto o incompleto y mostrar las actividades/periodo que respaldan cada conclusión.

### Ecosistema profesional

- Calendario para planificar salidas; eventos para quedadas y marchas; clubes con administración de varios grupos y mensajería entre miembros.
- Inventario personal de material y comparador de bicicletas/configuraciones, manteniendo estos datos separados del registro de rendimiento.
- Exportación avanzada de GPX, FIT y otros formatos solo cuando la estructura pueda validarse y conservarse correctamente.
- Integración con sensores de potencia, pulso y cadencia según perfiles Bluetooth compatibles, indicando conexión y calidad/disponibilidad de lecturas.
- Sincronización multidispositivo móvil/web con cuenta y almacenamiento propios; resolver conflictos sin sobrescribir silenciosamente actividades.
- Panel web para análisis ampliado en ordenador, con las mismas reglas de privacidad y métricas verificables que la aplicación móvil.
- Eventos, mensajería, sincronización y clubes requieren servicios de backend MTBPro, controles de acceso, retención definida y mecanismos para exportar o borrar los datos del usuario.

## Límites de mapas

No se descargan mosaicos del servidor estándar de OpenStreetMap para uso offline. Su política prohíbe la descarga masiva y el uso offline de ese servicio: [política oficial de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Para ampliar regiones hay que seleccionar un proveedor y respetar sus condiciones de descarga, atribución y almacenamiento.
