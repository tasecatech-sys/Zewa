/* ==========================================================
   Capa de datos: almacenamiento local, reglas de negocio,
   numeración, cálculos financieros y auditoría.
   En producción se reemplaza por Supabase (ver supabase_facturacion.sql).
   ========================================================== */
const DB_KEY = 'tsf_db_v1';

/* ---------- usuarios, roles y permisos por módulo ---------- */
const MODULOS = [
  { k: 'dashboard', label: 'Panel de control' },
  { k: 'busqueda', label: 'Búsqueda inteligente' },
  { k: 'clientes', label: 'Clientes' },
  { k: 'inventario', label: 'Inventario' },
  { k: 'cotizaciones', label: 'Presupuestos' },
  { k: 'abonos', label: 'Cobros' },
  { k: 'facturas', label: 'Facturación' },
  { k: 'plantillas', label: 'Plantillas' },
  { k: 'documentos', label: 'Gestión documental' },
  { k: 'auditoria', label: 'Auditoría' },
  { k: 'usuarios', label: 'Usuarios y permisos' },
  { k: 'config', label: 'Configuración' },
];
const PERM_LEVELS = [
  { k: 'ninguno', label: 'Sin acceso' },
  { k: 'ver', label: 'Solo ver' },
  { k: 'gestionar', label: 'Gestionar' },
];
function defaultRoles() {
  const todoGestionar = {}; MODULOS.forEach((m) => { todoGestionar[m.k] = 'gestionar'; });
  return [
    { id: 'rol_admin', nombre: 'Administrador', descripcion: 'Acceso completo a todos los módulos, incluida la gestión de usuarios y permisos.', sistema: true, permisos: todoGestionar },
    { id: 'rol_comercial', nombre: 'Comercial', descripcion: 'Clientes, inventario y presupuestos. Solo lectura de facturación.', sistema: false, permisos: { dashboard: 'ver', busqueda: 'ver', clientes: 'gestionar', inventario: 'ver', cotizaciones: 'gestionar', abonos: 'gestionar', facturas: 'ver', plantillas: 'ninguno', documentos: 'gestionar', auditoria: 'ninguno', usuarios: 'ninguno', config: 'ninguno' } },
    { id: 'rol_contable', nombre: 'Contabilidad', descripcion: 'Facturación, cobros y auditoría. Solo lectura de clientes y presupuestos.', sistema: false, permisos: { dashboard: 'ver', busqueda: 'ver', clientes: 'ver', inventario: 'ver', cotizaciones: 'ver', abonos: 'gestionar', facturas: 'gestionar', plantillas: 'ninguno', documentos: 'ver', auditoria: 'ver', usuarios: 'ninguno', config: 'ninguno' } },
  ];
}
function defaultUsuarios() {
  return [
    { id: 'admin', codigo: 'USR-0001', nombre: 'Administrador', email: 'admin@zewareformas.es', rolId: 'rol_admin', activo: true, passHash: '', creado: new Date().toISOString(), creadoPor: 'Sistema' },
    { id: 'comercial', codigo: 'USR-0002', nombre: 'Laura Gómez', email: 'laura@zewareformas.es', rolId: 'rol_comercial', activo: true, passHash: '', creado: new Date().toISOString(), creadoPor: 'Sistema' },
    { id: 'contable', codigo: 'USR-0003', nombre: 'Carlos Ruiz', email: 'carlos@zewareformas.es', rolId: 'rol_contable', activo: true, passHash: '', creado: new Date().toISOString(), creadoPor: 'Sistema' },
  ];
}
/* ---------- contraseñas ----------
   Aviso: esta app guarda todo en localStorage del navegador, sin servidor.
   El hash evita que alguien vea la contraseña a simple vista, pero no es una
   autenticación real: quien tenga acceso a ese navegador puede editar o
   borrar localStorage directamente. Sirve para evitar cambios accidentales
   de sesión entre compañeros, no para proteger datos sensibles. */
async function hashPassword(pass, salt) {
  const text = `${salt}::${pass || ''}`;
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return 'f' + h.toString(16);
}
async function setPassword(u, pass) { u.passHash = pass ? await hashPassword(pass, u.id) : ''; }
async function checkPassword(u, pass) { return !u.passHash || (await hashPassword(pass || '', u.id)) === u.passHash; }

