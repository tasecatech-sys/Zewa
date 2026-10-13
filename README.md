# TASECA · Sistema de Cotización y Facturación

Plataforma web para gestionar todo el ciclo comercial:
**Cliente → Cotización → Abono → Factura → Pago final**, con control documental, financiero y de auditoría.

HTML + CSS + JavaScript sin frameworks ni dependencias. Abre `index.html` desde cualquier servidor estático.

## Módulos

| # | Módulo | Ruta | Qué incluye |
|---|--------|------|-------------|
| 1 | Dashboard | `#/dashboard` | 8 indicadores, ventas mensuales, abonos recibidos, estado de cartera, embudo de conversión, cotizaciones por vencer, facturas pendientes y últimos movimientos |
| 2 | Clientes | `#/clientes` | Todos los campos obligatorios, validación de NIT duplicado, historial de compras, cotizaciones, pagos, adjuntos y auditoría por cliente |
| 3 | Cotizaciones | `#/cotizaciones` | Editor con detalle por línea (cantidad, valor, descuento, IVA), totales en vivo, condiciones; convertir a factura, duplicar, enviar por correo, PDF y firma digital |
| 4 | Abonos | `#/abonos` | Asociación a cotización o factura, saldo en vivo, control financiero por proyecto (total, abonado, saldo) e historial |
| 5 | Facturación | `#/facturas` | Factura desde cotización o manual; los anticipos se aplican automáticamente; estados Pendiente / En Proceso / Pagada / Vencida / Anulada |
| 6 | Plantillas | `#/plantillas` | **Plantillas Word (.docx) con variables**; o diseñador interno con bloques reordenables (arrastrar y soltar), colores, logo, encabezado, pie, firma, HTML propio con variables `{{...}}` y PDF base. **Versionadas:** cada documento guarda la versión con la que se emitió |
| 7 | Búsqueda inteligente | `#/busqueda` y barra superior (Ctrl+K) | Por NIT, empresa, número, proyecto, correo, teléfono, fecha y estado (Pendientes, Pagados, Vencidos, Anulados, En Proceso) |
| 8 | Gestión documental | `#/documentos` | Carpetas automáticas por cliente y proyecto, subida por arrastre, versiones, etiquetas y vista previa |
| 9 | Auditoría | `#/auditoria` | Quién, cuándo, qué acción y el cambio campo por campo (antes → después); exportable a CSV |

Además: modo oscuro, diseño adaptable (escritorio, tablet y móvil), tablas con orden, filtros, paginación y exportación a CSV, selector de usuario para simular roles, y respaldo/importación en JSON (`#/config`).

## Plantillas Word (.docx)

El diseño de cotizaciones, facturas y recibos se hace en **Word**, no en el código:

1. En Word, escribe variables entre llaves dobles donde va cada dato: `{{numero}}`, `{{fecha}}`, `{{cliente_nombre}}`, `{{total}}`…
2. En la tabla de conceptos deja **una sola fila**: `{{#items}}{{concepto}}` en la primera celda y `{{total}}{{/items}}` en la última. El sistema repite esa fila por cada línea.
3. En *Plantillas → (plantilla) → Plantilla Word*, sube el .docx. El sistema revisa las variables, muestra la vista previa con datos reales y explica cualquier error.
4. Pulsa *Guardar como vN*. Los documentos nuevos usan esa versión; los ya emitidos conservan la suya.

Desde cada documento se descarga el **Word** relleno o se genera el **PDF** con el mismo diseño. La lista completa de variables está en la misma pantalla (clic para copiar).

Ejemplo listo: `plantillas/cotizacion-zewa.docx` (la plantilla de Zewa Reformas ya convertida a variables).

La moneda (COP, EUR, USD, MXN) y el IVA por defecto se configuran en *Configuración*.

> Las plantillas Word usan librerías que se cargan desde internet (jsDelivr) la primera vez que se necesitan.

## Estado actual

- **Prototipo funcional:** los datos se guardan en el navegador (`localStorage`) e incluye datos de ejemplo. Los adjuntos tienen un límite de 2 MB por archivo, por el límite de almacenamiento del navegador.
- **PDF:** usa la impresión del navegador (A4, "Guardar como PDF").
- **Envío por correo:** abre el cliente de correo con el mensaje listo (`mailto:`); el PDF se adjunta a mano.
- **Firma digital:** firma manuscrita en pantalla, con fecha, hora y usuario registrados en la auditoría. No es una firma digital certificada.
- **Facturación electrónica DIAN:** no incluida. Para validez fiscal hay que integrar un proveedor tecnológico (CUFE, XML UBL 2.1, QR).

## Pasar a producción (Supabase)

`supabase_facturacion.sql` contiene el esquema para varias empresas:

- tablas de clientes, cotizaciones, facturas, líneas, abonos, plantillas, documentos y auditoría;
- consecutivos sin huecos por empresa, tipo y año (`fac_siguiente_numero`);
- versiones de plantilla inmutables (sin políticas de UPDATE ni DELETE);
- un trigger que traslada los anticipos a la factura al facturar una cotización;
- vistas `fac_v_facturas` (saldo y estado de pago) y `fac_v_proyectos` (control financiero);
- auditoría automática por trigger en todas las tablas, de solo inserción;
- RLS por empresa en todas las tablas;
- Storage: bucket privado `fac-documentos`, organizado como `{empresa}/{cliente}/{proyecto}/...`.

El siguiente paso es cambiar `Store` en `assets/data.js` por llamadas a `supabase-js`, igual que en `admin-taseca.html`.
