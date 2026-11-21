/* ==========================================================
   ZEWÁ · Finanzas
   Compras y gastos (facturas recibidas) · Proveedores · Empleados y nóminas
   · Tesorería y flujo de caja · Costes de obra · Impuestos (303, 111, 115,
   Seguridad Social, Sociedades) · Balance y cuenta de resultados.

   Todo se calcula a partir de los mismos datos: las facturas emitidas y los
   cobros (módulos existentes) + compras, nóminas y movimientos (aquí).
   Las cifras fiscales son orientativas: se revisan con la gestoría.
   ========================================================== */

/* ---------------- catálogos ---------------- */
const CATEGORIAS_GASTO = ['Materiales', 'Subcontratas', 'Alquiler de maquinaria', 'Alquiler de local', 'Suministros (luz, agua, gas)', 'Combustible', 'Vehículos y transporte', 'Herramientas y pequeño material', 'Gestión de residuos', 'Seguros', 'Asesoría y gestoría', 'Telefonía e internet', 'Publicidad y marketing', 'Formación y prevención de riesgos', 'Servicios bancarios', 'Otros gastos'];
const grupoGasto = (cat) => (cat === 'Materiales' ? 'mat' : cat === 'Subcontratas' ? 'sub' : 'otros');
const RETENCIONES = [['', 'Sin retención'], ['prof', 'Profesional / autónomo (modelo 111)'], ['alq', 'Alquiler de local (modelo 115)']];
const RET_PCT = { prof: 15, alq: 19 };
const CUENTAS_TES = ['Banco', 'Caja'];
const CAT_MOV = {
  Salida: ['Pago a proveedor', 'Nómina', 'Seguridad Social', 'Hacienda · IVA (303)', 'Hacienda · retenciones (111/115)', 'Impuesto sobre Sociedades', 'Cuota de préstamo', 'Comisiones bancarias', 'Otros gastos', 'Retirada de socios', 'Otros pagos (no es gasto)'],
  Entrada: ['Aportación de socios', 'Préstamo recibido', 'Subvención', 'Devolución de Hacienda', 'Intereses bancarios', 'Otros ingresos', 'Otros cobros (no es ingreso)'],
};
const MOV_GASTO = ['Comisiones bancarias', 'Otros gastos'];          // cuentan como gasto en la cuenta de resultados
const MOV_INGRESO = ['Subvención', 'Intereses bancarios', 'Otros ingresos'];
const PAGAS = ['14 pagas', '14 pagas prorrateadas', '12 pagas'];
const modoPagas = (p) => (/prorrate/i.test(p || '') ? '14p' : /^12/.test(p || '') ? '12' : '14');
const TIPOS_CONTRATO = ['Indefinido', 'Temporal', 'Fijo discontinuo', 'Formación y aprendizaje', 'Prácticas'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombrePeriodo = (p) => (p ? `${MESES[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : '—');
const r2 = (x) => Math.round((+x || 0) * 100) / 100;
const sumBy = (list, f) => list.reduce((s, x) => s + (+f(x) || 0), 0);
const finFiscal = (k) => (DB.empresa[k] === '' || DB.empresa[k] == null ? FISCAL_DEFAULT[k] : +DB.empresa[k]);

/* ---------------- accesos ---------------- */
const getProv = (id) => DB.proveedores.find((p) => p.id === id);
const getCompra = (id) => DB.compras.find((c) => c.id === id);
const getEmp = (id) => DB.empleados.find((e) => e.id === id);
const getNomina = (id) => DB.nominas.find((n) => n.id === id);
const getMov = (id) => DB.movimientos.find((m) => m.id === id);
const provNombre = (id) => getProv(id)?.razonSocial || '—';
const empNombre = (id) => getEmp(id)?.nombre || '—';
const movsActivos = () => DB.movimientos.filter((m) => m.estado !== 'Anulado');
const comprasActivas = () => DB.compras.filter((c) => c.estado !== 'Anulada');
const nominasActivas = () => DB.nominas.filter((n) => n.estado !== 'Anulada');
const facturasActivas = () => DB.facturas.filter((f) => f.estado !== 'Anulada');
/* Obras = presupuestos aceptados (aprobados o facturados) */
const obrasLista = (incluir) => DB.cotizaciones.filter((c) => ['Aprobado', 'Facturado'].includes(c.estado) || c.id === incluir);
const obraNombre = (id) => { const c = getCot(id); return c ? `${c.numero} · ${c.proyecto}` : 'Estructura / general'; };
const obraOptions = (sel) => `<option value="">— Estructura / general —</option>` + obrasLista(sel).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.numero)} · ${esc(c.proyecto)} · ${esc(clienteNombre(c.clienteId))}</option>`).join('');
const enRango = (fecha, [d, h]) => !!fecha && fecha >= d && fecha <= h;
const finDeMes = (periodo) => { const [y, m] = periodo.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const periodoDe = (iso) => iso.slice(0, 7);

/* ---------------- compras (facturas recibidas) ---------------- */
function compraCalc(c) {
  const t = docTotals(c.items || []);
  const retencion = c.retencionTipo ? r2(t.base * (+c.retencionPct || 0) / 100) : 0;
  const ivaDeducible = c.ivaNoDeducible ? 0 : t.iva;
  const coste = t.base + (c.ivaNoDeducible ? t.iva : 0);   // lo que cuesta realmente a la empresa
  const aPagar = r2(t.total - retencion);                   // la retención se ingresa en Hacienda, no al proveedor
  const pagos = DB.movimientos.filter((m) => m.compraId === c.id && m.estado !== 'Anulado');
  const pagado = sumBy(pagos, (m) => m.importe);
  return { ...t, retencion, ivaDeducible, coste, aPagar, pagos, pagado, pendiente: Math.max(0, r2(aPagar - pagado)) };
}
function compraEstado(c) {
  if (c.estado === 'Anulada') return 'Anulada';
  const r = compraCalc(c);
  if (r.pendiente <= 0.01) return 'Pagada';
  if (c.vence && c.vence < todayISO()) return 'Vencida';
  if (r.pagado > 0) return 'Pago parcial';
  return 'Pendiente';
}

/* ---------------- nóminas ----------------
   Devengos: salario base + complementos + horas extra + paga extra (o su prorrata) + dietas (no cotizan ni tributan).
   Base de cotización: salario base + complementos + horas extra + prorrata de pagas extra.
   Cuota obrera = base × % trabajador · IRPF = (devengos − dietas) × % · Líquido = devengos − deducciones.
   Coste empresa = devengos + cuota patronal (contingencias comunes, desempleo, FOGASA, FP, MEI + AT/EP).
   Simplificado: no aplica topes de base mínima/máxima ni tipos distintos para horas extra. */
function nominaCalc(n) {
  const v = (k) => +n[k] || 0;
  const devengado = r2(v('salarioBase') + v('complementos') + v('horasExtra') + v('pagaExtra') + v('dietas'));
  const baseCC = r2(v('salarioBase') + v('complementos') + v('horasExtra') + v('prorrataCC'));
  const baseIRPF = r2(devengado - v('dietas'));
  const ssTrab = r2(baseCC * v('ssTrabPct') / 100);
  const irpf = r2(baseIRPF * v('irpfPct') / 100);
  const deducciones = r2(ssTrab + irpf + v('otrasDeducciones'));
  const liquido = r2(devengado - deducciones);
  const ssEmp = r2(baseCC * (v('ssEmpPct') + v('ssAtPct')) / 100);
  return { devengado, baseCC, baseIRPF, ssTrab, irpf, deducciones, liquido, ssEmp, coste: r2(devengado + ssEmp), ssTotal: r2(ssTrab + ssEmp) };
}
/* Parte del coste de la nómina que se imputa a su obra (el resto es estructura general) */
const pctObra = (n) => (n.obraPct === '' || n.obraPct == null ? 100 : Math.min(100, Math.max(0, +n.obraPct)));
function nominaPagado(n) { return sumBy(DB.movimientos.filter((m) => m.nominaId === n.id && m.estado !== 'Anulado'), (m) => m.importe); }
function nominaEstado(n) {
  if (n.estado === 'Anulada') return 'Anulada';
  return nominaPagado(n) >= nominaCalc(n).liquido - 0.01 ? 'Pagada' : 'Pendiente de pago';
}
/* Nómina propuesta para un empleado y un mes, a partir de su ficha */
function nominaPropuesta(emp, periodo) {
  const anual = +emp.salarioBrutoAnual || 0, modo = modoPagas(emp.pagas), mes = +periodo.slice(5, 7);
  const base = modo === '12' ? anual / 12 : anual / 14;
  const prorrata = modo === '12' ? 0 : anual / 84;   // (2 pagas extra) / 12 meses
  return {
    periodo, empleadoId: emp.id, obraId: emp.obraId || '', obraPct: 100,
    salarioBase: r2(base), complementos: r2(+emp.complementos || 0), horasExtra: 0,
    pagaExtra: r2(modo === '14p' ? prorrata : modo === '14' && (mes === 6 || mes === 12) ? base : 0),
    dietas: 0, otrasDeducciones: 0, prorrataCC: r2(prorrata),
    irpfPct: emp.irpfPct === '' || emp.irpfPct == null ? finFiscal('irpfDefault') : +emp.irpfPct,
    ssTrabPct: finFiscal('ssTrabPct'), ssEmpPct: finFiscal('ssEmpPct'), ssAtPct: finFiscal('ssAtPct'),
    estado: 'Calculada',
  };
}

/* ---------------- tesorería ----------------
   Entradas: cobros de clientes (módulo Cobros) + movimientos de entrada.
   Salidas: movimientos de salida (pagos a proveedores, nóminas, SS, Hacienda…). */
function tesoreriaApuntes() {
  const cobros = DB.abonos.filter((a) => a.estado !== 'Anulado').map((a) => ({
    id: a.id, origen: 'cobro', numero: a.numero, fecha: a.fecha, tipo: 'Entrada', categoria: 'Cobro de cliente',
    concepto: `${a.concepto} · ${clienteNombre(a.clienteId)}`, importe: +a.valor || 0, cuenta: a.formaPago === 'Efectivo' ? 'Caja' : 'Banco',
    obraId: a.cotizacionId || '', href: '#/abonos/' + a.id, estado: a.estado,
  }));
  const movs = DB.movimientos.map((m) => ({ ...m, origen: 'mov', importe: +m.importe || 0, href: '' }));
  return [...cobros, ...movs].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
}
const signo = (a) => (a.tipo === 'Entrada' ? 1 : -1);
function saldoTesoreria(hasta = todayISO(), cuenta = null) {
  const desde = DB.empresa.tesFechaSaldo || FISCAL_DEFAULT.tesFechaSaldo;
  const ini = cuenta === 'Banco' ? finFiscal('tesSaldoInicial') : cuenta === 'Caja' ? finFiscal('tesSaldoCaja') : finFiscal('tesSaldoInicial') + finFiscal('tesSaldoCaja');
  return r2(ini + sumBy(tesoreriaApuntes().filter((a) => a.estado !== 'Anulado' && a.fecha >= desde && a.fecha <= hasta && (!cuenta || a.cuenta === cuenta)), (a) => signo(a) * a.importe));
}

/* ---------------- periodos fiscales ---------------- */
function rangoPeriodo(anio, t = 0) {
  if (!t) return [`${anio}-01-01`, `${anio}-12-31`];
  const m1 = (t - 1) * 3 + 1, m3 = m1 + 2;
  return [`${anio}-${String(m1).padStart(2, '0')}-01`, finDeMes(`${anio}-${String(m3).padStart(2, '0')}`)];
}
const mesesDeRango = ([d, h]) => { const out = []; let p = d.slice(0, 7); while (p <= h.slice(0, 7)) { out.push(p); const [y, m] = p.split('-').map(Number); p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; } return out; };
const plazoTrimestral = (anio, t) => (t === 4 ? `1 al 30 de enero de ${anio + 1}` : `1 al 20 de ${['abril', 'julio', 'octubre'][t - 1]} de ${anio}`);
const pagadoFiscal = (clave) => sumBy(movsActivos().filter((m) => m.periodoFiscal === clave), (m) => m.importe);

/* IVA por tipo (repercutido en facturas emitidas, soportado deducible en compras) */
function ivaPorTipo(docs) {
  const map = new Map();
  docs.forEach((d) => (d.items || []).forEach((it) => {
    const l = lineCalc(it), k = +it.iva || 0;
    const x = map.get(k) || { tipo: k, base: 0, cuota: 0 };
    x.base += l.base; x.cuota += l.iva; map.set(k, x);
  }));
  return [...map.values()].sort((a, b) => b.tipo - a.tipo).map((x) => ({ ...x, base: r2(x.base), cuota: r2(x.cuota) }));
}
function modelo303(rango) {
  const emitidas = facturasActivas().filter((f) => enRango(f.fecha, rango));
  const recibidas = comprasActivas().filter((c) => enRango(c.fecha, rango) && !c.ivaNoDeducible);
  const rep = ivaPorTipo(emitidas), sop = ivaPorTipo(recibidas);
  const devengado = r2(sumBy(rep, (x) => x.cuota)), deducible = r2(sumBy(sop, (x) => x.cuota));
  return { rep, sop, devengado, deducible, resultado: r2(devengado - deducible), nEmitidas: emitidas.length, nRecibidas: recibidas.length };
}
function modelo111(rango) {
  const meses = mesesDeRango(rango);
  const noms = nominasActivas().filter((n) => meses.includes(n.periodo));
  const prof = comprasActivas().filter((c) => c.retencionTipo === 'prof' && enRango(c.fecha, rango));
  const trabajo = { perceptores: new Set(noms.map((n) => n.empleadoId)).size, base: r2(sumBy(noms, (n) => nominaCalc(n).baseIRPF)), ret: r2(sumBy(noms, (n) => nominaCalc(n).irpf)) };
  const profesionales = { perceptores: new Set(prof.map((c) => c.proveedorId)).size, base: r2(sumBy(prof, (c) => compraCalc(c).base)), ret: r2(sumBy(prof, (c) => compraCalc(c).retencion)) };
  return { trabajo, profesionales, total: r2(trabajo.ret + profesionales.ret) };
}
function modelo115(rango) {
  const alq = comprasActivas().filter((c) => c.retencionTipo === 'alq' && enRango(c.fecha, rango));
  return { perceptores: new Set(alq.map((c) => c.proveedorId)).size, base: r2(sumBy(alq, (c) => compraCalc(c).base)), total: r2(sumBy(alq, (c) => compraCalc(c).retencion)) };
}
function seguridadSocialMes(periodo) {
  const noms = nominasActivas().filter((n) => n.periodo === periodo);
  const obrera = r2(sumBy(noms, (n) => nominaCalc(n).ssTrab)), patronal = r2(sumBy(noms, (n) => nominaCalc(n).ssEmp));
  return { periodo, trabajadores: noms.length, obrera, patronal, total: r2(obrera + patronal), pagado: r2(pagadoFiscal('SS-' + periodo)) };
}

/* ---------------- cuenta de resultados (criterio de devengo) ---------------- */
function cuentaResultados(rango) {
  const meses = mesesDeRango(rango);
  const ventas = r2(sumBy(facturasActivas().filter((f) => enRango(f.fecha, rango)), (f) => docTotals(f.items).base));
  const otrosIngresos = r2(sumBy(movsActivos().filter((m) => m.tipo === 'Entrada' && MOV_INGRESO.includes(m.categoria) && enRango(m.fecha, rango)), (m) => m.importe));
  const compras = comprasActivas().filter((c) => enRango(c.fecha, rango));
  const porCat = {};
  compras.forEach((c) => { const k = c.categoria || 'Otros gastos'; porCat[k] = (porCat[k] || 0) + compraCalc(c).coste; });
  movsActivos().filter((m) => m.tipo === 'Salida' && MOV_GASTO.includes(m.categoria) && enRango(m.fecha, rango)).forEach((m) => { porCat[m.categoria] = (porCat[m.categoria] || 0) + (+m.importe || 0); });
  const materiales = r2(porCat.Materiales || 0), subcontratas = r2(porCat.Subcontratas || 0);
  const otros = Object.entries(porCat).filter(([k]) => !['Materiales', 'Subcontratas'].includes(k)).map(([k, v]) => [k, r2(v)]).sort((a, b) => b[1] - a[1]);
  const noms = nominasActivas().filter((n) => meses.includes(n.periodo));
  const sueldos = r2(sumBy(noms, (n) => nominaCalc(n).devengado)), cargas = r2(sumBy(noms, (n) => nominaCalc(n).ssEmp));
  const aprov = r2(materiales + subcontratas), personal = r2(sueldos + cargas), otrosGastos = r2(sumBy(otros, (x) => x[1]));
  const margenBruto = r2(ventas - aprov);
  const explotacion = r2(ventas + otrosIngresos - aprov - personal - otrosGastos);
  const is = r2(Math.max(0, explotacion) * finFiscal('tipoIS') / 100);
  return { ventas, otrosIngresos, materiales, subcontratas, aprov, sueldos, cargas, personal, otros, otrosGastos, margenBruto, explotacion, is, neto: r2(explotacion - is) };
}

/* ---------------- balance de situación simplificado (a hoy) ---------------- */
function balanceSituacion() {
  const banco = saldoTesoreria(todayISO(), 'Banco'), caja = saldoTesoreria(todayISO(), 'Caja');
  const clientes = r2(sumBy(facturasActivas(), (f) => facturaResumen(f).saldo));
  const anticipos = r2(sumBy(DB.abonos.filter((a) => a.estado !== 'Anulado' && !a.facturaId), (a) => a.valor));
  const proveedores = r2(sumBy(comprasActivas(), (c) => compraCalc(c).pendiente));
  const nominasPend = r2(sumBy(nominasActivas(), (n) => Math.max(0, nominaCalc(n).liquido - nominaPagado(n))));
  const ss = r2(sumBy(nominasActivas(), (n) => nominaCalc(n).ssTotal) - sumBy(movsActivos().filter((m) => m.categoria === 'Seguridad Social'), (m) => m.importe));
  const ivaRep = sumBy(facturasActivas(), (f) => docTotals(f.items).iva);
  const ivaSop = sumBy(comprasActivas().filter((c) => !c.ivaNoDeducible), (c) => docTotals(c.items).iva);
  const iva = r2(ivaRep - ivaSop - sumBy(movsActivos().filter((m) => m.categoria === 'Hacienda · IVA (303)'), (m) => m.importe) + sumBy(movsActivos().filter((m) => m.categoria === 'Devolución de Hacienda'), (m) => m.importe));
  const ret = r2(sumBy(nominasActivas(), (n) => nominaCalc(n).irpf) + sumBy(comprasActivas(), (c) => compraCalc(c).retencion) - sumBy(movsActivos().filter((m) => m.categoria === 'Hacienda · retenciones (111/115)'), (m) => m.importe));
  const activo = [['Bancos', banco], ['Caja', caja], ['Clientes pendientes de cobro', clientes]];
  if (iva < 0) activo.push(['Hacienda Pública deudora por IVA', -iva]);
  const pasivo = [['Proveedores pendientes de pago', proveedores], ['Anticipos de clientes (cobrado sin factura)', anticipos], ['Nóminas pendientes de pago', nominasPend], ['Seguridad Social acreedora', Math.max(0, ss)], ['Hacienda Pública acreedora por retenciones', Math.max(0, ret)]];
  if (iva > 0) pasivo.splice(3, 0, ['Hacienda Pública acreedora por IVA', iva]);
  const tA = r2(sumBy(activo, (x) => x[1])), tP = r2(sumBy(pasivo, (x) => x[1]));
  return { activo, pasivo, tA, tP, neto: r2(tA - tP) };
}

/* ---------------- costes de obra ---------------- */
function invDeLinea(it) { return (it.invId && getInvItem(it.invId)) || DB.inventario.find((i) => norm(i.nombre) === norm(it.concepto)); }
function obraCostes(cot) {
  const compras = comprasActivas().filter((c) => c.obraId === cot.id);
  const noms = nominasActivas().filter((n) => n.obraId === cot.id);
  const movs = movsActivos().filter((m) => m.obraId === cot.id && m.tipo === 'Salida' && MOV_GASTO.includes(m.categoria));
  const g = { mat: 0, sub: 0, otros: 0 };
  compras.forEach((c) => { g[grupoGasto(c.categoria)] += compraCalc(c).coste; });
  g.otros += sumBy(movs, (m) => m.importe);
  const manoObra = r2(sumBy(noms, (n) => nominaCalc(n).coste * pctObra(n) / 100));
  const presupuestado = r2(docTotals(cot.items).base);
  const fac = cot.facturaId ? getFac(cot.facturaId) : null;
  const facturado = fac && fac.estado !== 'Anulada' ? r2(docTotals(fac.items).base) : 0;
  const ingreso = facturado || presupuestado;
  const costeEstimado = r2(sumBy(cot.items || [], (it) => { const inv = invDeLinea(it); return inv ? (+it.cantidad || 0) * (+inv.costo || 0) : 0; }));
  const coste = r2(g.mat + g.sub + g.otros + manoObra);
  const margen = r2(ingreso - coste);
  return { compras, noms, movs, materiales: r2(g.mat), subcontratas: r2(g.sub), otros: r2(g.otros), manoObra, presupuestado, facturado, ingreso, costeEstimado, coste, margen, pct: ingreso ? (margen / ingreso) * 100 : 0, cobrado: proyectoResumen(cot).abonado };
}

/* ---------------- coste de productos (inventario) desde las compras ---------------- */
function costesProducto(invId) {
  const lineas = [];
  comprasActivas().forEach((c) => (c.items || []).forEach((it) => { if (it.invId === invId) lineas.push({ c, it, l: lineCalc(it) }); }));
  lineas.sort((a, b) => a.c.fecha.localeCompare(b.c.fecha));
  const cant = sumBy(lineas, (x) => x.it.cantidad), importe = sumBy(lineas, (x) => x.l.base);
  const ult = lineas.at(-1);
  return { lineas, cantidad: cant, importe: r2(importe), medio: cant ? importe / cant : null, ultimo: ult ? ult.l.base / (+ult.it.cantidad || 1) : null, ultimaFecha: ult?.c.fecha || '' };
}

/* ==========================================================
   UI compartida
   ========================================================== */
const avisoFin = () => (Nube.finanzasListas ? '' : `<div class="card card-pad borr-aviso" style="margin-bottom:16px"><div>${ico('alert')}<div><b>Falta preparar la base de datos de finanzas</b><span>Para guardar compras, proveedores, nóminas y movimientos, el administrador debe ejecutar el archivo <b>supabase_finanzas.sql</b> en Supabase (SQL Editor). Mientras tanto, los informes se calculan solo con las facturas y los cobros.</span></div></div></div>`);
function finBloqueado(volver) {
  if (Nube.finanzasListas) return false;
  toast('Primero hay que ejecutar supabase_finanzas.sql en Supabase.', 'bad');
  if (volver) go(volver);
  return true;
}
const kpis = (list) => `<div class="grid g-kpi">${list.map(([l, v, i, sub, href]) => `<${href ? `a href="${href}" style="color:inherit"` : 'div'} class="card kpi"><span class="lbl"><span class="ico">${ico(i)}</span>${l}</span><span class="val">${v}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</${href ? 'a' : 'div'}>`).join('')}</div>`;
const tabsHTML = (list, on, base) => `<div class="tabs">${list.map(([k, l]) => `<button type="button" class="${on === k ? 'on' : ''}" data-go="${base}${k}">${l}</button>`).join('')}</div>`;
const bindTabs = (root = view) => $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
const opts = (list, sel) => list.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
const numIn = (name, val, extra = '') => `<input class="in" name="${name}" type="text" inputmode="decimal" data-num value="${esc(fmtInputNum(val))}" ${extra}>`;
const aniosDatos = () => {
  const ys = new Set([new Date().getFullYear()]);
  [...DB.facturas, ...DB.compras, ...DB.abonos, ...DB.movimientos].forEach((d) => d.fecha && ys.add(+d.fecha.slice(0, 4)));
  DB.nominas.forEach((n) => n.periodo && ys.add(+n.periodo.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
};
/* Selector de año (y trimestre) que navega a la misma ruta con ?anio=&t= */
function selPeriodo(anio, t, { trimestre = true, todoElAnio = true } = {}) {
  return `<div class="btn-row" style="align-items:center"><select class="in" id="pAnio" style="width:auto" aria-label="Año">${opts(aniosDatos(), anio)}</select>
    ${trimestre ? `<select class="in" id="pTri" style="width:auto" aria-label="Periodo">${opts([...(todoElAnio ? [[0, 'Año completo']] : []), [1, '1.er trimestre'], [2, '2.º trimestre'], [3, '3.er trimestre'], [4, '4.º trimestre']], t)}</select>` : ''}</div>`;
}
function bindPeriodo(ruta) {
  const nav = () => go(`${ruta}?anio=${$('#pAnio').value}${$('#pTri') ? '&t=' + $('#pTri').value : ''}`);
  $('#pAnio')?.addEventListener('change', nav); $('#pTri')?.addEventListener('change', nav);
}
const triActual = () => Math.ceil((new Date().getMonth() + 1) / 3);
const filaImporte = (l, v, o = {}) => `<tr><td style="${o.indent ? 'padding-left:28px;' : ''}${o.b ? 'font-weight:700' : ''}">${l}</td><td class="num" style="${o.b ? 'font-weight:700;' : ''}${o.color ? 'color:' + o.color : ''}">${v === null ? '' : fmtMoney(v)}</td></tr>`;

/* Editor de líneas reutilizable (compras): concepto, cantidad, precio, desc. %, IVA % */
function lineasEditor(el, items, onChange) {
  const vacia = () => ({ concepto: '', descripcion: '', cantidad: 1, valor: 0, desc: 0, iva: DB.empresa.ivaDefault ?? 21 });
  if (!items.length) items.push(vacia());
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl items"><thead><tr><th style="min-width:220px">Concepto</th><th class="num" style="width:80px">Cant.</th><th class="num" style="width:130px">Precio unit.</th><th class="num" style="width:76px">Desc %</th><th class="num" style="width:76px">IVA %</th><th class="num" style="width:120px">Base</th><th style="width:40px"></th></tr></thead><tbody></tbody></table></div>
    <div class="btn-row" style="padding:10px 14px"><button type="button" class="btn ghost sm" data-add>${ico('plus')}Línea en blanco</button><button type="button" class="btn sm" data-inv>${ico('tag')}Añadir desde inventario</button></div>`;
  const tb = $('tbody', el);
  const render = () => {
    tb.innerHTML = items.map((it, i) => `<tr data-i="${i}">
      <td><input data-f="concepto" value="${esc(it.concepto)}" placeholder="Concepto">${it.invId ? `<small class="muted" style="display:block;font-size:11px">Inventario ${esc(getInvItem(it.invId)?.codigo || '')}</small>` : ''}</td>
      <td class="num"><input data-f="cantidad" data-num inputmode="decimal" value="${fmtInputNum(it.cantidad)}"></td>
      <td class="num"><input data-f="valor" data-num inputmode="decimal" value="${fmtInputNum(it.valor)}"></td>
      <td class="num"><input data-f="desc" data-num inputmode="decimal" value="${fmtInputNum(it.desc)}"></td>
      <td class="num"><input data-f="iva" data-num inputmode="decimal" value="${fmtInputNum(it.iva)}" list="ivasC"></td>
      <td class="num" data-base>${fmtMoney(lineCalc(it).base)}</td>
      <td><button type="button" class="btn icon ghost sm" data-del title="Quitar línea">${ico('trash')}</button></td></tr>`).join('') + '<datalist id="ivasC"><option>0</option><option>4</option><option>10</option><option>21</option></datalist>';
    onChange?.();
  };
  tb.addEventListener('input', (e) => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    const it = items[+tr.dataset.i];
    it[f] = f === 'concepto' ? e.target.value : parseNum(e.target.value);
    $('[data-base]', tr).textContent = fmtMoney(lineCalc(it).base);
    onChange?.();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) { items.splice(+e.target.closest('tr').dataset.i, 1); if (!items.length) items.push(vacia()); render(); }
    if (e.target.closest('[data-add]')) { items.push(vacia()); render(); }
    if (e.target.closest('[data-inv]')) inventoryPicker((inv) => {
      if (items.length === 1 && !String(items[0].concepto).trim()) items.pop();
      items.push({ concepto: inv.nombre, descripcion: '', cantidad: 1, valor: +inv.costo || 0, desc: 0, iva: inv.iva ?? (DB.empresa.ivaDefault ?? 21), invId: inv.id });
      render();
    }, { precio: 'costo' });
  });
  render();
  return { render };
}

/* ==========================================================
   COMPRAS Y GASTOS · PROVEEDORES
   ========================================================== */
function compraColumns(conProv = true) {
  return [
    { k: 'numero', label: 'Registro', render: (c) => `<b>${c.numero}</b><div class="muted">Fra. ${esc(c.numeroFactura || '—')}</div>` },
    { k: 'fecha', label: 'Fecha', render: (c) => fmtDate(c.fecha) },
    ...(conProv ? [{ k: 'prov', label: 'Proveedor', sort: (c) => provNombre(c.proveedorId), render: (c) => `${esc(provNombre(c.proveedorId))}<div class="muted">${esc(getProv(c.proveedorId)?.nit || '')}</div>` }] : []),
    { k: 'categoria', label: 'Categoría / obra', render: (c) => `${esc(c.categoria || '—')}<div class="muted">${c.obraId ? esc(getCot(c.obraId)?.numero || '') + ' · ' + esc(getCot(c.obraId)?.proyecto || '') : 'Estructura / general'}</div>` },
    { k: 'base', label: 'Base', cls: 'num', sort: (c) => compraCalc(c).base, render: (c) => fmtMoney(compraCalc(c).base) },
    { k: 'iva', label: 'IVA', cls: 'num', sort: (c) => compraCalc(c).iva, render: (c) => fmtMoney(compraCalc(c).iva) },
    { k: 'total', label: 'Total', cls: 'num', sort: (c) => compraCalc(c).total, render: (c) => `<b>${fmtMoney(compraCalc(c).total)}</b>${compraCalc(c).retencion ? `<div class="muted">ret. −${fmtMoney(compraCalc(c).retencion)}</div>` : ''}` },
    { k: 'pend', label: 'Pendiente', cls: 'num', sort: (c) => compraCalc(c).pendiente, render: (c) => { const p = compraCalc(c).pendiente; return p > 0 && c.estado !== 'Anulada' ? `<b>${fmtMoney(p)}</b><div class="muted">vence ${fmtDate(c.vence)}</div>` : '<span class="muted">—</span>'; } },
    { k: 'estado', label: 'Estado', sort: (c) => compraEstado(c), render: (c) => badge(compraEstado(c)) },
  ];
}
function Compras(query = {}) {
  const tab = query.tab || 'facturas';
  const mes = todayISO().slice(0, 7), act = comprasActivas();
  const tri = rangoPeriodo(new Date().getFullYear(), triActual());
  const pend = act.filter((c) => compraCalc(c).pendiente > 0);
  const manage = puedeGestionar('compras');
  view.innerHTML = pageHead('Compras y gastos', 'Facturas de proveedores, tiques y gastos de la empresa y de cada obra',
    manage ? (tab === 'proveedores' ? `<a class="btn primary" href="#/compras/proveedores/nuevo">${ico('plus')}Nuevo proveedor</a>` : `<a class="btn" href="#/compras/proveedores/nuevo">${ico('plus')}Proveedor</a><a class="btn primary" href="#/compras/nueva">${ico('plus')}Registrar factura o gasto</a>`) : '') + avisoFin() +
    kpis([
      ['Gasto del mes (base)', fmtMoney(sumBy(act.filter((c) => c.fecha.startsWith(mes)), (c) => compraCalc(c).base)), 'invoice', nombrePeriodo(mes)],
      ['Pendiente de pago', fmtMoney(sumBy(pend, (c) => compraCalc(c).pendiente)), 'alert', `${pend.length} factura(s)`],
      ['Vencido sin pagar', fmtMoney(sumBy(pend.filter((c) => c.vence && c.vence < todayISO()), (c) => compraCalc(c).pendiente)), 'clock', 'Revisar con proveedores'],
      ['IVA soportado del trimestre', fmtMoney(sumBy(act.filter((c) => enRango(c.fecha, tri) && !c.ivaNoDeducible), (c) => compraCalc(c).iva)), 'wallet', `${triActual()}.º trimestre · deducible`],
    ]) +
    `<div class="card mt">${tabsHTML([['facturas', `Facturas recibidas y gastos (${DB.compras.length})`], ['proveedores', `Proveedores (${DB.proveedores.length})`]], tab, '/compras?tab=')}<div id="tbl"></div></div>`;
  bindTabs();
  if (tab === 'proveedores') {
    DataTable($('#tbl'), {
      rows: () => DB.proveedores.map((p) => { const cs = comprasActivas().filter((c) => c.proveedorId === p.id); return { ...p, _t: sumBy(cs, (c) => compraCalc(c).base), _p: sumBy(cs, (c) => compraCalc(c).pendiente) }; }),
      placeholder: 'Nombre, NIF, categoría…', searchText: (p) => [p.codigo, p.razonSocial, p.nit, p.categoria, p.email, p.telefono, p.ciudad].join(' '),
      sort: 'razonSocial', dir: 1, csv: 'proveedores',
      columns: [
        { k: 'codigo', label: 'Código', render: (p) => `<span class="muted">${esc(p.codigo)}</span>` },
        { k: 'razonSocial', label: 'Proveedor', render: (p) => `<div class="strong">${esc(p.razonSocial)}</div><div class="muted">${esc(p.tipo || '')}</div>` },
        { k: 'nit', label: 'NIF / CIF' },
        { k: 'categoria', label: 'Categoría habitual' },
        { k: 'email', label: 'Contacto', render: (p) => `${esc(p.telefono || '')}<div class="muted">${esc(p.email || '')}</div>` },
        { k: '_t', label: 'Comprado (base)', cls: 'num', render: (p) => fmtMoney(p._t) },
        { k: '_p', label: 'Pendiente', cls: 'num', render: (p) => (p._p > 0 ? `<b style="color:var(--warn)">${fmtMoney(p._p)}</b>` : '<span class="muted">Al día</span>') },
      ],
      onRow: (p) => go('/compras/proveedores/' + p.id),
      empty: 'Añade a tus proveedores (almacenes de materiales, subcontratas, gestoría…) para registrar sus facturas.',
    });
    return;
  }
  DataTable($('#tbl'), {
    rows: () => DB.compras, placeholder: 'Proveedor, nº de factura, concepto, obra…',
    searchText: (c) => [c.numero, c.numeroFactura, provNombre(c.proveedorId), getProv(c.proveedorId)?.nit, c.categoria, getCot(c.obraId)?.proyecto, getCot(c.obraId)?.numero, ...(c.items || []).map((i) => i.concepto)].join(' '),
    chips: [{ k: 'all', label: 'Todas' }, { k: 'pend', label: 'Pendientes de pago', test: (c) => ['Pendiente', 'Pago parcial', 'Vencida'].includes(compraEstado(c)) }, { k: 'Vencida', label: 'Vencidas', test: (c) => compraEstado(c) === 'Vencida' }, { k: 'Pagada', label: 'Pagadas', test: (c) => compraEstado(c) === 'Pagada' }, { k: 'obra', label: 'De obra', test: (c) => !!c.obraId }, { k: 'gen', label: 'Generales', test: (c) => !c.obraId }],
    sort: 'fecha', csv: 'compras', columns: compraColumns(),
    footer: (r) => { const v = r.filter((c) => c.estado !== 'Anulada'); return `Base ${fmtMoney(sumBy(v, (c) => compraCalc(c).base))} · IVA ${fmtMoney(sumBy(v, (c) => compraCalc(c).iva))} · Pendiente ${fmtMoney(sumBy(v, (c) => compraCalc(c).pendiente))}`; },
    onRow: (c) => go('/compras/' + c.id),
    empty: 'Aún no hay compras registradas.',
  });
  if (query.f) $(`[data-chip="${query.f}"]`)?.click();
}

function CompraForm(id, query = {}) {
  if (denyGestionar('compras', id ? '/compras/' + id : '/compras') || finBloqueado(id ? '/compras/' + id : '/compras')) return;
  const existing = id ? getCompra(id) : null;
  if (id && !existing) return notFound();
  if (existing?.estado === 'Anulada') { toast('No se puede editar una compra anulada', 'bad'); return go('/compras/' + id); }
  const today = todayISO();
  const prov0 = getProv(query.prov);
  const d = existing ? clone(existing) : { numero: '(automático)', numeroFactura: '', fecha: today, vence: addDays(today, prov0?.diasPago === '' || prov0?.diasPago == null ? 30 : +prov0.diasPago), proveedorId: prov0?.id || '', categoria: prov0?.categoria || 'Materiales', obraId: query.obra || '', items: [], retencionTipo: prov0?.retencionTipo || '', retencionPct: RET_PCT[prov0?.retencionTipo] || 0, ivaNoDeducible: false, formaPago: 'Transferencia', observaciones: '', estado: 'Registrada' };
  const items = d.items;
  view.innerHTML = pageHead(existing ? `Editar ${d.numero}` : 'Registrar factura recibida o gasto', 'Factura de proveedor, tique o gasto. Se imputa a una obra o a gastos generales', '', `<a href="#/compras">Compras y gastos</a> / ${existing ? d.numero : 'Nueva'}`) +
    `<form id="frm" novalidate class="grid">
      <div class="card card-pad"><div class="form-grid">
        <div class="section-title">Documento</div>
        <div class="f s6"><label>Proveedor <span class="req">*</span></label><select class="in" name="proveedorId"><option value="">Selecciona un proveedor…</option>${DB.proveedores.map((p) => `<option value="${p.id}" ${p.id === d.proveedorId ? 'selected' : ''}>${esc(p.razonSocial)} · ${esc(p.nit || '')}</option>`).join('')}</select><span class="hint"><a href="#" id="newProv">+ Crear proveedor nuevo</a></span></div>
        <div class="f s3"><label>Nº de factura del proveedor <span class="req">*</span></label><input class="in" name="numeroFactura" value="${esc(d.numeroFactura)}" placeholder="Ej. A-2026/0153"></div>
        <div class="f s3"><label>Registro interno</label><input class="in" value="${esc(d.numero)}" readonly></div>
        <div class="f s3"><label>Fecha de factura <span class="req">*</span></label><input class="in" type="date" name="fecha" value="${d.fecha}"></div>
        <div class="f s3"><label>Vencimiento de pago</label><input class="in" type="date" name="vence" value="${d.vence || ''}"></div>
        <div class="f s3"><label>Categoría de gasto</label><select class="in" name="categoria">${opts(CATEGORIAS_GASTO, d.categoria)}</select></div>
        <div class="f s3"><label>Forma de pago</label><select class="in" name="formaPago">${opts(FORMAS_PAGO, d.formaPago)}</select></div>
        <div class="f s12"><label>Obra a la que se imputa el gasto</label><select class="in" name="obraId">${obraOptions(d.obraId)}</select><span class="hint">Los gastos imputados a una obra se descuentan de su margen en «Costes de obra».</span></div>
      </div></div>
      <div class="card"><div class="card-head"><div><h3>Detalle</h3><p>Precios sin IVA. Los productos del inventario guardan su coste de compra</p></div></div><div id="lineas"></div>
        <div class="card-pad" style="padding-top:0"><div class="form-grid">
          <div class="f s4"><label>Retención IRPF</label><select class="in" name="retencionTipo">${opts(RETENCIONES, d.retencionTipo)}</select></div>
          <div class="f s2"><label>% retención</label>${numIn('retencionPct', d.retencionPct)}</div>
          <div class="f s6" style="justify-content:flex-end"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="ivaNoDeducible" ${d.ivaNoDeducible ? 'checked' : ''}> IVA no deducible (tique sin datos fiscales, gasto no afecto…)</label></div>
        </div><div class="totals" id="tot"></div></div></div>
      <div class="card card-pad"><div class="form-grid">
        ${existing ? '' : `<div class="section-title">Pago</div>
        <div class="f s6"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="pagada"> Ya está pagada: registrar el pago en tesorería</label></div>
        <div class="f s3"><label>Fecha de pago</label><input class="in" type="date" name="fechaPago" value="${today}"></div>
        <div class="f s3"><label>Cuenta</label><select class="in" name="cuentaPago">${opts(CUENTAS_TES)}</select></div>`}
        ${puedeGestionar('inventario') ? `<div class="f s12"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="actCoste" checked> Actualizar el coste de los productos del inventario con el precio de esta compra</label></div>` : ''}
        <div class="f s12"><label>Observaciones</label><textarea class="in" name="observaciones">${esc(d.observaciones || '')}</textarea></div>
      </div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="${existing ? '#/compras/' + id : '#/compras'}">Cancelar</a><button class="btn primary">${ico('check')}${existing ? 'Guardar cambios' : 'Registrar'}</button></div></div>
    </form>`;
  const form = $('#frm');
  const tot = () => {
    const c = compraCalc({ items, retencionTipo: form.retencionTipo.value, retencionPct: parseNum(form.retencionPct.value), ivaNoDeducible: form.ivaNoDeducible.checked, id: existing?.id || '__nueva' });
    $('#tot').innerHTML = `<div><span>Base imponible</span><span>${fmtMoney(c.base)}</span></div><div><span>IVA${form.ivaNoDeducible.checked ? ' (no deducible)' : ''}</span><span>${fmtMoney(c.iva)}</span></div>
      <div class="grand"><span>Total factura</span><span>${fmtMoney(c.total)}</span></div>${c.retencion ? `<div><span>Retención IRPF (se ingresa en Hacienda)</span><span>− ${fmtMoney(c.retencion)}</span></div><div style="font-weight:700"><span>A pagar al proveedor</span><span>${fmtMoney(c.aPagar)}</span></div>` : ''}`;
  };
  lineasEditor($('#lineas'), items, tot);
  form.retencionPct.addEventListener('input', tot);
  form.retencionTipo.addEventListener('change', () => { form.retencionPct.value = fmtInputNum(RET_PCT[form.retencionTipo.value] || 0); tot(); });
  form.ivaNoDeducible.addEventListener('change', tot);
  form.proveedorId.addEventListener('change', () => {
    const p = getProv(form.proveedorId.value); if (!p || existing) return;
    if (p.categoria) form.categoria.value = p.categoria;
    form.retencionTipo.value = p.retencionTipo || ''; form.retencionPct.value = fmtInputNum(RET_PCT[p.retencionTipo] || 0);
    if (p.diasPago !== '' && p.diasPago != null) form.vence.value = addDays(form.fecha.value || today, +p.diasPago || 0);
    tot();
  });
  $('#newProv').addEventListener('click', (e) => { e.preventDefault(); proveedorRapido((p) => { form.proveedorId.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.razonSocial)} · ${esc(p.nit)}</option>`); form.proveedorId.value = p.id; form.proveedorId.dispatchEvent(new Event('change')); }); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    const bad = ['proveedorId', 'numeroFactura', 'fecha'].filter((k) => !String(v[k] || '').trim());
    if (v.vence && v.vence < v.fecha) bad.push('vence');
    bad.forEach((k) => form.elements[k].classList.add('invalid'));
    if (bad.length) return toast(bad.includes('vence') && v.vence ? 'El vencimiento no puede ser anterior a la fecha.' : 'Completa los campos obligatorios.', 'bad');
    const lines = items.filter((it) => String(it.concepto).trim());
    if (!lines.length || docTotals(lines).total <= 0) return toast('Añade al menos una línea con concepto e importe.', 'bad');
    const dup = DB.compras.find((c) => c.id !== id && c.estado !== 'Anulada' && c.proveedorId === v.proveedorId && norm(c.numeroFactura) === norm(v.numeroFactura.trim()));
    if (dup) { form.numeroFactura.classList.add('invalid'); return toast(`Esa factura ya está registrada (${dup.numero}).`, 'bad'); }
    const data = { proveedorId: v.proveedorId, numeroFactura: v.numeroFactura.trim(), fecha: v.fecha, vence: v.vence || v.fecha, categoria: v.categoria, obraId: v.obraId || '', formaPago: v.formaPago, retencionTipo: v.retencionTipo, retencionPct: v.retencionTipo ? +v.retencionPct || 0 : 0, ivaNoDeducible: form.ivaNoDeducible.checked, observaciones: v.observaciones || '', items: lines.map((it) => ({ ...it })) };
    let c;
    if (existing) {
      const pagadoAntes = compraCalc(existing).pagado;
      if (compraCalc({ ...existing, ...data }).aPagar < pagadoAntes - 0.01) return toast(`El nuevo importe a pagar es menor que lo ya pagado (${fmtMoney(pagadoAntes)}).`, 'bad');
      const before = clone(existing); Object.assign(existing, data, { actualizado: new Date().toISOString() }); c = existing;
      audit('Editar', 'Compra', c.numero, `${provNombre(c.proveedorId)} · Fra. ${c.numeroFactura}`, diffObjects(before, c));
    } else {
      c = { id: uid('com'), numero: Store.nextNumber('COM'), ...data, estado: 'Registrada', creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      DB.compras.push(c);
      audit('Crear', 'Compra', c.numero, `${provNombre(c.proveedorId)} · Fra. ${c.numeroFactura} · ${fmtMoney(compraCalc(c).total)}`);
      if (form.pagada?.checked) registrarPagoCompra(c, compraCalc(c).aPagar, form.fechaPago.value || c.fecha, form.cuentaPago.value, '');
    }
    if (form.actCoste?.checked) actualizarCostesInventario(c);
    persist(); toast(existing ? 'Cambios guardados' : `Compra ${c.numero} registrada`); go('/compras/' + c.id);
  });
}
/* Pasa al inventario el último precio de compra (base unitaria tras descuento) */
function actualizarCostesInventario(c) {
  (c.items || []).forEach((it) => {
    const inv = it.invId && getInvItem(it.invId); if (!inv || !(+it.cantidad > 0)) return;
    const nuevo = r2(lineCalc(it).base / +it.cantidad);
    if (Math.abs((+inv.costo || 0) - nuevo) < 0.005) return;
    audit('Editar', 'Ítem de inventario', inv.codigo, `Coste ${fmtMoney(inv.costo)} → ${fmtMoney(nuevo)} (compra ${c.numero})`, [{ campo: 'costo', antes: inv.costo, despues: nuevo }]);
    inv.costo = nuevo; inv.actualizado = new Date().toISOString();
  });
}
function nuevoMovimiento(m) {
  const n = { id: uid('mov'), numero: Store.nextNumber('MOV'), compraId: '', nominaId: '', obraId: '', referencia: '', cuenta: 'Banco', estado: 'Aplicado', creado: new Date().toISOString(), creadoPor: Store.user().nombre, ...m, importe: r2(m.importe) };
  DB.movimientos.push(n);
  audit('Registrar', n.tipo === 'Entrada' ? 'Entrada' : 'Pago', n.numero, `${n.categoria} · ${n.concepto} · ${fmtMoney(n.importe)}`);
  return n;
}
function registrarPagoCompra(c, importe, fecha, cuenta, referencia) {
  return nuevoMovimiento({ fecha, tipo: 'Salida', categoria: 'Pago a proveedor', concepto: `Pago ${provNombre(c.proveedorId)} · Fra. ${c.numeroFactura}`, importe, cuenta, compraId: c.id, obraId: c.obraId || '', referencia });
}
function pagoCompraDialog(c) {
  if (finBloqueado()) return;
  const r = compraCalc(c);
  modal({
    title: `Pagar ${c.numero}`, okText: 'Registrar pago',
    body: `<p class="hint" style="margin-top:0">${esc(provNombre(c.proveedorId))} · Fra. ${esc(c.numeroFactura)} · pendiente <b>${fmtMoney(r.pendiente)}</b></p><div class="form-grid">
      <div class="f s6"><label>Fecha</label><input class="in" type="date" name="fecha" value="${todayISO()}"></div>
      <div class="f s6"><label>Importe</label>${numIn('importe', r.pendiente)}</div>
      <div class="f s6"><label>Cuenta</label><select class="in" name="cuenta">${opts(CUENTAS_TES, c.formaPago === 'Efectivo' ? 'Caja' : 'Banco')}</select></div>
      <div class="f s6"><label>Referencia</label><input class="in" name="ref" placeholder="Nº de operación"></div></div>`,
    onOk: (ov) => {
      const imp = parseNum($('[name=importe]', ov).value);
      if (!(imp > 0)) { toast('Indica un importe mayor que cero.', 'bad'); return false; }
      if (imp > r.pendiente + 0.01) { toast(`El importe supera lo pendiente (${fmtMoney(r.pendiente)}).`, 'bad'); return false; }
      registrarPagoCompra(c, imp, $('[name=fecha]', ov).value || todayISO(), $('[name=cuenta]', ov).value, $('[name=ref]', ov).value.trim());
      persist(); toast('Pago registrado'); route();
    },
  });
}
function CompraDetalle(id) {
  const c = getCompra(id); if (!c) return notFound();
  const r = compraCalc(c), manage = puedeGestionar('compras'), est = compraEstado(c), p = getProv(c.proveedorId);
  view.innerHTML = pageHead(`${c.numero} ${badge(est)}`, `${esc(provNombre(c.proveedorId))} · Fra. ${esc(c.numeroFactura)} · ${fmtDate(c.fecha)}`,
    manage && c.estado !== 'Anulada' ? `${r.pendiente > 0 ? `<button class="btn primary" id="pagar">${ico('cash')}Registrar pago</button>` : ''}<a class="btn" href="#/compras/${id}/editar">${ico('edit')}Editar</a><button class="btn" id="dup">${ico('copy')}Duplicar</button><button class="btn danger" id="anular">${ico('x')}Anular</button>` : '',
    `<a href="#/compras">Compras y gastos</a> / ${c.numero}`) + avisoFin() +
    kpis([['Total factura', fmtMoney(r.total), 'invoice', `Base ${fmtMoney(r.base)} · IVA ${fmtMoney(r.iva)}`], ['A pagar al proveedor', fmtMoney(r.aPagar), 'wallet', r.retencion ? `Retención ${fmtMoney(r.retencion)}` : 'Sin retención'], ['Pagado', fmtMoney(r.pagado), 'check', `${r.pagos.length} pago(s)`], ['Pendiente', fmtMoney(r.pendiente), 'alert', `Vence ${fmtDate(c.vence)}`]]) +
    `<div class="grid g-main mt"><div class="card"><div class="card-head"><h3>Detalle</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Desc.</th><th class="num">IVA</th><th class="num">Base</th></tr></thead><tbody>
      ${(c.items || []).map((it) => `<tr><td><b>${esc(it.concepto)}</b>${it.invId ? `<div class="muted">${esc(getInvItem(it.invId)?.codigo || '')} · inventario</div>` : ''}</td><td class="num">${fmtNumero(it.cantidad, 0, 3)}</td><td class="num">${fmtMoney(it.valor)}</td><td class="num">${fmtPct(it.desc || 0)}</td><td class="num">${fmtPct(it.iva || 0)}</td><td class="num">${fmtMoney(lineCalc(it).base)}</td></tr>`).join('')}
      </tbody></table></div><div class="totals"><div><span>Base imponible</span><span>${fmtMoney(r.base)}</span></div><div><span>IVA${c.ivaNoDeducible ? ' (no deducible)' : ''}</span><span>${fmtMoney(r.iva)}</span></div><div class="grand"><span>Total</span><span>${fmtMoney(r.total)}</span></div>${r.retencion ? `<div><span>Retención (${fmtPct(c.retencionPct)})</span><span>− ${fmtMoney(r.retencion)}</span></div>` : ''}</div></div>
      <div class="grid" style="align-content:start">
        <div class="card card-pad"><div class="kv" style="grid-template-columns:1fr 1fr">${[['Proveedor', p ? `<a href="#/compras/proveedores/${p.id}">${esc(p.razonSocial)}</a>` : '—'], ['NIF', esc(p?.nit || '—')], ['Categoría', esc(c.categoria)], ['Obra', c.obraId ? `<a href="#/obras/${c.obraId}">${esc(obraNombre(c.obraId))}</a>` : 'Estructura / general'], ['Forma de pago', esc(c.formaPago || '—')], ['Registrado por', esc(c.creadoPor || '')]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join('')}</div>${c.observaciones ? `<p class="hint">${esc(c.observaciones)}</p>` : ''}</div>
        <div class="card"><div class="card-head"><h3>Pagos</h3></div><div class="card-pad" style="padding-top:4px">${r.pagos.length ? `<table class="mini-tbl">${r.pagos.map((m) => `<tr><td>${fmtDate(m.fecha)}<div class="muted">${esc(m.numero)} · ${esc(m.cuenta)}</div></td><td class="num">${fmtMoney(m.importe)}</td></tr>`).join('')}</table>` : emptyState('Sin pagos registrados', 'wallet')}</div></div>
        <div class="card"><div class="card-head"><h3>Historial</h3></div><div class="card-pad">${historyFor(c.numero)}</div></div>
      </div></div>`;
  $('#pagar')?.addEventListener('click', () => pagoCompraDialog(c));
  $('#dup')?.addEventListener('click', () => {
    if (finBloqueado()) return;
    const n = { ...clone(c), id: uid('com'), numero: Store.nextNumber('COM'), numeroFactura: c.numeroFactura + ' (copia)', fecha: todayISO(), vence: addDays(todayISO(), 30), creado: new Date().toISOString(), creadoPor: Store.user().nombre, actualizado: '' };
    DB.compras.push(n); audit('Duplicar', 'Compra', n.numero, 'Copia de ' + c.numero); persist(); toast('Compra duplicada: revisa el nº de factura'); go(`/compras/${n.id}/editar`);
  });
  $('#anular')?.addEventListener('click', async () => {
    if (r.pagado > 0) return toast('Tiene pagos registrados: anúlalos primero en Tesorería.', 'bad');
    if (!(await confirmBox('Anular compra', `La compra ${c.numero} dejará de contar en gastos, IVA y costes de obra.`, 'Anular'))) return;
    c.estado = 'Anulada'; audit('Anular', 'Compra', c.numero, provNombre(c.proveedorId)); persist(); toast('Compra anulada'); route();
  });
}

