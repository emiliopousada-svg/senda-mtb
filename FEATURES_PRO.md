# MTB PRO — estado de las funciones premium

Este inventario separa lo que ya funciona en esta versión de lo que depende de servicios, permisos o trabajo posterior.

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
| Modo nocturno automático | Pendiente de programación horaria; la interfaz actual mantiene el tema oscuro. |
| Transiciones entre pantallas | Disponibles en el carrusel de páginas, con soporte de movimiento reducido del sistema. |
| Vibración de grabación | Implementada al iniciar, pausar, reanudar y finalizar cuando el dispositivo ofrece vibración y la preferencia está activa. |
| GPS y conexión | Indicadores visibles de estado GPS y conexión online/offline en el inicio. |
| Reordenación del dashboard | Implementada para métricas y tarjetas; guarda el orden localmente. |
| Gráficos interactivos | Chart.js para evolución, perfiles y comparación. |
| Diseño adaptable y estados de red | Incluye tamaños móvil/tablet/escritorio y mensajes de conexión, error, permisos y datos no disponibles en las áreas correspondientes. |

## Límites de mapas

No se descargan mosaicos del servidor estándar de OpenStreetMap para uso offline. Su política prohíbe la descarga masiva y el uso offline de ese servicio: [política oficial de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Para ampliar regiones hay que seleccionar un proveedor y respetar sus condiciones de descarga, atribución y almacenamiento.
