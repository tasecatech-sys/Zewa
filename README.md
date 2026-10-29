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

- **Prototipo funcional:** los datos se guardan en el navegador (`localStorage`) e incluye datos de ejemplo. Los adjuntos tienen un límite de 2 MB por archivo, por el límite de almacenamiento del navegador.
- **PDF:** usa la impresión del navegador (A4, "Guardar como PDF").
- **Envío por correo:** abre el cliente de correo con el mensaje listo (`mailto:`); el PDF se adjunta a mano.
- **Firma digital:** firma manuscrita en pantalla, con fecha, hora y usuario registrados en la auditoría. No es una firma digital certificada.
- **Verifactu / TicketBAI:** no incluido. Para cumplir el reglamento de sistemas de facturación de la AEAT (o TicketBAI en el País Vasco) hay que integrar un proveedor o módulo homologado (registro encadenado, QR y envío a la Agencia Tributaria).

## Pasar a producción (Supabase)

`supabase_facturacion.sql` contiene el esquema para varias empresas:

- tablas de clientes, presupuestos (`fac_cotizaciones`), facturas, líneas, cobros (`fac_abonos`), plantillas, documentos y auditoría;
- consecutivos sin huecos por empresa, tipo y año (`fac_siguiente_numero`);
- versiones de plantilla inmutables (sin políticas de UPDATE ni DELETE);
- un trigger que traslada los anticipos a la factura al facturar un presupuesto;
- vistas `fac_v_facturas` (saldo y estado de pago) y `fac_v_proyectos` (control financiero);
- auditoría automática por trigger en todas las tablas, de solo inserción;
- RLS por empresa en todas las tablas;
- Storage: bucket privado `fac-documentos`, organizado como `{empresa}/{cliente}/{proyecto}/...`.

El siguiente paso es cambiar `Store` en `assets/data.js` por llamadas a `supabase-js`.