const PROVEEDOR_FIELDS = [
  ['sec', 'Identificación'],
  ['codigo', 'Código', 's3', { readonly: true }],
  ['tipo', 'Tipo', 's3', { options: ['Empresa', 'Autónomo', 'Organismo público', 'Particular'] }],
  ['nit', 'NIF / CIF', 's3', { req: 1 }],
  ['categoria', 'Categoría de gasto habitual', 's3', { options: CATEGORIAS_GASTO }],
  ['razonSocial', 'Razón social', 's12', { req: 1 }],
  ['sec', 'Contacto'],
  ['contacto', 'Persona de contacto', 's4'],
  ['telefono', 'Teléfono', 's4'],
  ['email', 'Correo electrónico', 's4', { type: 'email' }],
  ['direccion', 'Dirección', 's6'],
  ['codigoPostal', 'Código postal', 's2'],
  ['ciudad', 'Localidad', 's2'],
  ['provincia', 'Provincia', 's2'],
  ['sec', 'Condiciones de pago'],
  ['diasPago', 'Plazo de pago (días)', 's3', { type: 'number' }],
  ['iban', 'IBAN del proveedor', 's5'],
  ['retencionTipo', 'Retención IRPF habitual', 's4', { options: RETENCIONES.map((x) => x[1]) }],
  ['observaciones', 'Observaciones', 's12', { textarea: 1 }],
];
const retDeLabel = (l) => (RETENCIONES.find((x) => x[1] === l) || RETENCIONES.find((x) => x[0] === l) || RETENCIONES[0])[0];
const retLabel = (k) => (RETENCIONES.find((x) => x[0] === k) || RETENCIONES[0])[1];
function ProveedorForm(id) {
  if (denyGestionar('compras', id ? '/compras/proveedores/' + id : '/compras?tab=proveedores') || finBloqueado(id ? '/compras/proveedores/' + id : '/compras?tab=proveedores')) return;
  const p = id ? getProv(id) : { codigo: '(se asigna al guardar)', tipo: 'Empresa', categoria: 'Materiales', diasPago: 30, retencionTipo: '' };
  if (id && !p) return notFound();
  const vals = { ...p, retencionTipo: retLabel(p.retencionTipo) };
  view.innerHTML = pageHead(id ? 'Editar proveedor' : 'Nuevo proveedor', 'Los campos con * son obligatorios', '', `<a href="#/compras?tab=proveedores">Proveedores</a> / ${id ? esc(p.codigo) : 'Nuevo'}`) +
    `<form class="card card-pad" id="frm" novalidate><div class="form-grid">${PROVEEDOR_FIELDS.map((f) => fieldHTML(f, vals[f[0]])).join('')}</div>
     <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="${id ? '#/compras/proveedores/' + id : '#/compras?tab=proveedores'}">Cancelar</a><button class="btn primary">${ico('check')}Guardar proveedor</button></div></form>`;
  const form = $('#frm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateRequired(form, PROVEEDOR_FIELDS)) return toast('Revisa los campos obligatorios marcados en rojo.', 'bad');
    const v = formValues(form); delete v.codigo;
    v.retencionTipo = retDeLabel(v.retencionTipo);
    const r = guardarProveedor(v, id);
    if (!r) { form.nit.classList.add('invalid'); return; }
    persist(); toast('Proveedor guardado'); go('/compras/proveedores/' + r.id);
  });
}
function guardarProveedor(v, id) {
  const nif = String(v.nit || '').replace(/[\s.-]/g, '').toUpperCase();
  const dup = nif && DB.proveedores.find((x) => x.id !== id && String(x.nit || '').replace(/[\s.-]/g, '').toUpperCase() === nif);
  if (dup) { toast(`Ese NIF ya existe: ${dup.razonSocial}`, 'bad'); return null; }
  v.nit = nif;
  if (id) {
    const p = getProv(id), before = clone(p);
    Object.assign(p, v, { actualizado: new Date().toISOString() });
    audit('Editar', 'Proveedor', p.codigo, p.razonSocial, diffObjects(before, p));
    return p;
  }
  const n = { id: uid('prv'), codigo: Store.nextNumber('PRV'), ...v, creado: new Date().toISOString(), creadoPor: Store.user().nombre };
  DB.proveedores.push(n); audit('Crear', 'Proveedor', n.codigo, n.razonSocial);
  return n;
}
function proveedorRapido(done) {
  if (finBloqueado()) return;
  modal({
    title: 'Nuevo proveedor', okText: 'Crear',
    body: `<div class="form-grid"><div class="f s12"><label>Razón social <span class="req">*</span></label><input class="in" name="razonSocial"></div>
      <div class="f s6"><label>NIF / CIF <span class="req">*</span></label><input class="in" name="nit"></div>
      <div class="f s6"><label>Tipo</label><select class="in" name="tipo">${opts(['Empresa', 'Autónomo', 'Organismo público', 'Particular'])}</select></div>
      <div class="f s12"><label>Categoría habitual</label><select class="in" name="categoria">${opts(CATEGORIAS_GASTO)}</select></div></div>`,
    onOk: (ov) => {
      const v = { razonSocial: $('[name=razonSocial]', ov).value.trim(), nit: $('[name=nit]', ov).value.trim(), tipo: $('[name=tipo]', ov).value, categoria: $('[name=categoria]', ov).value, diasPago: 30, retencionTipo: '' };
      if (!v.razonSocial || !v.nit) { toast('Indica razón social y NIF.', 'bad'); return false; }
      const p = guardarProveedor(v, null); if (!p) return false;
      persist(); toast('Proveedor creado'); done(p);
    },
  });
}
function ProveedorDetalle(id) {
  const p = getProv(id); if (!p) return notFound();
  const cs = DB.compras.filter((c) => c.proveedorId === id), act = cs.filter((c) => c.estado !== 'Anulada');
  view.innerHTML = pageHead(esc(p.razonSocial), `${esc(p.codigo)} · NIF ${esc(p.nit || '—')} · ${esc(p.tipo || '')}`,
    puedeGestionar('compras') ? `<a class="btn" href="#/compras/proveedores/${id}/editar">${ico('edit')}Editar</a>${!cs.length ? `<button class="btn danger" id="del">${ico('trash')}Eliminar</button>` : ''}<a class="btn primary" href="#/compras/nueva?prov=${id}">${ico('plus')}Registrar factura</a>` : '',
    `<a href="#/compras?tab=proveedores">Proveedores</a> / ${esc(p.codigo)}`) + avisoFin() +
    kpis([['Facturas', act.length, 'invoice'], ['Comprado (base)', fmtMoney(sumBy(act, (c) => compraCalc(c).base)), 'trend'], ['Pagado', fmtMoney(sumBy(act, (c) => compraCalc(c).pagado)), 'wallet'], ['Pendiente', fmtMoney(sumBy(act, (c) => compraCalc(c).pendiente)), 'alert']]) +
    `<div class="card mt card-pad"><div class="kv">${[['Categoría habitual', p.categoria], ['Contacto', p.contacto], ['Teléfono', p.telefono], ['Correo', p.email], ['Dirección', [p.direccion, p.codigoPostal, p.ciudad, p.provincia].filter(Boolean).join(', ')], ['Plazo de pago', p.diasPago !== '' && p.diasPago != null ? p.diasPago + ' días' : ''], ['IBAN', p.iban], ['Retención habitual', retLabel(p.retencionTipo)]].map(([k, v]) => `<div><small>${k}</small><span>${esc(v || '—')}</span></div>`).join('')}</div>${p.observaciones ? `<p class="hint">${esc(p.observaciones)}</p>` : ''}</div>
    <div class="card mt"><div class="card-head"><h3>Facturas del proveedor</h3></div><div id="tbl"></div></div>`;
  DataTable($('#tbl'), { rows: () => cs, searchText: (c) => c.numero + c.numeroFactura + c.categoria, sort: 'fecha', columns: compraColumns(false), onRow: (c) => go('/compras/' + c.id), empty: 'Sin facturas registradas.' });
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmBox('Eliminar proveedor', `Se eliminará ${esc(p.razonSocial)}. No tiene facturas registradas.`, 'Eliminar'))) return;
    DB.proveedores = DB.proveedores.filter((x) => x.id !== id); audit('Eliminar', 'Proveedor', p.codigo, p.razonSocial); persist(); toast('Proveedor eliminado'); go('/compras?tab=proveedores');
  });
}

