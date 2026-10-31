# Evidencia de verificación

Validación realizada en el entorno cloud con Node.js **24.19.0**, SQLite local y Chromium. Los resultados corresponden a esta ejecución; no implican un despliegue público ni una publicación en GitHub.

| Comprobación | Resultado observado |
| --- | --- |
| Instalación reproducible con `npm ci --cache /workspace/.npm-cache` | Completada respetando el archivo de bloqueo. |
| `npm audit` | 0 vulnerabilidades informadas. |
| `npm run check` | Completada correctamente. |
| `npm test` | 13 pruebas; 13 aprobadas, 0 fallidas, 0 omitidas. |
| Registro, inicio y cierre de sesión | Verificados desde la interfaz en Chromium. |
| CRUD de tareas y filtros | Creación, consulta, actualización y eliminación verificadas desde la interfaz. |
| Persistencia | Verificada; los datos se conservan al reabrir la aplicación. |
| Comunicación en tiempo real | Dos pestañas recibieron los cambios de creación, actualización y eliminación por SSE. |
| Vista móvil de 390 px | Sin desbordamiento horizontal ni excepciones JavaScript observadas. |

La suite de integración cubre las rutas HTTP y las respuestas de error, autenticación y aislamiento entre usuarios, conflictos de versión, consultas seguras, persistencia de tareas y sesiones, y recepción de eventos. Utiliza bases de datos temporales para aislar los datos de prueba.

## Capturas

- [Interfaz de escritorio](demo.png).
- [Interfaz móvil](demo-mobile.png).

## Reproducción

Desde la raíz del repositorio:

```sh
npm ci --cache /workspace/.npm-cache
npm run check
npm test
npm start
```

La opción de caché es específica de este entorno cloud; en una máquina con su caché habitual escribible basta con `npm ci`.

Para repetir la comprobación visual, abre la interfaz del servidor local en dos pestañas del mismo navegador. Registra un usuario, crea una tarea, comprueba su aparición en ambas pestañas, cambia su estado y elimínala. Comprueba los filtros, cierra sesión e inicia sesión otra vez. Detén y reinicia el servidor conservando el archivo SQLite y la clave de sesión para verificar la persistencia. El README contiene peticiones `curl` que permiten comprobar las rutas y provocar un conflicto con una versión anterior.

## Pendientes de entrega y límites

- Completar el autor y renombrar `Apellido_Nombre_AplWeb_U2.pdf` con los datos del estudiante.
- Subir el código a `https://github.com/wtrujillov1/API`; no se realizó `push` durante esta actividad.
- La demostración funciona localmente. No se desplegó un servicio público ni existe una URL pública de demostración verificada.
- El diseño usa un solo proceso para distribuir eventos SSE y SQLite en disco. Una ejecución con varias réplicas requiere coordinación compartida. Un despliegue público necesita HTTPS, configuración del proxy, secretos seguros y almacenamiento persistente.

El informe PDF contiene dos páginas; el repositorio y este anexo de evidencias se entregan por separado.
