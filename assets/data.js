/* ==========================================================
   Capa de datos: almacenamiento local, reglas de negocio,
   numeración, cálculos financieros y auditoría.
   En producción se reemplaza por Supabase (ver supabase_facturacion.sql).
   ========================================================== */
const DB_KEY = 'tsf_db_v1';

const USERS = [
  { id: 'admin', nombre: 'Administrador', rol: 'Administrador' },
  { id: 'comercial', nombre: 'Laura Gómez', rol: 'Comercial' },
  { id: 'contable', nombre: 'Carlos Ruiz', rol: 'Contabilidad' },
];

const ESTADOS_COT = ['Borrador', 'Enviada', 'Aprobada', 'Facturada', 'Vencida', 'Anulada'];
const FORMAS_PAGO = ['Transferencia', 'Efectivo', 'Tarjeta', 'PSE', 'Consignación'];
const BANCOS = ['Bancolombia', 'Davivienda', 'Banco de Bogotá', 'BBVA', 'Banco de Occidente', 'Nequi', 'Daviplata'];
const BLOQUES = {
  encabezado: 'Encabezado y logo',
  cliente: 'Datos del cliente',
  general: 'Datos generales / proyecto',
  detalle: 'Detalle de conceptos',
  totales: 'Totales',
  condiciones: 'Condiciones comerciales',
  abonos: 'Abonos aplicados',
  banco: 'Datos bancarios',
  notas: 'Observaciones',
  firma: 'Firmas',
  pie: 'Pie de página',
};

/* ---------- helpers ---------- */
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const MONEDAS = {
  COP: { code: 'COP', locale: 'es-CO', dec: 0, simbolo: '$', nombre: 'Peso colombiano (COP)' },
  EUR: { code: 'EUR', locale: 'es-ES', dec: 2, simbolo: '€', nombre: 'Euro (EUR)' },
  USD: { code: 'USD', locale: 'en-US', dec: 2, simbolo: 'US$', nombre: 'Dólar (USD)' },
  MXN: { code: 'MXN', locale: 'es-MX', dec: 2, simbolo: '$', nombre: 'Peso mexicano (MXN)' },
};
const moneda = () => MONEDAS[(typeof DB !== 'undefined' && DB?.empresa?.moneda) || 'COP'] || MONEDAS.COP;
const fmtMoney = (n) => { const m = moneda(); return new Intl.NumberFormat(m.locale, { style: 'currency', currency: m.code, minimumFractionDigits: m.dec, maximumFractionDigits: m.dec }).format(+n || 0); };
const fmtShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return moneda().simbolo + (n / 1e9).toFixed(1).replace('.', ',') + ' mil M';
  if (a >= 1e6) return moneda().simbolo + (n / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1e3) return moneda().simbolo + Math.round(n / 1e3) + ' mil';
  return moneda().simbolo + Math.round(n);
};
const fmtDate = (iso) => iso ? new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- store ---------- */
let DB;
const Store = {
  load() {
    try { DB = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { DB = null; }
    if (!DB || !DB.version) { DB = seed(); this.save(); }
    DB.empresa = { moneda: 'COP', ivaDefault: 19, pais: 'Colombia', codigoPostal: '', provincia: '', ...DB.empresa };
    return DB;
  },
  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); return true; }
    catch (e) { console.error(e); if (window.toast) toast('Almacenamiento lleno: libera documentos adjuntos.', 'bad'); return false; }
  },
  reset() { localStorage.removeItem(DB_KEY); DB = seed(); this.save(); },
  user() { return USERS.find((u) => u.id === DB.usuarioActual) || USERS[0]; },
  nextNumber(tipo) {
    const year = new Date().getFullYear();
    const pref = { COT: 'COT', FAC: 'FE', ABO: 'AB', CLI: 'CLI' }[tipo];
    DB.seq[tipo] = (DB.seq[tipo] || 0) + 1;
    return tipo === 'CLI' ? `${pref}-${String(DB.seq[tipo]).padStart(4, '0')}` : `${pref}-${year}-${String(DB.seq[tipo]).padStart(4, '0')}`;
  },
};