/* ==========================================================
   NÓMINAS · EMPLEADOS
   ========================================================== */
function Nominas(query = {}) {
  const tab = query.tab || 'nominas';
  const periodo = /^\d{4}-\d{2}$/.test(query.p || '') ? query.p : todayISO().slice(0, 7);
  const manage = puedeGestionar('nominas');
  const delMes = DB.nominas.filter((n) => n.periodo === periodo);
  const act = delMes.filter((n) => n.estado !== 'Anulada');
  const T = (k) => r2(sumBy(act, (n) => nominaCalc(n)[k]));
  const altas = DB.empleados.filter((e) => e.estado !== 'Baja');
  const sinNomina = altas.filter((e) => !act.some((n) => n.empleadoId === e.id));
  const pendientes = act.filter((n) => nominaEstado(n) === 'Pendiente de pago');
  view.innerHTML = pageHead('Nóminas', 'Empleados, nóminas mensuales, Seguridad Social y retenciones de IRPF',
    manage ? (tab === 'empleados' ? `<a class="btn primary" href="#/nominas/empleados/nuevo">${ico('plus')}Nuevo empleado</a>` : `<a class="btn" href="#/nominas/nueva?p=${periodo}">${ico('plus')}Nómina suelta</a>${sinNomina.length ? `<button class="btn primary" id="gen">${ico('plus')}Generar ${sinNomina.length} nómina(s) de ${nombrePeriodo(periodo)}</button>` : ''}`) : '') + avisoFin() +
    `<div class="card">${tabsHTML([['nominas', 'Nóminas del mes'], ['empleados', `Empleados (${altas.length} de alta)`]], tab, `/nominas?p=${periodo}&tab=`)}<div id="body"></div></div>`;
  bindTabs();
  const body = $('#body');
  if (tab === 'empleados') {
    DataTable(body, {
      rows: () => DB.empleados, placeholder: 'Nombre, DNI/NIE, puesto…', searchText: (e) => [e.codigo, e.nombre, e.nif, e.puesto, e.naf].join(' '),
      chips: [{ k: 'alta', label: 'De alta', test: (e) => e.estado !== 'Baja' }, { k: 'all', label: 'Todos' }, { k: 'baja', label: 'De baja', test: (e) => e.estado === 'Baja' }],
      sort: 'nombre', dir: 1, csv: 'empleados',
      columns: [
        { k: 'codigo', label: 'Código', render: (e) => `<span class="muted">${esc(e.codigo)}</span>` },
        { k: 'nombre', label: 'Empleado', render: (e) => `<div class="strong">${esc(e.nombre)}</div><div class="muted">${esc(e.nif || '')}</div>` },
        { k: 'puesto', label: 'Puesto', render: (e) => `${esc(e.puesto || '')}<div class="muted">${esc(e.tipoContrato || '')}</div>` },
        { k: 'fechaAlta', label: 'Alta', render: (e) => fmtDate(e.fechaAlta) },
        { k: 'salarioBrutoAnual', label: 'Bruto anual', cls: 'num', sort: (e) => +e.salarioBrutoAnual, render: (e) => `${fmtMoney(e.salarioBrutoAnual)}<div class="muted">${esc(e.pagas || '14 pagas')}</div>` },
        { k: 'coste', label: 'Coste empresa / mes', cls: 'num', sort: (e) => nominaCalc(nominaPropuesta(e, '2000-01')).coste, render: (e) => fmtMoney(nominaCalc(nominaPropuesta(e, '2000-01')).coste), csv: (e) => r2(nominaCalc(nominaPropuesta(e, '2000-01')).coste) },
        { k: 'estado', label: 'Estado', render: (e) => badge(e.estado || 'Alta') },
      ],
      onRow: (e) => go(`/nominas/empleados/${e.id}/editar`),
      empty: 'Da de alta a tus trabajadores para calcular sus nóminas.',
    });
    $('[data-chip="alta"]', body)?.click();
    return;
  }
  body.innerHTML = `<div class="card-pad" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--border)"><label class="hint" for="pMes" style="font-weight:600">Mes</label><input class="in" type="month" id="pMes" value="${periodo}" style="width:auto">
      ${manage && pendientes.length ? `<button class="btn" id="pagarTodo" style="margin-left:auto">${ico('cash')}Pagar ${pendientes.length} nómina(s) · ${fmtMoney(sumBy(pendientes, (n) => nominaCalc(n).liquido - nominaPagado(n)))}</button>` : ''}</div>
    <div class="card-pad">${kpis([['Total devengado', fmtMoney(T('devengado')), 'invoice', `${act.length} nómina(s)`], ['Líquido a pagar', fmtMoney(T('liquido')), 'wallet', `${pendientes.length} pendiente(s) de pago`], ['Seguridad Social (TC)', fmtMoney(T('ssTotal')), 'shield', `Obrera ${fmtMoney(T('ssTrab'))} · patronal ${fmtMoney(T('ssEmp'))}`], ['Retenciones IRPF', fmtMoney(T('irpf')), 'tag', 'Se ingresan con el modelo 111'], ['Coste total empresa', fmtMoney(T('coste')), 'trend', 'Devengado + SS a cargo de la empresa']])}</div><div id="tblN"></div>`;
  $('#pMes').addEventListener('change', (e) => e.target.value && go(`/nominas?p=${e.target.value}`));
  DataTable($('#tblN'), {
    rows: () => delMes, searchText: (n) => [empNombre(n.empleadoId), getEmp(n.empleadoId)?.nif, obraNombre(n.obraId)].join(' '), sort: 'emp', dir: 1, csv: 'nominas_' + periodo,
    columns: [
      { k: 'emp', label: 'Empleado', sort: (n) => empNombre(n.empleadoId), render: (n) => `<div class="strong">${esc(empNombre(n.empleadoId))}</div><div class="muted">${esc(n.obraId ? obraNombre(n.obraId) : 'Estructura / general')}</div>`, csv: (n) => empNombre(n.empleadoId) },
      { k: 'dev', label: 'Devengado', cls: 'num', sort: (n) => nominaCalc(n).devengado, render: (n) => fmtMoney(nominaCalc(n).devengado) },
      { k: 'sst', label: 'SS trabajador', cls: 'num', sort: (n) => nominaCalc(n).ssTrab, render: (n) => fmtMoney(nominaCalc(n).ssTrab) },
      { k: 'irpf', label: 'IRPF', cls: 'num', sort: (n) => nominaCalc(n).irpf, render: (n) => `${fmtMoney(nominaCalc(n).irpf)}<div class="muted">${fmtPct(n.irpfPct)}</div>` },
      { k: 'liq', label: 'Líquido', cls: 'num', sort: (n) => nominaCalc(n).liquido, render: (n) => `<b>${fmtMoney(nominaCalc(n).liquido)}</b>` },
      { k: 'sse', label: 'SS empresa', cls: 'num', sort: (n) => nominaCalc(n).ssEmp, render: (n) => fmtMoney(nominaCalc(n).ssEmp) },
      { k: 'coste', label: 'Coste empresa', cls: 'num', sort: (n) => nominaCalc(n).coste, render: (n) => fmtMoney(nominaCalc(n).coste) },
      { k: 'estado', label: 'Estado', sort: (n) => nominaEstado(n), render: (n) => badge(nominaEstado(n)) },
    ],
    onRow: (n) => go('/nominas/' + n.id),
    empty: altas.length ? `Aún no hay nóminas de ${nombrePeriodo(periodo)}. Pulsa «Generar nóminas» para calcularlas a partir de la ficha de cada empleado.` : 'Primero da de alta a los empleados (pestaña Empleados).',
  });
  $('#gen')?.addEventListener('click', () => {
    if (finBloqueado()) return;
    sinNomina.forEach((e) => { const n = { id: uid('nom'), ...nominaPropuesta(e, periodo), creado: new Date().toISOString(), creadoPor: Store.user().nombre }; DB.nominas.push(n); });
    audit('Crear', 'Nómina', periodo, `${sinNomina.length} nómina(s) de ${nombrePeriodo(periodo)}`);
    persist(); toast(`${sinNomina.length} nómina(s) generada(s). Revisa horas extra, dietas y pluses.`); route();
  });
  $('#pagarTodo')?.addEventListener('click', () => {
    if (finBloqueado()) return;
    modal({
      title: `Pagar nóminas de ${nombrePeriodo(periodo)}`, okText: 'Registrar pagos',
      body: `<p class="hint" style="margin-top:0">Se registrará en tesorería un pago por cada nómina pendiente (${pendientes.length}), por su líquido.</p><div class="form-grid"><div class="f s6"><label>Fecha de pago</label><input class="in" type="date" name="fecha" value="${todayISO() < finDeMes(periodo) ? todayISO() : finDeMes(periodo)}"></div><div class="f s6"><label>Cuenta</label><select class="in" name="cuenta">${opts(CUENTAS_TES)}</select></div></div>`,
      onOk: (ov) => {
        const fecha = $('[name=fecha]', ov).value || todayISO(), cuenta = $('[name=cuenta]', ov).value;
        pendientes.forEach((n) => pagarNomina(n, fecha, cuenta));
        persist(); toast('Pagos de nóminas registrados'); route();
      },
    });
  });
}
function pagarNomina(n, fecha, cuenta) {
  const falta = r2(nominaCalc(n).liquido - nominaPagado(n)); if (falta <= 0) return null;
  return nuevoMovimiento({ fecha, tipo: 'Salida', categoria: 'Nómina', concepto: `Nómina ${nombrePeriodo(n.periodo)} · ${empNombre(n.empleadoId)}`, importe: falta, cuenta, nominaId: n.id, obraId: n.obraId || '' });
}
const NOMINA_CAMPOS = [
  ['Devengos', [['salarioBase', 'Salario base'], ['complementos', 'Complementos y pluses'], ['horasExtra', 'Horas extraordinarias'], ['pagaExtra', 'Paga extra / prorrata'], ['dietas', 'Dietas y kilometraje (exentas)']]],
  ['Cotización e IRPF', [['prorrataCC', 'Prorrata pagas extra (solo cotiza)'], ['ssTrabPct', '% Seguridad Social trabajador'], ['irpfPct', '% retención IRPF'], ['otrasDeducciones', 'Otras deducciones (anticipos…)']]],
  ['A cargo de la empresa', [['ssEmpPct', '% Seguridad Social empresa'], ['ssAtPct', '% accidentes de trabajo (AT/EP)']]],
];
function NominaForm(id, query = {}) {
  if (denyGestionar('nominas', '/nominas') || finBloqueado('/nominas')) return;
  const existing = id ? getNomina(id) : null;
  if (id && !existing) return notFound();
  const periodo = existing?.periodo || (/^\d{4}-\d{2}$/.test(query.p || '') ? query.p : todayISO().slice(0, 7));
  const emp0 = getEmp(existing?.empleadoId || query.emp) || DB.empleados.find((e) => e.estado !== 'Baja');
  if (!emp0) { toast('Primero da de alta a un empleado.', 'bad'); return go('/nominas/empleados/nuevo'); }
  const d = existing ? clone(existing) : nominaPropuesta(emp0, periodo);
  view.innerHTML = pageHead(existing ? `Nómina de ${esc(empNombre(d.empleadoId))}` : 'Nueva nómina', `${nombrePeriodo(d.periodo)} · los importes se calculan al momento`, '', `<a href="#/nominas?p=${d.periodo}">Nóminas</a> / ${existing ? nombrePeriodo(d.periodo) : 'Nueva'}`) +
    `<div class="grid g-main"><form class="card card-pad" id="frm" novalidate><div class="form-grid">
      <div class="section-title">Datos</div>
      <div class="f s6"><label>Empleado</label><select class="in" name="empleadoId" ${existing ? 'disabled' : ''}>${DB.empleados.filter((e) => e.estado !== 'Baja' || e.id === d.empleadoId).map((e) => `<option value="${e.id}" ${e.id === d.empleadoId ? 'selected' : ''}>${esc(e.nombre)} · ${esc(e.puesto || '')}</option>`).join('')}</select></div>
      <div class="f s3"><label>Mes</label><input class="in" type="month" name="periodo" value="${d.periodo}" ${existing ? 'readonly' : ''}></div>
      <div class="f s3"><label>&nbsp;</label>${existing ? '' : `<button type="button" class="btn" id="recalc">${ico('clock')}Cargar desde la ficha</button>`}</div>
      <div class="f s9"><label>Obra (para imputar la mano de obra)</label><select class="in" name="obraId">${obraOptions(d.obraId)}</select></div>
      <div class="f s3"><label>% de la jornada en esa obra</label>${numIn('obraPct', d.obraPct ?? 100)}</div>
      ${NOMINA_CAMPOS.map(([sec, campos]) => `<div class="section-title">${sec}</div>` + campos.map(([k, l]) => `<div class="f s4"><label>${l}</label>${numIn(k, d[k])}</div>`).join('')).join('')}
      <div class="f s12"><label>Observaciones</label><textarea class="in" name="observaciones">${esc(d.observaciones || '')}</textarea></div>
    </div><p class="hint">Cálculo simplificado: no aplica las bases mínimas y máximas de cotización ni el tipo especial de las horas extra. Para la nómina oficial, contrasta con tu gestoría.</p>
    <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><a class="btn" href="${existing ? '#/nominas/' + id : '#/nominas?p=' + d.periodo}">Cancelar</a><button class="btn primary">${ico('check')}Guardar nómina</button></div></form>
    <div class="card" style="align-self:start"><div class="card-head"><h3>Resumen</h3></div><div class="card-pad" id="res"></div></div></div>`;
  const form = $('#frm');
  const leer = () => { const v = formValues(form); const o = { ...d }; NOMINA_CAMPOS.forEach(([, cs]) => cs.forEach(([k]) => { o[k] = +v[k] || 0; })); return o; };
  const res = () => {
    const c = nominaCalc(leer());
    $('#res').innerHTML = `<table class="mini-tbl"><tbody>${filaImporte('Total devengado', c.devengado, { b: 1 })}${filaImporte('Base de cotización', c.baseCC)}${filaImporte('Base sujeta a IRPF', c.baseIRPF)}${filaImporte('− Seguridad Social trabajador', c.ssTrab, { indent: 1 })}${filaImporte('− Retención IRPF', c.irpf, { indent: 1 })}${filaImporte('− Otras deducciones', +leer().otrasDeducciones || 0, { indent: 1 })}${filaImporte('Líquido a percibir', c.liquido, { b: 1, color: 'var(--ok)' })}${filaImporte('Seguridad Social empresa', c.ssEmp)}${filaImporte('Coste total para la empresa', c.coste, { b: 1 })}</tbody></table>`;
  };
  form.addEventListener('input', res);
  form.addEventListener('focusout', () => setTimeout(res, 0));
  $('#recalc')?.addEventListener('click', () => {
    const e = getEmp(form.empleadoId.value); if (!e) return;
    const p = nominaPropuesta(e, form.periodo.value || periodo);
    NOMINA_CAMPOS.forEach(([, cs]) => cs.forEach(([k]) => { form.elements[k].value = fmtInputNum(p[k]); }));
    form.obraId.value = p.obraId || ''; res();
  });
  form.empleadoId.addEventListener('change', () => $('#recalc')?.click());
  form.periodo?.addEventListener('change', () => $('#recalc')?.click());
  res();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form), o = leer();
    const per = existing ? d.periodo : v.periodo;
    if (!/^\d{4}-\d{2}$/.test(per || '')) return toast('Indica el mes de la nómina.', 'bad');
    const empId = existing ? d.empleadoId : v.empleadoId;
    const data = { ...o, periodo: per, empleadoId: empId, obraId: v.obraId || '', obraPct: v.obraId ? Math.min(100, Math.max(0, v.obraPct === '' ? 100 : +v.obraPct)) : 100, observaciones: v.observaciones || '' };
    if (existing) {
      if (nominaCalc(data).liquido < nominaPagado(existing) - 0.01) return toast('El nuevo líquido es menor que lo ya pagado. Anula antes el pago en Tesorería.', 'bad');
      const before = clone(existing); Object.assign(existing, data, { actualizado: new Date().toISOString() });
      audit('Editar', 'Nómina', `${per} · ${empNombre(empId)}`, fmtMoney(nominaCalc(existing).liquido), diffObjects(before, existing));
      persist(); toast('Nómina guardada'); return go('/nominas/' + existing.id);
    }
    if (DB.nominas.some((n) => n.estado !== 'Anulada' && n.empleadoId === empId && n.periodo === per) && !confirm(`${empNombre(empId)} ya tiene nómina de ${nombrePeriodo(per)}. ¿Crear otra (atrasos, finiquito…)?`)) return;
    const n = { id: uid('nom'), ...data, estado: 'Calculada', creado: new Date().toISOString(), creadoPor: Store.user().nombre };
    DB.nominas.push(n); audit('Crear', 'Nómina', `${per} · ${empNombre(empId)}`, fmtMoney(nominaCalc(n).liquido));
    persist(); toast('Nómina creada'); go('/nominas/' + n.id);
  });
}
function NominaDetalle(id) {
  const n = getNomina(id); if (!n) return notFound();
  const c = nominaCalc(n), e = getEmp(n.empleadoId), est = nominaEstado(n), manage = puedeGestionar('nominas');
  const pagos = DB.movimientos.filter((m) => m.nominaId === id && m.estado !== 'Anulado');
  const ref = `${n.periodo} · ${empNombre(n.empleadoId)}`;
  const E = DB.empresa;
  view.innerHTML = pageHead(`Nómina ${nombrePeriodo(n.periodo)} ${badge(est)}`, `${esc(empNombre(n.empleadoId))} · ${esc(e?.puesto || '')}`,
    manage && n.estado !== 'Anulada' ? `${est === 'Pendiente de pago' ? `<button class="btn primary" id="pagar">${ico('cash')}Registrar pago</button>` : ''}<a class="btn" href="#/nominas/${id}/editar">${ico('edit')}Editar</a><button class="btn" id="imp">${ico('download')}Imprimir recibo</button><button class="btn danger" id="anular">${ico('x')}Anular</button>` : `<button class="btn" id="imp">${ico('download')}Imprimir recibo</button>`,
    `<a href="#/nominas?p=${n.periodo}">Nóminas</a> / ${nombrePeriodo(n.periodo)}`) + avisoFin() +
    kpis([['Devengado', fmtMoney(c.devengado), 'invoice'], ['Líquido', fmtMoney(c.liquido), 'wallet', `Pagado ${fmtMoney(nominaPagado(n))}`], ['SS total (TC)', fmtMoney(c.ssTotal), 'shield'], ['Coste empresa', fmtMoney(c.coste), 'trend']]) +
    `<div class="grid g-main mt"><div class="card"><div id="recibo" class="card-pad">${reciboNomina(n)}</div></div>
     <div class="grid" style="align-content:start"><div class="card card-pad"><div class="kv" style="grid-template-columns:1fr 1fr">${[['Empleado', e ? `<a href="#/nominas/empleados/${e.id}/editar">${esc(e.nombre)}</a>` : '—'], ['DNI / NIE', esc(e?.nif || '—')], ['Nº afiliación SS', esc(e?.naf || '—')], ['Obra', esc(obraNombre(n.obraId))], ['Empresa', esc(E.razonSocial || '')], ['Registrada por', esc(n.creadoPor || '')]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join('')}</div></div>
     <div class="card"><div class="card-head"><h3>Pagos</h3></div><div class="card-pad" style="padding-top:4px">${pagos.length ? `<table class="mini-tbl">${pagos.map((m) => `<tr><td>${fmtDate(m.fecha)}<div class="muted">${esc(m.numero)} · ${esc(m.cuenta)}</div></td><td class="num">${fmtMoney(m.importe)}</td></tr>`).join('')}</table>` : emptyState('Sin pagos', 'wallet')}</div></div>
     <div class="card"><div class="card-head"><h3>Historial</h3></div><div class="card-pad">${historyFor(ref)}</div></div></div></div>`;
  $('#pagar')?.addEventListener('click', () => {
    if (finBloqueado()) return;
    modal({ title: 'Pagar nómina', okText: 'Registrar pago', body: `<div class="form-grid"><div class="f s6"><label>Fecha</label><input class="in" type="date" name="fecha" value="${todayISO()}"></div><div class="f s6"><label>Cuenta</label><select class="in" name="cuenta">${opts(CUENTAS_TES)}</select></div></div>`,
      onOk: (ov) => { pagarNomina(n, $('[name=fecha]', ov).value || todayISO(), $('[name=cuenta]', ov).value); persist(); toast('Pago registrado'); route(); } });
  });
  $('#imp').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) return toast('Permite las ventanas emergentes para imprimir.', 'bad');
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Nómina ${esc(nombrePeriodo(n.periodo))} · ${esc(empNombre(n.empleadoId))}</title><style>body{font:13px/1.5 Inter,Arial,sans-serif;color:#0f172a;margin:32px}table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid #e3e8ef}td.num{text-align:right;white-space:nowrap}h2{color:#283d6a;margin:0 0 4px}.muted{color:#64748b}</style></head><body>${reciboNomina(n)}<script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  });
  $('#anular')?.addEventListener('click', async () => {
    if (pagos.length) return toast('Tiene pagos registrados: anúlalos primero en Tesorería.', 'bad');
    if (!(await confirmBox('Anular nómina', 'La nómina dejará de contar en costes, Seguridad Social y retenciones.', 'Anular'))) return;
    n.estado = 'Anulada'; audit('Anular', 'Nómina', ref, ''); persist(); toast('Nómina anulada'); route();
  });
}
function reciboNomina(n) {
  const c = nominaCalc(n), e = getEmp(n.empleadoId) || {}, E = DB.empresa;
  const fila = (l, v, extra = '') => `<tr><td>${l}${extra ? ` <span class="muted">${extra}</span>` : ''}</td><td class="num">${fmtMoney(v)}</td></tr>`;
  return `<h2>Recibo de salarios · ${esc(nombrePeriodo(n.periodo))}</h2>
    <p class="muted" style="margin:0 0 14px">${esc(E.razonSocial || '')} · CIF ${esc(E.nit || '')}<br>Trabajador: <b>${esc(e.nombre || '')}</b> · DNI/NIE ${esc(e.nif || '—')} · Nº SS ${esc(e.naf || '—')} · ${esc(e.puesto || '')}</p>
    <table class="mini-tbl"><tbody>
      <tr><td colspan="2"><b>I. Devengos</b></td></tr>
      ${fila('Salario base', n.salarioBase)}${+n.complementos ? fila('Complementos y pluses', n.complementos) : ''}${+n.horasExtra ? fila('Horas extraordinarias', n.horasExtra) : ''}${+n.pagaExtra ? fila('Paga extra / prorrata', n.pagaExtra) : ''}${+n.dietas ? fila('Dietas y kilometraje', n.dietas, '(exento)') : ''}
      <tr><td><b>A. Total devengado</b></td><td class="num"><b>${fmtMoney(c.devengado)}</b></td></tr>
      <tr><td colspan="2"><b>II. Deducciones</b></td></tr>
      ${fila('Aportación del trabajador a la Seguridad Social', c.ssTrab, `${fmtPct(n.ssTrabPct)} s/ ${fmtMoney(c.baseCC)}`)}${fila('Retención IRPF', c.irpf, `${fmtPct(n.irpfPct)} s/ ${fmtMoney(c.baseIRPF)}`)}${+n.otrasDeducciones ? fila('Otras deducciones', n.otrasDeducciones) : ''}
      <tr><td><b>B. Total a deducir</b></td><td class="num"><b>${fmtMoney(c.deducciones)}</b></td></tr>
      <tr><td><b>Líquido total a percibir (A − B)</b></td><td class="num"><b>${fmtMoney(c.liquido)}</b></td></tr>
      <tr><td colspan="2" class="muted">Aportación de la empresa a la Seguridad Social: ${fmtMoney(c.ssEmp)} (${fmtPct((+n.ssEmpPct || 0) + (+n.ssAtPct || 0))} s/ ${fmtMoney(c.baseCC)}) · Coste total: ${fmtMoney(c.coste)}</td></tr>
    </tbody></table>`;
}