const ESTADOS_COT = ['Borrador', 'Enviado', 'Aprobado', 'Facturado', 'Vencido', 'Anulado'];
const FORMAS_PAGO = ['Transferencia', 'Bizum', 'Tarjeta', 'Domiciliación', 'Efectivo'];
const BANCOS = ['CaixaBank', 'Banco Santander', 'BBVA', 'Banco Sabadell', 'Bankinter', 'ING', 'Unicaja', 'Kutxabank', 'Abanca', 'Ibercaja'];
const BLOQUES = {
  encabezado: 'Encabezado y logo',
  cliente: 'Datos del cliente',
  general: 'Datos generales / proyecto',
  detalle: 'Detalle de conceptos',
  totales: 'Totales',
  condiciones: 'Condiciones comerciales',
  abonos: 'Pagos a cuenta',
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
  EUR: { code: 'EUR', locale: 'es-ES', dec: 2, simbolo: '€', nombre: 'Euro (EUR)' },
  COP: { code: 'COP', locale: 'es-CO', dec: 0, simbolo: '$', nombre: 'Peso colombiano (COP)' },
  USD: { code: 'USD', locale: 'en-US', dec: 2, simbolo: 'US$', nombre: 'Dólar (USD)' },
  MXN: { code: 'MXN', locale: 'es-MX', dec: 2, simbolo: '$', nombre: 'Peso mexicano (MXN)' },
};
const moneda = () => MONEDAS[(typeof DB !== 'undefined' && DB?.empresa?.moneda) || 'EUR'] || MONEDAS.EUR;
const fmtMoney = (n) => { const m = moneda(); return new Intl.NumberFormat(m.locale, { style: 'currency', currency: m.code, minimumFractionDigits: m.dec, maximumFractionDigits: m.dec }).format(+n || 0); };
const fmtShort = (n) => {
  const a = Math.abs(n), m = moneda();
  const v = a >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' mil M' : a >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : a >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(Math.round(n));
  return m.code === 'EUR' ? `${v} €` : m.simbolo + v; // en España el símbolo va detrás
};
const fmtDate = (iso) => iso ? new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- store ---------- */
let DB;
const Store = {
  load() {
    try { DB = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { DB = null; }
    if (!DB || !DB.version) { DB = seed(); this.save(); }
    DB.empresa = { moneda: 'EUR', ivaDefault: 21, pais: 'España', codigoPostal: '', provincia: '', ...DB.empresa };
    DB.inventario = DB.inventario || [];
    DB.roles = DB.roles && DB.roles.length ? DB.roles : defaultRoles();
    DB.usuarios = DB.usuarios && DB.usuarios.length ? DB.usuarios : defaultUsuarios();
    DB.usuarios.forEach((u) => { if (u.passHash === undefined) u.passHash = ''; });
    DB.seq = { COT: 0, FAC: 0, ABO: 0, CLI: 0, INV: 0, USR: DB.usuarios.length, ...DB.seq };
    if (!DB.usuarioActual || !DB.usuarios.find((u) => u.id === DB.usuarioActual)) DB.usuarioActual = DB.usuarios[0]?.id;
    migrarLexicoES(DB); this.save();
    return DB;
  },
  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); return true; }
    catch (e) { console.error(e); if (window.toast) toast('Almacenamiento lleno: libera documentos adjuntos.', 'bad'); return false; }
  },
  reset() { localStorage.removeItem(DB_KEY); DB = seed(); this.save(); },
  user() { return DB.usuarios.find((u) => u.id === DB.usuarioActual) || DB.usuarios[0]; },
  nextNumber(tipo) {
    const year = new Date().getFullYear();
    const pref = { COT: 'PRE', FAC: 'FAC', ABO: 'REC', CLI: 'CLI', INV: 'INV', USR: 'USR' }[tipo];
    DB.seq[tipo] = (DB.seq[tipo] || 0) + 1;
    return ['CLI', 'INV', 'USR'].includes(tipo) ? `${pref}-${String(DB.seq[tipo]).padStart(4, '0')}` : `${pref}-${year}-${String(DB.seq[tipo]).padStart(4, '0')}`;
  },
};

