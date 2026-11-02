# API de tareas

API REST para gestionar tareas de cada usuario, con persistencia SQLite, sesiones de servidor y notificaciones en tiempo real mediante Server-Sent Events (SSE). Incluye una interfaz web para demostrar el registro, el inicio de sesión y las operaciones CRUD.

Código y documentación de la entrega: <https://github.com/wtrujillov1/API>. La demostración pública queda pendiente de despliegue; ejecutar el servidor localmente no crea una URL pública.

## Requisitos y ejecución

- Node.js 24 o superior y npm.
- No se requiere un servidor de base de datos: se utiliza `node:sqlite`, incluido en Node.js.

Desde la raíz del repositorio:

```sh
npm ci
npm test
npm start
```

En la primera instalación también puede utilizarse `npm install`. Para repetir una instalación respetando el archivo de bloqueo se recomienda `npm ci`. En este entorno cloud, cuya caché predeterminada no permite escritura, utiliza `npm ci --cache /workspace/.npm-cache`; en una máquina normal basta con `npm ci`.

El servidor escucha por defecto en el equipo local, puerto 3000. La interfaz se sirve en `/` y la comprobación de funcionamiento en `GET /api/health`. Para comprobar una sesión y los eventos, abre la interfaz en dos pestañas del mismo navegador, inicia sesión y crea o modifica una tarea: la otra pestaña actualizará el listado.

## Configuración

| Variable | Valor predeterminado / uso |
| --- | --- |
| `HOST` | `127.0.0.1`; utilizar `0.0.0.0` cuando el alojamiento lo requiera. |
| `PORT` | `3000`. |
| `DATABASE_PATH` | `data/tasks.sqlite`; ruta al archivo SQLite. |
| `SESSION_SECRET` | Clave para firmar la cookie de sesión. En desarrollo se genera y conserva en `data/.session-secret` si no se proporciona. En producción es obligatoria y debe tener al menos 32 caracteres. |
| `NODE_ENV` | Establecer `production` en producción para exigir una clave explícita y usar cookies seguras. |
| `TRUST_PROXY` | Establecer `1` únicamente si la aplicación se ejecuta detrás de un proxy de confianza que termina HTTPS. |

`.env.example` describe la configuración y no se carga automáticamente. Exporta las variables antes de arrancar o copia la plantilla a `.env`, completa sus valores y ejecuta `node --env-file=.env src/server.js`. No publiques ese archivo.

Los archivos de datos y la clave local se excluyen de Git. Conserva la base de datos y la misma clave para mantener las sesiones al reiniciar. No incluyas credenciales en el repositorio, capturas o informe.

## Rutas y formato

Las respuestas correctas con contenido usan `{ "data": ... }`; las operaciones `204` no tienen cuerpo. Los errores usan `{ "error": { "code": "...", "message": "...", "details": ... } }`, donde `details` es opcional.

| Método y ruta | Resultado |
| --- | --- |
| `GET /api/health` | `200`, estado del servicio. |
| `POST /api/auth/register` | `201`, crea un usuario e inicia su sesión. |
| `POST /api/auth/login` | `200`, inicia una sesión. |
| `GET /api/auth/me` | `200`, usuario de la sesión; `401` si no hay sesión. |
| `POST /api/auth/logout` | `204`, destruye la sesión. |
| `GET /api/tasks` | `200`, tareas del usuario actual. |
| `GET /api/tasks/:id` | `200`, tarea del usuario actual; `404` si no es accesible. |
| `POST /api/tasks` | `201`, crea una tarea. |
| `PATCH /api/tasks/:id` | `200`, modifica una tarea con control de versión. |
| `DELETE /api/tasks/:id?version=N` | `204`, elimina una tarea con control de versión. |
| `GET /api/events` | Flujo SSE autenticado de cambios del usuario actual. |

Las rutas de tareas y eventos requieren una sesión. Un identificador de otro usuario recibe `404`, igual que uno inexistente. Los errores de entrada reciben `400`, un origen prohibido `403`, los conflictos —usuario ya registrado o versión desactualizada— `409`, un cuerpo superior a 16 KB `413`, un formato, codificación o charset de contenido no admitido `415` y el exceso de intentos `429`. Una base SQLite ocupada recibe `503`; un fallo interno recibe `500` sin exponer detalles internos.

El nombre de usuario admite de 3 a 40 caracteres alfanuméricos o guion bajo; la contraseña, de 8 a 128 caracteres. Una tarea tiene `title` de 1 a 120 caracteres después de eliminar espacios de los extremos, `description` de hasta 2000 caracteres y `status`: `pending`, `in_progress` o `completed`. Ni el título ni la descripción permiten el carácter NUL. La creación permite omitir la descripción y el estado; sus valores serán `""` y `pending`. La versión inicial es `1` y cambia con cada actualización.

## Ejemplos de petición y respuesta

Los siguientes comandos usan un archivo local de cookies. Elige un usuario nuevo si ya ejecutaste el registro. No utilices la contraseña de ejemplo fuera de esta demostración.

```sh
curl -i -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"estudiante","password":"ejemplo-local-2026"}' \
  http://127.0.0.1:3000/api/auth/register

curl -i -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"title":"Preparar informe","description":"Máximo dos páginas"}' \
  http://127.0.0.1:3000/api/tasks
```

Respuesta de creación (`201`; identificador y fechas ilustrativos):

```json
{
  "data": {
    "id": "824d7db0-3585-4bfc-988d-b5732792625e",
    "title": "Preparar informe",
    "description": "Máximo dos páginas",
    "status": "pending",
    "version": 1,
    "createdAt": "2026-10-29T12:00:00.000Z",
    "updatedAt": "2026-10-29T12:00:00.000Z"
  }
}
```