const EMPLEADO_FIELDS = [
  ['sec', 'Datos personales'],
  ['codigo', 'Código', 's3', { readonly: true }],
  ['nombre', 'Nombre y apellidos', 's6', { req: 1 }],
  ['nif', 'DNI / NIE', 's3', { req: 1 }],
  ['naf', 'Nº de afiliación a la Seguridad Social', 's4'],
  ['email', 'Correo electrónico', 's4', { type: 'email' }],
  ['telefono', 'Teléfono', 's4'],
  ['iban', 'IBAN para la nómina', 's6'],
  ['direccion', 'Dirección', 's6'],
  ['sec', 'Contrato'],
  ['puesto', 'Puesto', 's4', { req: 1 }],
  ['grupoCotizacion', 'Grupo de cotización', 's4', { options: ['1 · Ingenieros y licenciados', '2 · Ingenieros técnicos', '3 · Jefes administrativos y de taller', '4 · Ayudantes no titulados', '5 · Oficiales administrativos', '6 · Subalternos', '7 · Auxiliares administrativos', '8 · Oficiales de 1.ª y 2.ª', '9 · Oficiales de 3.ª y especialistas', '10 · Peones', '11 · Menores de 18 años'] }],
  ['tipoContrato', 'Tipo de contrato', 's4', { options: TIPOS_CONTRATO }],
  ['fechaAlta', 'Fecha de alta', 's3', { req: 1, type: 'date' }],
  ['fechaBaja', 'Fecha de baja', 's3', { type: 'date' }],
  ['estado', 'Situación', 's3', { options: ['Alta', 'Baja'] }],
  ['jornada', 'Jornada', 's3', { options: ['Completa', 'Parcial'] }],
  ['sec', 'Retribución'],
  ['salarioBrutoAnual', 'Salario bruto anual', 's4', { req: 1, type: 'number' }],
  ['pagas', 'Pagas', 's4', { options: PAGAS }],
  ['complementos', 'Complementos fijos al mes', 's4', { type: 'number' }],
  ['irpfPct', '% retención IRPF', 's4', { type: 'number' }],
  ['observaciones', 'Observaciones', 's12', { textarea: 1 }],
];
function EmpleadoForm(id) {
  if (denyGestionar('nominas', '/nominas?tab=empleados') || finBloqueado('/nominas?tab=empleados')) return;
  const e = id ? getEmp(id) : { codigo: '(se asigna al guardar)', estado: 'Alta', pagas: PAGAS[0], tipoContrato: 'Indefinido', jornada: 'Completa', fechaAlta: todayISO(), irpfPct: finFiscal('irpfDefault'), grupoCotizacion: '8 · Oficiales de 1.ª y 2.ª' };
  if (id && !e) return notFound();
  const nNom = id ? DB.nominas.filter((n) => n.empleadoId === id).length : 0;
  view.innerHTML = pageHead(id ? esc(e.nombre) : 'Nuevo empleado', id ? `${esc(e.codigo)} · ${nNom} nómina(s)` : 'Los campos con * son obligatorios', id ? `<a class="btn" href="#/nominas/nueva?emp=${id}">${ico('plus')}Nómina</a>` : '', `<a href="#/nominas?tab=empleados">Empleados</a> / ${id ? esc(e.codigo) : 'Nuevo'}`) +
    `<div class="grid g-main"><form class="card card-pad" id="frm" novalidate><div class="form-grid">${EMPLEADO_FIELDS.map((f) => fieldHTML(f, e[f[0]])).join('')}</div>
     <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="#/nominas?tab=empleados">Cancelar</a><button class="btn primary">${ico('check')}Guardar empleado</button></div></form>
     <div class="card" style="align-self:start"><div class="card-head"><div><h3>Nómina mensual estimada</h3><p>Mes ordinario, con los parámetros de Configuración</p></div></div><div class="card-pad" id="est"></div></div></div>`;
  const form = $('#frm');
  const est = () => {
    const v = formValues(form);
    const n = nominaPropuesta({ ...v, salarioBrutoAnual: +v.salarioBrutoAnual || 0, complementos: +v.complementos || 0 }, '2000-01'), c = nominaCalc(n);
    $('#est').innerHTML = `<table class="mini-tbl"><tbody>${filaImporte('Bruto mensual', c.devengado)}${filaImporte('− SS trabajador', c.ssTrab, { indent: 1 })}${filaImporte('− IRPF', c.irpf, { indent: 1 })}${filaImporte('Líquido', c.liquido, { b: 1 })}${filaImporte('SS empresa', c.ssEmp)}${filaImporte('Coste empresa / mes', c.coste, { b: 1 })}${filaImporte('Coste empresa / año', r2(((+v.salarioBrutoAnual || 0) + (+v.complementos || 0) * 12) * (1 + (finFiscal('ssEmpPct') + finFiscal('ssAtPct')) / 100)), { b: 1 })}</tbody></table>`;
  };
  form.addEventListener('input', est); form.addEventListener('change', est); est();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!validateRequired(form, EMPLEADO_FIELDS)) return toast('Revisa los campos obligatorios marcados en rojo.', 'bad');
    const v = formValues(form); delete v.codigo;
    v.nif = String(v.nif).replace(/[\s.-]/g, '').toUpperCase();
    const dup = DB.empleados.find((x) => x.id !== id && String(x.nif || '').toUpperCase() === v.nif);
    if (dup) { form.nif.classList.add('invalid'); return toast(`Ese DNI/NIE ya existe: ${dup.nombre}`, 'bad'); }
    if (v.estado === 'Baja' && !v.fechaBaja) v.fechaBaja = todayISO();
    if (id) {
      const before = clone(e); Object.assign(e, v, { actualizado: new Date().toISOString() });
      audit('Editar', 'Empleado', e.codigo, e.nombre, diffObjects(before, e));
    } else {
      const n = { id: uid('emp'), codigo: Store.nextNumber('EMP'), ...v, creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      DB.empleados.push(n); audit('Crear', 'Empleado', n.codigo, n.nombre);
    }
    persist(); toast('Empleado guardado'); go('/nominas?tab=empleados');
  });
}

