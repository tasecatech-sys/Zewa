# ZEWÁ · Sistema de Presupuestos y Facturación

Plataforma web para gestionar todo el ciclo comercial:
**Cliente → Presupuesto → Cobro → Factura → Pago final**, con control documental, financiero y de auditoría.

HTML + CSS + JavaScript sin frameworks ni dependencias. Abre `index.html` desde cualquier servidor estático.

## Módulos

| # | Módulo | Ruta | Qué incluye |
|---|--------|------|-------------|
| 1 | Panel de control | `#/dashboard` | 8 indicadores, ventas mensuales, cobros recibidos, estado de cobros, embudo de conversión, presupuestos por vencer, facturas pendientes y últimos movimientos |
| 2 | Clientes | `#/clientes` | Todos los campos obligatorios, validación de NIF duplicado, historial de compras, presupuestos, cobros, adjuntos y auditoría por cliente |
| 3 | Presupuestos | `#/cotizaciones` | Editor con detalle por línea (cantidad, precio, descuento, IVA), totales en vivo, condiciones; convertir a factura, duplicar, enviar por correo, PDF y firma digital |
| 4 | Cobros | `#/abonos` | Pagos a cuenta asociados a un presupuesto o factura, saldo en vivo, control financiero por proyecto (total, cobrado, saldo) e historial |
| 5 | Facturación | `#/facturas` | Factura desde presupuesto o manual; los anticipos se aplican automáticamente; estados Pendiente / En Proceso / Pagada / Vencida / Anulada |
| 6 | Plantillas | `#/plantillas` | **Plantillas Word (.docx) con variables**; o diseñador interno con bloques reordenables (arrastrar y soltar), colores, logo, encabezado, pie, firma, HTML propio con variables `{{...}}` y PDF base. **Versionadas:** cada documento guarda la versión con la que se emitió |
| 7 | Búsqueda inteligente | `#/busqueda` y barra superior (Ctrl+K) | Por NIF, empresa, número, proyecto, correo, teléfono, fecha y estado (Pendientes, Pagados, Vencidos, Anulados, En Proceso) |
| 8 | Gestión documental | `#/documentos` | Carpetas automáticas por cliente y proyecto, subida por arrastre, versiones, etiquetas y vista previa |
| 9 | Auditoría | `#/auditoria` | Quién, cuándo, qué acción y el cambio campo por campo (antes → después); exportable a CSV |

Además: modo oscuro, diseño adaptable (escritorio, tablet y móvil), tablas con orden, filtros, paginación y exportación a CSV, selector de usuario para simular roles, y respaldo/importación en JSON (`#/config`).

## Plantillas Word (.docx)

El diseño de presupuestos, facturas y recibos se hace en **Word**, no en el código:

1. En Word, escribe variables entre llaves dobles donde va cada dato: `{{numero}}`, `{{fecha}}`, `{{cliente_nombre}}`, `{{total}}`…
2. En la tabla de conceptos deja **una sola fila**: `{{#items}}{{concepto}}` en la primera celda y `{{total}}{{/items}}` en la última. El sistema repite esa fila por cada línea.
3. En *Plantillas → (plantilla) → Plantilla Word*, sube el .docx. El sistema revisa las variables, muestra la vista previa con datos reales y explica cualquier error.
4. Pulsa *Guardar como vN*. Los documentos nuevos usan esa versión; los ya emitidos conservan la suya.

Desde cada documento se descarga el **Word** relleno o se genera el **PDF** con el mismo diseño. La lista completa de variables está en la misma pantalla (clic para copiar).

Ejemplo listo: `plantillas/cotizacion-zewa.docx` (la plantilla de presupuesto de Zewá Reformas ya convertida a variables).

La moneda (EUR por defecto; también COP, USD y MXN) y el IVA por defecto (21 %) se configuran en *Configuración*.

> Las plantillas Word usan librerías que se cargan desde internet (jsDelivr) la primera vez que se necesitan.

## Léxico y configuración regional (España)