/* ---------- migración al léxico de España (datos guardados antes del cambio) ---------- */
function migrarLexicoES(db) {
  if (db.lexico === 'es-ES') return;
  const EST = { Enviada: 'Enviado', Aprobada: 'Aprobado', Facturada: 'Facturado', Vencida: 'Vencido', Anulada: 'Anulado' };
  (db.cotizaciones || []).forEach((c) => { if (EST[c.estado]) c.estado = EST[c.estado]; });
  (db.clientes || []).forEach((c) => { if (c.tipo === 'Natural') c.tipo = 'Física'; });
  const ENT = { 'Cotización': 'Presupuesto', Abono: 'Cobro' };
  (db.auditoria || []).forEach((a) => { if (ENT[a.entidad]) a.entidad = ENT[a.entidad]; });
  const TPL = { 'Cotización corporativa': 'Presupuesto corporativo', 'Recibo de abono': 'Recibo de pago', 'Cotización minimal (verde)': 'Presupuesto minimalista (verde)' };
  (db.plantillas || []).forEach((p) => { if (TPL[p.nombre]) p.nombre = TPL[p.nombre]; });
  const CAT = { 'Soporte de pago': 'Justificante de pago', 'Orden de compra': 'Pedido' };
  (db.documentos || []).forEach((d) => { if (CAT[d.categoria]) d.categoria = CAT[d.categoria]; });
  db.lexico = 'es-ES';
}

/* ---------- permisos ---------- */
const getRol = (id) => DB.roles.find((r) => r.id === id);
const rolDe = (u) => getRol(u?.rolId) || DB.roles[0];
const permisoModulo = (modulo, u = Store.user()) => rolDe(u)?.permisos?.[modulo] || 'ninguno';
const puedeVer = (modulo, u) => permisoModulo(modulo, u) !== 'ninguno';
const puedeGestionar = (modulo, u) => permisoModulo(modulo, u) === 'gestionar';
/* Simula si, tras aplicar nuevosPermisos al rol rolId, seguiría habiendo algún usuario activo
   capaz de gestionar usuarios y roles (evita que el administrador se quede sin acceso). */