/* ==========================================================
   TESORERÍA · FLUJO DE CAJA
   ========================================================== */
/* Previsión: lo pendiente de cobrar y de pagar, agrupado por mes de vencimiento */
function prevision(meses = 3) {
  const hoy = todayISO(), cab = [{ k: 'venc', label: 'Vencido' }];
  let p = hoy.slice(0, 7);
  for (let i = 0; i < meses; i++) { cab.push({ k: p, label: nombrePeriodo(p) }); const [y, m] = p.split('-').map(Number); p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
  const bucket = (fecha) => (!fecha || fecha < hoy ? 'venc' : cab.some((c) => c.k === fecha.slice(0, 7)) ? fecha.slice(0, 7) : null);
  const filas = { cobros: {}, proveedores: {}, nominas: {}, ss: {}, hacienda: {} };
  const add = (f, b, v) => { if (b && v > 0) filas[f][b] = (filas[f][b] || 0) + v; };
  facturasActivas().forEach((f) => add('cobros', bucket(f.vence || f.fecha), facturaResumen(f).saldo));
  comprasActivas().forEach((c) => add('proveedores', bucket(c.vence || c.fecha), compraCalc(c).pendiente));
  nominasActivas().forEach((n) => add('nominas', bucket(finDeMes(n.periodo)), nominaCalc(n).liquido - nominaPagado(n)));
  // Seguridad Social: se paga el mes siguiente al de la nómina
  [...new Set(nominasActivas().map((n) => n.periodo))].forEach((per) => { const s = seguridadSocialMes(per); const [y, m] = per.split('-').map(Number); add('ss', bucket(finDeMes(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`)), s.total - s.pagado); });
  // Hacienda: IVA y retenciones del trimestre en curso y del anterior (si no se han pagado)
  const y = +hoy.slice(0, 4), t = triActual();
  [[y, t], t === 1 ? [y - 1, 4] : [y, t - 1]].forEach(([a, tt]) => {
    const rg = rangoPeriodo(a, tt), clave = `${a}-T${tt}`;
    const due = tt === 4 ? `${a + 1}-01-30` : `${a}-${String(tt * 3 + 1).padStart(2, '0')}-20`;
    const iva = Math.max(0, modelo303(rg).resultado - pagadoFiscal('303-' + clave));
    const ret = Math.max(0, modelo111(rg).total + modelo115(rg).total - pagadoFiscal('111-' + clave) - pagadoFiscal('115-' + clave));
    add('hacienda', bucket(due), iva + ret);
  });
  return { cab, filas };
}
function Tesoreria(query = {}) {
  const anio = +query.anio || new Date().getFullYear();
  const hoy = todayISO(), mes = hoy.slice(0, 7);
  const apuntes = tesoreriaApuntes().filter((a) => a.estado !== 'Anulado');
  const delMes = apuntes.filter((a) => a.fecha.startsWith(mes));
  const pv = prevision(3);
  const tot = (f) => sumBy(Object.values(pv.filas[f]), (x) => x);
  const entra90 = tot('cobros'), sale90 = tot('proveedores') + tot('nominas') + tot('ss') + tot('hacienda');
  const saldo = saldoTesoreria();
  const manage = puedeGestionar('tesoreria');
  view.innerHTML = pageHead('Tesorería', `Flujo de caja: dinero que entra y sale de bancos y caja · saldo inicial ${fmtMoney(finFiscal('tesSaldoInicial') + finFiscal('tesSaldoCaja'))} a ${fmtDate(DB.empresa.tesFechaSaldo || FISCAL_DEFAULT.tesFechaSaldo)}`,
    `${puedeGestionar('config') ? `<a class="btn" href="#/config">${ico('settings')}Saldo inicial</a>` : ''}${manage ? `<button class="btn" data-mov="Entrada">${ico('plus')}Entrada</button><button class="btn primary" data-mov="Salida">${ico('plus')}Salida / pago</button>` : ''}`) + avisoFin() +
    kpis([
      ['Saldo actual', fmtMoney(saldo), 'wallet', `Banco ${fmtMoney(saldoTesoreria(hoy, 'Banco'))} · Caja ${fmtMoney(saldoTesoreria(hoy, 'Caja'))}`],
      ['Entradas del mes', fmtMoney(sumBy(delMes.filter((a) => a.tipo === 'Entrada'), (a) => a.importe)), 'trend', nombrePeriodo(mes)],
      ['Salidas del mes', fmtMoney(sumBy(delMes.filter((a) => a.tipo === 'Salida'), (a) => a.importe)), 'cash', nombrePeriodo(mes)],
      ['Saldo previsto', fmtMoney(saldo + entra90 - sale90), 'clock', `Si se cobra y paga todo lo pendiente (${pv.cab.length - 1} meses)`],
    ]) +
    `<div class="grid g-2 mt">
      <div class="card"><div class="card-head"><div><h3>Entradas y salidas</h3><p>Por mes · ${anio}</p></div>${selPeriodo(anio, 0, { trimestre: false })}</div><div class="card-pad"><div id="chFlujo"></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Previsión de tesorería</h3><p>Pendiente de cobrar y de pagar según vencimiento</p></div></div><div class="tbl-wrap" id="prev"></div></div>
    </div>
    <div class="card mt"><div class="card-head"><div><h3>Flujo de caja mensual ${anio}</h3><p>Saldo inicial + entradas − salidas = saldo final de cada mes</p></div><button class="btn sm" id="csvFlujo">${ico('download')}CSV</button></div><div class="tbl-wrap" id="flujo"></div></div>
    <div class="card mt"><div class="card-head"><h3>Movimientos</h3></div><div id="tbl"></div></div>`;
  bindPeriodo('/tesoreria');
  // --- flujo mensual por categoría
  const meses = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);
  const delAnio = apuntes.filter((a) => a.fecha.startsWith(String(anio)));
  const cats = (tipo) => [...new Set(delAnio.filter((a) => a.tipo === tipo).map((a) => a.categoria))].sort();
  const val = (tipo, cat, m) => sumBy(delAnio.filter((a) => a.tipo === tipo && (!cat || a.categoria === cat) && a.fecha.startsWith(m)), (a) => a.importe);
  const ini = meses.map((m) => saldoTesoreria(addDays(m + '-01', -1)));
  const fin = meses.map((m) => saldoTesoreria(finDeMes(m)));
  const rows = [['Saldo inicial', ini, 'b'], ...cats('Entrada').map((c) => ['+ ' + c, meses.map((m) => val('Entrada', c, m)), 'in']), ['Total entradas', meses.map((m) => val('Entrada', null, m)), 'b ok'], ...cats('Salida').map((c) => ['− ' + c, meses.map((m) => val('Salida', c, m)), 'in']), ['Total salidas', meses.map((m) => val('Salida', null, m)), 'b bad'], ['Flujo neto del mes', meses.map((m) => val('Entrada', null, m) - val('Salida', null, m)), 'b'], ['Saldo final', fin, 'b']];
  const mesCorto = (m) => MESES[+m.slice(5) - 1].slice(0, 3);
  $('#flujo').innerHTML = `<table class="tbl" style="font-size:12.5px"><thead><tr><th>Concepto</th>${meses.map((m) => `<th class="num">${mesCorto(m)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${rows.map(([l, vs, cls]) => {
    const total = l.startsWith('Saldo inicial') ? vs[0] : l.startsWith('Saldo final') ? vs[11] : sumBy(vs, (x) => x);
    const st = `${/\bb\b/.test(cls) ? 'font-weight:700;' : ''}${/ok/.test(cls) ? 'color:var(--ok);' : ''}${/bad/.test(cls) ? 'color:var(--bad);' : ''}`;
    return `<tr><td style="white-space:nowrap;${st}${/in/.test(cls) ? 'padding-left:24px;color:var(--text-2)' : ''}">${esc(l)}</td>${vs.map((v) => `<td class="num" style="${st}${v < 0 && !/bad/.test(cls) ? 'color:var(--bad)' : ''}">${Math.abs(v) < 0.005 ? '<span class="muted">—</span>' : fmtNumero(v)}</td>`).join('')}<td class="num" style="${st}">${fmtNumero(total)}</td></tr>`;
  }).join('')}</tbody></table>`;
  $('#csvFlujo').addEventListener('click', () => downloadFile(`flujo-caja-${anio}.csv`, '﻿' + [['Concepto', ...meses, 'Total'], ...rows.map(([l, vs]) => [l, ...vs.map((v) => fmtNumero(v)), fmtNumero(l.startsWith('Saldo') ? (l.includes('inicial') ? vs[0] : vs[11]) : sumBy(vs, (x) => x))])].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv'));
  Charts.bars2($('#chFlujo'), { labels: meses.map(mesCorto), series: [{ label: 'Entradas', color: 'var(--series-3)', values: meses.map((m) => val('Entrada', null, m)) }, { label: 'Salidas', color: 'var(--series-2)', values: meses.map((m) => val('Salida', null, m)) }] });
  // --- previsión
  const etiquetas = { cobros: 'Cobros de clientes', proveedores: 'Pagos a proveedores', nominas: 'Nóminas', ss: 'Seguridad Social', hacienda: 'Hacienda (IVA y retenciones)' };
  const celda = (f, k) => { const v = pv.filas[f][k] || 0; return `<td class="num">${v ? fmtNumero(v) : '<span class="muted">—</span>'}</td>`; };
  let acum = saldo;
  $('#prev').innerHTML = `<table class="tbl" style="font-size:12.5px"><thead><tr><th></th>${pv.cab.map((c) => `<th class="num">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${Object.keys(etiquetas).map((f) => `<tr><td style="white-space:nowrap;${f === 'cobros' ? 'color:var(--ok)' : ''}">${f === 'cobros' ? '+' : '−'} ${etiquetas[f]}</td>${pv.cab.map((c) => celda(f, c.k)).join('')}</tr>`).join('')}
    <tr><td><b>Saldo previsto</b></td>${pv.cab.map((c) => { acum += (pv.filas.cobros[c.k] || 0) - ['proveedores', 'nominas', 'ss', 'hacienda'].reduce((s, f) => s + (pv.filas[f][c.k] || 0), 0); return `<td class="num" style="font-weight:700;${acum < 0 ? 'color:var(--bad)' : ''}">${fmtNumero(acum)}</td>`; }).join('')}</tr></tbody></table>
    <p class="hint" style="padding:0 16px 12px">«Vencido» suma lo que ya debía estar cobrado o pagado. Hacienda: estimación del IVA y las retenciones de los trimestres sin pagar.</p>`;
  // --- movimientos
  DataTable($('#tbl'), {
    rows: () => tesoreriaApuntes(), placeholder: 'Concepto, categoría, número, referencia…',
    searchText: (a) => [a.numero, a.concepto, a.categoria, a.referencia, a.cuenta, obraNombre(a.obraId)].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, { k: 'E', label: 'Entradas', test: (a) => a.tipo === 'Entrada' }, { k: 'S', label: 'Salidas', test: (a) => a.tipo === 'Salida' }, { k: 'Banco', label: 'Banco', test: (a) => a.cuenta === 'Banco' }, { k: 'Caja', label: 'Caja', test: (a) => a.cuenta === 'Caja' }, { k: 'mes', label: 'Este mes', test: (a) => a.fecha.startsWith(mes) }, { k: 'anul', label: 'Anulados', test: (a) => a.estado === 'Anulado' }],
    sort: 'fecha', csv: 'movimientos-tesoreria',
    columns: [
      { k: 'fecha', label: 'Fecha', render: (a) => `${fmtDate(a.fecha)}<div class="muted">${esc(a.numero)}</div>` },
      { k: 'categoria', label: 'Categoría', render: (a) => `${esc(a.categoria)}<div class="muted">${esc(a.cuenta)}${a.obraId ? ' · ' + esc(getCot(a.obraId)?.numero || '') : ''}</div>` },
      { k: 'concepto', label: 'Concepto', render: (a) => `${esc(a.concepto)}${a.referencia ? `<div class="muted">Ref. ${esc(a.referencia)}</div>` : ''}` },
      { k: 'entrada', label: 'Entrada', cls: 'num', sort: (a) => (a.tipo === 'Entrada' ? a.importe : 0), render: (a) => (a.tipo === 'Entrada' ? `<b style="color:var(--ok)">${fmtMoney(a.importe)}</b>` : ''), csv: (a) => (a.tipo === 'Entrada' ? fmtNumero(a.importe) : '') },
      { k: 'salida', label: 'Salida', cls: 'num', sort: (a) => (a.tipo === 'Salida' ? a.importe : 0), render: (a) => (a.tipo === 'Salida' ? `<b>${fmtMoney(a.importe)}</b>` : ''), csv: (a) => (a.tipo === 'Salida' ? fmtNumero(a.importe) : '') },
      { k: 'estado', label: 'Estado', render: (a) => badge(a.estado) },
    ],
    footer: (r) => { const v = r.filter((a) => a.estado !== 'Anulado'); const e = sumBy(v.filter((a) => a.tipo === 'Entrada'), (a) => a.importe), s = sumBy(v.filter((a) => a.tipo === 'Salida'), (a) => a.importe); return `Entradas ${fmtMoney(e)} · Salidas ${fmtMoney(s)} · Neto ${fmtMoney(e - s)}`; },
    onRow: (a) => (a.origen === 'cobro' ? (location.hash = a.href) : movimientoDialog(getMov(a.id))),
    empty: 'Sin movimientos.',
  });
  $$('[data-mov]').forEach((b) => b.addEventListener('click', () => movimientoDialog(null, { tipo: b.dataset.mov })));
}
/* Alta / consulta de un movimiento de tesorería */
function movimientoDialog(m, preset = {}) {
  if (!m && finBloqueado()) return;
  const nuevo = !m, manage = puedeGestionar('tesoreria') || puedeGestionar('impuestos');
  const d = m || { fecha: todayISO(), tipo: 'Salida', categoria: '', concepto: '', importe: '', cuenta: 'Banco', obraId: '', referencia: '', ...preset };
  const vinculo = d.compraId ? `<a href="#/compras/${d.compraId}" data-x>Compra ${esc(getCompra(d.compraId)?.numero || '')}</a>` : d.nominaId ? `<a href="#/nominas/${d.nominaId}" data-x>Nómina ${esc(nombrePeriodo(getNomina(d.nominaId)?.periodo))}</a>` : '';
  const dlg = modal({
    title: nuevo ? `Nueva ${d.tipo === 'Entrada' ? 'entrada' : 'salida'} de dinero` : `${d.numero} · ${d.tipo}`,
    okText: nuevo ? 'Registrar' : 'Guardar', hideOk: !manage || d.estado === 'Anulado',
    body: `<div class="form-grid">
      <div class="f s4"><label>Tipo</label><select class="in" name="tipo" ${nuevo ? '' : 'disabled'}>${opts(['Entrada', 'Salida'], d.tipo)}</select></div>
      <div class="f s4"><label>Fecha</label><input class="in" type="date" name="fecha" value="${d.fecha}"></div>
      <div class="f s4"><label>Cuenta</label><select class="in" name="cuenta">${opts(CUENTAS_TES, d.cuenta)}</select></div>
      <div class="f s6"><label>Categoría</label><select class="in" name="categoria" ${d.compraId || d.nominaId ? 'disabled' : ''}></select></div>
      <div class="f s6"><label>Importe</label>${numIn('importe', d.importe, d.compraId || d.nominaId ? 'readonly' : '')}</div>
      <div class="f s12"><label>Concepto</label><input class="in" name="concepto" value="${esc(d.concepto)}" placeholder="Ej. Cuota préstamo ICO, comisión mantenimiento…"></div>
      <div class="f s6"><label>Referencia</label><input class="in" name="referencia" value="${esc(d.referencia || '')}" placeholder="Nº de operación, justificante…"></div>
      <div class="f s6"><label>Obra</label><select class="in" name="obraId">${obraOptions(d.obraId)}</select></div>
      ${d.periodoFiscal ? `<div class="f s12"><span class="hint">Liquidación: <b>${esc(d.periodoFiscal)}</b></span></div>` : ''}
      ${vinculo ? `<div class="f s12"><span class="hint">Vinculado a ${vinculo}</span></div>` : ''}
      ${!nuevo && manage && d.estado !== 'Anulado' ? `<div class="f s12"><button type="button" class="btn danger sm" id="anularMov" style="align-self:flex-start">${ico('x')}Anular movimiento</button></div>` : ''}
    </div>`,
    onOpen: (ov) => {
      const tipo = $('[name=tipo]', ov), cat = $('[name=categoria]', ov);
      const fill = () => { const lista = CAT_MOV[tipo.value]; cat.innerHTML = opts(lista.includes(d.categoria) || !d.categoria ? lista : [d.categoria, ...lista], d.categoria || lista[0]); };
      tipo.addEventListener('change', () => { d.categoria = ''; fill(); }); fill();
      $('#anularMov', ov)?.addEventListener('click', async () => {
        dlg.close();
        if (!(await confirmBox('Anular movimiento', `${esc(d.numero)} · ${fmtMoney(d.importe)} dejará de contar en tesorería${d.compraId ? ' y la compra volverá a quedar pendiente' : ''}.`, 'Anular'))) return;
        m.estado = 'Anulado'; audit('Anular', d.tipo === 'Entrada' ? 'Entrada' : 'Pago', d.numero, `${d.categoria} · ${fmtMoney(d.importe)}`); persist(); toast('Movimiento anulado'); route();
      });
    },
    onOk: (ov) => {
      const g = (k) => $(`[name=${k}]`, ov);
      const v = { tipo: g('tipo').value, fecha: g('fecha').value, cuenta: g('cuenta').value, categoria: g('categoria').value, importe: parseNum(g('importe').value), concepto: g('concepto').value.trim(), referencia: g('referencia').value.trim(), obraId: g('obraId').value };
      if (!v.fecha || !(v.importe > 0)) { toast('Indica la fecha y un importe mayor que cero.', 'bad'); return false; }
      if (!v.concepto) v.concepto = v.categoria;
      if (nuevo) { nuevoMovimiento({ ...v, periodoFiscal: preset.periodoFiscal || '' }); }
      else {
        const before = clone(m);
        Object.assign(m, { fecha: v.fecha, cuenta: v.cuenta, concepto: v.concepto, referencia: v.referencia, obraId: v.obraId, ...(m.compraId || m.nominaId ? {} : { categoria: v.categoria, importe: r2(v.importe) }), actualizado: new Date().toISOString() });
        audit('Editar', m.tipo === 'Entrada' ? 'Entrada' : 'Pago', m.numero, m.concepto, diffObjects(before, m));
      }
      persist(); toast('Movimiento guardado'); route();
    },
  });
}

/* ==========================================================
   IMPUESTOS
   ========================================================== */
const avisoFiscal = () => `<p class="hint" style="margin:14px 0 0">${ico('alert')} Cálculo orientativo con los datos registrados en ZEWÁ. La presentación oficial de los modelos se hace en la Sede Electrónica de la AEAT o a través de tu gestoría, que debe revisar las cifras.</p>`;
function pagoFiscalBtn(clave, categoria, importe, concepto, corto = false) {
  const pagado = pagadoFiscal(clave), pend = r2(importe - pagado);
  if (importe <= 0) return corto ? '<span class="muted">—</span>' : `<span class="badge b-muted">Sin importe a ingresar</span>`;
  if (pend <= 0.01) return `${badge('Pagado')}${corto ? '' : ` <small class="muted">${fmtMoney(pagado)}</small>`}`;
  const puede = puedeGestionar('impuestos') || puedeGestionar('tesoreria');
  return `${pagado > 0 && !corto ? `<small class="muted">Pagado ${fmtMoney(pagado)} · </small>` : ''}${puede ? `<button class="btn sm ${corto ? '' : 'primary'}" title="Registrar pago de ${fmtMoney(pend)}" data-pagofiscal='${esc(JSON.stringify({ clave, categoria, importe: pend, concepto }))}'>${ico('cash')}${corto ? 'Pagar' : `Registrar pago de ${fmtMoney(pend)}`}</button>` : badge('Pendiente')}`;
}
function bindPagosFiscales() {
  $$('[data-pagofiscal]').forEach((b) => b.addEventListener('click', () => {
    const o = JSON.parse(b.dataset.pagofiscal);
    movimientoDialog(null, { tipo: 'Salida', categoria: o.categoria, importe: o.importe, concepto: o.concepto, periodoFiscal: o.clave });
  }));
}
function Impuestos(query = {}) {
  const anio = +query.anio || new Date().getFullYear();
  const t = query.t === undefined ? triActual() : +query.t || triActual();
  const rg = rangoPeriodo(anio, t), clave = `${anio}-T${t}`;
  const iva = modelo303(rg), m111 = modelo111(rg), m115 = modelo115(rg);
  const meses = mesesDeRango(rg).map(seguridadSocialMes);
  const anual = cuentaResultados(rangoPeriodo(anio, 0));
  const tablaIva = (lista, titulo) => `<tr><td colspan="3"><b>${titulo}</b></td></tr>${lista.length ? lista.map((x) => `<tr><td style="padding-left:24px">Tipo ${fmtPct(x.tipo)}</td><td class="num">${fmtMoney(x.base)}</td><td class="num">${fmtMoney(x.cuota)}</td></tr>`).join('') : '<tr><td style="padding-left:24px" class="muted" colspan="3">Sin operaciones</td></tr>'}`;
  view.innerHTML = pageHead('Impuestos', `Liquidaciones del ${t}.º trimestre de ${anio} · plazo de presentación: ${plazoTrimestral(anio, t)}`, selPeriodo(anio, t, { todoElAnio: false })) + avisoFin() +
    kpis([
      ['IVA (modelo 303)', fmtMoney(iva.resultado), 'invoice', iva.resultado >= 0 ? 'A ingresar' : 'A compensar / devolver'],
      ['Retenciones (modelo 111)', fmtMoney(m111.total), 'users', 'Trabajadores y profesionales'],
      ['Alquileres (modelo 115)', fmtMoney(m115.total), 'home', 'Retenciones de arrendamientos'],
      ['Seguridad Social del trimestre', fmtMoney(sumBy(meses, (m) => m.total)), 'shield', 'Cuota obrera + patronal'],
    ]) +
    `<div class="grid g-2 mt">
      <div class="card"><div class="card-head"><div><h3>Modelo 303 · IVA</h3><p>${iva.nEmitidas} factura(s) emitida(s) · ${iva.nRecibidas} recibida(s) con IVA deducible</p></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="num">Base imponible</th><th class="num">Cuota</th></tr></thead><tbody>
          ${tablaIva(iva.rep, 'IVA devengado (repercutido en tus facturas)')}
          <tr><td style="font-weight:700">Total IVA devengado</td><td></td><td class="num" style="font-weight:700">${fmtMoney(iva.devengado)}</td></tr>
          ${tablaIva(iva.sop, 'IVA deducible (soportado en compras y gastos)')}
          <tr><td style="font-weight:700">Total IVA deducible</td><td></td><td class="num" style="font-weight:700">${fmtMoney(iva.deducible)}</td></tr>
          <tr><td style="font-weight:700">Resultado de la liquidación</td><td></td><td class="num" style="font-weight:800;font-size:16px;color:${iva.resultado > 0 ? 'var(--bad)' : 'var(--ok)'}">${fmtMoney(iva.resultado)}</td></tr>
        </tbody></table></div><div class="card-pad">${pagoFiscalBtn('303-' + clave, 'Hacienda · IVA (303)', iva.resultado, `Modelo 303 · ${t}T ${anio}`)}${iva.resultado < 0 ? `<p class="hint">Resultado negativo: se compensa en los trimestres siguientes o se solicita la devolución en el 4.º trimestre.</p>` : ''}</div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-head"><div><h3>Modelo 111 · Retenciones de IRPF</h3><p>Nóminas y facturas de profesionales con retención</p></div></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="num">Perceptores</th><th class="num">Base</th><th class="num">Retenciones</th></tr></thead><tbody>
            <tr><td>Rendimientos del trabajo (nóminas)</td><td class="num">${m111.trabajo.perceptores}</td><td class="num">${fmtMoney(m111.trabajo.base)}</td><td class="num">${fmtMoney(m111.trabajo.ret)}</td></tr>
            <tr><td>Actividades profesionales</td><td class="num">${m111.profesionales.perceptores}</td><td class="num">${fmtMoney(m111.profesionales.base)}</td><td class="num">${fmtMoney(m111.profesionales.ret)}</td></tr>
            <tr><td style="font-weight:700">Total a ingresar</td><td></td><td></td><td class="num" style="font-weight:700">${fmtMoney(m111.total)}</td></tr></tbody></table></div>
          <div class="card-pad">${pagoFiscalBtn('111-' + clave, 'Hacienda · retenciones (111/115)', m111.total, `Modelo 111 · ${t}T ${anio}`)}</div></div>
        <div class="card"><div class="card-head"><div><h3>Modelo 115 · Retenciones de alquileres</h3><p>${m115.perceptores} arrendador(es) · base ${fmtMoney(m115.base)}</p></div></div>
          <div class="card-pad"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><b>${fmtMoney(m115.total)}</b>${pagoFiscalBtn('115-' + clave, 'Hacienda · retenciones (111/115)', m115.total, `Modelo 115 · ${t}T ${anio}`)}</div></div></div>
      </div>
    </div>
    <div class="grid g-2 mt">
      <div class="card"><div class="card-head"><div><h3>Seguridad Social (RLC / RNT)</h3><p>Se paga por domiciliación el último día hábil del mes siguiente</p></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mes</th><th class="num">Trab.</th><th class="num">Cuota obrera</th><th class="num">Cuota patronal</th><th class="num">Total</th><th></th></tr></thead><tbody>
          ${meses.map((m) => `<tr><td>${nombrePeriodo(m.periodo)}</td><td class="num">${m.trabajadores}</td><td class="num">${fmtMoney(m.obrera)}</td><td class="num">${fmtMoney(m.patronal)}</td><td class="num"><b>${fmtMoney(m.total)}</b></td><td class="num">${pagoFiscalBtn('SS-' + m.periodo, 'Seguridad Social', m.total, `Seguros sociales ${nombrePeriodo(m.periodo)}`, true)}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><div><h3>Impuesto sobre Sociedades ${anio} (estimación)</h3><p>Modelo 200 · se presenta del 1 al 25 de julio de ${anio + 1}</p></div></div>
        <div class="card-pad"><table class="mini-tbl"><tbody>${filaImporte('Resultado contable estimado del año', anual.explotacion)}${filaImporte(`Cuota estimada (${fmtPct(finFiscal('tipoIS'))})`, anual.is, { b: 1 })}${filaImporte('Resultado después de impuestos', anual.neto)}</tbody></table>
        <p class="hint">Sin ajustes fiscales, bases negativas de años anteriores ni pagos fraccionados (modelo 202). El tipo se configura en Configuración (25 % general; las empresas de reducida dimensión y de nueva creación pueden tener un tipo menor).</p>
        <div>${pagoFiscalBtn('IS-' + anio, 'Impuesto sobre Sociedades', anual.is, `Impuesto sobre Sociedades ${anio}`)}</div></div></div>
    </div>
    <div class="card mt card-pad"><h3 style="font-size:15px;margin-bottom:8px">Calendario fiscal ${anio}</h3>
      <div class="kv">${[1, 2, 3, 4].map((x) => `<div><small>${x}.º trimestre · 303, 111 y 115</small><span>${plazoTrimestral(anio, x)}</span></div>`).join('')}<div><small>Resúmenes anuales 390, 190 y 180</small><span>1 al 30 de enero de ${anio + 1}</span></div><div><small>Declaración de operaciones con terceros (347)</small><span>Febrero de ${anio + 1}</span></div><div><small>Impuesto sobre Sociedades (200)</small><span>1 al 25 de julio de ${anio + 1}</span></div></div>
      ${avisoFiscal()}</div>`;
  bindPeriodo('/impuestos');
  bindPagosFiscales();
}

/* ==========================================================
   BALANCE Y RESULTADOS
   ========================================================== */
function Resultados(query = {}) {
  const anio = +query.anio || new Date().getFullYear(), t = +query.t || 0;
  const rg = rangoPeriodo(anio, t), r = cuentaResultados(rg), b = balanceSituacion();
  const pct = (v) => (r.ventas ? ` <small class="muted">${fmtNumero((v / r.ventas) * 100, 1)} %</small>` : '');
  const periodoTxt = t ? `${t}.º trimestre de ${anio}` : `año ${anio}`;
  const meses = mesesDeRango(rg);
  const porMes = meses.map((m) => cuentaResultados([m + '-01', finDeMes(m)]));
  view.innerHTML = pageHead('Balance y resultados', `Cuenta de pérdidas y ganancias del ${periodoTxt} y situación a ${fmtDate(todayISO())}`, selPeriodo(anio, t)) + avisoFin() +
    kpis([
      ['Ventas (sin IVA)', fmtMoney(r.ventas), 'trend', periodoTxt],
      ['Gastos totales', fmtMoney(r.aprov + r.personal + r.otrosGastos), 'cash', 'Compras, personal y otros'],
      ['Resultado antes de impuestos', fmtMoney(r.explotacion), 'wallet', r.ventas ? `Margen ${fmtNumero((r.explotacion / r.ventas) * 100, 1)} %` : ''],
      ['Tesorería disponible', fmtMoney(b.activo[0][1] + b.activo[1][1]), 'shield', 'Bancos + caja'],
    ]) +
    `<div class="grid g-main mt">
      <div class="card"><div class="card-head"><div><h3>Cuenta de pérdidas y ganancias</h3><p>Criterio de devengo: facturas por su fecha, nóminas por su mes</p></div><button class="btn sm" id="csvPyg">${ico('download')}CSV</button></div>
        <div class="tbl-wrap"><table class="tbl" id="pyg"><tbody>
          ${filaImporte('1. Importe neto de la cifra de negocios (ventas)', r.ventas, { b: 1 })}
          ${r.otrosIngresos ? filaImporte('5. Otros ingresos de explotación', r.otrosIngresos) : ''}
          ${filaImporte('4. Aprovisionamientos', -r.aprov, { b: 1 })}
          ${filaImporte('a) Consumo de materiales', -r.materiales, { indent: 1 })}
          ${filaImporte('b) Trabajos realizados por otras empresas (subcontratas)', -r.subcontratas, { indent: 1 })}
          <tr><td style="font-weight:700;background:var(--surface-2)">Margen bruto${pct(r.margenBruto)}</td><td class="num" style="font-weight:700;background:var(--surface-2)">${fmtMoney(r.margenBruto)}</td></tr>
          ${filaImporte('6. Gastos de personal', -r.personal, { b: 1 })}
          ${filaImporte('a) Sueldos y salarios', -r.sueldos, { indent: 1 })}
          ${filaImporte('b) Cargas sociales (Seguridad Social a cargo de la empresa)', -r.cargas, { indent: 1 })}
          ${filaImporte('7. Otros gastos de explotación', -r.otrosGastos, { b: 1 })}
          ${r.otros.map(([k, v]) => filaImporte(esc(k), -v, { indent: 1 })).join('')}
          <tr><td style="font-weight:800;background:var(--surface-2)">A) Resultado de explotación${pct(r.explotacion)}</td><td class="num" style="font-weight:800;background:var(--surface-2);color:${r.explotacion >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtMoney(r.explotacion)}</td></tr>
          ${filaImporte(`Impuesto sobre beneficios estimado (${fmtPct(finFiscal('tipoIS'))})`, -r.is)}
          <tr><td style="font-weight:800">Resultado del ejercicio${pct(r.neto)}</td><td class="num" style="font-weight:800;font-size:16px;color:${r.neto >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtMoney(r.neto)}</td></tr>
        </tbody></table></div>
        <div class="card-pad"><div id="chRes"></div></div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-head"><div><h3>Balance de situación</h3><p>Simplificado, a fecha de hoy</p></div></div>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            <tr><td colspan="2"><b>ACTIVO CORRIENTE</b></td></tr>${b.activo.map(([k, v]) => filaImporte(esc(k), v, { indent: 1 })).join('')}${filaImporte('Total activo', b.tA, { b: 1 })}
            <tr><td colspan="2"><b>PASIVO CORRIENTE</b></td></tr>${b.pasivo.map(([k, v]) => filaImporte(esc(k), v, { indent: 1 })).join('')}${filaImporte('Total pasivo', b.tP, { b: 1 })}
            <tr><td style="font-weight:800">Fondo de maniobra (activo − pasivo)</td><td class="num" style="font-weight:800;color:${b.neto >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtMoney(b.neto)}</td></tr>
          </tbody></table></div>
          <p class="hint" style="padding:0 16px 14px">No incluye inmovilizado (vehículos, maquinaria), préstamos pendientes ni capital social: para el balance oficial de las cuentas anuales, tu gestoría parte de la contabilidad completa.</p></div>
        <div class="card card-pad"><h3 style="font-size:15px;margin-bottom:8px">Indicadores</h3><div class="kv" style="grid-template-columns:1fr 1fr">${[
          ['Margen bruto', r.ventas ? fmtNumero((r.margenBruto / r.ventas) * 100, 1) + ' %' : '—'],
          ['Margen neto', r.ventas ? fmtNumero((r.neto / r.ventas) * 100, 1) + ' %' : '—'],
          ['Peso del personal', r.ventas ? fmtNumero((r.personal / r.ventas) * 100, 1) + ' %' : '—'],
          ['Liquidez (activo / pasivo)', b.tP ? fmtNumero(b.tA / b.tP, 2) : '—'],
          ['Pendiente de cobro', fmtMoney(b.activo[2][1])],
          ['Pendiente de pago a proveedores', fmtMoney(b.pasivo[0][1])],
        ].map(([k, v]) => `<div><small>${k}</small><span style="font-weight:700">${v}</span></div>`).join('')}</div></div>
      </div>
    </div>`;
  bindPeriodo('/resultados');
  Charts.bars2($('#chRes'), { labels: meses.map((m) => MESES[+m.slice(5) - 1].slice(0, 3)), series: [{ label: 'Ingresos', color: 'var(--series-1)', values: porMes.map((x) => x.ventas + x.otrosIngresos) }, { label: 'Gastos', color: 'var(--series-2)', values: porMes.map((x) => x.aprov + x.personal + x.otrosGastos) }] });
  $('#csvPyg').addEventListener('click', () => downloadFile(`cuenta-resultados-${anio}${t ? '-T' + t : ''}.csv`, '﻿' + $$('#pyg tr').map((tr) => [...tr.children].map((td) => `"${td.textContent.trim().replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv'));
}

/* ==========================================================
   COSTES DE OBRA
   ========================================================== */
function Obras() {
  const lista = DB.cotizaciones.filter((c) => ['Aprobado', 'Facturado'].includes(c.estado) || DB.compras.some((x) => x.obraId === c.id) || DB.nominas.some((n) => n.obraId === c.id)).map((c) => ({ ...c, _o: obraCostes(c) }));
  const gen = comprasActivas().filter((c) => !c.obraId);
  view.innerHTML = pageHead('Costes de obra', 'Rentabilidad de cada obra: lo presupuestado o facturado frente a materiales, subcontratas, mano de obra y otros gastos') + avisoFin() +
    kpis([
      ['Obras', lista.length, 'quote', 'Presupuestos aceptados'],
      ['Ingresos de obras (sin IVA)', fmtMoney(sumBy(lista, (c) => c._o.ingreso)), 'trend', 'Facturado o, si no, presupuestado'],
      ['Costes imputados', fmtMoney(sumBy(lista, (c) => c._o.coste)), 'cash', 'Materiales, subcontratas, personal, otros'],
      ['Gastos generales sin obra', fmtMoney(sumBy(gen, (c) => compraCalc(c).coste)), 'layout', 'Estructura de la empresa'],
    ]) +
    `<div class="card mt" id="tbl"></div>`;
  DataTable($('#tbl'), {
    rows: () => lista, placeholder: 'Obra, cliente, número…', searchText: (c) => [c.numero, c.proyecto, clienteNombre(c.clienteId)].join(' '),
    chips: [{ k: 'all', label: 'Todas' }, { k: 'curso', label: 'En curso', test: (c) => c.estado === 'Aprobado' }, { k: 'fac', label: 'Facturadas', test: (c) => c.estado === 'Facturado' }, { k: 'neg', label: 'Con pérdidas', test: (c) => c._o.margen < 0 }],
    sort: 'ingreso', csv: 'costes-obra',
    columns: [
      { k: 'proyecto', label: 'Obra', render: (c) => `<b>${esc(c.proyecto)}</b><div class="muted">${esc(c.numero)} · ${esc(clienteNombre(c.clienteId))}</div>` },
      { k: 'ingreso', label: 'Ingreso', cls: 'num', sort: (c) => c._o.ingreso, render: (c) => `${fmtMoney(c._o.ingreso)}<div class="muted">${c._o.facturado ? 'facturado' : 'presupuestado'}</div>`, csv: (c) => fmtNumero(c._o.ingreso) },
      { k: 'mat', label: 'Materiales', cls: 'num', sort: (c) => c._o.materiales, render: (c) => fmtMoney(c._o.materiales), csv: (c) => fmtNumero(c._o.materiales) },
      { k: 'sub', label: 'Subcontratas', cls: 'num', sort: (c) => c._o.subcontratas, render: (c) => fmtMoney(c._o.subcontratas), csv: (c) => fmtNumero(c._o.subcontratas) },
      { k: 'mo', label: 'Mano de obra', cls: 'num', sort: (c) => c._o.manoObra, render: (c) => fmtMoney(c._o.manoObra), csv: (c) => fmtNumero(c._o.manoObra) },
      { k: 'otros', label: 'Otros', cls: 'num', sort: (c) => c._o.otros, render: (c) => fmtMoney(c._o.otros), csv: (c) => fmtNumero(c._o.otros) },
      { k: 'margen', label: 'Margen', cls: 'num', sort: (c) => c._o.margen, render: (c) => `<b style="color:${c._o.margen >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmtMoney(c._o.margen)}</b><div class="muted">${fmtNumero(c._o.pct, 1)} %</div>`, csv: (c) => fmtNumero(c._o.margen) },
      { k: 'estado', label: 'Estado', render: (c) => badge(cotEstado(c)) },
    ],
    footer: (r) => `Ingresos ${fmtMoney(sumBy(r, (c) => c._o.ingreso))} · Costes ${fmtMoney(sumBy(r, (c) => c._o.coste))} · Margen ${fmtMoney(sumBy(r, (c) => c._o.margen))}`,
    onRow: (c) => go('/obras/' + c.id),
    empty: 'Cuando un presupuesto se aprueba pasa a ser una obra. Imputa compras y nóminas a la obra para ver su rentabilidad.',
  });
}
function ObraDetalle(id) {
  const c = getCot(id); if (!c) return notFound();
  const o = obraCostes(c), puedeNom = puedeVer('nominas');
  const barra = (l, v, color) => `<div style="display:grid;grid-template-columns:150px 1fr 110px;gap:10px;align-items:center;margin:8px 0"><span style="font-size:12.5px;color:var(--text-2)">${l}</span><div style="height:14px;background:var(--muted-bg);border-radius:6px;overflow:hidden"><div style="height:100%;width:${o.ingreso ? Math.min(100, (v / o.ingreso) * 100) : 0}%;background:${color}"></div></div><span class="num" style="text-align:right">${fmtMoney(v)}</span></div>`;
  view.innerHTML = pageHead(esc(c.proyecto), `${esc(c.numero)} · ${esc(clienteNombre(c.clienteId))} · ${cotEstado(c)}`,
    `<a class="btn" href="#/cotizaciones/${id}">${ico('quote')}Ver presupuesto</a>${puedeGestionar('compras') ? `<a class="btn primary" href="#/compras/nueva?obra=${id}">${ico('plus')}Gasto de esta obra</a>` : ''}`,
    `<a href="#/obras">Costes de obra</a> / ${esc(c.numero)}`) + avisoFin() +
    kpis([
      ['Ingreso (sin IVA)', fmtMoney(o.ingreso), 'trend', o.facturado ? 'Facturado' : 'Presupuestado'],
      ['Coste real', fmtMoney(o.coste), 'cash', o.costeEstimado ? `Estimado según inventario: ${fmtMoney(o.costeEstimado)}` : ''],
      ['Margen', fmtMoney(o.margen), 'wallet', `${fmtNumero(o.pct, 1)} % sobre ingreso`],
      ['Cobrado del cliente', fmtMoney(o.cobrado), 'check', 'IVA incluido'],
    ]) +
    `<div class="grid g-2 mt"><div class="card card-pad"><h3 style="font-size:15px;margin-bottom:6px">Reparto del ingreso</h3>
      ${barra('Materiales', o.materiales, 'var(--series-1)')}${barra('Subcontratas', o.subcontratas, 'var(--seq-2)')}${barra('Mano de obra', o.manoObra, 'var(--series-2)')}${barra('Otros gastos', o.otros, 'var(--seq-1)')}${barra('Margen', Math.max(0, o.margen), 'var(--series-3)')}
      ${!puedeNom ? '<p class="hint">Tu rol no tiene acceso a Nóminas: la mano de obra puede no estar incluida.</p>' : ''}</div>
      <div class="card"><div class="card-head"><div><h3>Presupuesto frente a coste estimado</h3><p>Coste de inventario × cantidad presupuestada</p></div></div><div class="tbl-wrap"><table class="tbl" style="font-size:12.5px"><thead><tr><th>Partida</th><th class="num">Venta</th><th class="num">Coste est.</th><th class="num">Margen</th></tr></thead><tbody>
        ${(c.items || []).map((it) => { const inv = invDeLinea(it), venta = lineCalc(it).base, coste = inv ? (+it.cantidad || 0) * (+inv.costo || 0) : null; return `<tr><td>${esc(it.concepto)}${inv ? '' : '<div class="muted">sin coste en inventario</div>'}</td><td class="num">${fmtMoney(venta)}</td><td class="num">${coste === null ? '—' : fmtMoney(coste)}</td><td class="num">${coste === null ? '—' : fmtMoney(venta - coste)}</td></tr>`; }).join('')}
      </tbody></table></div></div></div>
    <div class="card mt"><div class="card-head"><h3>Compras y gastos imputados (${o.compras.length})</h3></div><div id="tC"></div></div>
    ${puedeNom ? `<div class="card mt"><div class="card-head"><h3>Mano de obra · nóminas imputadas (${o.noms.length})</h3></div><div id="tN"></div></div>` : ''}`;
  DataTable($('#tC'), { rows: () => o.compras, searchText: (x) => x.numero + provNombre(x.proveedorId) + x.categoria, sort: 'fecha', columns: compraColumns(), onRow: (x) => go('/compras/' + x.id), empty: 'Sin compras imputadas a esta obra.', pageSize: 8 });
  if (puedeNom) DataTable($('#tN'), { rows: () => o.noms, searchText: (n) => empNombre(n.empleadoId) + n.periodo, sort: 'periodo', pageSize: 8, columns: [{ k: 'periodo', label: 'Mes', render: (n) => nombrePeriodo(n.periodo) }, { k: 'emp', label: 'Empleado', sort: (n) => empNombre(n.empleadoId), render: (n) => esc(empNombre(n.empleadoId)) }, { k: 'pct', label: '% en la obra', cls: 'num', sort: (n) => pctObra(n), render: (n) => fmtPct(pctObra(n)) }, { k: 'coste', label: 'Coste imputado', cls: 'num', sort: (n) => nominaCalc(n).coste * pctObra(n), render: (n) => fmtMoney(nominaCalc(n).coste * pctObra(n) / 100) }], onRow: (n) => go('/nominas/' + n.id), empty: 'Sin nóminas imputadas. Asigna la obra en la nómina o en la ficha del empleado.' });
}