La interfaz usa terminología de España: **Presupuesto** (no cotización), **Cobro / pago a cuenta** (no abono, que en España significa devolución o factura rectificativa), **NIF/CIF**, **móvil**, **provincia**, **localidad**, **persona física**, **importe**, **TPV**. Numeración: `PRE-2026-0001` (presupuestos), `FAC-…` (facturas), `REC-…` (recibos de cobro).

Los nombres internos del código, las rutas (`#/cotizaciones`, `#/abonos`), las tablas SQL y las variables de las plantillas Word (`{{abonado}}`, `{{cotizacion_numero}}`…) **no cambian**, para no romper datos ni plantillas existentes. Al abrir la app, los datos guardados antes del cambio se migran automáticamente (estados de presupuesto en masculino, *Natural* → *Física*, nombres de entidades en la auditoría).

## Estado actual

- **Datos en Supabase** (proyecto `ekjcdmxtzcpkbexilzrf`): inicio de sesión real con Supabase Auth, datos compartidos entre todos los usuarios de la empresa y permisos por rol aplicados también en la base de datos (RLS).
- **Primer arranque:** si la base de datos está vacía, la app muestra *Configuración inicial* para crear la empresa y el administrador. Después, en *Configuración* se pueden cargar datos de ejemplo, importar un respaldo JSON o pasar al servidor los datos que la versión anterior guardó en el navegador.
- **Usuarios:** se crean desde *Usuarios y permisos* con correo y contraseña inicial (función `zewa-usuarios`). Cada usuario cambia su contraseña desde su nombre, arriba a la derecha.
- **Adjuntos:** se guardan en el bucket privado `fac-documentos` (máx. 10 MB por archivo).
- **Estilo Zewá:** presupuestos, facturas y recibos usan el membrete de *Plantilla Zewa.docx* (logo, correo y filete dorado; azul marino `#283d6a` y dorado `#c19c73`). En *Plantillas → Diseño → Estilo del documento* se puede volver al estilo clásico. `plantillas/presupuesto-membrete-zewa.docx` es la misma plantilla en Word con variables.
- **PDF:** usa la impresión del navegador (A4, "Guardar como PDF").
- **Envío por correo:** abre el cliente de correo con el mensaje listo (`mailto:`); el PDF se adjunta a mano.
- **Firma digital:** firma manuscrita en pantalla, con fecha, hora y usuario registrados en la auditoría. No es una firma digital certificada.
- **Verifactu / TicketBAI:** no incluido. Para cumplir el reglamento de sistemas de facturación de la AEAT (o TicketBAI en el País Vasco) hay que integrar un proveedor o módulo homologado (registro encadenado, QR y envío a la Agencia Tributaria).

## Arquitectura de datos

- `assets/nube.js`: conexión con Supabase. Carga todas las tablas al entrar y, en cada guardado, envía solo lo que cambió (altas, cambios y bajas) en orden de dependencias. Las líneas van a `fac_lineas` mediante `fac_guardar_lineas` (una transacción por documento). Al volver a la pestaña recarga los cambios de otros usuarios si no estás editando.
- `supabase_facturacion.sql`: esquema completo (tablas `fac_*`, RLS por empresa y módulo, numeración sin duplicados, vistas `fac_v_facturas` y `fac_v_proyectos`, bucket de Storage).
- `supabase/functions/zewa-usuarios`: función de servidor para la configuración inicial, el alta de usuarios y el cambio de contraseña o correo de acceso.
- Numeración: la app propone el siguiente número y el servidor lo confirma; si otro usuario lo usó a la vez, asigna el siguiente libre y la app lo corrige y avisa.

## Ajustes recomendados en el panel de Supabase

1. *Authentication → Sign In / Providers*: desactiva "Allow new users to sign up" (las altas se hacen desde la app).
2. *Authentication → URL Configuration*: pon como *Site URL* la dirección donde publiques la app, para que funcione el enlace de "¿Olvidaste tu contraseña?".