/* ---------- auditoría ---------- */
function diffObjects(a, b, ignore = ['items', 'firma', 'actualizado', 'versiones']) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach((k) => {
    if (ignore.includes(k)) return;
    const va = a?.[k], vb = b?.[k];
    if (typeof va === 'object' || typeof vb === 'object') return;
    if (String(va ?? '') !== String(vb ?? '')) out.push({ campo: k, antes: va ?? '', despues: vb ?? '' });
  });
  if (a && b && JSON.stringify(a.items) !== JSON.stringify(b.items)) out.push({ campo: 'items', antes: `${a.items?.length || 0} líneas`, despues: `${b.items?.length || 0} líneas` });
  return out;
}
function audit(accion, entidad, ref, detalle = '', cambios = []) {
  const u = Store.user();
  DB.auditoria.unshift({ id: uid('au'), fecha: new Date().toISOString(), usuario: u.nombre, rol: u.rol, accion, entidad, ref, detalle, cambios });
  if (DB.auditoria.length > 2000) DB.auditoria.length = 2000;
}

/* ---------- cálculos ---------- */
function lineCalc(it) {
  const bruto = (+it.cantidad || 0) * (+it.valor || 0);
  const descuento = bruto * ((+it.desc || 0) / 100);
  const base = bruto - descuento;
  const iva = base * ((+it.iva || 0) / 100);
  return { bruto, descuento, base, iva, total: base + iva };
}
function docTotals(items = []) {
  return items.reduce((t, it) => {
    const l = lineCalc(it);
    t.subtotal += l.bruto; t.descuento += l.descuento; t.base += l.base; t.iva += l.iva; t.total += l.total;
    return t;
  }, { subtotal: 0, descuento: 0, base: 0, iva: 0, total: 0 });
}
const getCliente = (id) => DB.clientes.find((c) => c.id === id);
const getCot = (id) => DB.cotizaciones.find((c) => c.id === id);
const getFac = (id) => DB.facturas.find((c) => c.id === id);
const getAbo = (id) => DB.abonos.find((c) => c.id === id);
const abonosDe = (tipo, id) => DB.abonos.filter((a) => a.estado !== 'Anulado' && (tipo === 'cot' ? a.cotizacionId === id : a.facturaId === id));
const sumAbonos = (list) => list.reduce((s, a) => s + (+a.valor || 0), 0);

function facturaResumen(f) {
  const t = docTotals(f.items);
  const ab = abonosDe('fac', f.id);
  const abonado = sumAbonos(ab);
  return { ...t, abonado, saldo: Math.max(0, t.total - abonado), abonos: ab };
}
function facturaEstado(f) {
  if (f.estado === 'Anulada') return 'Anulada';
  const r = facturaResumen(f);
  if (r.saldo <= 0.5) return 'Pagada';
  if (f.vence && f.vence < todayISO()) return 'Vencida';
  if (r.abonado > 0) return 'En Proceso';
  return 'Pendiente';
}
function cotEstado(c) {
  if (['Anulada', 'Facturada'].includes(c.estado)) return c.estado;
  if (c.vence && c.vence < todayISO() && c.estado !== 'Aprobada') return 'Vencida';
  return c.estado;
}
/* Control financiero de un proyecto (cotización → abonos → factura) */
function proyectoResumen(cot) {
  const total = docTotals(cot.items).total;
  const fac = cot.facturaId ? getFac(cot.facturaId) : null;
  const abonos = DB.abonos.filter((a) => a.estado !== 'Anulado' && (a.cotizacionId === cot.id || (fac && a.facturaId === fac.id)));
  const uniq = [...new Map(abonos.map((a) => [a.id, a])).values()];
  const abonado = sumAbonos(uniq);
  return { total, abonado, saldo: Math.max(0, total - abonado), abonos: uniq.sort((a, b) => a.fecha.localeCompare(b.fecha)), pct: total ? Math.min(100, (abonado / total) * 100) : 0 };
}