Sustituye `ID` por el identificador devuelto al crear la tarea:

```sh
curl -b cookies.txt http://127.0.0.1:3000/api/tasks

curl -b cookies.txt http://127.0.0.1:3000/api/tasks/ID

curl -i -X PATCH -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"status":"completed","version":1}' \
  http://127.0.0.1:3000/api/tasks/ID

curl -i -X DELETE -b cookies.txt \
  'http://127.0.0.1:3000/api/tasks/ID?version=2'

curl -i -X POST -b cookies.txt http://127.0.0.1:3000/api/auth/logout

curl -i -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"estudiante","password":"ejemplo-local-2026"}' \
  http://127.0.0.1:3000/api/auth/login
```

Para observar eventos, inicia sesión y deja abierto este comando en otra terminal antes de crear, modificar o eliminar una tarea:

```sh
curl -N -b cookies.txt http://127.0.0.1:3000/api/events
```

El flujo comienza con `event: ready` y emite `task.created`, `task.updated` y `task.deleted`. Cada evento contiene JSON en `data:` con el formato `{ "data": ... }`. Las creaciones y actualizaciones incluyen la tarea; la eliminación incluye su `id` y `version`. Los eventos sólo se envían a conexiones del mismo usuario.

Para reproducir un conflicto, intenta actualizar dos veces la misma tarea con `version: 1`: la segunda petición recibe `409` si la primera ya la actualizó. Consulta de nuevo el recurso antes de reintentar; no sobrescribas automáticamente cambios ajenos.

## Organización y decisiones

El código separa el arranque del servidor, la composición de la aplicación, la validación, la persistencia y las operaciones HTTP. Las transformaciones de entrada y las conversiones de filas se mantienen separadas de la E/S. Las consultas usan parámetros para no concatenar datos del usuario con SQL.

SQLite conserva usuarios, tareas y sesiones. Las operaciones de escritura comprueban propietario y versión; una actualización desactualizada no sobrescribe la versión vigente. Las contraseñas se almacenan con `scrypt` y sal aleatoria, nunca como texto original. La sesión utiliza una cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción; su identificador se renueva al autenticar y se invalida al salir.

SSE proporciona comunicación de servidor a cliente sin añadir un protocolo bidireccional que este caso no necesita. El navegador vuelve a consultar las tareas cuando recibe cambios. El flujo sirve como aviso y la base de datos mantiene el estado definitivo.

## Pruebas y alcance

`npm test` ejecuta pruebas de integración con el ejecutor de Node.js. Las pruebas crean bases de datos temporales independientes de los datos de desarrollo. Comprueban CRUD, entrada inválida, autenticación, aislamiento entre usuarios, conflictos, persistencia y eventos SSE. La instalación reproducible con `npm ci` se ha verificado y `npm audit` no encontró vulnerabilidades en las dependencias instaladas. La validación final completó **13 pruebas, 13 aprobadas, 0 fallidas y 0 omitidas**; `npm run check` también pasó. La demostración se verificó en Chromium: registro y acceso, CRUD, filtros, cierre de sesión, persistencia y eventos de creación, actualización y eliminación entre dos pestañas. La vista móvil de 390 px no presentó desbordamiento ni excepciones JavaScript. Los resultados y las capturas están en [`docs/evidencias/verificacion.md`](docs/evidencias/verificacion.md).

Esta aplicación académica está diseñada para un proceso Node.js y una base SQLite local. Los avisos SSE se distribuyen en ese proceso; varias réplicas necesitarían un canal compartido. No es un despliegue de alta disponibilidad. Un alojamiento público debe añadir HTTPS, configurar correctamente el proxy y las cookies, proteger la clave de sesión y disponer de almacenamiento persistente y copias de seguridad. No actives `TRUST_PROXY=1` si el servidor es accesible directamente por clientes no confiables.

## Entrega

1. Consultar el código, las pruebas y la documentación en <https://github.com/wtrujillov1/API>.
2. Ejecutar `npm ci`, `npm test` y una demostración de registro, CRUD, conflicto y notificación en dos pestañas.
3. Consultar el informe técnico de Wilmer Andrés Trujillo Vera. Incorporar una URL pública de demostración cuando exista un despliegue.
4. Revisar el PDF de dos páginas en [`docs/Trujillo_Wilmer_AplWeb_U2.pdf`](docs/Trujillo_Wilmer_AplWeb_U2.pdf). Sus fuentes editables están en `docs/informe.md` y `docs/informe.html`.
5. Adjuntar evidencias adicionales por separado; el repositorio, los anexos y las evidencias no cuentan en las dos páginas del informe.


## Regenerar el informe

El informe ya se entrega en PDF. Para modificar el contenido o añadir una URL pública, edita `docs/informe.html` y su versión de texto `docs/informe.md`. Puedes abrir el HTML en un navegador e imprimir en A4, sin encabezados ni pies automáticos. Comprueba que el resultado mantiene un máximo de dos páginas.

La generación utilizada en el entorno cloud está disponible como script opcional:

```sh
python3 scripts/generar-informe.py
```

Requiere el paquete Python `playwright` y Chromium; ambos están instalados en este entorno. El script usa `/usr/bin/chromium` por defecto y permite otro ejecutable mediante `CHROMIUM_PATH`. El PDF se guarda en `docs/Trujillo_Wilmer_AplWeb_U2.pdf`. Estas herramientas sólo regeneran el documento; no son dependencias de la API.
