/* ==========================================================
   Plantillas Word (.docx)
   El usuario diseña el documento en Word con variables {{...}},
   lo sube y el sistema lo rellena (docxtemplater) y lo muestra
   / imprime a PDF (docx-preview). Las librerías se cargan solo
   cuando se necesitan.
   ========================================================== */
const WORD_LIBS = [
  'https://cdn.jsdelivr.net/npm/pizzip@3.1.7/dist/pizzip.min.js',
  'https://cdn.jsdelivr.net/npm/docxtemplater@3.47.4/build/docxtemplater.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js',
];
let wordLibsPromise = null;
function loadWordLibs() {
  if (!wordLibsPromise) {
    wordLibsPromise = WORD_LIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar ' + src.split('/npm/')[1] + '. Revisa la conexión a internet.'));
      document.head.appendChild(s);
    })), Promise.resolve()).catch((e) => { wordLibsPromise = null; throw e; });
  }
  return wordLibsPromise;
}

/* Variables disponibles en las plantillas Word */
const WORD_VARS = [
  ['Documento', [
    ['numero', 'Número del documento (COT-2026-0001, FE-…, AB-…)'], ['titulo', 'Cotización / Factura de venta / Recibo de abono'],
    ['fecha', 'Fecha (dd/mm/aaaa)'], ['vence', 'Fecha de vencimiento / válido hasta'], ['fecha_operacion', 'Fecha de operación (facturas)'],
    ['proyecto', 'Proyecto'], ['descripcion', 'Descripción general (cotizaciones)'], ['estado', 'Estado del documento'],
    ['validez', 'Validez'], ['forma_pago', 'Forma de pago'], ['tiempo_ejecucion', 'Tiempo de ejecución'], ['responsable', 'Responsable comercial'],
    ['observaciones', 'Observaciones'], ['cotizacion_numero', 'Cotización relacionada'], ['factura_numero', 'Factura relacionada'],
  ]],
  ['Cliente', [
    ['cliente_nombre', 'Razón social / nombre'], ['cliente_comercial', 'Nombre comercial'], ['cliente_nif', 'NIT / NIF / CIF'],
    ['cliente_direccion', 'Dirección'], ['cliente_cp', 'Código postal'], ['cliente_ciudad', 'Ciudad / localidad'], ['cliente_provincia', 'Departamento / provincia'],
    ['cliente_pais', 'País'], ['cliente_telefono', 'Teléfono o celular'], ['cliente_email', 'Correo'], ['cliente_contacto', 'Contacto principal'], ['cliente_cargo', 'Cargo del contacto'],
  ]],
  ['Empresa emisora (Configuración)', [
    ['empresa_nombre', 'Razón social'], ['empresa_nif', 'NIT / NIF'], ['empresa_direccion', 'Dirección'], ['empresa_cp', 'Código postal'],
    ['empresa_ciudad', 'Ciudad'], ['empresa_provincia', 'Departamento / provincia'], ['empresa_pais', 'País'], ['empresa_telefono', 'Teléfono'], ['empresa_email', 'Correo'],
    ['banco', 'Banco'], ['titular', 'Titular de la cuenta'], ['cuenta', 'Número de cuenta'], ['metodo_pago', 'Método de pago (facturas)'],
  ]],
  ['Líneas de detalle — dentro de {{#items}} … {{/items}}', [
    ['#items', 'Inicio de la fila que se repite (ponlo en la primera celda)'], ['/items', 'Fin de la fila que se repite (ponlo en la última celda)'],
    ['n', 'Número de línea'], ['concepto', 'Concepto'], ['descripcion', 'Descripción de la línea'], ['cantidad', 'Cantidad'],
    ['valor_unitario', 'Valor unitario'], ['descuento_pct', 'Descuento %'], ['base', 'Base imponible de la línea'], ['iva_pct', 'IVA %'], ['iva_valor', 'Valor del IVA'], ['total', 'Total de la línea'],
  ]],
  ['Totales', [
    ['subtotal', 'Subtotal antes de descuento'], ['descuento_total', 'Descuento total'], ['base_imponible', 'Base imponible'], ['iva_total', 'IVA total'],
    ['total', 'Total del documento (fuera de la tabla)'], ['abonado', 'Total abonado / abonos aplicados'], ['saldo', 'Saldo pendiente'],
    ['moneda', 'Código de moneda (EUR, COP…)'], ['simbolo', 'Símbolo (€, $…)'],
  ]],
  ['Abonos', [
    ['valor_abono', 'Valor del abono (recibos)'], ['referencia', 'Referencia de operación'], ['total_proyecto', 'Total del proyecto'],
    ['#abonos', 'Inicio de fila repetida de abonos aplicados'], ['/abonos', 'Fin de fila de abonos'], ['abono_numero / abono_fecha / abono_concepto / abono_valor', 'Campos dentro de {{#abonos}}'],
  ]],
];
const WORD_KNOWN = new Set(WORD_VARS.flatMap(([, l]) => l.flatMap(([k]) => k.replace(/^[#/]/, '').split(' / '))));

const fmtNum = (n) => { const m = moneda(); return new Intl.NumberFormat(m.locale, { minimumFractionDigits: m.dec, maximumFractionDigits: m.dec }).format(+n || 0); };
const fmtQty = (n) => new Intl.NumberFormat(moneda().locale, { maximumFractionDigits: 4 }).format(+n || 0);
const fmtDMY = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/* Datos que recibe la plantilla */
function wordData(tipo, d) {
  const E = DB.empresa, cli = getCliente(d.clienteId) || {}, m = moneda();
  const items = tipo === 'abono' ? [{ concepto: d.concepto, descripcion: `Ref. ${d.referencia || '—'}`, cantidad: 1, valor: +d.valor, iva: 0, desc: 0 }] : d.items || [];
  const t = docTotals(items);
  const cot = tipo === 'cotizacion' ? d : getCot(d.cotizacionId);
  const fac = tipo === 'factura' ? d : getFac(d.facturaId);
  let fin = { abonado: 0, saldo: t.total, total: t.total, abonos: [] };
  if (tipo === 'factura' && d.id) { const r = facturaResumen(d); fin = { abonado: r.abonado, saldo: r.saldo, total: r.total, abonos: r.abonos }; }
  else if (cot?.id) { const r = proyectoResumen(cot); fin = { abonado: r.abonado, saldo: r.saldo, total: r.total, abonos: r.abonos }; }
  return {
    titulo: { cotizacion: 'Cotización', factura: 'Factura de venta', abono: 'Recibo de abono' }[tipo],
    numero: d.numero || '', fecha: fmtDMY(d.fecha), vence: fmtDMY(d.vence), fecha_operacion: fmtDMY(d.fechaOperacion),
    proyecto: d.proyecto || cot?.proyecto || '', descripcion: d.descripcion || '', estado: tipo === 'factura' && d.id ? facturaEstado(d) : tipo === 'cotizacion' ? cotEstado(d) : d.estado || '',
    validez: d.validez || '', forma_pago: d.formaPago || '', tiempo_ejecucion: d.tiempoEjecucion || '', responsable: d.responsable || '', observaciones: d.observaciones || '',
    cotizacion_numero: cot?.numero || '', factura_numero: fac?.numero || '',
    cliente_nombre: cli.razonSocial || '', cliente_comercial: cli.nombreComercial || '', cliente_nif: cli.nit || '', cliente_direccion: cli.direccion || '', cliente_cp: cli.codigoPostal || '',
    cliente_ciudad: cli.ciudad || '', cliente_provincia: cli.departamento || '', cliente_pais: cli.pais || '', cliente_telefono: cli.celular || cli.telefono || '', cliente_email: cli.email || '',
    cliente_contacto: cli.contacto || '', cliente_cargo: cli.cargo || '',
    empresa_nombre: E.razonSocial || '', empresa_nif: E.nit || '', empresa_direccion: E.direccion || '', empresa_cp: E.codigoPostal || '', empresa_ciudad: E.ciudad || '',
    empresa_provincia: E.provincia || '', empresa_pais: E.pais || '', empresa_telefono: E.telefono || '', empresa_email: E.email || '',
    banco: tipo === 'factura' ? d.banco : E.banco, titular: tipo === 'factura' ? d.titular : E.titular, cuenta: tipo === 'factura' ? d.cuenta : E.cuenta, metodo_pago: d.metodoPago || d.formaPago || '',
    items: items.map((it, i) => { const l = lineCalc(it); return { n: i + 1, concepto: it.concepto, descripcion: it.descripcion || '', cantidad: fmtQty(it.cantidad), valor_unitario: fmtNum(it.valor), descuento_pct: fmtQty(it.desc), base: fmtNum(l.base), iva_pct: fmtQty(it.iva), iva_valor: fmtNum(l.iva), total: fmtNum(l.total) }; }),
    subtotal: fmtNum(t.subtotal), descuento_total: fmtNum(t.descuento), base_imponible: fmtNum(t.base), iva_total: fmtNum(t.iva), total: fmtNum(t.total),
    abonado: fmtNum(fin.abonado), saldo: fmtNum(fin.saldo), total_proyecto: fmtNum(fin.total),
    valor_abono: tipo === 'abono' ? fmtNum(d.valor) : '', referencia: d.referencia || '',
    abonos: fin.abonos.map((a) => ({ abono_numero: a.numero, abono_fecha: fmtDMY(a.fecha), abono_concepto: a.concepto, abono_valor: fmtNum(a.valor) })),
    moneda: m.code, simbolo: m.simbolo,
  };
}

const dataURLToBytes = (u) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));
const bytesToDataURL = (bytes) => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + btoa(s); };

/* Traduce los errores de docxtemplater a mensajes claros */
function wordErrors(e) {
  const list = e?.properties?.errors || [e];
  return list.map((x) => {
    const p = x.properties || {}, tag = p.xtag || p.id || '';
    if (p.id === 'unclosed_loop' || p.id === 'unopened_loop') return `El bloque {{#${tag}}} … {{/${tag}}} no está bien cerrado.`;
    if (p.id === 'unclosed_tag' || p.id === 'unopened_tag') return `Hay una variable mal escrita cerca de "${(p.context || tag).slice(0, 30)}" (revisa las llaves {{ }}).`;
    if (p.id === 'closing_tag_does_not_match_opening_tag') return `{{#${p.openingtag}}} se cierra con {{/${p.closingtag}}}: deben tener el mismo nombre.`;
    return p.explanation || x.message || String(x);
  });
}
function makeTemplater(bytes) {
  const zip = new PizZip(bytes);
  return new docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' }, nullGetter: () => '' });
}

/* Revisa un .docx subido: variables encontradas, desconocidas y errores de sintaxis */
async function inspectWord(bytes, tipo) {
  await loadWordLibs();
  const zip = new PizZip(bytes);
  if (!zip.file('word/document.xml')) throw new Error('El archivo no es un documento Word (.docx) válido.');
  const text = Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))
    .map((f) => zip.file(f).asText().replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')).join(' ');
  const tags = [...new Set([...text.matchAll(/\{\{\s*([#/^]?)\s*([\w.]+)\s*\}\}/g)].map((m) => m[2]))];
  const desconocidas = tags.filter((t) => !WORD_KNOWN.has(t));
  let errores = [];
  try { const doc = makeTemplater(bytes); doc.render(wordData(tipo, sampleDoc(tipo) || { items: [] })); }
  catch (e) { errores = wordErrors(e); }
  return { tags, desconocidas, errores, tieneItems: tags.includes('items') };
}

/* Genera el .docx relleno */
async function fillWord(cfg, tipo, d) {
  await loadWordLibs();
  const doc = makeTemplater(dataURLToBytes(cfg.docx));
  try { doc.render(wordData(tipo, d)); }
  catch (e) { throw new Error('La plantilla Word tiene errores: ' + wordErrors(e).join(' · ')); }
  return doc.getZip().generate({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
async function renderWordInto(el, cfg, tipo, d) {
  const blob = await fillWord(cfg, tipo, d);
  el.innerHTML = '';
  await docx.renderAsync(blob, el, null, { className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, renderHeaders: true, renderFooters: true });
  fixPageAnchors(el, cfg);
  return blob;
}

/* docx-preview coloca las imágenes flotantes respecto al margen aunque en Word estén
   ancladas a la PÁGINA (membretes y fondos a página completa). Leemos esos anclajes
   del .docx y reubicamos cada imagen en su posición real dentro de la hoja. */
function pageAnchors(cfg) {
  const zip = new PizZip(dataURLToBytes(cfg.docx)), out = [];
  const pt = (emu) => (+emu || 0) / 12700;
  Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f)).forEach((f) => {
    for (const [a] of zip.file(f).asText().matchAll(/<wp:anchor[\s\S]*?<\/wp:anchor>/g)) {
      const h = a.match(/<wp:positionH relativeFrom="page">\s*<wp:posOffset>(-?\d+)/), v = a.match(/<wp:positionV relativeFrom="page">\s*<wp:posOffset>(-?\d+)/);
      const ext = a.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
      if (h && v && ext) out.push({ x: pt(h[1]), y: pt(v[1]), w: pt(ext[1]), h: pt(ext[2]), behind: /behindDoc="1"/.test(a) });
    }
  });
  return out;
}
function fixPageAnchors(el, cfg) {
  const anchors = pageAnchors(cfg);
  if (!anchors.length) return;
  el.querySelectorAll('section.docx').forEach((sec) => {
    sec.querySelectorAll('img').forEach((img) => {
      const w = parseFloat(img.style.width), h = parseFloat(img.style.height);
      const a = anchors.find((x) => Math.abs(x.w - w) < 1 && Math.abs(x.h - h) < 1);
      const box = img.parentElement;
      if (!a || !box || box === sec) return;
      box.style.cssText = `position:absolute;left:${a.x}pt;top:${a.y}pt;width:${a.w}pt;height:${a.h}pt;margin:0;z-index:${a.behind ? 0 : 2};pointer-events:none`;
      img.style.position = 'static'; img.style.left = img.style.top = '0';
      sec.prepend(box);
    });
    sec.querySelectorAll(':scope > header, :scope > article, :scope > footer').forEach((n) => { n.style.position = 'relative'; n.style.zIndex = '1'; });
  });
}

/* Vistas previas diferidas: renderDoc deja un hueco y esto lo rellena */
const WORD_JOBS = new Map();
function wordSlot(tipo, d, cfg) {
  const k = 'w' + Math.random().toString(36).slice(2, 9);
  WORD_JOBS.set(k, { tipo, d, cfg });
  return `<div class="docx-slot" data-job="${k}"><div class="empty">Generando vista previa del Word…</div></div>`;
}
function hydrateWord(root = document) {
  root.querySelectorAll('.docx-slot[data-job]').forEach((slot) => {
    const key = slot.dataset.job, job = WORD_JOBS.get(key);
    slot.removeAttribute('data-job'); WORD_JOBS.delete(key);
    if (!job) return;
    renderWordInto(slot, job.cfg, job.tipo, job.d).catch((e) => { slot.innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; });
  });
}
async function downloadWord(tipo, d) {
  const cfg = plantillaConfig(d.plantilla);
  if (cfg.formato !== 'word' || !cfg.docx) return toast('Este documento usa el diseñador del sistema, no una plantilla Word.', 'bad');
  try { const blob = await fillWord(cfg, tipo, d); downloadFile(`${d.numero}.docx`, blob); }
  catch (e) { toast(e.message, 'bad'); }
}