function tendriaAccesoAdmin(rolId, nuevosPermisos) {
  return DB.usuarios.some((u) => {
    if (u.activo === false) return false;
    const permisos = u.rolId === rolId ? nuevosPermisos : rolDe(u)?.permisos;
    return permisos?.usuarios === 'gestionar';
  });
}

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
  DB.auditoria.unshift({ id: uid('au'), fecha: new Date().toISOString(), usuario: u?.nombre || 'Sistema', rol: rolDe(u)?.nombre || '', accion, entidad, ref, detalle, cambios });
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
const getInvItem = (id) => DB.inventario.find((i) => i.id === id);
const invMargen = (i) => (+i.precioVenta > 0 ? ((+i.precioVenta - (+i.costo || 0)) / +i.precioVenta) * 100 : 0);
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
  if (['Anulado', 'Facturado'].includes(c.estado)) return c.estado;
  if (c.vence && c.vence < todayISO() && c.estado !== 'Aprobado') return 'Vencido';
  return c.estado;
}
/* Control financiero de un proyecto (presupuesto → cobros → factura) */
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
    encabezado: 'ZEWÁ REFORMAS · NIF B00000000\nCalle Ejemplo, 1 · 28001 Madrid · 641 486 231',
    pie: 'Gracias por su confianza · zewareformas@gmail.com · 641 486 231',
    firmaNombre: 'ZEWÁ REFORMAS', firmaCargo: 'Gerencia',
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
    version: 1, lexico: 'es-ES', usuarioActual: 'admin', seq: { COT: 0, FAC: 0, ABO: 0, CLI: 0, INV: 0, USR: 3 },
    empresa: { razonSocial: 'ZEWÁ REFORMAS', nit: 'B00000000', direccion: 'Calle Ejemplo, 1', ciudad: 'Madrid', codigoPostal: '28001', provincia: 'Madrid', pais: 'España', moneda: 'EUR', ivaDefault: 21, telefono: '641 486 231', email: 'zewareformas@gmail.com', banco: 'CaixaBank', titular: 'ZEWÁ REFORMAS', cuenta: 'ES00 0000 0000 0000 0000 0000' },
    clientes: [], cotizaciones: [], abonos: [], facturas: [], plantillas: [], documentos: [], auditoria: [], inventario: [],
    roles: defaultRoles(), usuarios: defaultUsuarios(),
  };
  DB = db;
  const mkCli = (o) => { const c = { id: uid('cli'), codigo: Store.nextNumber('CLI'), pais: 'España', creado: new Date(now - 200 * 864e5).toISOString(), creadoPor: 'Administrador', adjuntos: [], ...o }; db.clientes.push(c); return c; };
  const c1 = mkCli({ tipo: 'Jurídica', razonSocial: 'Construcciones Levante S.L.', nombreComercial: 'Levante Obras', nit: 'B46123456', telefono: '963 52 14 20', celular: '612 345 678', email: 'compras@levanteobras.es', direccion: 'Av. del Puerto, 120, 3.º', codigoPostal: '46023', ciudad: 'Valencia', departamento: 'Valencia', contacto: 'María Fernanda López', cargo: 'Jefa de Compras', observaciones: 'Cliente estratégico. Pago a 30 días.' });
  const c2 = mkCli({ tipo: 'Jurídica', razonSocial: 'Café Origen S.L.', nombreComercial: 'Café Origen', nit: 'B87654321', telefono: '914 22 11 00', celular: '622 223 344', email: 'admin@cafeorigen.es', direccion: 'Calle de Fuencarral, 45', codigoPostal: '28004', ciudad: 'Madrid', departamento: 'Madrid', contacto: 'Julián Restrepo', cargo: 'Gerente', observaciones: '3 locales. Interesados en reformar un local nuevo.' });
  const c3 = mkCli({ tipo: 'Física', razonSocial: 'Natalia Torres Vargas', nombreComercial: 'Estudio NT Diseño', nit: '12345678Z', telefono: '', celular: '600 987 654', email: 'natalia@estudiont.es', direccion: 'Carrer d’Aragó, 210, 2.º 1.ª', codigoPostal: '08011', ciudad: 'Barcelona', departamento: 'Barcelona', contacto: 'Natalia Torres', cargo: 'Propietaria', observaciones: '' });
  const c4 = mkCli({ tipo: 'Jurídica', razonSocial: 'Clínica Dental Sonrisa S.L.', nombreComercial: 'Sonrisa Dental', nit: 'B41987654', telefono: '954 36 04 40', celular: '618 444 556', email: 'gerencia@sonrisadental.es', direccion: 'Av. de la Constitución, 18', codigoPostal: '41001', ciudad: 'Sevilla', departamento: 'Sevilla', contacto: 'Dr. Ricardo Palacio', cargo: 'Director', observaciones: 'Cliente desde 2025.' });
  const c5 = mkCli({ tipo: 'Jurídica', razonSocial: 'Logística Express del Norte S.A.', nombreComercial: 'LogiExpress', nit: 'A48111222', telefono: '944 66 12 00', celular: '611 000 778', email: 'tesoreria@logiexpress.es', direccion: 'Polígono Industrial Asua, Nave 14', codigoPostal: '48950', ciudad: 'Erandio', departamento: 'Bizkaia', contacto: 'Paola Méndez', cargo: 'Tesorera', observaciones: '' });
  const c6 = mkCli({ tipo: 'Física', razonSocial: 'Jorge Iván Castaño', nombreComercial: 'JC Asesoría', nit: '79555111C', telefono: '', celular: '617 123 456', email: 'jorge@jcasesoria.es', direccion: 'Calle Larios, 8', codigoPostal: '29005', ciudad: 'Málaga', departamento: 'Málaga', contacto: 'Jorge Castaño', cargo: 'Asesor fiscal', observaciones: '' });

  ['cotizacion', 'factura', 'abono'].forEach((t) => {
    const cfg = defaultTemplateConfig(t);
    db.plantillas.push({ id: uid('tpl'), tipo: t, nombre: { cotizacion: 'Presupuesto corporativo', factura: 'Factura estándar', abono: 'Recibo de pago' }[t], estado: 'Activa', creado: new Date(now - 180 * 864e5).toISOString(), creadoPor: 'Administrador', versiones: [{ version: 1, fecha: new Date(now - 180 * 864e5).toISOString(), usuario: 'Administrador', nota: 'Versión inicial', config: cfg }] });
  });
  const alt = defaultTemplateConfig('cotizacion');
  alt.color = '#0f766e'; alt.color2 = '#134e4a';
  db.plantillas.push({ id: uid('tpl'), tipo: 'cotizacion', nombre: 'Presupuesto minimalista (verde)', estado: 'Inactiva', creado: new Date(now - 60 * 864e5).toISOString(), creadoPor: 'Laura Gómez', versiones: [{ version: 1, fecha: new Date(now - 60 * 864e5).toISOString(), usuario: 'Laura Gómez', nota: 'Propuesta alternativa', config: alt }] });

  const svc = {
    demolicion: { concepto: 'Demolición y retirada de escombros', descripcion: 'Incluye contenedor y gestión de residuos', cantidad: 1, valor: 850, iva: 21, desc: 0 },
    alicatado: { concepto: 'Alicatado (m²)', descripcion: 'Azulejo cerámico, material y mano de obra', cantidad: 24, valor: 38, iva: 21, desc: 0 },
    fontaneria: { concepto: 'Instalación de fontanería', descripcion: 'Tomas de agua, desagües y sanitarios', cantidad: 1, valor: 1200, iva: 21, desc: 0 },
    electricidad: { concepto: 'Instalación eléctrica', descripcion: 'Cableado, mecanismos y boletín', cantidad: 1, valor: 1600, iva: 21, desc: 0 },
    pintura: { concepto: 'Pintura de paredes y techos (m²)', descripcion: 'Pintura plástica lisa, dos manos', cantidad: 120, valor: 9, iva: 21, desc: 0 },
    cocina: { concepto: 'Montaje de cocina', descripcion: 'Muebles, encimera y electrodomésticos (mano de obra)', cantidad: 1, valor: 2400, iva: 21, desc: 5 },
  };
  const mkInv = (o) => { const i = { id: uid('inv'), codigo: Store.nextNumber('INV'), estado: 'Activo', iva: db.empresa.ivaDefault ?? 21, creado: new Date(now - 150 * 864e5).toISOString(), creadoPor: 'Administrador', ...o }; db.inventario.push(i); return i; };
  mkInv({ tipo: 'Servicio', categoria: 'Demolición', unidad: 'ud', nombre: 'Demolición y retirada de escombros', descripcion: 'Incluye contenedor y gestión de residuos', costo: 450, precioVenta: 850 });
  mkInv({ tipo: 'Servicio', categoria: 'Alicatado', unidad: 'm²', nombre: 'Alicatado', descripcion: 'Azulejo cerámico, material y mano de obra', costo: 22, precioVenta: 38 });
  mkInv({ tipo: 'Servicio', categoria: 'Fontanería', unidad: 'ud', nombre: 'Instalación de fontanería', descripcion: 'Tomas de agua, desagües y sanitarios', costo: 650, precioVenta: 1200 });
  mkInv({ tipo: 'Servicio', categoria: 'Electricidad', unidad: 'ud', nombre: 'Instalación eléctrica', descripcion: 'Cableado, mecanismos y boletín', costo: 900, precioVenta: 1600 });
  mkInv({ tipo: 'Servicio', categoria: 'Pintura', unidad: 'm²', nombre: 'Pintura de paredes y techos', descripcion: 'Pintura plástica lisa, dos manos', costo: 4.5, precioVenta: 9 });
  mkInv({ tipo: 'Servicio', categoria: 'Cocina', unidad: 'ud', nombre: 'Montaje de cocina', descripcion: 'Muebles, encimera y electrodomésticos (mano de obra)', costo: 1500, precioVenta: 2400 });
  mkInv({ tipo: 'Material', categoria: 'Alicatado', unidad: 'm²', nombre: 'Azulejo cerámico 30x60', descripcion: 'Material cerámico de primera calidad', costo: 9, precioVenta: 16 });
  mkInv({ tipo: 'Material', categoria: 'Pintura', unidad: 'l', nombre: 'Pintura plástica blanca', descripcion: 'Litro de pintura plástica lisa mate', costo: 4, precioVenta: 7.5 });
  mkInv({ tipo: 'Material', categoria: 'Fontanería', unidad: 'ud', nombre: 'Sanitario completo (inodoro + cisterna)', descripcion: 'Inodoro de porcelana con cisterna', costo: 85, precioVenta: 150 });
  mkInv({ tipo: 'Material', categoria: 'Electricidad', unidad: 'ud', nombre: 'Cuadro eléctrico 12 módulos', descripcion: 'Cuadro de protección con magnetotérmicos', costo: 60, precioVenta: 110 });
  const tplCot = plantillaActiva('cotizacion'), tplFac = plantillaActiva('factura'), tplAbo = plantillaActiva('abono');
  const mkCot = (cli, off, proyecto, items, estado, extra = {}) => {
    const c = { id: uid('cot'), numero: Store.nextNumber('COT'), fecha: iso(off), vence: iso(off + 30), proyecto, descripcion: `Presupuesto para ${proyecto.toLowerCase()}.`, clienteId: cli.id, items: items.map(clone), validez: '30 días', formaPago: '50% a la aceptación, 50% a la finalización', tiempoEjecucion: '4 semanas', observaciones: 'Precios en euros. Incluye retirada de escombros y limpieza final de obra.', responsable: 'Laura Gómez', estado, plantilla: tplCot, firma: '', facturaId: null, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Laura Gómez', ...extra };
    db.cotizaciones.push(c); return c;
  };
  const mkFac = (cot, off, venceDias = 30) => {
    const f = { id: uid('fac'), numero: Store.nextNumber('FAC'), fecha: iso(off), fechaOperacion: iso(off), vence: iso(off + venceDias), clienteId: cot.clienteId, cotizacionId: cot.id, items: clone(cot.items), metodoPago: 'Transferencia', banco: db.empresa.banco, titular: db.empresa.titular, cuenta: db.empresa.cuenta, observaciones: 'Por favor, indique el número de factura en el concepto de la transferencia.', estado: 'Emitida', plantilla: tplFac, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Carlos Ruiz' };
    cot.estado = 'Facturado'; cot.facturaId = f.id; db.facturas.push(f);
    db.abonos.filter((a) => a.cotizacionId === cot.id).forEach((a) => { a.facturaId = f.id; });
    return f;
  };
  const mkAbo = (cot, off, pct, concepto, forma = 'Transferencia', banco = 'CaixaBank') => {
    const total = docTotals(cot.items).total;
    const a = { id: uid('abo'), numero: Store.nextNumber('ABO'), fecha: iso(off), cotizacionId: cot.id, facturaId: cot.facturaId || null, clienteId: cot.clienteId, concepto, referencia: 'OP' + Math.floor(1e7 + Math.random() * 9e7), formaPago: forma, banco, valor: Math.round(total * pct * 100) / 100, estado: 'Aplicado', plantilla: tplAbo, creado: new Date(now.getTime() + off * 864e5).toISOString(), creadoPor: 'Carlos Ruiz' };
    db.abonos.push(a); return a;
  };

  // Historia de ~6 meses
  let k = mkCot(c1, -170, 'Reforma de oficinas centrales', [svc.demolicion, svc.electricidad, svc.pintura], 'Aprobado'); mkAbo(k, -165, .5, 'Anticipo 50%'); mkFac(k, -150); mkAbo(k, -135, .5, 'Pago final');
  k = mkCot(c2, -150, 'Reforma de 3 locales', [{ ...svc.cocina, cantidad: 3 }, { ...svc.pintura, cantidad: 300 }], 'Aprobado'); mkAbo(k, -145, .4, 'Anticipo 40%'); mkFac(k, -120); mkAbo(k, -100, .3, 'Segundo pago'); mkAbo(k, -80, .3, 'Pago final', 'Domiciliación');
  k = mkCot(c4, -130, 'Reforma de gabinetes dentales', [svc.fontaneria, svc.electricidad], 'Aprobado'); mkFac(k, -115); mkAbo(k, -95, 1, 'Pago total', 'Transferencia', 'Banco Sabadell');
  k = mkCot(c5, -110, 'Adecuación de nave', [svc.demolicion, svc.electricidad, { ...svc.pintura, cantidad: 400 }], 'Aprobado'); mkAbo(k, -105, .5, 'Anticipo 50%', 'Transferencia', 'BBVA'); mkFac(k, -70, 45); mkAbo(k, -40, .25, 'Pago parcial', 'Transferencia', 'BBVA');
  k = mkCot(c6, -95, 'Pintura de despacho', [{ ...svc.pintura, cantidad: 60 }], 'Aprobado'); mkFac(k, -88, 15); mkAbo(k, -86, 1, 'Pago total', 'Tarjeta', 'Banco Santander');
  k = mkCot(c3, -80, 'Reforma de baño', [svc.demolicion, svc.alicatado, svc.fontaneria], 'Anulado');
  k = mkCot(c1, -60, 'Reforma de aseos', [{ ...svc.alicatado, cantidad: 40 }, svc.fontaneria], 'Aprobado'); mkAbo(k, -55, .3, 'Anticipo 30%'); mkFac(k, -40, 20);
  k = mkCot(c2, -45, 'Montaje de cocina en local', [svc.cocina], 'Aprobado'); mkFac(k, -30); mkAbo(k, -12, 1, 'Pago total', 'Bizum');
  k = mkCot(c4, -28, 'Ampliación de recepción', [svc.demolicion, { ...svc.pintura, cantidad: 80 }], 'Aprobado'); mkAbo(k, -20, .5, 'Anticipo 50%', 'Transferencia', 'Banco Sabadell'); mkFac(k, -5);
  k = mkCot(c5, -20, 'Mantenimiento 2.º semestre 2026', [svc.electricidad], 'Enviado'); k.vence = iso(4);
  k = mkCot(c6, -10, 'Reforma de cocina', [svc.cocina, svc.alicatado], 'Enviado'); k.vence = iso(6);
  k = mkCot(c3, -5, 'Reforma integral de baño', [svc.demolicion, svc.alicatado, svc.fontaneria], 'Borrador');
  k = mkCot(c2, -50, 'Local nuevo – reforma', [svc.electricidad, { ...svc.pintura, cantidad: 150 }], 'Enviado');
  k = mkCot(c1, -3, 'Pintura de fachada', [{ ...svc.pintura, concepto: 'Pintura de fachada (m²)', descripcion: 'Pintura pétrea, incluye andamio', cantidad: 200, valor: 14 }], 'Enviado'); k.vence = iso(27);

  // Documentos libres de ejemplo
  db.documentos.push({ id: uid('doc'), nombre: 'Contrato de obra.pdf', mime: 'application/pdf', categoria: 'Contrato', clienteId: c1.id, proyecto: 'Reforma de oficinas centrales', etiquetas: ['contrato', 'firmado'], versiones: [{ v: 1, fecha: new Date(now - 168 * 864e5).toISOString(), usuario: 'Administrador', size: 182000, data: '' }], creado: new Date(now - 168 * 864e5).toISOString() });
  db.documentos.push({ id: uid('doc'), nombre: 'Escrituras Café Origen.pdf', mime: 'application/pdf', categoria: 'Documento legal', clienteId: c2.id, proyecto: '', etiquetas: ['escrituras'], versiones: [{ v: 1, fecha: new Date(now - 150 * 864e5).toISOString(), usuario: 'Laura Gómez', size: 96000, data: '' }, { v: 2, fecha: new Date(now - 20 * 864e5).toISOString(), usuario: 'Laura Gómez', size: 98000, data: '' }], creado: new Date(now - 150 * 864e5).toISOString() });
  db.documentos.push({ id: uid('doc'), nombre: 'Foto final de obra local norte.jpg', mime: 'image/jpeg', categoria: 'Imagen', clienteId: c2.id, proyecto: 'Reforma de 3 locales', etiquetas: ['evidencia', 'entrega'], versiones: [{ v: 1, fecha: new Date(now - 82 * 864e5).toISOString(), usuario: 'Carlos Ruiz', size: 420000, data: '' }], creado: new Date(now - 82 * 864e5).toISOString() });

  // Auditoría inicial derivada
  const pushAu = (fecha, usuario, accion, entidad, ref, detalle) => db.auditoria.push({ id: uid('au'), fecha, usuario, rol: '', accion, entidad, ref, detalle, cambios: [] });
  db.clientes.forEach((c) => pushAu(c.creado, c.creadoPor, 'Crear', 'Cliente', c.codigo, c.razonSocial));
  db.cotizaciones.forEach((c) => pushAu(c.creado, c.creadoPor, 'Crear', 'Presupuesto', c.numero, c.proyecto));
  db.facturas.forEach((f) => pushAu(f.creado, f.creadoPor, 'Convertir', 'Factura', f.numero, 'Generada desde ' + getCot(f.cotizacionId).numero));
  db.abonos.forEach((a) => pushAu(a.creado, a.creadoPor, 'Registrar', 'Cobro', a.numero, `${a.concepto} · ${fmtMoney(a.valor)}`));
  db.auditoria.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return db;
}