/* ---------- plantillas (versionadas: los documentos guardan {id, version}) ---------- */
function plantillaActiva(tipo) {
  const p = DB.plantillas.find((x) => x.tipo === tipo && x.estado === 'Activa') || DB.plantillas.find((x) => x.tipo === tipo);
  return p ? { id: p.id, version: p.versiones[p.versiones.length - 1].version } : null;
}
function plantillaConfig(ref) {
  const p = ref && DB.plantillas.find((x) => x.id === ref.id);
  if (!p) return defaultTemplateConfig('cotizacion');
  return (p.versiones.find((v) => v.version === ref.version) || p.versiones[p.versiones.length - 1]).config;
}
function defaultTemplateConfig(tipo) {
  const orden = {
    cotizacion: ['encabezado', 'cliente', 'general', 'detalle', 'totales', 'condiciones', 'notas', 'firma', 'pie'],
    factura: ['encabezado', 'cliente', 'general', 'detalle', 'totales', 'abonos', 'banco', 'notas', 'firma', 'pie'],
    abono: ['encabezado', 'cliente', 'general', 'detalle', 'totales', 'banco', 'notas', 'firma', 'pie'],
  }[tipo];
  return {
    color: '#1d4ed8', color2: '#0f172a', fuente: 'Inter', logo: '',
    encabezado: 'TASECA S.A.S. · NIT 901.234.567-8\nCalle 100 # 15-20, Bogotá · +57 312 530 2674',
    pie: 'Gracias por su confianza · www.taseca.tech · tasecatech@gmail.com',
    firmaNombre: 'Andrés Barón', firmaCargo: 'Gerente General',
    bloques: orden.map((k) => ({ k, on: true })),
    html: '', pdfBase: '',
    formato: 'diseno', docx: '', docxNombre: '',
  };
}

/* ---------- datos de ejemplo ---------- */
function seed() {
  const now = new Date();
  const iso = (dOff) => { const d = new Date(now); d.setDate(d.getDate() + dOff); return d.toISOString().slice(0, 10); };
  const db = {
    version: 1, usuarioActual: 'admin', seq: { COT: 0, FAC: 0, ABO: 0, CLI: 0 },
    empresa: { razonSocial: 'TASECA S.A.S.', nit: '901.234.567-8', direccion: 'Calle 100 # 15-20', ciudad: 'Bogotá', codigoPostal: '110111', provincia: 'Cundinamarca', pais: 'Colombia', moneda: 'COP', ivaDefault: 19, telefono: '+57 312 530 2674', email: 'tasecatech@gmail.com', banco: 'Bancolombia', titular: 'TASECA S.A.S.', cuenta: 'Ahorros 123-456789-01' },
    clientes: [], cotizaciones: [], abonos: [], facturas: [], plantillas: [], documentos: [], auditoria: [],
  };
  DB = db;
  const mkCli = (o) => { const c = { id: uid('cli'), codigo: Store.nextNumber('CLI'), pais: 'Colombia', creado: new Date(now - 200 * 864e5).toISOString(), creadoPor: 'Administrador', adjuntos: [], ...o }; db.clientes.push(c); return c; };
  const c1 = mkCli({ tipo: 'Jurídica', razonSocial: 'Constructora Andina S.A.S.', nombreComercial: 'Andina Constructora', nit: '900.123.456-7', telefono: '601 745 2200', celular: '310 555 1020', email: 'compras@andina.co', direccion: 'Cra 7 # 72-41 Of. 502', ciudad: 'Bogotá', departamento: 'Cundinamarca', contacto: 'María Fernanda López', cargo: 'Jefe de Compras', observaciones: 'Cliente estratégico. Pago a 30 días.' });
  const c2 = mkCli({ tipo: 'Jurídica', razonSocial: 'Café Origen Ltda.', nombreComercial: 'Café Origen', nit: '901.456.789-1', telefono: '604 322 1100', celular: '315 222 3344', email: 'admin@cafeorigen.co', direccion: 'Calle 10 # 40-22', ciudad: 'Medellín', departamento: 'Antioquia', contacto: 'Julián Restrepo', cargo: 'Gerente', observaciones: '3 sedes. Interesados en sistema para restaurantes.' });
  const c3 = mkCli({ tipo: 'Natural', razonSocial: 'Natalia Torres Vargas', nombreComercial: 'Estudio NT Diseño', nit: '1.020.345.678', telefono: '', celular: '300 987 6543', email: 'natalia@estudiont.com', direccion: 'Av. 6N # 25-10', ciudad: 'Cali', departamento: 'Valle del Cauca', contacto: 'Natalia Torres', cargo: 'Propietaria', observaciones: '' });
  const c4 = mkCli({ tipo: 'Jurídica', razonSocial: 'Clínica Dental Sonrisa S.A.S.', nombreComercial: 'Sonrisa Dental', nit: '900.987.654-3', telefono: '605 360 4400', celular: '318 444 5566', email: 'gerencia@sonrisadental.co', direccion: 'Cra 53 # 80-120', ciudad: 'Barranquilla', departamento: 'Atlántico', contacto: 'Dr. Ricardo Palacio', cargo: 'Director', observaciones: 'Usa Taseca Citas desde 2025.' });
  const c5 = mkCli({ tipo: 'Jurídica', razonSocial: 'Logística Express del Caribe S.A.', nombreComercial: 'LogiExpress', nit: '890.111.222-5', telefono: '605 660 1200', celular: '311 000 7788', email: 'tesoreria@logiexpress.com', direccion: 'Zona Franca Bodega 14', ciudad: 'Cartagena', departamento: 'Bolívar', contacto: 'Paola Méndez', cargo: 'Tesorera', observaciones: '' });
  const c6 = mkCli({ tipo: 'Natural', razonSocial: 'Jorge Iván Castaño', nombreComercial: 'JC Asesorías Contables', nit: '79.555.111', telefono: '', celular: '317 123 4567', email: 'jorge@jcasesorias.co', direccion: 'Calle 19 # 8-34', ciudad: 'Pereira', departamento: 'Risaralda', contacto: 'Jorge Castaño', cargo: 'Contador', observaciones: '' });

  ['cotizacion', 'factura', 'abono'].forEach((t) => {
    const cfg = defaultTemplateConfig(t);
    db.plantillas.push({ id: uid('tpl'), tipo: t, nombre: { cotizacion: 'Cotización corporativa', factura: 'Factura estándar', abono: 'Recibo de abono' }[t], estado: 'Activa', creado: new Date(now - 180 * 864e5).toISOString(), creadoPor: 'Administrador', versiones: [{ version: 1, fecha: new Date(now - 180 * 864e5).toISOString(), usuario: 'Administrador', nota: 'Versión inicial', config: cfg }] });
  });
  const alt = defaultTemplateConfig('cotizacion');
  alt.color = '#0f766e'; alt.color2 = '#134e4a';
  db.plantillas.push({ id: uid('tpl'), tipo: 'cotizacion', nombre: 'Cotización minimal (verde)', estado: 'Inactiva', creado: new Date(now - 60 * 864e5).toISOString(), creadoPor: 'Laura Gómez', versiones: [{ version: 1, fecha: new Date(now - 60 * 864e5).toISOString(), usuario: 'Laura Gómez', nota: 'Propuesta alternativa', config: alt }] });

  const svc = {
    citas: { concepto: 'Taseca Citas – suscripción anual', descripcion: 'Agenda en línea, recordatorios y panel administrativo', cantidad: 12, valor: 100000, iva: 19, desc: 0 },
    setup: { concepto: 'Implementación y configuración', descripcion: 'Parametrización, carga inicial de datos y capacitación', cantidad: 1, valor: 1500000, iva: 19, desc: 0 },
    resto: { concepto: 'Sistema para Restaurantes – licencia mensual', descripcion: 'POS, inventario y reportes por sede', cantidad: 12, valor: 300000, iva: 19, desc: 10 },
    medida: { concepto: 'Desarrollo a medida', descripcion: 'Automatización de procesos según levantamiento', cantidad: 1, valor: 8500000, iva: 19, desc: 0 },
    curso: { concepto: 'Curso Excel / Power BI (4 clases)', descripcion: 'Grupo de hasta 8 personas', cantidad: 2, valor: 200000, iva: 0, desc: 0 },
    soporte: { concepto: 'Bolsa de horas de soporte', descripcion: '20 horas, vigencia 6 meses', cantidad: 20, valor: 90000, iva: 19, desc: 5 },
  };
  const tplCot = plantillaActiva('cotizacion'), tplFac = plantillaActiva('factura'), tplAbo = plantillaActiva('abono');
  const mkCot = (cli, off, proyecto, items, estado, extra = {}) => {
    const c = { id: uid('cot'), numero: Store.nextNumber('COT'), fecha: iso(off), vence: iso(off + 30), proyecto, descripcion: `Propuesta comercial para ${proyecto.toLowerCase()}.`, clienteId: cli.id, items: items.map(clone), validez: '30 días', formaPago: '50% anticipo, 50% contra entrega', tiempoEjecucion: '4 semanas', observaciones: 'Precios en pesos colombianos. Incluye soporte durante el primer mes.', responsable: 'Laura Gómez', estado, plantilla: tplCot, firma: '', facturaId: null, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Laura Gómez', ...extra };
    db.cotizaciones.push(c); return c;
  };
  const mkFac = (cot, off, venceDias = 30) => {
    const f = { id: uid('fac'), numero: Store.nextNumber('FAC'), fecha: iso(off), fechaOperacion: iso(off), vence: iso(off + venceDias), clienteId: cot.clienteId, cotizacionId: cot.id, items: clone(cot.items), metodoPago: 'Transferencia', banco: db.empresa.banco, titular: db.empresa.titular, cuenta: db.empresa.cuenta, observaciones: 'Favor referenciar el número de factura en el pago.', estado: 'Emitida', plantilla: tplFac, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Carlos Ruiz' };
    cot.estado = 'Facturada'; cot.facturaId = f.id; db.facturas.push(f);
    db.abonos.filter((a) => a.cotizacionId === cot.id).forEach((a) => { a.facturaId = f.id; });
    return f;
  };
  const mkAbo = (cot, off, pct, concepto, forma = 'Transferencia', banco = 'Bancolombia') => {
    const total = docTotals(cot.items).total;
    const a = { id: uid('abo'), numero: Store.nextNumber('ABO'), fecha: iso(off), cotizacionId: cot.id, facturaId: cot.facturaId || null, clienteId: cot.clienteId, concepto, referencia: 'OP' + Math.floor(1e7 + Math.random() * 9e7), formaPago: forma, banco, valor: Math.round(total * pct), estado: 'Aplicado', plantilla: tplAbo, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Carlos Ruiz' };
    db.abonos.push(a); return a;
  };

  // Historia de ~6 meses
  let k = mkCot(c1, -170, 'Agenda de obra y visitas', [svc.citas, svc.setup], 'Aprobada'); mkAbo(k, -165, .5, 'Anticipo 50%'); mkFac(k, -150); mkAbo(k, -135, .5, 'Pago final');
  k = mkCot(c2, -150, 'POS para 3 sedes', [{ ...svc.resto, cantidad: 36 }, svc.setup], 'Aprobada'); mkAbo(k, -145, .4, 'Anticipo 40%'); mkFac(k, -120); mkAbo(k, -100, .3, 'Segundo pago'); mkAbo(k, -80, .3, 'Pago final', 'PSE');
  k = mkCot(c4, -130, 'Ampliación Taseca Citas', [svc.citas, svc.soporte], 'Aprobada'); mkFac(k, -115); mkAbo(k, -95, 1, 'Pago total', 'Consignación', 'Davivienda');
  k = mkCot(c5, -110, 'Automatización de despachos', [svc.medida, svc.soporte], 'Aprobada'); mkAbo(k, -105, .5, 'Anticipo 50%', 'Transferencia', 'BBVA'); mkFac(k, -70, 45); mkAbo(k, -40, .25, 'Abono parcial', 'Transferencia', 'BBVA');
  k = mkCot(c6, -95, 'Capacitación Power BI', [svc.curso], 'Aprobada'); mkFac(k, -88, 15); mkAbo(k, -86, 1, 'Pago total', 'Tarjeta', 'Banco de Bogotá');
  k = mkCot(c3, -80, 'Portafolio y cotizador web', [{ ...svc.medida, valor: 3200000 }], 'Anulada');
  k = mkCot(c1, -60, 'Tablero de control de obras', [svc.medida, svc.curso], 'Aprobada'); mkAbo(k, -55, .3, 'Anticipo 30%'); mkFac(k, -40, 20);
  k = mkCot(c2, -45, 'Curso de inventarios en Excel', [{ ...svc.curso, cantidad: 3 }], 'Aprobada'); mkFac(k, -30); mkAbo(k, -12, 1, 'Pago total', 'PSE');
  k = mkCot(c4, -28, 'Recordatorios por WhatsApp', [{ ...svc.medida, valor: 2400000 }, svc.soporte], 'Aprobada'); mkAbo(k, -20, .5, 'Anticipo 50%', 'Transferencia', 'Davivienda'); mkFac(k, -5);
  k = mkCot(c5, -20, 'Bolsa de soporte 2026-II', [svc.soporte], 'Enviada'); k.vence = iso(4);
  k = mkCot(c6, -10, 'Licencia Taseca Citas', [svc.citas, svc.setup], 'Enviada'); k.vence = iso(6);
  k = mkCot(c3, -5, 'Rediseño de catálogo', [{ ...svc.medida, valor: 4100000 }], 'Borrador');
  k = mkCot(c2, -50, 'Sede nueva – POS', [{ ...svc.resto, cantidad: 12 }], 'Enviada');
  k = mkCot(c1, -3, 'Soporte anual obras', [svc.soporte, svc.citas], 'Enviada'); k.vence = iso(27);

  // Documentos libres de ejemplo
  db.documentos.push({ id: uid('doc'), nombre: 'Contrato marco de servicios.pdf', mime: 'application/pdf', categoria: 'Contrato', clienteId: c1.id, proyecto: 'Agenda de obra y visitas', etiquetas: ['contrato', 'firmado'], versiones: [{ v: 1, fecha: new Date(now - 168 * 864e5).toISOString(), usuario: 'Administrador', size: 182000, data: '' }], creado: new Date(now - 168 * 864e5).toISOString() });
  db.documentos.push({ id: uid('doc'), nombre: 'RUT Café Origen.pdf', mime: 'application/pdf', categoria: 'Documento legal', clienteId: c2.id, proyecto: '', etiquetas: ['rut'], versiones: [{ v: 1, fecha: new Date(now - 150 * 864e5).toISOString(), usuario: 'Laura Gómez', size: 96000, data: '' }, { v: 2, fecha: new Date(now - 20 * 864e5).toISOString(), usuario: 'Laura Gómez', size: 98000, data: '' }], creado: new Date(now - 150 * 864e5).toISOString() });
  db.documentos.push({ id: uid('doc'), nombre: 'Foto entrega sede norte.jpg', mime: 'image/jpeg', categoria: 'Imagen', clienteId: c2.id, proyecto: 'POS para 3 sedes', etiquetas: ['evidencia', 'entrega'], versiones: [{ v: 1, fecha: new Date(now - 82 * 864e5).toISOString(), usuario: 'Carlos Ruiz', size: 420000, data: '' }], creado: new Date(now - 82 * 864e5).toISOString() });

  // Auditoría inicial derivada
  const pushAu = (fecha, usuario, accion, entidad, ref, detalle) => db.auditoria.push({ id: uid('au'), fecha, usuario, rol: '', accion, entidad, ref, detalle, cambios: [] });
  db.clientes.forEach((c) => pushAu(c.creado, c.creadoPor, 'Crear', 'Cliente', c.codigo, c.razonSocial));
  db.cotizaciones.forEach((c) => pushAu(c.creado, c.creadoPor, 'Crear', 'Cotización', c.numero, c.proyecto));
  db.facturas.forEach((f) => pushAu(f.creado, f.creadoPor, 'Convertir', 'Factura', f.numero, 'Generada desde ' + getCot(f.cotizacionId).numero));
  db.abonos.forEach((a) => pushAu(a.creado, a.creadoPor, 'Registrar', 'Abono', a.numero, `${a.concepto} · ${fmtMoney(a.valor)}`));
  db.auditoria.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return db;
}
