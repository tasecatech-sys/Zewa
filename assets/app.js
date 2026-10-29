/* ==========================================================
   ZEWÁ · Sistema de Presupuestos y Facturación — aplicación
   Ciclo: Cliente → Presupuesto → Cobro → Factura → Pago final
   ========================================================== */
Store.load();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ico = (n, cls = 'i') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const view = $('#view');

/* ---------------- UI básicos ---------------- */
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${ico(kind === 'bad' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2800);
  setTimeout(() => t.remove(), 3200);
}
window.toast = toast;

function modal({ title, body, size = '', okText = 'Guardar', cancelText = 'Cancelar', onOk, onOpen, hideOk = false }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button class="btn icon ghost" data-x aria-label="Cerrar">${ico('x')}</button></header>
    <div class="body">${body}</div><footer><button class="btn" data-x>${cancelText}</button>${hideOk ? '' : `<button class="btn primary" data-ok>${okText}</button>`}</footer></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  ov.querySelector('[data-ok]')?.addEventListener('click', async () => { if (!onOk || (await onOk(ov)) !== false) close(); });
  onOpen?.(ov);
  ov.querySelector('input,select,textarea')?.focus();
  return { el: ov, close };
}
const confirmBox = (title, text, okText = 'Confirmar') => new Promise((res) => {
  let done = false;
  const m = modal({ title, body: `<p style="margin:0;color:var(--text-2)">${text}</p>`, okText, onOk: () => { done = true; res(true); } });
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) res(false); } });
  obs.observe(document.body, { childList: true });
});

const ESTADO_CLASS = {
  Pagada: 'b-ok', Aplicado: 'b-ok', Aprobada: 'b-ok', Aprobado: 'b-ok', Facturada: 'b-info', Facturado: 'b-info', Activa: 'b-ok',
  Pendiente: 'b-warn', Enviada: 'b-warn', Enviado: 'b-warn', 'Por vencer': 'b-warn',
  Vencida: 'b-bad', Vencido: 'b-bad', Anulada: 'b-muted', Anulado: 'b-muted', Inactiva: 'b-muted',
  'En Proceso': 'b-info', Borrador: 'b-muted',
};
const badge = (e) => `<span class="badge ${ESTADO_CLASS[e] || 'b-muted'}">${esc(e)}</span>`;
const pageHead = (title, sub, actions = '', crumbs = '') => `<div class="page-head"><div>${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="btn-row">${actions}</div></div>`;
const emptyState = (txt, icon = 'folder') => `<div class="empty">${ico(icon)}<div>${txt}</div></div>`;
const clienteNombre = (id) => getCliente(id)?.razonSocial || '—';
const go = (h) => { location.hash = h; };
const persist = () => Store.save();

function downloadFile(name, content, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = content instanceof Blob ? URL.createObjectURL(content) : content.startsWith?.('data:') ? content : URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const readFileAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const readFileAsText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });

/* ---------------- Tabla avanzada reutilizable ---------------- */
function DataTable(el, cfg) {
  const st = { q: '', chip: cfg.chips?.[0]?.k ?? null, sort: cfg.sort ?? null, dir: cfg.dir ?? -1, page: 0 };
  const size = cfg.pageSize || 12;
  el.innerHTML = `<div class="tbl-tools">
      <div class="search">${ico('search')}<input type="search" placeholder="${cfg.placeholder || 'Filtrar…'}" aria-label="Filtrar tabla"></div>
      ${cfg.chips ? `<div class="chips">${cfg.chips.map((c) => `<button class="chip" data-chip="${c.k}">${c.label}</button>`).join('')}</div>` : ''}
      <div style="margin-left:auto" class="btn-row">${cfg.tools || ''}${cfg.csv ? `<button class="btn sm" data-csv>${ico('download')}CSV</button>` : ''}</div>
    </div><div class="tbl-wrap"><table class="tbl"><thead></thead><tbody></tbody></table></div><div class="tbl-foot"></div>`;
  const rowsFiltered = () => {
    let rows = cfg.rows();
    if (st.chip != null) { const c = cfg.chips.find((x) => x.k === st.chip); if (c?.test) rows = rows.filter(c.test); }
    if (st.q) { const q = norm(st.q); rows = rows.filter((r) => norm(cfg.searchText(r)).includes(q)); }
    if (st.sort) {
      const col = cfg.columns.find((c) => c.k === st.sort);
      const f = col.sort || ((r) => r[col.k]);
      rows = [...rows].sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    }
    return rows;
  };
  const render = () => {
    const rows = rowsFiltered();
    const pages = Math.max(1, Math.ceil(rows.length / size));
    st.page = Math.min(st.page, pages - 1);
    $('thead', el).innerHTML = `<tr>${cfg.columns.map((c) => `<th class="${c.cls || ''} ${c.nosort ? '' : 'sortable'} ${st.sort === c.k ? 'sorted' : ''}" data-k="${c.k}">${c.label}${c.nosort ? '' : `<span class="arr">${st.sort === c.k ? (st.dir > 0 ? '↑' : '↓') : '↕'}</span>`}</th>`).join('')}</tr>`;
    const slice = rows.slice(st.page * size, st.page * size + size);
    $('tbody', el).innerHTML = slice.length ? slice.map((r, i) => `<tr class="${cfg.onRow ? 'click' : ''}" data-i="${st.page * size + i}">${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cfg.columns.length}">${emptyState(cfg.empty || 'Sin resultados para los filtros aplicados.', 'search')}</td></tr>`;
    $('.tbl-foot', el).innerHTML = `<span>${rows.length} registro${rows.length === 1 ? '' : 's'}${cfg.footer ? ' · ' + cfg.footer(rows) : ''}</span>
      <span class="btn-row"><button class="btn sm" data-pg="-1" ${st.page === 0 ? 'disabled' : ''}>Anterior</button><span style="align-self:center">Pág. ${st.page + 1} de ${pages}</span><button class="btn sm" data-pg="1" ${st.page >= pages - 1 ? 'disabled' : ''}>Siguiente</button></span>`;
    $$('.chip', el).forEach((c) => c.classList.toggle('on', c.dataset.chip === String(st.chip)));
    el._rows = rows;
  };
  $('.search input', el).addEventListener('input', (e) => { st.q = e.target.value; st.page = 0; render(); });
  el.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (th) { st.dir = st.sort === th.dataset.k ? -st.dir : 1; st.sort = th.dataset.k; render(); return; }
    const ch = e.target.closest('[data-chip]');
    if (ch) { st.chip = ch.dataset.chip; st.page = 0; render(); return; }
    const pg = e.target.closest('[data-pg]');
    if (pg) { st.page += +pg.dataset.pg; render(); return; }
    if (e.target.closest('[data-csv]')) {
      const rows = el._rows, cols = cfg.columns.filter((c) => !c.nocsv);
      const val = (c, r) => String(c.csv ? c.csv(r) : c.sort ? c.sort(r) : r[c.k] ?? '').replace(/"/g, '""');
      downloadFile(cfg.csv + '.csv', '﻿' + [cols.map((c) => `"${c.label}"`).join(';'), ...rows.map((r) => cols.map((c) => `"${val(c, r)}"`).join(';'))].join('\n'), 'text/csv');
      return;
    }
    const tr = e.target.closest('tbody tr[data-i]');
    if (tr && cfg.onRow && !e.target.closest('button,a,input,select')) cfg.onRow(el._rows[+tr.dataset.i]);
  });
  render();
  return { render };
}

/* ---------------- Navegación ---------------- */
const NAV = [
  { h: 'dashboard', label: 'Panel de control', icon: 'home', group: 'General' },
  { h: 'busqueda', label: 'Búsqueda inteligente', icon: 'search' },
  { h: 'clientes', label: 'Clientes', icon: 'users', group: 'Comercial', count: () => DB.clientes.length },
  { h: 'inventario', label: 'Inventario', icon: 'tag', count: () => DB.inventario.filter((i) => i.estado !== 'Inactivo').length },
  { h: 'cotizaciones', label: 'Presupuestos', icon: 'quote', count: () => DB.cotizaciones.filter((c) => ['Borrador', 'Enviado', 'Aprobado'].includes(cotEstado(c))).length },
  { h: 'abonos', label: 'Cobros', icon: 'cash' },
  { h: 'facturas', label: 'Facturación', icon: 'invoice', count: () => DB.facturas.filter((f) => ['Pendiente', 'Vencida', 'En Proceso'].includes(facturaEstado(f))).length },
  { h: 'plantillas', label: 'Plantillas', icon: 'layout', group: 'Administración' },
  { h: 'documentos', label: 'Gestión documental', icon: 'folder' },
  { h: 'auditoria', label: 'Auditoría', icon: 'shield' },
  { h: 'usuarios', label: 'Usuarios y permisos', icon: 'users', count: () => DB.usuarios.filter((u) => u.activo !== false).length },
  { h: 'config', label: 'Configuración', icon: 'settings' },
];
function renderNav(active) {
  let g = '';
  const grupos = NAV.map((n) => { g = n.group || g; return { ...n, g }; });
  let last = null;
  $('#nav').innerHTML = grupos.filter((n) => puedeVer(n.h)).map((n) => {
    const head = n.g !== last ? `<div class="nav-label">${n.g}</div>` : '';
    last = n.g;
    return `${head}<a href="#/${n.h}" class="${active === n.h ? 'active' : ''}">${ico(n.icon)}<span>${n.label}</span>${n.count ? `<span class="count">${n.count()}</span>` : ''}</a>`;
  }).join('');
}

/* ---------------- Router ---------------- */
function parseHash() {
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function primerModuloAccesible() { const n = NAV.find((x) => puedeVer(x.h)); return n ? '#/' + n.h : null; }
function accessDenied(modLabel) {
  const href = primerModuloAccesible();
  return pageHead('Acceso restringido', `Tu rol (${esc(rolDe(Store.user())?.nombre || '—')}) no tiene permiso para ver ${modLabel ? `"${esc(modLabel)}"` : 'este módulo'}.`,
    href ? `<a class="btn primary" href="${href}">${ico('arrow')}Ir a un módulo disponible</a>` : '');
}
function route() {
  const { parts, query } = parseHash();
  const [mod, a, b] = parts;
  view.onclick = null;
  $('#sidebar').classList.remove('open');
  view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  window.scrollTo(0, 0);
  const R = {
    dashboard: () => Dashboard(),
    clientes: () => (a === 'nuevo' ? ClienteForm() : a && b === 'editar' ? ClienteForm(a) : a ? ClienteDetalle(a, query.tab) : Clientes()),
    inventario: () => (a === 'nuevo' ? InventarioForm() : a && b === 'editar' ? InventarioForm(a) : Inventario()),
    cotizaciones: () => (a === 'nueva' ? DocEditor('cotizacion', null, query) : a && b === 'editar' ? DocEditor('cotizacion', a) : a ? CotDetalle(a, query.tab) : Cotizaciones(query)),
    facturas: () => (a === 'nueva' ? DocEditor('factura', null, query) : a && b === 'editar' ? DocEditor('factura', a) : a ? FacDetalle(a, query.tab) : Facturas(query)),
    abonos: () => (a === 'nuevo' ? AbonoForm(query) : a ? AbonoDetalle(a) : Abonos()),
    plantillas: () => (a ? PlantillaEditor(a, query) : Plantillas()),
    busqueda: () => Busqueda(query),
    documentos: () => Documentos(query),
    auditoria: () => Auditoria(),
    usuarios: () => (a === 'nuevo' ? UsuarioForm() : a === 'rol' && b === 'nuevo' ? RolForm() : a === 'rol' && b ? RolForm(b) : a && b === 'editar' ? UsuarioForm(a) : Usuarios(query)),
    config: () => Config(),
  };
  const modKey = R[mod] ? mod : 'dashboard';
  renderNav(modKey);
  if (!puedeVer(modKey)) { view.innerHTML = accessDenied(NAV.find((n) => n.h === modKey)?.label); hydrateWord(view); return; }
  R[modKey]();
  hydrateWord(view);
}
window.addEventListener('hashchange', route);

/* ==========================================================
   MÓDULO 1 · DASHBOARD
   ========================================================== */
function monthBuckets(n = 6) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') });
  }
  return out;
}
function Dashboard() {
  const today = todayISO();
  const cots = DB.cotizaciones.filter((c) => cotEstado(c) !== 'Anulado');
  const facs = DB.facturas.filter((f) => f.estado !== 'Anulada');
  const abos = DB.abonos.filter((a) => a.estado !== 'Anulado');
  const facturado = facs.reduce((s, f) => s + docTotals(f.items).total, 0);
  const abonado = abos.reduce((s, a) => s + +a.valor, 0);
  const saldoFact = facs.reduce((s, f) => s + facturaResumen(f).saldo, 0);
  const anticipos = abos.filter((a) => !a.facturaId).reduce((s, a) => s + +a.valor, 0);
  const porVencer = DB.cotizaciones.filter((c) => ['Enviado', 'Borrador'].includes(cotEstado(c)) && c.vence >= today && daysBetween(today, c.vence) <= 7);
  const pendientes = DB.facturas.filter((f) => ['Pendiente', 'En Proceso', 'Vencida'].includes(facturaEstado(f)));
  const kpis = [
    ['Presupuestos', cots.length, fmtMoney(cots.reduce((s, c) => s + docTotals(c.items).total, 0)) + ' presupuestado', 'quote', '#/cotizaciones'],
    ['Facturas', facs.length, `${pendientes.length} con saldo`, 'invoice', '#/facturas'],
    ['Cobros', abos.length, `${fmtMoney(anticipos)} en anticipos`, 'cash', '#/abonos'],
    ['Importe facturado', fmtMoney(facturado), 'Total histórico', 'trend', '#/facturas'],
    ['Importe cobrado', fmtMoney(abonado), 'Incluye anticipos', 'wallet', '#/abonos'],
    ['Pendiente de cobro', fmtMoney(saldoFact), 'Facturas por cobrar', 'alert', '#/facturas?f=pend'],
    ['Por vencer (7 días)', porVencer.length, 'Presupuestos abiertos', 'clock', '#/cotizaciones?f=vencer'],
    ['Facturas pendientes', pendientes.length, fmtMoney(pendientes.reduce((s, f) => s + facturaResumen(f).saldo, 0)), 'invoice', '#/facturas?f=pend'],
  ];
  const months = monthBuckets(6);
  const ventas = months.map((m) => facs.filter((f) => f.fecha.startsWith(m.key)).reduce((s, f) => s + docTotals(f.items).total, 0));
  const abMes = months.map((m) => abos.filter((a) => a.fecha.startsWith(m.key)).reduce((s, a) => s + +a.valor, 0));
  // cartera
  const cart = { aldia: 0, v30: 0, v30p: 0 };
  facs.forEach((f) => {
    const r = facturaResumen(f); if (r.saldo <= 0) return;
    const d = f.vence ? daysBetween(f.vence, today) : 0;
    if (d <= 0) cart.aldia += r.saldo; else if (d <= 30) cart.v30 += r.saldo; else cart.v30p += r.saldo;
  });
  // conversión
  const emitidas = DB.cotizaciones.filter((c) => c.estado !== 'Borrador');
  const aprob = emitidas.filter((c) => ['Aprobado', 'Facturado'].includes(c.estado));
  const factC = emitidas.filter((c) => c.estado === 'Facturado');
  const pagadas = factC.filter((c) => facturaEstado(getFac(c.facturaId)) === 'Pagada');
  const amt = (l) => l.reduce((s, c) => s + docTotals(c.items).total, 0);

  view.innerHTML = pageHead('Panel de control', `Resumen comercial al ${fmtDate(today)}`, `<a class="btn" href="#/abonos/nuevo">${ico('cash')}Registrar cobro</a><a class="btn primary" href="#/cotizaciones/nueva">${ico('plus')}Nuevo presupuesto</a>`) +
    `<div class="grid g-kpi">${kpis.map(([l, v, s, i, h]) => `<a class="card kpi" href="${h}" style="color:inherit"><span class="lbl"><span class="ico">${ico(i)}</span>${l}</span><span class="val">${v}</span><span class="sub">${s}</span></a>`).join('')}</div>
    <div class="grid g-2 mt">
      <div class="card"><div class="card-head"><div><h3>Ventas mensuales</h3><p>Importe facturado por mes · últimos 6 meses</p></div><button class="btn sm ghost chart-toggle" data-tbl="t-ventas">Ver tabla</button></div><div class="card-pad"><div id="ch-ventas"></div><div id="t-ventas" hidden></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Cobros recibidos</h3><p>Dinero recibido por mes</p></div><button class="btn sm ghost chart-toggle" data-tbl="t-abonos">Ver tabla</button></div><div class="card-pad"><div id="ch-abonos"></div><div id="t-abonos" hidden></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Estado de cobros</h3><p>Pendiente de cobro según vencimiento · ${fmtMoney(cart.aldia + cart.v30 + cart.v30p)}</p></div></div><div class="card-pad"><div id="ch-cartera"></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Conversión presupuesto → factura</h3><p>${emitidas.length ? Math.round((factC.length / emitidas.length) * 100) : 0}% de los presupuestos emitidos se facturaron</p></div></div><div class="card-pad"><div id="ch-funnel"></div></div></div>
    </div>
    <div class="grid g-main mt">
      <div class="card"><div class="card-head"><h3>Últimos movimientos</h3><a class="btn sm ghost" href="#/auditoria">Ver auditoría ${ico('arrow')}</a></div><div class="card-pad" style="padding-top:4px;padding-bottom:4px"><ul class="timeline">${DB.auditoria.slice(0, 7).map(auditItem).join('') || emptyState('Sin movimientos')}</ul></div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-head"><h3>Presupuestos por vencer</h3>${badge(porVencer.length + ' abiertos')}</div><div class="card-pad" style="padding-top:6px">${porVencer.length ? porVencer.map((c) => `<a href="#/cotizaciones/${c.id}" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);color:inherit"><span><b>${c.numero}</b><br><small style="color:var(--text-3)">${esc(clienteNombre(c.clienteId))}</small></span><span style="text-align:right">${fmtMoney(docTotals(c.items).total)}<br><small style="color:var(--warn)">vence en ${daysBetween(today, c.vence)} d</small></span></a>`).join('') : emptyState('Nada por vencer esta semana', 'check')}</div></div>
        <div class="card"><div class="card-head"><h3>Facturas pendientes</h3><a class="btn sm ghost" href="#/facturas?f=pend">Ver todas</a></div><div class="card-pad" style="padding-top:6px">${pendientes.slice(0, 5).map((f) => { const r = facturaResumen(f); return `<a href="#/facturas/${f.id}" style="display:block;padding:8px 0;border-bottom:1px solid var(--border);color:inherit"><span style="display:flex;justify-content:space-between"><b>${f.numero}</b>${badge(facturaEstado(f))}</span><small style="color:var(--text-3)">${esc(clienteNombre(f.clienteId))} · saldo ${fmtMoney(r.saldo)}</small><div class="progress" style="margin-top:6px"><i style="width:${(r.abonado / r.total) * 100}%"></i></div></a>`; }).join('') || emptyState('Cobros al día', 'check')}</div></div>
      </div>
    </div>`;
  const labels = months.map((m) => m.label);
  Charts.bars($('#ch-ventas'), { labels, values: ventas });
  Charts.area($('#ch-abonos'), { labels, values: abMes });
  Charts.stack($('#ch-cartera'), { parts: [{ label: 'Al día (no vencida)', value: cart.aldia, color: 'var(--info)' }, { label: 'Vencida 1–30 días', value: cart.v30, color: 'var(--warn)' }, { label: 'Vencida más de 30 días', value: cart.v30p, color: 'var(--bad)' }] });
  Charts.funnel($('#ch-funnel'), { steps: [{ label: 'Emitidos', value: emitidas.length, amount: amt(emitidas) }, { label: 'Aprobados', value: aprob.length, amount: amt(aprob) }, { label: 'Facturados', value: factC.length, amount: amt(factC) }, { label: 'Cobrados', value: pagadas.length, amount: amt(pagadas) }] });
  const miniTbl = (vals) => `<table class="mini-tbl"><tbody>${labels.map((l, i) => `<tr><td>${l}</td><td class="num">${fmtMoney(vals[i])}</td></tr>`).join('')}</tbody></table>`;
  $('#t-ventas').innerHTML = miniTbl(ventas); $('#t-abonos').innerHTML = miniTbl(abMes);
  $$('.chart-toggle').forEach((b) => b.addEventListener('click', () => { const t = $('#' + b.dataset.tbl); t.hidden = !t.hidden; b.textContent = t.hidden ? 'Ver tabla' : 'Ocultar tabla'; }));
}
const AUD_ICON = { Crear: 'plus', Editar: 'edit', Eliminar: 'trash', Anular: 'x', Convertir: 'arrow', Registrar: 'cash', Firmar: 'pen', Enviar: 'mail', Descargar: 'download', Duplicar: 'copy', Subir: 'upload', Activar: 'check', Estado: 'tag', Restaurar: 'clock' };
function auditItem(a) {
  return `<li><span class="dot">${ico(AUD_ICON[a.accion] || 'clock')}</span><div><b>${esc(a.accion)} ${esc(a.entidad)}</b> <span style="color:var(--brand)">${esc(a.ref)}</span><br><span style="color:var(--text-2)">${esc(a.detalle)}</span><small>${esc(a.usuario)} · ${fmtDateTime(a.fecha)}</small>
    ${a.cambios?.length ? `<div class="diff">${a.cambios.slice(0, 5).map((c) => `<div><b>${esc(c.campo)}:</b> <del>${esc(String(c.antes).slice(0, 60))}</del> → <ins>${esc(String(c.despues).slice(0, 60))}</ins></div>`).join('')}</div>` : ''}</div></li>`;
}

/* ==========================================================
   MÓDULO 2 · CLIENTES
   ========================================================== */
function clienteStats(c) {
  const cots = DB.cotizaciones.filter((x) => x.clienteId === c.id);
  const facs = DB.facturas.filter((x) => x.clienteId === c.id && x.estado !== 'Anulada');
  const abos = DB.abonos.filter((x) => x.clienteId === c.id && x.estado !== 'Anulado');
  return { cots, facs, abos, comprado: facs.reduce((s, f) => s + docTotals(f.items).total, 0), pagado: sumAbonos(abos), saldo: facs.reduce((s, f) => s + facturaResumen(f).saldo, 0) };
}
function Clientes() {
  view.innerHTML = pageHead('Clientes', 'Empresas y personas con las que tienes relación comercial', puedeGestionar('clientes') ? `<a class="btn primary" href="#/clientes/nuevo">${ico('plus')}Nuevo cliente</a>` : '') + `<div class="card" id="tbl"></div>`;
  DataTable($('#tbl'), {
    rows: () => DB.clientes.map((c) => ({ ...c, _s: clienteStats(c) })),
    placeholder: 'Buscar por nombre, NIF, localidad, correo…',
    searchText: (c) => [c.codigo, c.razonSocial, c.nombreComercial, c.nit, c.email, c.ciudad, c.contacto, c.celular, c.telefono].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, { k: 'J', label: 'Jurídica', test: (c) => c.tipo === 'Jurídica' }, { k: 'F', label: 'Física', test: (c) => c.tipo === 'Física' }, { k: 'deuda', label: 'Con saldo', test: (c) => c._s.saldo > 0 }],
    sort: 'razonSocial', dir: 1, csv: 'clientes',
    columns: [
      { k: 'codigo', label: 'ID', render: (c) => `<span class="muted">${c.codigo}</span>` },
      { k: 'razonSocial', label: 'Razón social', render: (c) => `<div class="strong">${esc(c.razonSocial)}</div><div class="muted">${esc(c.nombreComercial || '')}</div>` },
      { k: 'nit', label: 'NIF' },
      { k: 'tipo', label: 'Tipo', render: (c) => `<span class="tag">${c.tipo}</span>` },
      { k: 'ciudad', label: 'Localidad', render: (c) => `${esc(c.ciudad)}<div class="muted">${esc(c.departamento)}</div>` },
      { k: 'email', label: 'Contacto', render: (c) => `${esc(c.contacto || '')}<div class="muted">${esc(c.email)}</div>` },
      { k: 'comprado', label: 'Facturado', cls: 'num', sort: (c) => c._s.comprado, render: (c) => fmtMoney(c._s.comprado) },
      { k: 'saldo', label: 'Saldo', cls: 'num', sort: (c) => c._s.saldo, render: (c) => c._s.saldo > 0 ? `<b style="color:var(--warn)">${fmtMoney(c._s.saldo)}</b>` : `<span class="muted">Al día</span>` },
    ],
    onRow: (c) => go('/clientes/' + c.id),
  });
}
const CLIENTE_FIELDS = [
  ['sec', 'Identificación'],
  ['codigo', 'ID Cliente', 's3', { readonly: true }],
  ['tipo', 'Tipo persona', 's3', { req: 1, options: ['Jurídica', 'Física'] }],
  ['nit', 'NIF / CIF', 's6', { req: 1 }],
  ['razonSocial', 'Razón social', 's6', { req: 1 }],
  ['nombreComercial', 'Nombre comercial', 's6', { req: 1 }],
  ['sec', 'Contacto'],
  ['telefono', 'Teléfono', 's3', { req: 1 }],
  ['celular', 'Móvil', 's3', { req: 1 }],
  ['email', 'Correo electrónico', 's6', { req: 1, type: 'email' }],
  ['contacto', 'Contacto principal', 's6', { req: 1 }],
  ['cargo', 'Cargo del contacto', 's6', { req: 1 }],
  ['sec', 'Ubicación'],
  ['direccion', 'Dirección', 's4', { req: 1 }],
  ['codigoPostal', 'Código postal', 's2'],
  ['ciudad', 'Localidad', 's2', { req: 1 }],
  ['departamento', 'Provincia', 's2', { req: 1 }],
  ['pais', 'País', 's2', { req: 1 }],
  ['observaciones', 'Observaciones', 's12', { textarea: 1 }],
];
function fieldHTML([k, label, span, o = {}], val) {
  if (k === 'sec') return `<div class="section-title">${label}</div>`;
  const v = esc(val ?? '');
  const ctl = o.options ? `<select class="in" name="${k}">${o.options.map((x) => `<option ${x === val ? 'selected' : ''}>${x}</option>`).join('')}</select>`
    : o.textarea ? `<textarea class="in" name="${k}">${v}</textarea>`
      : `<input class="in" name="${k}" type="${o.type || 'text'}" value="${v}" ${o.readonly ? 'readonly' : ''}>`;
  return `<div class="f ${span}"><label>${label}${o.req ? ' <span class="req">*</span>' : ''}</label>${ctl}</div>`;
}
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function validateRequired(form, fields) {
  let ok = true;
  fields.forEach(([k, , , o]) => {
    const el = form.elements[k];
    if (!el || !o?.req) return;
    // El teléfono fijo es opcional si hay móvil (y viceversa)
    const bad = !String(el.value).trim() && !(k === 'telefono' && form.elements.celular.value.trim()) && !(k === 'celular' && form.elements.telefono.value.trim());
    el.classList.toggle('invalid', bad); if (bad) ok = false;
  });
  if (form.elements.email && form.elements.email.value && !/^\S+@\S+\.\S+$/.test(form.elements.email.value)) { form.elements.email.classList.add('invalid'); ok = false; }
  return ok;
}
function ClienteForm(id) {
  if (denyGestionar('clientes', id ? '/clientes/' + id : '/clientes')) return;
  const c = id ? getCliente(id) : { codigo: '(se asigna al guardar)', tipo: 'Jurídica', pais: 'España' };
  if (!c) return notFound();
  view.innerHTML = pageHead(id ? 'Editar cliente' : 'Nuevo cliente', id ? esc(c.razonSocial) : 'Los campos con * son obligatorios', '', `<a href="#/clientes">Clientes</a> / ${id ? esc(c.codigo) : 'Nuevo'}`) +
    `<form class="card card-pad" id="frm" novalidate><div class="form-grid">${CLIENTE_FIELDS.map((f) => fieldHTML(f, c[f[0]])).join('')}</div>
     <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="${id ? '#/clientes/' + id : '#/clientes'}">Cancelar</a><button class="btn primary">${ico('check')}Guardar cliente</button></div></form>`;
  const form = $('#frm');
  form.tipo.addEventListener('change', () => { if (form.tipo.value === 'Física' && !form.nombreComercial.value) form.nombreComercial.value = form.razonSocial.value; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateRequired(form, CLIENTE_FIELDS)) return toast('Revisa los campos obligatorios marcados en rojo.', 'bad');
    const v = formValues(form); delete v.codigo;
    const dup = DB.clientes.find((x) => x.nit.replace(/\D/g, '') === v.nit.replace(/\D/g, '') && x.id !== id);
    if (dup) { form.nit.classList.add('invalid'); return toast(`El NIF ya existe: ${dup.razonSocial}`, 'bad'); }
    if (id) {
      const before = clone(c); Object.assign(c, v, { actualizado: new Date().toISOString() });
      audit('Editar', 'Cliente', c.codigo, c.razonSocial, diffObjects(before, c));
    } else {
      const n = { id: uid('cli'), codigo: Store.nextNumber('CLI'), ...v, adjuntos: [], creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      DB.clientes.push(n); audit('Crear', 'Cliente', n.codigo, n.razonSocial); id = n.id;
    }
    persist(); toast('Cliente guardado'); go('/clientes/' + id);
  });
}
function ClienteDetalle(id, tab = 'resumen') {
  const c = getCliente(id); if (!c) return notFound();
  const s = clienteStats(c);
  const docs = DB.documentos.filter((d) => d.clienteId === id);
  view.innerHTML = pageHead(esc(c.razonSocial), `${c.codigo} · ${c.tipo === 'Jurídica' ? 'Persona jurídica' : 'Persona física'} · NIF ${esc(c.nit)}`,
    `<a class="btn" href="#/clientes/${id}/editar">${ico('edit')}Editar</a><a class="btn" href="#/documentos?cli=${id}">${ico('folder')}Carpeta</a><a class="btn primary" href="#/cotizaciones/nueva?cli=${id}">${ico('plus')}Presupuestar</a>`,
    `<a href="#/clientes">Clientes</a> / ${c.codigo}`) +
    `<div class="grid g-kpi">${[['Presupuestos', s.cots.length, 'quote'], ['Facturado', fmtMoney(s.comprado), 'invoice'], ['Pagado', fmtMoney(s.pagado), 'wallet'], ['Saldo', fmtMoney(s.saldo), 'alert']].map(([l, v, i]) => `<div class="card kpi"><span class="lbl"><span class="ico">${ico(i)}</span>${l}</span><span class="val">${v}</span></div>`).join('')}</div>
    <div class="card mt"><div class="tabs">${[['resumen', 'Resumen'], ['compras', `Historial de compras (${s.facs.length})`], ['cotizaciones', `Presupuestos (${s.cots.length})`], ['pagos', `Pagos (${s.abos.length})`], ['adjuntos', `Documentos (${docs.length})`], ['auditoria', 'Auditoría']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tabBody"></div></div>`;
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => go(`/clientes/${id}?tab=${b.dataset.tab}`)));
  const body = $('#tabBody');
  if (tab === 'resumen') {
    body.innerHTML = `<div class="card-pad"><div class="kv">${[['Razón social', c.razonSocial], ['Nombre comercial', c.nombreComercial], ['NIF / CIF', c.nit], ['Tipo persona', c.tipo], ['Teléfono', c.telefono], ['Móvil', c.celular], ['Correo', c.email], ['Dirección', c.direccion], ['Localidad', c.ciudad], ['Provincia', c.departamento], ['País', c.pais], ['Contacto principal', c.contacto], ['Cargo', c.cargo], ['Creado', `${fmtDate(c.creado)} · ${c.creadoPor || ''}`]].map(([k, v]) => `<div><small>${k}</small><span>${esc(v || '—')}</span></div>`).join('')}</div>
      ${c.observaciones ? `<div class="mt" style="padding:12px 14px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border)"><small style="color:var(--text-3)">OBSERVACIONES</small><div>${esc(c.observaciones)}</div></div>` : ''}</div>`;
  } else if (tab === 'compras') {
    DataTable(body, { rows: () => s.facs, searchText: (f) => f.numero, sort: 'fecha', csv: 'compras_' + c.codigo, columns: facColumns(false), onRow: (f) => go('/facturas/' + f.id), empty: 'Este cliente aún no tiene facturas.' });
  } else if (tab === 'cotizaciones') {
    DataTable(body, { rows: () => s.cots, searchText: (x) => x.numero + x.proyecto, sort: 'fecha', columns: cotColumns(false), onRow: (x) => go('/cotizaciones/' + x.id), empty: 'Sin presupuestos.' });
  } else if (tab === 'pagos') {
    DataTable(body, { rows: () => DB.abonos.filter((a) => a.clienteId === id), searchText: (a) => a.numero + a.concepto + a.referencia, sort: 'fecha', columns: aboColumns(false), onRow: (a) => go('/abonos/' + a.id), footer: (r) => 'Total ' + fmtMoney(sumAbonos(r.filter((a) => a.estado !== 'Anulado'))) });
  } else if (tab === 'adjuntos') {
    const puedeSubir = puedeGestionar('documentos');
    body.innerHTML = `<div class="card-pad">${puedeSubir ? `<div class="drop" id="drop">${ico('upload')}<div><b>Arrastra archivos aquí</b> o haz clic para adjuntar al cliente</div><small>PDF, imágenes, contratos · máx. 2 MB c/u</small></div>` : ''}<div id="docList" class="mt"></div></div>`;
    if (puedeSubir) setupDrop($('#drop'), (files) => uploadDialog(files, { clienteId: id }, () => route()));
    $('#docList').innerHTML = docs.length ? docs.map(docRowHTML).join('') : emptyState('Sin documentos adjuntos');
    bindDocRows($('#docList'));
  } else {
    const refs = [c.codigo, ...s.cots.map((x) => x.numero), ...s.facs.map((x) => x.numero), ...s.abos.map((x) => x.numero)];
    const items = DB.auditoria.filter((a) => refs.includes(a.ref));
    body.innerHTML = `<div class="card-pad"><ul class="timeline">${items.map(auditItem).join('') || emptyState('Sin registros')}</ul></div>`;
  }
}

/* ==========================================================
   MÓDULO 2B · INVENTARIO (servicios y materiales)
   ========================================================== */
const INVENTARIO_FIELDS = [
  ['sec', 'Identificación'],
  ['codigo', 'Código', 's3', { readonly: true }],
  ['tipo', 'Tipo', 's3', { req: 1, options: ['Servicio', 'Material'] }],
  ['categoria', 'Categoría', 's3'],
  ['unidad', 'Unidad', 's3', { req: 1 }],
  ['nombre', 'Nombre', 's12', { req: 1 }],
  ['descripcion', 'Descripción', 's12', { textarea: 1 }],
  ['sec', 'Precios (sin impuestos)'],
  ['costo', 'Costo', 's4', { req: 1, type: 'number' }],
  ['precioVenta', 'Precio de venta al público', 's4', { req: 1, type: 'number' }],
  ['iva', 'IVA % por defecto', 's4', { type: 'number' }],
  ['sec', 'Estado'],
  ['estado', 'Estado', 's3', { options: ['Activo', 'Inactivo'] }],
];
function Inventario() {
  view.innerHTML = pageHead('Inventario', 'Catálogo de servicios y materiales para presupuestar y facturar', puedeGestionar('inventario') ? `<a class="btn primary" href="#/inventario/nuevo">${ico('plus')}Nuevo ítem</a>` : '') + `<div class="card" id="tbl"></div>`;
  DataTable($('#tbl'), {
    rows: () => DB.inventario,
    placeholder: 'Buscar por código, nombre, categoría…',
    searchText: (i) => [i.codigo, i.nombre, i.categoria, i.descripcion, i.unidad].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, { k: 'Servicio', label: 'Servicios', test: (i) => i.tipo === 'Servicio' }, { k: 'Material', label: 'Materiales', test: (i) => i.tipo === 'Material' }, { k: 'inactivo', label: 'Inactivos', test: (i) => i.estado === 'Inactivo' }],
    sort: 'nombre', dir: 1, csv: 'inventario',
    columns: [
      { k: 'codigo', label: 'Código', render: (i) => `<span class="muted">${i.codigo}</span>` },
      { k: 'nombre', label: 'Nombre', render: (i) => `<div class="strong">${esc(i.nombre)}</div><div class="muted">${esc(i.categoria || '')}</div>` },
      { k: 'tipo', label: 'Tipo', render: (i) => `<span class="tag">${i.tipo}</span>` },
      { k: 'unidad', label: 'Unidad' },
      { k: 'costo', label: 'Costo', cls: 'num', sort: (i) => +i.costo, render: (i) => fmtMoney(i.costo) },
      { k: 'precioVenta', label: 'Precio venta', cls: 'num', sort: (i) => +i.precioVenta, render: (i) => fmtMoney(i.precioVenta) },
      { k: 'margen', label: 'Margen', cls: 'num', sort: (i) => invMargen(i), render: (i) => `${invMargen(i).toFixed(0)}%` },
      { k: 'estado', label: 'Estado', render: (i) => badge(i.estado === 'Inactivo' ? 'Inactiva' : 'Activa') },
    ],
    onRow: (i) => go('/inventario/' + i.id + '/editar'),
    empty: 'Añade servicios y materiales para poder seleccionarlos al crear presupuestos.',
  });
}
function InventarioForm(id) {
  if (denyGestionar('inventario', '/inventario')) return;
  const i = id ? getInvItem(id) : { codigo: '(se asigna al guardar)', tipo: 'Servicio', unidad: 'ud', iva: DB.empresa.ivaDefault ?? 21, estado: 'Activo' };
  if (id && !i) return notFound();
  view.innerHTML = pageHead(id ? 'Editar ítem de inventario' : 'Nuevo ítem de inventario', 'El precio de venta se guarda sin impuestos: el IVA se aplica al presupuestar o facturar', '', `<a href="#/inventario">Inventario</a> / ${id ? esc(i.codigo) : 'Nuevo'}`) +
    `<form class="card card-pad" id="frm" novalidate><div class="form-grid">${INVENTARIO_FIELDS.map((f) => fieldHTML(f, i[f[0]])).join('')}</div>
     <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="#/inventario">Cancelar</a><button class="btn primary">${ico('check')}Guardar ítem</button></div></form>`;
  const form = $('#frm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateRequired(form, INVENTARIO_FIELDS)) return toast('Revisa los campos obligatorios marcados en rojo.', 'bad');
    const v = formValues(form); delete v.codigo;
    v.costo = +v.costo || 0; v.precioVenta = +v.precioVenta || 0; v.iva = v.iva === '' ? (DB.empresa.ivaDefault ?? 21) : +v.iva;
    if (id) {
      const before = clone(i); Object.assign(i, v, { actualizado: new Date().toISOString() });
      audit('Editar', 'Ítem de inventario', i.codigo, i.nombre, diffObjects(before, i));
    } else {
      const n = { id: uid('inv'), codigo: Store.nextNumber('INV'), ...v, creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      DB.inventario.push(n); audit('Crear', 'Ítem de inventario', n.codigo, n.nombre); id = n.id;
    }
    persist(); toast('Ítem guardado'); go('/inventario');
  });
}
/* Selector de inventario, reutilizado en el editor de presupuestos/facturas */
function inventoryPicker(onPick) {
  const m = modal({
    title: 'Añadir desde inventario', size: 'lg', hideOk: true, cancelText: 'Cerrar',
    body: `<div class="search" style="margin-bottom:12px">${ico('search')}<input id="invq" type="search" placeholder="Buscar servicio o material…" autocomplete="off"></div><div id="invList"></div>`,
  });
  const renderList = (q = '') => {
    const qq = norm(q);
    const rows = DB.inventario.filter((i) => i.estado !== 'Inactivo' && (!qq || norm([i.codigo, i.nombre, i.categoria, i.descripcion].join(' ')).includes(qq)));
    $('#invList', m.el).innerHTML = rows.length ? rows.map((i) => `<div class="inv-pick-row" data-id="${i.id}">
        <div><b>${esc(i.nombre)}</b> <span class="tag">${i.tipo}</span><div class="muted">${esc(i.descripcion || '')}</div></div>
        <div class="num">${fmtMoney(i.precioVenta)}<div class="muted">/ ${esc(i.unidad)} · IVA ${i.iva ?? (DB.empresa.ivaDefault ?? 21)}%</div></div>
        <button type="button" class="btn sm primary" data-pick="${i.id}">${ico('plus')}Añadir</button>
      </div>`).join('') : emptyState(DB.inventario.length ? 'Sin resultados en el inventario' : 'El inventario está vacío. Añade ítems desde el módulo Inventario.', 'search');
  };
  renderList();
  $('#invq', m.el).addEventListener('input', (e) => renderList(e.target.value));
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const it = getInvItem(b.dataset.pick); if (!it) return;
    onPick(it); toast(`${it.nombre} añadido`);
  });
}

/* ==========================================================
   MÓDULO 3 · COTIZACIONES
   ========================================================== */
function cotColumns(withClient = true) {
  return [
    { k: 'numero', label: 'Número', render: (c) => `<b>${c.numero}</b>` },
    { k: 'fecha', label: 'Fecha', render: (c) => fmtDate(c.fecha) },
    ...(withClient ? [{ k: 'cliente', label: 'Cliente', sort: (c) => clienteNombre(c.clienteId), render: (c) => `${esc(clienteNombre(c.clienteId))}<div class="muted">${esc(getCliente(c.clienteId)?.nit || '')}</div>` }] : []),
    { k: 'proyecto', label: 'Proyecto', render: (c) => esc(c.proyecto) },
    { k: 'vence', label: 'Vence', render: (c) => { const e = cotEstado(c); const d = daysBetween(todayISO(), c.vence); return `${fmtDate(c.vence)}${['Enviado', 'Borrador'].includes(e) && d >= 0 && d <= 7 ? `<div class="muted" style="color:var(--warn)">en ${d} días</div>` : ''}`; } },
    { k: 'total', label: 'Total', cls: 'num', sort: (c) => docTotals(c.items).total, render: (c) => fmtMoney(docTotals(c.items).total) },
    { k: 'estado', label: 'Estado', sort: (c) => cotEstado(c), render: (c) => badge(cotEstado(c)) },
  ];
}
function Cotizaciones(query = {}) {
  const today = todayISO();
  view.innerHTML = pageHead('Presupuestos', 'Propuestas comerciales y su conversión a factura', puedeGestionar('cotizaciones') ? `<a class="btn primary" href="#/cotizaciones/nueva">${ico('plus')}Nuevo presupuesto</a>` : '') + `<div class="card" id="tbl"></div>`;
  DataTable($('#tbl'), {
    rows: () => DB.cotizaciones,
    placeholder: 'Número, cliente, NIF, proyecto…',
    searchText: (c) => [c.numero, c.proyecto, clienteNombre(c.clienteId), getCliente(c.clienteId)?.nit, c.responsable].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, { k: 'vencer', label: 'Por vencer', test: (c) => ['Enviado', 'Borrador'].includes(cotEstado(c)) && c.vence >= today && daysBetween(today, c.vence) <= 7 }, ...ESTADOS_COT.map((e) => ({ k: e, label: e, test: (c) => cotEstado(c) === e }))],
    sort: 'fecha', csv: 'presupuestos', columns: cotColumns(),
    footer: (r) => 'Total ' + fmtMoney(r.reduce((s, c) => s + docTotals(c.items).total, 0)),
    onRow: (c) => go('/cotizaciones/' + c.id),
  });
  if (query.f) $(`[data-chip="${query.f}"]`)?.click();
}

/* ---------- Editor compartido: Cotización / Factura ---------- */
const emptyItem = () => ({ concepto: '', descripcion: '', cantidad: 1, valor: 0, iva: DB.empresa.ivaDefault ?? 21, desc: 0 });
function DocEditor(tipo, id, query = {}) {
  const isCot = tipo === 'cotizacion';
  if (denyGestionar(isCot ? 'cotizaciones' : 'facturas', id ? `/${isCot ? 'cotizaciones' : 'facturas'}/${id}` : `/${isCot ? 'cotizaciones' : 'facturas'}`)) return;
  const list = isCot ? DB.cotizaciones : DB.facturas;
  const existing = id ? list.find((x) => x.id === id) : null;
  if (id && !existing) return notFound();
  if (existing && !isCot && existing.estado === 'Anulada') return toast('No se puede editar una factura anulada', 'bad'), go('/facturas/' + id);
  const today = todayISO(), E = DB.empresa;
  const fromCot = query.cot ? getCot(query.cot) : null;
  const d = existing ? clone(existing) : isCot
    ? { numero: '(automático)', fecha: today, vence: addDays(today, 30), proyecto: '', descripcion: '', clienteId: query.cli || '', items: [emptyItem()], validez: '30 días', formaPago: '50% anticipo, 50% contra entrega', tiempoEjecucion: '', observaciones: '', responsable: Store.user().nombre, estado: 'Borrador' }
    : { numero: '(automático)', fecha: today, fechaOperacion: today, vence: addDays(today, 30), clienteId: fromCot?.clienteId || query.cli || '', cotizacionId: fromCot?.id || '', items: fromCot ? clone(fromCot.items) : [emptyItem()], metodoPago: 'Transferencia', banco: E.banco, titular: E.titular, cuenta: E.cuenta, observaciones: '', estado: 'Emitida' };
  const base = isCot ? 'cotizaciones' : 'facturas';
  const cliOpts = `<option value="">Selecciona un cliente…</option>` + DB.clientes.map((c) => `<option value="${c.id}" ${c.id === d.clienteId ? 'selected' : ''}>${esc(c.razonSocial)} · ${esc(c.nit)}</option>`).join('');
  view.innerHTML = pageHead(existing ? `Editar ${d.numero}` : isCot ? 'Nuevo presupuesto' : 'Nueva factura', isCot ? 'Completa los datos generales, el detalle y las condiciones' : 'Los pagos a cuenta del presupuesto relacionado se descuentan automáticamente', '',
    `<a href="#/${base}">${isCot ? 'Presupuestos' : 'Facturación'}</a> / ${existing ? d.numero : 'Nueva'}`) +
    `<form id="frm" novalidate class="grid">
      <div class="card card-pad"><div class="form-grid">
        <div class="section-title">Datos generales</div>
        <div class="f s3"><label>${isCot ? 'Número de presupuesto' : 'Número de factura'}</label><input class="in" value="${esc(d.numero)}" readonly></div>
        <div class="f s3"><label>${isCot ? 'Fecha' : 'Fecha factura'} <span class="req">*</span></label><input class="in" type="date" name="fecha" value="${d.fecha}"></div>
        ${isCot ? '' : `<div class="f s3"><label>Fecha operación</label><input class="in" type="date" name="fechaOperacion" value="${d.fechaOperacion || ''}"></div>`}
        <div class="f s3"><label>${isCot ? 'Válido hasta' : 'Vencimiento de pago'} <span class="req">*</span></label><input class="in" type="date" name="vence" value="${d.vence}"></div>
        ${isCot ? `<div class="f s6"><label>Proyecto <span class="req">*</span></label><input class="in" name="proyecto" value="${esc(d.proyecto)}" placeholder="Ej. Implementación sistema de agenda"></div>
        <div class="f s12"><label>Descripción general</label><textarea class="in" name="descripcion">${esc(d.descripcion)}</textarea></div>`
      : `<div class="f s6"><label>Presupuesto relacionado</label><select class="in" name="cotizacionId"><option value="">— Sin presupuesto —</option>${DB.cotizaciones.filter((c) => c.estado !== 'Anulado' && (!c.facturaId || c.id === d.cotizacionId)).map((c) => `<option value="${c.id}" ${c.id === d.cotizacionId ? 'selected' : ''}>${c.numero} · ${esc(c.proyecto)}</option>`).join('')}</select></div>`}
        <div class="section-title">Datos del cliente</div>
        <div class="f s6"><label>Cliente <span class="req">*</span></label><select class="in" name="clienteId">${cliOpts}</select><span class="hint"><a href="#/clientes/nuevo">+ Crear cliente nuevo</a></span></div>
        <div class="f s6" id="cliInfo"></div>
      </div></div>
      <div class="card"><div class="card-head"><div><h3>Detalle</h3><p>Concepto, cantidad, precio unitario, descuento e IVA por línea</p></div><div class="btn-row"><button type="button" class="btn ghost sm" id="addItem">${ico('plus')}Línea en blanco</button><button type="button" class="btn primary" id="addFromInv">${ico('tag')}Añadir desde inventario</button></div></div>
        ${!existing && DB.inventario.length ? `<div style="margin:14px 20px 0;padding:10px 14px;border-radius:10px;background:var(--brand-50);color:var(--brand);display:flex;align-items:center;gap:8px;font-size:13px"><b style="display:flex">${ico('tag')}</b>Usa <b>&nbsp;Añadir desde inventario&nbsp;</b> para cargar servicios y materiales con el precio ya definido.</div>` : ''}
        <div class="tbl-wrap"><table class="tbl items"><thead><tr><th style="min-width:220px">Concepto / descripción</th><th class="num" style="width:80px">Cant.</th><th class="num" style="width:140px">Precio unit.</th><th class="num" style="width:80px">Desc %</th><th class="num" style="width:80px">IVA %</th><th class="num" style="width:130px">Subtotal</th><th class="num" style="width:130px">Total línea</th><th style="width:40px"></th></tr></thead><tbody id="items"></tbody></table></div>
        <div class="totals" id="totals"></div></div>
      <div class="card card-pad"><div class="form-grid">
        ${isCot ? `<div class="section-title">Condiciones</div>
          <div class="f s3"><label>Validez</label><input class="in" name="validez" value="${esc(d.validez)}"></div>
          <div class="f s6"><label>Forma de pago</label><input class="in" name="formaPago" value="${esc(d.formaPago)}"></div>
          <div class="f s3"><label>Plazo de ejecución</label><input class="in" name="tiempoEjecucion" value="${esc(d.tiempoEjecucion)}"></div>
          <div class="f s6"><label>Responsable comercial</label><select class="in" name="responsable">${DB.usuarios.filter((u) => u.activo !== false).map((u) => `<option ${u.nombre === d.responsable ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></div>
          <div class="f s6"><label>Estado</label><select class="in" name="estado">${['Borrador', 'Enviado', 'Aprobado'].map((e) => `<option ${e === d.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></div>`
      : `<div class="section-title">Método de pago y datos bancarios</div>
          <div class="f s3"><label>Método de pago</label><select class="in" name="metodoPago">${FORMAS_PAGO.map((e) => `<option ${e === d.metodoPago ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
          <div class="f s3"><label>Banco</label><input class="in" name="banco" value="${esc(d.banco)}" list="bancos"></div>
          <div class="f s3"><label>Titular</label><input class="in" name="titular" value="${esc(d.titular)}"></div>
          <div class="f s3"><label>Cuenta (IBAN)</label><input class="in" name="cuenta" value="${esc(d.cuenta)}"></div>`}
        <div class="f s12"><label>Observaciones</label><textarea class="in" name="observaciones">${esc(d.observaciones)}</textarea></div>
      </div>
      <datalist id="bancos">${BANCOS.map((b) => `<option>${b}</option>`).join('')}</datalist>
      <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="${existing ? `#/${base}/${id}` : '#/' + base}">Cancelar</a><button class="btn primary">${ico('check')}${existing ? 'Guardar cambios' : isCot ? 'Crear presupuesto' : 'Emitir factura'}</button></div></div>
    </form>`;
  const form = $('#frm');
  const items = d.items;
  const showCli = () => {
    const c = getCliente(form.clienteId.value);
    $('#cliInfo').innerHTML = c ? `<label>&nbsp;</label><div style="font-size:13px;line-height:1.6;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)"><b>NIF:</b> ${esc(c.nit)} · <b>Tel:</b> ${esc(c.celular || c.telefono)}<br><b>Dirección:</b> ${esc(c.direccion)}, ${esc(c.codigoPostal || '')} ${esc(c.ciudad)}<br><b>Correo:</b> ${esc(c.email)}</div>` : '';
  };
  const renderTotals = () => {
    const t = docTotals(items);
    const ab = !isCot && existing ? facturaResumen(existing).abonado : !isCot && form.cotizacionId?.value ? sumAbonos(abonosDe('cot', form.cotizacionId.value)) : 0;
    $('#totals').innerHTML = `<div><span>Subtotal</span><span>${fmtMoney(t.subtotal)}</span></div><div><span>Descuento total</span><span>− ${fmtMoney(t.descuento)}</span></div><div><span>Base imponible</span><span>${fmtMoney(t.base)}</span></div><div><span>IVA</span><span>${fmtMoney(t.iva)}</span></div>
      <div class="grand"><span>Total ${isCot ? 'presupuesto' : 'factura'}</span><span>${fmtMoney(t.total)}</span></div>
      ${!isCot ? `<div><span>Pagos a cuenta</span><span>− ${fmtMoney(ab)}</span></div><div style="font-weight:700"><span>Saldo pendiente</span><span>${fmtMoney(Math.max(0, t.total - ab))}</span></div>` : ''}`;
  };
  const renderItems = () => {
    $('#items').innerHTML = items.map((it, i) => { const l = lineCalc(it); return `<tr data-i="${i}">
      <td><input data-f="concepto" value="${esc(it.concepto)}" placeholder="Concepto"><textarea data-f="descripcion" rows="1" placeholder="Descripción">${esc(it.descripcion)}</textarea></td>
      <td class="num"><input data-f="cantidad" type="number" min="0" step="any" value="${it.cantidad}"></td>
      <td class="num"><input data-f="valor" type="number" min="0" step="any" value="${it.valor}"></td>
      <td class="num"><input data-f="desc" type="number" min="0" max="100" step="any" value="${it.desc}"></td>
      <td class="num"><input data-f="iva" type="number" min="0" max="100" step="any" value="${it.iva}" list="ivas"></td>
      <td class="num" data-sub>${fmtMoney(l.base)}</td><td class="num strong" data-tot>${fmtMoney(l.total)}</td>
      <td><button type="button" class="btn icon ghost sm" data-del title="Quitar línea">${ico('trash')}</button></td></tr>`; }).join('') + '<datalist id="ivas"><option>0</option><option>4</option><option>10</option><option>21</option></datalist>';
    renderTotals();
  };
  $('#items').addEventListener('input', (e) => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    const it = items[+tr.dataset.i];
    it[f] = ['concepto', 'descripcion'].includes(f) ? e.target.value : +e.target.value;
    const l = lineCalc(it); $('[data-sub]', tr).textContent = fmtMoney(l.base); $('[data-tot]', tr).textContent = fmtMoney(l.total);
    renderTotals();
  });
  $('#items').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (!b) return; items.splice(+b.closest('tr').dataset.i, 1); if (!items.length) items.push(emptyItem()); renderItems(); });
  $('#addItem').addEventListener('click', () => { items.push(emptyItem()); renderItems(); $$('#items tr:last-child input')[0].focus(); });
  $('#addFromInv').addEventListener('click', () => inventoryPicker((it) => {
    items.push({ concepto: it.nombre, descripcion: it.descripcion || '', cantidad: 1, valor: +it.precioVenta || 0, iva: it.iva ?? (DB.empresa.ivaDefault ?? 21), desc: 0 });
    renderItems();
  }));
  form.clienteId.addEventListener('change', showCli);
  form.cotizacionId?.addEventListener('change', () => {
    const c = getCot(form.cotizacionId.value);
    if (c) { form.clienteId.value = c.clienteId; showCli(); items.splice(0, items.length, ...clone(c.items)); renderItems(); toast('Detalle copiado desde ' + c.numero); }
    else renderTotals();
  });
  showCli(); renderItems();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    const bad = [];
    if (!v.clienteId) bad.push(form.clienteId);
    if (!v.fecha) bad.push(form.fecha);
    if (!v.vence || v.vence < v.fecha) bad.push(form.vence);
    if (isCot && !v.proyecto.trim()) bad.push(form.proyecto);
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    bad.forEach((x) => x.classList.add('invalid'));
    const lines = items.filter((it) => it.concepto.trim());
    if (bad.length) return toast(bad.includes(form.vence) && v.vence ? 'El vencimiento no puede ser anterior a la fecha.' : 'Completa los campos obligatorios.', 'bad');
    if (!lines.length || docTotals(lines).total <= 0) return toast('Añade al menos una línea con concepto e importe.', 'bad');
    const data = { ...v, items: lines.map((it) => ({ ...it })) };
    if (existing) {
      const before = clone(existing); Object.assign(existing, data, { actualizado: new Date().toISOString(), modificadoPor: Store.user().nombre });
      if (!isCot) relinkFacturaCot(existing, before.cotizacionId);
      audit('Editar', isCot ? 'Presupuesto' : 'Factura', existing.numero, isCot ? existing.proyecto : clienteNombre(existing.clienteId), diffObjects(before, existing));
      persist(); toast('Cambios guardados'); return go(`/${base}/${existing.id}`);
    }
    const n = { id: uid(isCot ? 'cot' : 'fac'), numero: Store.nextNumber(isCot ? 'COT' : 'FAC'), ...data, firmas: {}, plantilla: plantillaActiva(tipo), creado: new Date().toISOString(), creadoPor: Store.user().nombre };
    if (isCot) { n.facturaId = null; DB.cotizaciones.push(n); audit('Crear', 'Presupuesto', n.numero, n.proyecto); }
    else { n.estado = 'Emitida'; DB.facturas.push(n); relinkFacturaCot(n, null); audit('Crear', 'Factura', n.numero, `${clienteNombre(n.clienteId)} · ${fmtMoney(docTotals(n.items).total)}`); }
    persist(); toast(isCot ? `Presupuesto ${n.numero} creado` : `Factura ${n.numero} emitida`); go(`/${base}/${n.id}`);
  });
}
/* Vincula factura ↔ cotización y traslada los abonos (anticipos) de la cotización a la factura */
function relinkFacturaCot(f, prevCotId) {
  if (prevCotId && prevCotId !== f.cotizacionId) {
    const pc = getCot(prevCotId); if (pc) { pc.facturaId = null; pc.estado = 'Aprobado'; }
    DB.abonos.filter((a) => a.facturaId === f.id && a.cotizacionId === prevCotId).forEach((a) => { a.facturaId = null; });
  }
  if (!f.cotizacionId) return;
  const c = getCot(f.cotizacionId);
  if (c) { c.facturaId = f.id; c.estado = 'Facturado'; }
  DB.abonos.filter((a) => a.cotizacionId === f.cotizacionId && a.estado !== 'Anulado').forEach((a) => { a.facturaId = f.id; });
}

const isWordDoc = (d) => { const c = plantillaConfig(d.plantilla); return c.formato === 'word' && !!c.docx; };
function docActions(tipo, d) {
  const isCot = tipo === 'cotizacion';
  const manage = puedeGestionar(isCot ? 'cotizaciones' : 'facturas');
  const locked = isCot ? ['Facturado', 'Anulado'].includes(d.estado) : d.estado === 'Anulada';
  const canEdit = manage && !locked && (isCot || facturaEstado(d) !== 'Pagada');
  return `${canEdit ? `<a class="btn" href="#/${isCot ? 'cotizaciones' : 'facturas'}/${d.id}/editar">${ico('edit')}Editar</a>` : ''}
    ${manage ? `<button class="btn" data-act="dup">${ico('copy')}Duplicar</button>` : ''}
    <button class="btn" data-act="mail">${ico('mail')}Enviar</button>
    <button class="btn" data-act="pdf">${ico('download')}PDF</button>
    ${isWordDoc(d) ? `<button class="btn" data-act="word">${ico('download')}Word</button>` : ''}
    ${manage ? `<button class="btn" data-act="sign">${ico('pen')}Firmar</button>` : ''}
    ${manage && !locked ? `<button class="btn danger" data-act="anular">${ico('x')}Anular</button>` : ''}
    ${manage && isCot && !locked ? `<a class="btn" href="#/abonos/nuevo?cot=${d.id}">${ico('cash')}Cobro</a><button class="btn primary" data-act="convert">${ico('arrow')}Convertir a factura</button>` : ''}
    ${manage && !isCot && !locked && facturaResumen(d).saldo > 0 ? `<a class="btn primary" href="#/abonos/nuevo?fac=${d.id}">${ico('cash')}Registrar pago</a>` : ''}`;
}
function bindDocActions(tipo, d) {
  const isCot = tipo === 'cotizacion', ent = { cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Cobro' }[tipo];
  const modulo = { cotizacion: 'cotizaciones', factura: 'facturas', abono: 'abonos' }[tipo];
  view.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (['sign', 'dup', 'anular', 'convert', 'estado'].includes(act) && !puedeGestionar(modulo)) return toast('Tu rol no tiene permiso para esta acción.', 'bad');
    if (act === 'pdf') { printDoc(tipo, d); audit('Descargar', ent, d.numero, 'PDF generado'); persist(); }
    if (act === 'word') { downloadWord(tipo, d); audit('Descargar', ent, d.numero, 'Word generado'); persist(); }
    if (act === 'mail') sendMail(tipo, d);
    if (act === 'sign') signDialog(tipo, d);
    if (act === 'dup') {
      const n = { ...clone(d), id: uid(tipo.slice(0, 3)), numero: Store.nextNumber(isCot ? 'COT' : tipo === 'factura' ? 'FAC' : 'ABO'), fecha: todayISO(), firmas: {}, plantilla: plantillaActiva(tipo), creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      if (isCot) { Object.assign(n, { estado: 'Borrador', facturaId: null, vence: addDays(todayISO(), 30), proyecto: d.proyecto + ' (copia)' }); DB.cotizaciones.push(n); }
      else { Object.assign(n, { estado: 'Emitida', cotizacionId: '', vence: addDays(todayISO(), 30) }); DB.facturas.push(n); }
      audit('Duplicar', ent, n.numero, 'Copia de ' + d.numero); persist(); toast('Documento duplicado: ' + n.numero);
      go(`/${isCot ? 'cotizaciones' : 'facturas'}/${n.id}/editar`);
    }
    if (act === 'anular') {
      if (!(await confirmBox(`Anular ${d.numero}`, isCot ? 'El presupuesto quedará anulado. Los cobros registrados no se eliminan.' : 'La factura quedará anulada y el presupuesto relacionado vuelve a estado Aprobado. Los cobros aplicados quedan como anticipos del presupuesto.', 'Anular'))) return;
      d.estado = isCot ? 'Anulado' : 'Anulada';
      if (!isCot && d.cotizacionId) { const c = getCot(d.cotizacionId); if (c) { c.estado = 'Aprobado'; c.facturaId = null; } DB.abonos.filter((a) => a.facturaId === d.id).forEach((a) => { a.facturaId = null; }); }
      audit('Anular', ent, d.numero, ''); persist(); toast(d.numero + (isCot ? ' anulado' : ' anulada')); route();
    }
    if (act === 'convert') convertToInvoice(d);
    if (act === 'estado') {
      const before = d.estado; d.estado = b.dataset.val; audit('Estado', ent, d.numero, `${before} → ${d.estado}`); persist(); route();
    }
  };
}
async function convertToInvoice(c) {
  const t = docTotals(c.items).total, ab = sumAbonos(abonosDe('cot', c.id));
  if (!(await confirmBox('Convertir a factura', `Se emitirá una factura por <b>${fmtMoney(t)}</b> con el detalle de ${c.numero}.${ab ? ` Se aplicarán automáticamente <b>${fmtMoney(ab)}</b> en cobros ya recibidos.` : ''}`, 'Emitir factura'))) return;
  const E = DB.empresa, today = todayISO();
  const f = { id: uid('fac'), numero: Store.nextNumber('FAC'), fecha: today, fechaOperacion: today, vence: addDays(today, 30), clienteId: c.clienteId, cotizacionId: c.id, items: clone(c.items), metodoPago: 'Transferencia', banco: E.banco, titular: E.titular, cuenta: E.cuenta, observaciones: '', estado: 'Emitida', firmas: {}, plantilla: plantillaActiva('factura'), creado: new Date().toISOString(), creadoPor: Store.user().nombre };
  DB.facturas.push(f); relinkFacturaCot(f, null);
  audit('Convertir', 'Factura', f.numero, `Generada desde ${c.numero}`); audit('Estado', 'Presupuesto', c.numero, 'Aprobado → Facturado');
  persist(); toast(`Factura ${f.numero} emitida`); go('/facturas/' + f.id);
}
function docPreview(tipo, d) { return `<div class="preview-frame"><div id="docRender">${renderDoc(tipo, d)}</div></div>`; }
function historyFor(ref) { const it = DB.auditoria.filter((a) => a.ref === ref); return `<ul class="timeline">${it.map(auditItem).join('') || emptyState('Sin registros')}</ul>`; }
function finPanel(c) {
  const r = proyectoResumen(c);
  return `<div class="card-pad"><div class="grid g-3">${[['Total proyecto', r.total], ['Total cobrado', r.abonado], ['Saldo pendiente', r.saldo]].map(([l, v]) => `<div><small style="color:var(--text-3)">${l}</small><div style="font-size:20px;font-weight:700">${fmtMoney(v)}</div></div>`).join('')}</div>
    <div class="progress mt"><i style="width:${r.pct}%"></i></div><small style="color:var(--text-3)">${Math.round(r.pct)}% pagado</small>
    <h4 class="mt" style="margin-bottom:6px">Historial de cobros</h4>
    ${r.abonos.length ? `<table class="tbl"><thead><tr><th>Número</th><th>Fecha</th><th>Concepto</th><th>Forma de pago</th><th class="num">Importe</th></tr></thead><tbody>${r.abonos.map((a) => `<tr class="click" onclick="go('/abonos/${a.id}')"><td><b>${a.numero}</b></td><td>${fmtDate(a.fecha)}</td><td>${esc(a.concepto)}</td><td>${esc(a.formaPago)} · ${esc(a.banco)}</td><td class="num">${fmtMoney(a.valor)}</td></tr>`).join('')}</tbody></table>` : emptyState('Aún no hay cobros para este proyecto', 'cash')}</div>`;
}
function CotDetalle(id, tab = 'doc') {
  const c = getCot(id); if (!c) return notFound();
  const e = cotEstado(c);
  view.innerHTML = pageHead(`${c.numero} ${badge(e)}`, `${esc(c.proyecto)} · ${esc(clienteNombre(c.clienteId))}`, docActions('cotizacion', c), `<a href="#/cotizaciones">Presupuestos</a> / ${c.numero}`) +
    `${c.facturaId ? `<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;border-color:var(--info)">${ico('invoice')}<span>Convertido en factura <a href="#/facturas/${c.facturaId}"><b>${getFac(c.facturaId)?.numero}</b></a> (${facturaEstado(getFac(c.facturaId))})</span></div>` : ''}
    ${puedeGestionar('cotizaciones') && ['Borrador', 'Enviado'].includes(c.estado) ? `<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="color:var(--text-2)">Cambiar estado:</span>${['Borrador', 'Enviado', 'Aprobado'].filter((x) => x !== c.estado).map((x) => `<button class="btn sm" data-act="estado" data-val="${x}">Marcar como ${x}</button>`).join('')}</div>` : ''}
    <div class="card"><div class="tabs">${[['doc', 'Documento'], ['fin', 'Control financiero'], ['hist', 'Historial']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="go('/cotizaciones/${id}?tab=${k}')">${l}</button>`).join('')}</div>
    ${tab === 'doc' ? docPreview('cotizacion', c) : tab === 'fin' ? finPanel(c) : `<div class="card-pad">${historyFor(c.numero)}</div>`}</div>`;
  bindDocActions('cotizacion', c);
}

/* ==========================================================
   MÓDULO 4 · ABONOS
   ========================================================== */
function aboColumns(withClient = true) {
  return [
    { k: 'numero', label: 'Número', render: (a) => `<b>${a.numero}</b>` },
    { k: 'fecha', label: 'Fecha', render: (a) => fmtDate(a.fecha) },
    ...(withClient ? [{ k: 'cliente', label: 'Cliente', sort: (a) => clienteNombre(a.clienteId), render: (a) => esc(clienteNombre(a.clienteId)) }] : []),
    { k: 'concepto', label: 'Concepto', render: (a) => `${esc(a.concepto)}<div class="muted">${[getCot(a.cotizacionId)?.numero, getFac(a.facturaId)?.numero].filter(Boolean).join(' · ')}</div>` },
    { k: 'formaPago', label: 'Forma de pago', render: (a) => `${esc(a.formaPago)}<div class="muted">${esc(a.banco)} · Ref ${esc(a.referencia)}</div>` },
    { k: 'valor', label: 'Importe', cls: 'num', sort: (a) => +a.valor, render: (a) => `<b>${fmtMoney(a.valor)}</b>` },
    { k: 'estado', label: 'Estado', render: (a) => badge(a.estado) },
  ];
}
function Abonos() {
  const proyectos = DB.cotizaciones.filter((c) => ['Aprobado', 'Facturado'].includes(c.estado)).map((c) => ({ ...c, _r: proyectoResumen(c) }));
  const totalAb = sumAbonos(DB.abonos.filter((a) => a.estado !== 'Anulado'));
  const saldo = proyectos.reduce((s, p) => s + p._r.saldo, 0);
  view.innerHTML = pageHead('Cobros', 'Pagos parciales, anticipos y control financiero por proyecto', puedeGestionar('abonos') ? `<a class="btn primary" href="#/abonos/nuevo">${ico('plus')}Registrar cobro</a>` : '') +
    `<div class="grid g-kpi">${[['Total cobrado', fmtMoney(totalAb), 'wallet'], ['Proyectos activos', proyectos.filter((p) => p._r.saldo > 0).length, 'quote'], ['Saldo por cobrar', fmtMoney(saldo), 'alert'], ['Cobrado este mes', fmtMoney(sumAbonos(DB.abonos.filter((a) => a.estado !== 'Anulado' && a.fecha.startsWith(todayISO().slice(0, 7))))), 'cash']].map(([l, v, i]) => `<div class="card kpi"><span class="lbl"><span class="ico">${ico(i)}</span>${l}</span><span class="val">${v}</span></div>`).join('')}</div>
    <div class="card mt"><div class="card-head"><div><h3>Control financiero por proyecto</h3><p>Total proyecto · total cobrado · saldo pendiente</p></div></div><div id="tblP"></div></div>
    <div class="card mt"><div class="card-head"><h3>Historial de cobros</h3></div><div id="tbl"></div></div>`;
  DataTable($('#tblP'), {
    rows: () => proyectos, searchText: (p) => p.numero + p.proyecto + clienteNombre(p.clienteId), sort: 'saldo', pageSize: 6,
    chips: [{ k: 'pend', label: 'Con saldo', test: (p) => p._r.saldo > 0 }, { k: 'all', label: 'Todos' }, { k: 'pag', label: 'Pagados', test: (p) => p._r.saldo <= 0 }],
    columns: [
      { k: 'proyecto', label: 'Proyecto', render: (p) => `<b>${esc(p.proyecto)}</b><div class="muted">${p.numero} · ${esc(clienteNombre(p.clienteId))}</div>` },
      { k: 'total', label: 'Total proyecto', cls: 'num', sort: (p) => p._r.total, render: (p) => fmtMoney(p._r.total) },
      { k: 'abonado', label: 'Cobrado', cls: 'num', sort: (p) => p._r.abonado, render: (p) => fmtMoney(p._r.abonado) },
      { k: 'saldo', label: 'Saldo', cls: 'num', sort: (p) => p._r.saldo, render: (p) => p._r.saldo > 0 ? `<b>${fmtMoney(p._r.saldo)}</b>` : badge('Pagada') },
      { k: 'pct', label: 'Avance', nosort: 1, nocsv: 1, render: (p) => `<div style="min-width:120px"><div class="progress"><i style="width:${p._r.pct}%"></i></div><small class="muted">${Math.round(p._r.pct)}%</small></div>` },
      { k: 'acc', label: '', nosort: 1, nocsv: 1, render: (p) => p._r.saldo > 0 ? `<a class="btn sm" href="#/abonos/nuevo?cot=${p.id}">${ico('plus')}Cobro</a>` : '' },
    ],
    onRow: (p) => go(`/cotizaciones/${p.id}?tab=fin`),
  });
  DataTable($('#tbl'), {
    rows: () => DB.abonos, placeholder: 'Número, cliente, referencia, banco…',
    searchText: (a) => [a.numero, a.concepto, a.referencia, a.banco, a.formaPago, clienteNombre(a.clienteId), getCot(a.cotizacionId)?.numero, getFac(a.facturaId)?.numero].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, ...FORMAS_PAGO.map((f) => ({ k: f, label: f, test: (a) => a.formaPago === f })), { k: 'anul', label: 'Anulados', test: (a) => a.estado === 'Anulado' }],
    sort: 'fecha', csv: 'cobros', columns: aboColumns(),
    footer: (r) => 'Total ' + fmtMoney(sumAbonos(r.filter((a) => a.estado !== 'Anulado'))),
    onRow: (a) => go('/abonos/' + a.id),
  });
}
function AbonoForm(query = {}) {
  if (denyGestionar('abonos', '/abonos')) return;
  const fac0 = query.fac ? getFac(query.fac) : null;
  const cot0 = query.cot ? getCot(query.cot) : fac0?.cotizacionId ? getCot(fac0.cotizacionId) : null;
  const cli0 = cot0?.clienteId || fac0?.clienteId || query.cli || '';
  view.innerHTML = pageHead('Registrar cobro', 'El cobro se asocia al presupuesto y/o a la factura y actualiza el saldo automáticamente', '', `<a href="#/abonos">Cobros</a> / Nuevo`) +
    `<div class="grid g-main"><form class="card card-pad" id="frm" novalidate><div class="form-grid">
      <div class="section-title">Datos del cobro</div>
      <div class="f s3"><label>Número de cobro</label><input class="in" value="(automático)" readonly></div>
      <div class="f s3"><label>Fecha <span class="req">*</span></label><input class="in" type="date" name="fecha" value="${todayISO()}"></div>
      <div class="f s6"><label>Cliente <span class="req">*</span></label><select class="in" name="clienteId"><option value="">Selecciona…</option>${DB.clientes.map((c) => `<option value="${c.id}" ${c.id === cli0 ? 'selected' : ''}>${esc(c.razonSocial)}</option>`).join('')}</select></div>
      <div class="f s6"><label>Presupuesto asociado</label><select class="in" name="cotizacionId"></select></div>
      <div class="f s6"><label>Factura asociada</label><select class="in" name="facturaId"></select></div>
      <div class="f s12"><label>Concepto <span class="req">*</span></label><input class="in" name="concepto" placeholder="Ej. Anticipo 50%" value=""></div>
      <div class="section-title">Pago</div>
      <div class="f s3"><label>Forma de pago</label><select class="in" name="formaPago">${FORMAS_PAGO.map((f) => `<option>${f}</option>`).join('')}</select></div>
      <div class="f s3"><label>Banco</label><input class="in" name="banco" list="bancos" value="${esc(DB.empresa.banco)}"><datalist id="bancos">${BANCOS.map((b) => `<option>${b}</option>`).join('')}</datalist></div>
      <div class="f s3"><label>Referencia de operación</label><input class="in" name="referencia" placeholder="Nº de operación"></div>
      <div class="f s3"><label>Importe del cobro <span class="req">*</span></label><input class="in" type="number" min="0" step="any" name="valor"></div>
      <div class="f s12"><span class="hint" id="valHint"></span></div>
    </div><div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="#/abonos">Cancelar</a><button class="btn primary">${ico('check')}Registrar cobro</button></div></form>
    <div class="card"><div class="card-head"><h3>Control financiero</h3></div><div id="fin" class="card-pad"></div></div></div>`;
  const form = $('#frm');
  const fill = () => {
    const cli = form.clienteId.value;
    const cots = DB.cotizaciones.filter((c) => c.clienteId === cli && c.estado !== 'Anulada');
    const facs = DB.facturas.filter((f) => f.clienteId === cli && f.estado !== 'Anulada' && facturaResumen(f).saldo > 0);
    const cv = form.cotizacionId.value || cot0?.id || '', fv = form.facturaId.value || fac0?.id || cot0?.facturaId || '';
    form.cotizacionId.innerHTML = `<option value="">— Ninguno —</option>` + cots.map((c) => `<option value="${c.id}" ${c.id === cv ? 'selected' : ''}>${c.numero} · ${esc(c.proyecto)}</option>`).join('');
    form.facturaId.innerHTML = `<option value="">— Ninguna —</option>` + facs.map((f) => `<option value="${f.id}" ${f.id === fv ? 'selected' : ''}>${f.numero} · saldo ${fmtMoney(facturaResumen(f).saldo)}</option>`).join('');
    fin();
  };
  const fin = () => {
    const c = getCot(form.cotizacionId.value), f = getFac(form.facturaId.value);
    const r = c ? proyectoResumen(c) : f ? (() => { const x = facturaResumen(f); return { total: x.total, abonado: x.abonado, saldo: x.saldo, abonos: x.abonos, pct: x.total ? (x.abonado / x.total) * 100 : 0 }; })() : null;
    const v = +form.valor.value || 0;
    $('#fin').innerHTML = r ? `<div class="kv" style="grid-template-columns:1fr">${[['Total proyecto', r.total], ['Total cobrado', r.abonado], ['Saldo pendiente', r.saldo], ['Saldo después de este cobro', Math.max(0, r.saldo - v)]].map(([l, x]) => `<div><small>${l}</small><span style="font-size:18px;font-weight:700">${fmtMoney(x)}</span></div>`).join('')}</div>
      <div class="progress mt"><i style="width:${Math.min(100, ((r.abonado + v) / (r.total || 1)) * 100)}%"></i></div>
      <h4 class="mt" style="font-size:13px">Historial</h4>${r.abonos.length ? `<table class="mini-tbl">${r.abonos.map((a) => `<tr><td>${fmtDate(a.fecha)}</td><td>${esc(a.concepto)}</td><td class="num">${fmtMoney(a.valor)}</td></tr>`).join('')}</table>` : '<small class="hint">Sin cobros previos</small>'}`
      : emptyState('Selecciona un presupuesto o una factura para ver el saldo', 'wallet');
    $('#valHint').innerHTML = r && v > r.saldo ? `<span style="color:var(--bad)">⚠ El importe supera el saldo pendiente (${fmtMoney(r.saldo)}).</span>` : r ? `Saldo pendiente: ${fmtMoney(r.saldo)} · <a href="#" id="fillSaldo">usar saldo total</a>` : '';
    $('#fillSaldo')?.addEventListener('click', (e) => { e.preventDefault(); form.valor.value = Math.round(r.saldo); fin(); });
  };
  form.clienteId.addEventListener('change', () => { form.cotizacionId.value = ''; form.facturaId.value = ''; fill(); });
  form.cotizacionId.addEventListener('change', () => { const c = getCot(form.cotizacionId.value); if (c?.facturaId) form.facturaId.value = c.facturaId; fin(); });
  form.facturaId.addEventListener('change', () => { const f = getFac(form.facturaId.value); if (f?.cotizacionId) form.cotizacionId.value = f.cotizacionId; fin(); });
  form.valor.addEventListener('input', fin);
  fill();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    const bad = ['clienteId', 'fecha', 'concepto', 'valor'].filter((k) => !String(v[k]).trim() || (k === 'valor' && +v[k] <= 0));
    bad.forEach((k) => form.elements[k].classList.add('invalid'));
    if (bad.length) return toast('Completa los campos obligatorios.', 'bad');
    if (!v.cotizacionId && !v.facturaId) return toast('Asocia el cobro a un presupuesto o a una factura.', 'bad');
    const a = { id: uid('abo'), numero: Store.nextNumber('ABO'), ...v, valor: +v.valor, estado: 'Aplicado', firmas: {}, plantilla: plantillaActiva('abono'), creado: new Date().toISOString(), creadoPor: Store.user().nombre };
    if (!a.facturaId && a.cotizacionId) a.facturaId = getCot(a.cotizacionId)?.facturaId || '';
    const ac = getCot(a.cotizacionId);
    if (ac && ['Borrador', 'Enviado'].includes(ac.estado)) { audit('Estado', 'Presupuesto', ac.numero, `${ac.estado} → Aprobado (anticipo recibido)`); ac.estado = 'Aprobado'; }
    DB.abonos.push(a);
    audit('Registrar', 'Cobro', a.numero, `${a.concepto} · ${fmtMoney(a.valor)} · ${clienteNombre(a.clienteId)}`);
    const f = getFac(a.facturaId);
    if (f && facturaEstado(f) === 'Pagada') audit('Estado', 'Factura', f.numero, 'Pago final recibido → Pagada');
    persist(); toast(`Cobro ${a.numero} registrado`); go('/abonos/' + a.id);
  });
}
function AbonoDetalle(id) {
  const a = getAbo(id); if (!a) return notFound();
  const manage = puedeGestionar('abonos');
  view.innerHTML = pageHead(`${a.numero} ${badge(a.estado)}`, `${esc(a.concepto)} · ${esc(clienteNombre(a.clienteId))} · ${fmtMoney(a.valor)}`,
    `<button class="btn" data-act="mail">${ico('mail')}Enviar</button><button class="btn" data-act="pdf">${ico('download')}PDF</button>${isWordDoc(a) ? `<button class="btn" data-act="word">${ico('download')}Word</button>` : ''}${manage ? `<button class="btn" data-act="sign">${ico('pen')}Firmar</button>` : ''}${manage && a.estado !== 'Anulado' ? `<button class="btn danger" id="anular">${ico('x')}Anular</button>` : ''}`,
    `<a href="#/abonos">Cobros</a> / ${a.numero}`) +
    `<div class="grid g-main"><div class="card">${docPreview('abono', a)}</div><div class="grid" style="align-content:start">
      <div class="card card-pad"><div class="kv" style="grid-template-columns:1fr 1fr">${[['Presupuesto', getCot(a.cotizacionId) ? `<a href="#/cotizaciones/${a.cotizacionId}">${getCot(a.cotizacionId).numero}</a>` : '—'], ['Factura', getFac(a.facturaId) ? `<a href="#/facturas/${a.facturaId}">${getFac(a.facturaId).numero}</a>` : '—'], ['Forma de pago', esc(a.formaPago)], ['Banco', esc(a.banco)], ['Referencia', esc(a.referencia || '—')], ['Registrado por', esc(a.creadoPor)]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h3>Historial</h3></div><div class="card-pad">${historyFor(a.numero)}</div></div></div></div>`;
  bindDocActions('abono', a);
  $('#anular')?.addEventListener('click', async () => {
    if (!(await confirmBox('Anular cobro', `El cobro ${a.numero} por ${fmtMoney(a.valor)} dejará de sumar al saldo del proyecto.`, 'Anular'))) return;
    a.estado = 'Anulado'; audit('Anular', 'Cobro', a.numero, fmtMoney(a.valor)); persist(); toast('Cobro anulado'); route();
  });
}

/* ==========================================================
   MÓDULO 5 · FACTURACIÓN
   ========================================================== */
function facColumns(withClient = true) {
  return [
    { k: 'numero', label: 'Número', render: (f) => `<b>${f.numero}</b>${f.cotizacionId ? `<div class="muted">${getCot(f.cotizacionId)?.numero || ''}</div>` : ''}` },
    { k: 'fecha', label: 'Fecha', render: (f) => fmtDate(f.fecha) },
    ...(withClient ? [{ k: 'cliente', label: 'Cliente', sort: (f) => clienteNombre(f.clienteId), render: (f) => `${esc(clienteNombre(f.clienteId))}<div class="muted">${esc(getCliente(f.clienteId)?.nit || '')}</div>` }] : []),
    { k: 'vence', label: 'Vence', render: (f) => fmtDate(f.vence) },
    { k: 'total', label: 'Total', cls: 'num', sort: (f) => docTotals(f.items).total, render: (f) => fmtMoney(docTotals(f.items).total) },
    { k: 'abonado', label: 'Cobrado', cls: 'num', sort: (f) => facturaResumen(f).abonado, render: (f) => fmtMoney(facturaResumen(f).abonado) },
    { k: 'saldo', label: 'Saldo', cls: 'num', sort: (f) => facturaResumen(f).saldo, render: (f) => { const s = facturaResumen(f).saldo; return s > 0 && f.estado !== 'Anulada' ? `<b>${fmtMoney(s)}</b>` : '<span class="muted">—</span>'; } },
    { k: 'estado', label: 'Estado', sort: (f) => facturaEstado(f), render: (f) => badge(facturaEstado(f)) },
  ];
}
function Facturas(query = {}) {
  view.innerHTML = pageHead('Facturación', 'Facturas emitidas, pagos a cuenta y saldos', puedeGestionar('facturas') ? `<a class="btn primary" href="#/facturas/nueva">${ico('plus')}Nueva factura</a>` : '') + `<div class="card" id="tbl"></div>`;
  DataTable($('#tbl'), {
    rows: () => DB.facturas, placeholder: 'Número, cliente, NIF, presupuesto…',
    searchText: (f) => [f.numero, clienteNombre(f.clienteId), getCliente(f.clienteId)?.nit, getCot(f.cotizacionId)?.numero, getCot(f.cotizacionId)?.proyecto].join(' '),
    chips: [{ k: 'all', label: 'Todas' }, { k: 'pend', label: 'Con saldo', test: (f) => ['Pendiente', 'En Proceso', 'Vencida'].includes(facturaEstado(f)) }, ...['Pendiente', 'En Proceso', 'Pagada', 'Vencida', 'Anulada'].map((e) => ({ k: e, label: e, test: (f) => facturaEstado(f) === e }))],
    sort: 'fecha', csv: 'facturas', columns: facColumns(),
    footer: (r) => { const v = r.filter((f) => f.estado !== 'Anulada'); return `Facturado ${fmtMoney(v.reduce((s, f) => s + docTotals(f.items).total, 0))} · Saldo ${fmtMoney(v.reduce((s, f) => s + facturaResumen(f).saldo, 0))}`; },
    onRow: (f) => go('/facturas/' + f.id),
  });
  if (query.f) $(`[data-chip="${query.f}"]`)?.click();
}
function FacDetalle(id, tab = 'doc') {
  const f = getFac(id); if (!f) return notFound();
  const r = facturaResumen(f);
  view.innerHTML = pageHead(`${f.numero} ${badge(facturaEstado(f))}`, `${esc(clienteNombre(f.clienteId))} · ${fmtMoney(r.total)}`, docActions('factura', f), `<a href="#/facturas">Facturación</a> / ${f.numero}`) +
    `<div class="grid g-kpi" style="margin-bottom:16px">${[['Total factura', fmtMoney(r.total)], ['Pagos a cuenta', fmtMoney(r.abonado)], ['Saldo pendiente', fmtMoney(r.saldo)], ['Vencimiento', fmtDate(f.vence)]].map(([l, v]) => `<div class="card kpi"><span class="lbl">${l}</span><span class="val">${v}</span></div>`).join('')}</div>
    <div class="card"><div class="tabs">${[['doc', 'Documento'], ['abonos', `Pagos a cuenta (${r.abonos.length})`], ['hist', 'Historial']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="go('/facturas/${id}?tab=${k}')">${l}</button>`).join('')}</div>
    ${tab === 'doc' ? docPreview('factura', f) : tab === 'abonos' ? `<div id="abT"></div>` : `<div class="card-pad">${historyFor(f.numero)}</div>`}</div>`;
  if (tab === 'abonos') DataTable($('#abT'), { rows: () => r.abonos, searchText: (a) => a.numero + a.concepto, sort: 'fecha', columns: aboColumns(false), onRow: (a) => go('/abonos/' + a.id), footer: () => 'Total ' + fmtMoney(r.abonado), empty: 'Sin pagos a cuenta', tools: r.saldo > 0 && f.estado !== 'Anulada' ? `<a class="btn sm primary" href="#/abonos/nuevo?fac=${f.id}">${ico('plus')}Registrar pago</a>` : '' });
  bindDocActions('factura', f);
}

/* ==========================================================
   Render de documentos con plantillas versionadas
   ========================================================== */
function renderDoc(tipo, d, cfgOverride) {
  const cfg = cfgOverride || plantillaConfig(d.plantilla);
  if (cfg.formato === 'word' && cfg.docx) return wordSlot(tipo, d, cfg);
  const cli = getCliente(d.clienteId) || {};
  const E = DB.empresa;
  const titulo = { cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Recibo de pago' }[tipo];
  const items = tipo === 'abono' ? [{ concepto: d.concepto, descripcion: `Ref. ${d.referencia || '—'} · ${d.formaPago} · ${d.banco}`, cantidad: 1, valor: +d.valor, iva: 0, desc: 0 }] : d.items || [];
  const t = docTotals(items);
  const fr = tipo === 'factura' && d.id ? facturaResumen(d) : null;
  const cotRel = tipo !== 'cotizacion' ? getCot(d.cotizacionId) : null;
  const pr = tipo === 'abono' ? (cotRel ? proyectoResumen(cotRel) : getFac(d.facturaId) ? facturaResumen(getFac(d.facturaId)) : null) : null;
  const estado = tipo === 'factura' ? (d.id ? facturaEstado(d) : '') : tipo === 'cotizacion' ? cotEstado(d) : d.estado;
  const stampColor = { Pagada: '#15803d', Anulada: '#b91c1c', Anulado: '#b91c1c', Vencida: '#b45309', Aprobada: '#15803d' }[estado];
  const firma = (k) => d.firmas?.[k];
  const lines = (s) => esc(s).split('\n').map((x, i) => (i ? `<small>${x}</small>` : `<b>${x}</b>`)).join('');
  const B = {
    encabezado: () => `<div class="d-head"><div class="d-logo">${cfg.logo ? `<img src="${cfg.logo}" alt="Logo">` : `<div class="lm">${esc((E.razonSocial || 'T')[0])}</div>`}<div class="d-emisor">${lines(cfg.encabezado || E.razonSocial)}</div></div>
      <div class="d-title"><h2>${titulo}</h2><div class="n">${esc(d.numero || '')}</div><small>Fecha: ${fmtDate(d.fecha)}</small>${d.vence && tipo !== 'abono' ? `<small>${tipo === 'cotizacion' ? 'Válido hasta' : 'Vence'}: ${fmtDate(d.vence)}</small>` : ''}${stampColor ? `<div class="stamp" style="color:${stampColor}">${estado}</div>` : ''}</div></div>`,
    cliente: () => `<div class="d-block"><h4>${tipo === 'abono' ? 'Recibimos de' : 'Cliente'}</h4><div class="d-cols">${[['Razón social', cli.razonSocial], ['NIF', cli.nit], ['Dirección', cli.direccion], ['Localidad', [[cli.codigoPostal, cli.ciudad].filter(Boolean).join(' '), cli.departamento].filter(Boolean).join(', ')], ['Teléfono', cli.celular || cli.telefono], ['Correo', cli.email], ['Contacto', cli.contacto && `${cli.contacto}${cli.cargo ? ' · ' + cli.cargo : ''}`]].filter(([, v]) => v).map(([k, v]) => `<div><small>${k}:</small>${esc(v)}</div>`).join('')}</div></div>`,
    general: () => {
      const rows = tipo === 'cotizacion' ? [['Proyecto', d.proyecto], ['Fecha', fmtDate(d.fecha)], ['Vencimiento', fmtDate(d.vence)]]
        : tipo === 'factura' ? [['Fecha factura', fmtDate(d.fecha)], ['Fecha operación', fmtDate(d.fechaOperacion)], ['Presupuesto relacionado', cotRel?.numero], ['Proyecto', cotRel?.proyecto]]
          : [['Presupuesto asociado', cotRel?.numero], ['Factura asociada', getFac(d.facturaId)?.numero], ['Proyecto', cotRel?.proyecto], ['Forma de pago', d.formaPago], ['Banco', d.banco], ['Referencia de operación', d.referencia]];
      return `<div class="d-block"><h4>${tipo === 'cotizacion' ? 'Datos generales' : 'Información del documento'}</h4><div class="d-cols">${rows.filter(([, v]) => v).map(([k, v]) => `<div><small>${k}:</small>${esc(v)}</div>`).join('')}</div>${tipo === 'cotizacion' && d.descripcion ? `<p style="margin:8px 0 0">${esc(d.descripcion)}</p>` : ''}</div>`;
    },
    detalle: () => `<div class="d-block"><table><thead><tr><th>Concepto</th>${tipo === 'abono' ? '' : '<th class="r">Cant.</th><th class="r">Precio unit.</th><th class="r">Desc.</th><th class="r">IVA</th>'}<th class="r">Total</th></tr></thead><tbody>${items.map((it) => { const l = lineCalc(it); return `<tr><td><b>${esc(it.concepto)}</b>${it.descripcion ? `<small>${esc(it.descripcion)}</small>` : ''}</td>${tipo === 'abono' ? '' : `<td class="r">${it.cantidad}</td><td class="r">${fmtMoney(it.valor)}</td><td class="r">${+it.desc ? it.desc + '%' : '—'}</td><td class="r">${it.iva}%</td>`}<td class="r">${fmtMoney(l.total)}</td></tr>`; }).join('')}</tbody></table></div>`,
    totales: () => tipo === 'abono'
      ? `<div class="d-totals"><div class="g"><span>Importe recibido</span><span>${fmtMoney(d.valor)}</span></div>${pr ? `<div><span>Total proyecto</span><span>${fmtMoney(pr.total)}</span></div><div><span>Total cobrado</span><span>${fmtMoney(pr.abonado)}</span></div><div><b>Saldo pendiente</b><b>${fmtMoney(pr.saldo)}</b></div>` : ''}</div>`
      : `<div class="d-totals"><div><span>Subtotal</span><span>${fmtMoney(t.subtotal)}</span></div>${t.descuento ? `<div><span>Descuento</span><span>− ${fmtMoney(t.descuento)}</span></div>` : ''}<div><span>Base imponible</span><span>${fmtMoney(t.base)}</span></div><div><span>IVA</span><span>${fmtMoney(t.iva)}</span></div><div class="g"><span>Total ${tipo === 'cotizacion' ? 'presupuesto' : 'factura'}</span><span>${fmtMoney(t.total)}</span></div>
        ${fr ? `<div><span>Pagos a cuenta</span><span>− ${fmtMoney(fr.abonado)}</span></div><div><b>Saldo pendiente</b><b>${fmtMoney(fr.saldo)}</b></div>` : ''}</div>`,
    condiciones: () => tipo !== 'cotizacion' ? '' : `<div class="d-block"><h4>Condiciones comerciales</h4><div class="d-cols">${[['Validez', d.validez], ['Forma de pago', d.formaPago], ['Plazo de ejecución', d.tiempoEjecucion], ['Responsable comercial', d.responsable]].filter(([, v]) => v).map(([k, v]) => `<div><small>${k}:</small>${esc(v)}</div>`).join('')}</div></div>`,
    abonos: () => !fr || !fr.abonos.length ? '' : `<div class="d-block"><h4>Pagos a cuenta</h4><table><thead><tr><th>Fecha</th><th>Recibo</th><th>Concepto</th><th class="r">Importe</th></tr></thead><tbody>${fr.abonos.map((a) => `<tr><td>${fmtDate(a.fecha)}</td><td>${a.numero}</td><td>${esc(a.concepto)}</td><td class="r">${fmtMoney(a.valor)}</td></tr>`).join('')}</tbody></table></div>`,
    banco: () => `<div class="d-block"><h4>${tipo === 'abono' ? 'Cuenta de ingreso' : 'Método de pago y datos bancarios'}</h4><div class="d-cols">${[['Método de pago', tipo === 'factura' ? d.metodoPago : null], ['Banco', tipo === 'factura' ? d.banco : E.banco], ['Titular', tipo === 'factura' ? d.titular : E.titular], ['Cuenta', tipo === 'factura' ? d.cuenta : E.cuenta]].filter(([, v]) => v).map(([k, v]) => `<div><small>${k}:</small>${esc(v)}</div>`).join('')}</div></div>`,
    notas: () => d.observaciones ? `<div class="d-block"><h4>Observaciones</h4><div class="d-note">${esc(d.observaciones)}</div></div>` : '',
    firma: () => `<div class="d-sign"><div>${firma('emisor') ? `<img src="${firma('emisor').img}" alt="Firma">` : '<div style="height:64px"></div>'}<div class="line"><b>${esc(firma('emisor')?.nombre || cfg.firmaNombre)}</b><br><small>${esc(cfg.firmaCargo)} · ${esc(E.razonSocial)}</small>${firma('emisor') ? `<br><small style="color:#15803d">Firmado digitalmente ${fmtDateTime(firma('emisor').fecha)}</small>` : ''}</div></div>
      <div>${firma('cliente') ? `<img src="${firma('cliente').img}" alt="Firma cliente">` : '<div style="height:64px"></div>'}<div class="line"><b>${esc(firma('cliente')?.nombre || cli.contacto || 'Cliente')}</b><br><small>${tipo === 'cotizacion' ? 'Aceptación del cliente' : esc(cli.razonSocial || '')}</small>${firma('cliente') ? `<br><small style="color:#15803d">Firmado digitalmente ${fmtDateTime(firma('cliente').fecha)}</small>` : ''}</div></div></div>`,
    pie: () => `<div class="d-foot">${esc(cfg.pie)}${d.plantilla ? `<br>Plantilla v${d.plantilla.version} · Generado por ZEWÁ` : ''}</div>`,
  };
  if (cfg.html && cfg.html.trim()) {
    const vars = { numero: d.numero, fecha: fmtDate(d.fecha), vence: fmtDate(d.vence), titulo, proyecto: d.proyecto || cotRel?.proyecto || '', cliente: cli.razonSocial, nit: cli.nit, direccion: cli.direccion, ciudad: cli.ciudad, telefono: cli.celular || cli.telefono, correo: cli.email, subtotal: fmtMoney(t.subtotal), descuento: fmtMoney(t.descuento), base: fmtMoney(t.base), iva: fmtMoney(t.iva), total: fmtMoney(tipo === 'abono' ? d.valor : t.total), saldo: fmtMoney(fr?.saldo ?? pr?.saldo ?? 0), observaciones: d.observaciones || '', empresa: E.razonSocial, empresa_nit: E.nit, logo: cfg.logo ? `<img src="${cfg.logo}" style="max-height:60px">` : '' };
    const html = cfg.html.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k === 'detalle' ? B.detalle() : k === 'totales' ? B.totales() : k === 'firma' ? B.firma() : k === 'logo' ? vars.logo : esc(vars[k] ?? '')));
    return `<div class="doc" style="--c1:${cfg.color};--c2:${cfg.color2};--doc-font:'${cfg.fuente}'">${sanitizeHTML(html)}</div>`;
  }
  return `<div class="doc" style="--c1:${cfg.color};--c2:${cfg.color2};--doc-font:'${cfg.fuente}'">${cfg.bloques.filter((b) => b.on && B[b.k]).map((b) => B[b.k]()).join('')}</div>`;
}
/* Las plantillas HTML subidas no pueden ejecutar scripts */
function sanitizeHTML(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  tpl.content.querySelectorAll('script,iframe,object,embed,link,meta').forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name); }));
  return tpl.innerHTML;
}
/* Página aislada solo con el documento: sin fondo ni layout de la app.
   Plantilla Word: los márgenes los pone el propio .docx (Diseño > Márgenes), por eso @page va en 0.
   Diseñador del sistema: márgenes de página en cada hoja. */
function buildPrintHTML(title, bodyHTML, isWord) {
  const css = new URL('assets/app.css', location.href).href;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${css}">
    <style>
      @page { size: A4; margin: ${isWord ? '0' : '16mm 14mm'}; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; display: block !important; min-height: 0 !important; }
      #print-area { display: block !important; position: static !important; }
      #print-area .doc { box-shadow: none !important; width: auto !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
      #print-area .docx-wrapper { background: none !important; padding: 0 !important; display: block !important; }
      #print-area .docx-wrapper > section.docx { box-shadow: none !important; margin: 0 !important; break-after: page; }
      #print-area .docx-wrapper > section.docx:last-child { break-after: auto; }
      #print-area .doc tr, #print-area .doc .d-totals, #print-area .doc .d-sign { break-inside: avoid; }
    </style></head><body><div id="print-area">${bodyHTML}</div></body></html>`;
}
async function printDoc(tipo, d) {
  const area = $('#print-area');
  area.innerHTML = renderDoc(tipo, d);
  const slot = $('.docx-slot', area);
  if (slot) {
    toast('Preparando PDF desde la plantilla Word…');
    try { await renderWordInto(slot, plantillaConfig(d.plantilla), tipo, d); }
    catch (e) { return toast(e.message, 'bad'); }
  }
  const html = buildPrintHTML(`${d.numero} - ${clienteNombre(d.clienteId)}`, area.innerHTML, !!slot);
  area.innerHTML = '';
  $('#print-frame')?.remove();
  const fr = document.createElement('iframe');
  fr.id = 'print-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  const fire = () => setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); }, 250);
  if (fr.contentDocument.readyState === 'complete') fire(); else fr.addEventListener('load', fire, { once: true });
}
function sendMail(tipo, d) {
  const cli = getCliente(d.clienteId) || {};
  const titulo = { cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Recibo de pago' }[tipo];
  const total = tipo === 'abono' ? d.valor : docTotals(d.items).total;
  modal({
    title: `Enviar ${titulo} ${d.numero}`, okText: 'Abrir en correo',
    body: `<div class="form-grid"><div class="f s12"><label>Para</label><input class="in" name="to" value="${esc(cli.email || '')}"></div>
      <div class="f s12"><label>Asunto</label><input class="in" name="sub" value="${esc(`${titulo} ${d.numero} - ${DB.empresa.razonSocial}`)}"></div>
      <div class="f s12"><label>Mensaje</label><textarea class="in" name="msg" rows="7">${esc(`Hola ${cli.contacto || cli.razonSocial || ''},\n\nLe adjuntamos ${tipo === 'factura' ? 'la' : 'el'} ${titulo.toLowerCase()} ${d.numero}${d.proyecto ? ` del proyecto "${d.proyecto}"` : ''} por importe de ${fmtMoney(total)}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo,\n${Store.user().nombre}\n${DB.empresa.razonSocial}`)}</textarea></div>
      <div class="f s12"><span class="hint">Se abrirá tu cliente de correo. Descarga el PDF con el botón "PDF" y adjúntalo al mensaje.</span></div></div>`,
    onOk: (ov) => {
      const to = $('[name=to]', ov).value, sub = $('[name=sub]', ov).value, msg = $('[name=msg]', ov).value;
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(msg)}`;
      if (tipo === 'cotizacion' && d.estado === 'Borrador') d.estado = 'Enviado';
      audit('Enviar', { cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Cobro' }[tipo], d.numero, 'Enviado a ' + to); persist(); setTimeout(route, 300);
    },
  });
}
function signDialog(tipo, d) {
  const cli = getCliente(d.clienteId) || {};
  modal({
    title: 'Firma digital · ' + d.numero, okText: 'Firmar documento',
    body: `<div class="form-grid"><div class="f s6"><label>Firma como</label><select class="in" name="rol"><option value="emisor">Emisor (${esc(DB.empresa.razonSocial)})</option><option value="cliente">Cliente (aceptación)</option></select></div>
      <div class="f s6"><label>Nombre del firmante</label><input class="in" name="nombre" value="${esc(Store.user().nombre)}"></div>
      <div class="f s12"><label>Dibuja la firma</label><canvas class="sig-pad" id="sig"></canvas><div style="display:flex;justify-content:space-between"><span class="hint">Se registra fecha, hora y usuario en la auditoría.</span><button type="button" class="btn sm ghost" id="sigClear">Limpiar</button></div></div></div>`,
    onOpen: (ov) => {
      const cv = $('#sig', ov), ctx = cv.getContext('2d');
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; ctx.scale(2, 2); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'; };
      fit(); cv._dirty = false;
      let drawing = false;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointerdown', (e) => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
      cv.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); cv._dirty = true; });
      cv.addEventListener('pointerup', () => { drawing = false; });
      $('#sigClear', ov).addEventListener('click', () => { ctx.clearRect(0, 0, cv.width, cv.height); cv._dirty = false; });
      $('[name=rol]', ov).addEventListener('change', (e) => { $('[name=nombre]', ov).value = e.target.value === 'cliente' ? (cli.contacto || '') : Store.user().nombre; });
    },
    onOk: (ov) => {
      const cv = $('#sig', ov);
      if (!cv._dirty) { toast('Dibuja la firma antes de continuar', 'bad'); return false; }
      const rol = $('[name=rol]', ov).value;
      d.firmas = d.firmas || {};
      d.firmas[rol] = { img: cv.toDataURL('image/png'), nombre: $('[name=nombre]', ov).value, fecha: new Date().toISOString(), usuario: Store.user().nombre };
      if (tipo === 'cotizacion' && rol === 'cliente' && ['Borrador', 'Enviado'].includes(d.estado)) d.estado = 'Aprobado';
      audit('Firmar', { cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Cobro' }[tipo], d.numero, `Firma ${rol === 'cliente' ? 'del cliente' : 'del emisor'}: ${d.firmas[rol].nombre}`);
      persist(); toast('Documento firmado'); route();
    },
  });
}

/* ==========================================================
   MÓDULO 6 · PLANTILLAS
   ========================================================== */
function sampleDoc(tipo) {
  const list = { cotizacion: DB.cotizaciones, factura: DB.facturas, abono: DB.abonos }[tipo];
  const real = [...list].reverse().find((x) => x.estado !== 'Anulada' && x.estado !== 'Anulado');
  return real ? { ...real, plantilla: null } : null;
}
function Plantillas() {
  const tipos = [['cotizacion', 'Presupuestos'], ['factura', 'Facturas'], ['abono', 'Recibos de pago']];
  const puede = puedeGestionar('plantillas');
  view.innerHTML = pageHead('Plantillas de documentos', 'Diseño de presupuestos, facturas y recibos. Cada cambio crea una versión nueva: los documentos ya emitidos conservan su diseño original.', puede ? `<button class="btn primary" id="newTpl">${ico('plus')}Nueva plantilla</button>` : '') +
    tipos.map(([t, l]) => `<h3 style="margin:22px 0 10px;font-size:15px">${l}</h3><div class="grid g-3">${DB.plantillas.filter((p) => p.tipo === t).map((p) => {
      const v = p.versiones[p.versiones.length - 1], s = sampleDoc(t);
      return `<a class="card tpl-card" href="#/plantillas/${p.id}" style="color:inherit"><div class="tpl-thumb">${v.config.formato === 'word' && v.config.docx ? `<div style="height:100%;display:grid;place-items:center;text-align:center;background:var(--brand-50);color:var(--brand)"><div><div class="file-ico" style="background:#2b579a;margin:0 auto 6px;width:44px;height:44px;font-size:11px">DOCX</div><small>${esc(v.config.docxNombre || 'Plantilla Word')}</small></div></div>` : s ? `<div class="tpl-scale">${renderDoc(t, s, v.config)}</div>` : ''}</div>
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(p.nombre)}</b>${badge(p.estado)}</div>
        <small style="color:var(--text-3)">v${v.version} · modificada ${fmtDate(v.fecha)} por ${esc(v.usuario)}</small>
        <div class="swatches"><i style="width:16px;height:16px;border-radius:4px;background:${v.config.color}"></i><i style="width:16px;height:16px;border-radius:4px;background:${v.config.color2}"></i><small style="color:var(--text-3)">${v.config.formato === 'word' && v.config.docx ? 'Plantilla Word' : v.config.html ? 'HTML personalizado' : v.config.bloques.filter((b) => b.on).length + ' bloques'}</small></div></a>`;
    }).join('')}</div>`).join('');
  if (!puede) return;
  $('#newTpl').addEventListener('click', () => modal({
    title: 'Nueva plantilla', okText: 'Crear',
    body: `<div class="form-grid"><div class="f s12"><label>Nombre</label><input class="in" name="n" placeholder="Ej. Presupuesto premium"></div><div class="f s12"><label>Tipo de documento</label><select class="in" name="t">${tipos.map(([t, l]) => `<option value="${t}">${l}</option>`).join('')}</select></div>
      <div class="f s12"><label>Basada en</label><select class="in" name="b"><option value="">Diseño por defecto</option>${DB.plantillas.map((p) => `<option value="${p.id}">${esc(p.nombre)} (v${p.versiones.length})</option>`).join('')}</select></div></div>`,
    onOk: (ov) => {
      const n = $('[name=n]', ov).value.trim(), t = $('[name=t]', ov).value, b = $('[name=b]', ov).value;
      if (!n) { toast('Escribe un nombre', 'bad'); return false; }
      const src = b ? DB.plantillas.find((p) => p.id === b) : null;
      const cfg = src && src.tipo === t ? clone(src.versiones[src.versiones.length - 1].config) : defaultTemplateConfig(t);
      if (src && src.tipo !== t) Object.assign(cfg, { color: src.versiones.at(-1).config.color, color2: src.versiones.at(-1).config.color2, logo: src.versiones.at(-1).config.logo });
      const p = { id: uid('tpl'), tipo: t, nombre: n, estado: 'Inactiva', creado: new Date().toISOString(), creadoPor: Store.user().nombre, versiones: [{ version: 1, fecha: new Date().toISOString(), usuario: Store.user().nombre, nota: 'Creación', config: cfg }] };
      DB.plantillas.push(p); audit('Crear', 'Plantilla', p.nombre, 'v1'); persist(); go('/plantillas/' + p.id);
    },
  }));
}
function PlantillaEditor(id, query = {}) {
  const p = DB.plantillas.find((x) => x.id === id); if (!p) return notFound();
  const puede = puedeGestionar('plantillas');
  const viewV = query.v ? p.versiones.find((v) => v.version === +query.v) : null;
  const cur = p.versiones[p.versiones.length - 1];
  const cfg = clone((viewV || cur).config);
  const sample = sampleDoc(p.tipo);
  let nombre = p.nombre;
  const usados = { cotizacion: DB.cotizaciones, factura: DB.facturas, abono: DB.abonos }[p.tipo].filter((d) => d.plantilla?.id === p.id).length;
  view.innerHTML = pageHead(`${esc(p.nombre)} ${badge(p.estado)}`, `${{ cotizacion: 'Presupuesto', factura: 'Factura', abono: 'Cobro' }[p.tipo]} · ${viewV ? `viendo versión ${viewV.version} (histórica)` : `versión actual v${cur.version}`} · usada por ${usados} documento(s)`,
    !puede ? '' : `${p.estado !== 'Activa' ? `<button class="btn" id="activar">${ico('check')}Activar</button>` : ''}${viewV ? `<a class="btn" href="#/plantillas/${id}">Volver a la actual</a><button class="btn primary" id="restore">${ico('clock')}Restaurar esta versión</button>` : `<button class="btn primary" id="save">${ico('check')}Guardar como v${cur.version + 1}</button>`}`,
    `<a href="#/plantillas">Plantillas</a> / ${esc(p.nombre)}`) +
    `<div class="tpl-layout"><div class="grid">
      <div class="card"><div class="tabs" id="tplTabs"><button class="on" data-t="word">Plantilla Word</button><button data-t="dis">Diseño</button><button data-t="blo">Bloques</button><button data-t="html">HTML / PDF</button><button data-t="ver">Versiones</button></div><div class="card-pad" id="tplPane"></div></div>
    </div><div class="card"><div class="card-head"><div><h3>Vista previa en vivo</h3><p>${sample ? 'Con datos de ' + sample.numero : 'Sin documentos de ejemplo'}</p></div></div><div class="preview-frame" id="tplPrev"></div></div></div>`;
  const prev = () => { $('#tplPrev').innerHTML = sample ? renderDoc(p.tipo, sample, cfg) : emptyState('Crea un documento de este tipo para ver la vista previa'); hydrateWord($('#tplPrev')); };
  let wordCheck = '';
  const usaWord = () => cfg.formato === 'word';
  const panes = {
    word: () => `<div class="form-grid">
      <div class="f s12"><label>Nombre de la plantilla</label><input class="in" data-k="__nombre" value="${esc(nombre)}"></div>
      <div class="f s12"><label>Formato del documento</label><div class="chips">
        <label class="chip ${usaWord() ? 'on' : ''}"><input type="radio" name="fmt" value="word" ${usaWord() ? 'checked' : ''} hidden data-edit>Plantilla Word (.docx)</label>
        <label class="chip ${!usaWord() ? 'on' : ''}"><input type="radio" name="fmt" value="diseno" ${!usaWord() ? 'checked' : ''} hidden data-edit>Diseñador del sistema</label></div></div>
      <div class="f s12"><div style="padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)">
        ${cfg.docx ? `<div style="display:flex;gap:10px;align-items:center"><span class="file-ico" style="background:#2b579a">DOCX</span><div style="flex:1;min-width:0"><b style="word-break:break-all">${esc(cfg.docxNombre || 'plantilla.docx')}</b><div class="hint">${Math.round(cfg.docx.length * 0.75 / 1024)} KB · ${usaWord() ? 'en uso' : 'guardada, pero el documento usa el diseñador'}</div></div></div>
          <div class="btn-row mt"><button class="btn sm" id="wDown">${ico('download')}Descargar para editar</button><label class="btn sm primary">${ico('upload')}Subir versión editada<input type="file" accept=".docx" id="wIn" hidden data-edit></label><button class="btn sm ghost danger" id="wDel" data-edit>Quitar</button></div>`
        : `<div class="drop" id="wDrop" style="padding:18px">${ico('upload')}<div><b>Sube tu plantilla Word (.docx)</b></div><small>Arrastra el archivo aquí o haz clic · máx. 3 MB</small><input type="file" accept=".docx" id="wIn" hidden data-edit></div>
          ${p.tipo === 'cotizacion' ? `<button class="btn sm mt" id="wEj" data-edit>${ico('layout')}Cargar ejemplo: Presupuesto Zewá Reformas</button>` : ''}`}
      </div></div>
      <div class="f s12" id="wCheck">${wordCheck}</div>
      <div class="f s12"><details ${cfg.docx ? '' : 'open'}><summary style="cursor:pointer;font-weight:600">¿Cómo preparar la plantilla en Word?</summary>
        <ol style="padding-left:18px;color:var(--text-2);line-height:1.7;margin:8px 0">
          <li>Diseña el documento en Word como quieras: logo, colores, tablas, encabezado y pie.</li>
          <li>Donde va un dato, escribe la variable entre llaves dobles, por ejemplo <code>{{cliente_nombre}}</code> o <code>{{total}}</code>.</li>
          <li>Para la tabla de conceptos deja <b>una sola fila</b>: en la primera celda escribe <code>{{#items}}{{concepto}}</code> y en la última <code>{{total}}{{/items}}</code>. El sistema repite la fila por cada línea.</li>
          <li>Los valores salen con el formato de la moneda configurada (p. ej. <code>1.234,50</code>); escribe tú el símbolo € o $ en Word si lo quieres.</li>
          <li>Sube el archivo, revisa la vista previa y pulsa <b>Guardar como v${cur.version + 1}</b>. Los documentos ya emitidos no cambian.</li>
        </ol></details></div>
      <div class="f s12"><details><summary style="cursor:pointer;font-weight:600">Variables disponibles (clic para copiar)</summary>
        ${WORD_VARS.map(([g, l]) => `<div style="margin-top:10px"><small style="color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.05em">${esc(g)}</small><table class="mini-tbl">${l.map(([k, dsc]) => `<tr><td style="white-space:nowrap"><code class="wvar" style="cursor:pointer" title="Copiar">{{${k.split(' / ')[0]}}}</code></td><td>${esc(dsc)}</td></tr>`).join('')}</table></div>`).join('')}
      </details></div></div>`,
    dis: () => `<div class="form-grid">
      ${usaWord() ? `<div class="f s12"><div style="padding:10px 12px;border-radius:8px;background:var(--warn-bg);color:var(--warn)">Esta plantilla usa un archivo Word: el diseño se cambia editando el .docx. Estas opciones aplican solo al diseñador del sistema.</div></div>` : ''}
      <div class="f s12"><label>Colores corporativos</label><div class="swatches"><input type="color" data-k="color" value="${cfg.color}" title="Color principal"><input type="color" data-k="color2" value="${cfg.color2}" title="Color secundario"><span class="hint">Principal · Secundario</span></div></div>
      <div class="f s12"><label>Tipografía</label><select class="in" data-k="fuente">${['Inter', 'Georgia', 'Arial', 'Courier New', 'Trebuchet MS'].map((f) => `<option ${f === cfg.fuente ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="f s12"><label>Logo</label><div style="display:flex;gap:8px;align-items:center">${cfg.logo ? `<img src="${cfg.logo}" style="max-height:40px;max-width:120px;border:1px solid var(--border);border-radius:6px;padding:2px;background:#fff">` : ''}<label class="btn sm">${ico('upload')}Subir imagen<input type="file" accept="image/*" id="logoIn" hidden></label>${cfg.logo ? `<button class="btn sm ghost" id="logoDel">Quitar</button>` : ''}</div><span class="hint">PNG o SVG, máx. 300 KB</span></div>
      <div class="f s12"><label>Encabezado (datos del emisor)</label><textarea class="in" data-k="encabezado" rows="3">${esc(cfg.encabezado)}</textarea></div>
      <div class="f s12"><label>Pie de página</label><textarea class="in" data-k="pie" rows="2">${esc(cfg.pie)}</textarea></div>
      <div class="f s6"><label>Firma: nombre</label><input class="in" data-k="firmaNombre" value="${esc(cfg.firmaNombre)}"></div>
      <div class="f s6"><label>Firma: cargo</label><input class="in" data-k="firmaCargo" value="${esc(cfg.firmaCargo)}"></div></div>`,
    blo: () => `<p class="hint" style="margin-top:0">Arrastra para reordenar las secciones del documento. Desmarca para ocultarlas.</p><ul class="blocks" id="blocks">${cfg.bloques.map((b, i) => `<li draggable="true" data-i="${i}"><span class="grip">${ico('grip')}</span>${BLOQUES[b.k]}<input type="checkbox" ${b.on ? 'checked' : ''} aria-label="Mostrar ${BLOQUES[b.k]}"></li>`).join('')}</ul>`,
    html: () => `<div class="form-grid"><div class="f s12"><label>Plantilla HTML personalizada (opcional)</label><textarea class="in" data-k="html" rows="10" style="font-family:monospace;font-size:12px" placeholder="<h1>{{titulo}} {{numero}}</h1>…">${esc(cfg.html)}</textarea>
      <span class="hint">Si hay HTML, reemplaza el diseño por bloques. Variables: {{titulo}} {{numero}} {{fecha}} {{vence}} {{cliente}} {{nit}} {{direccion}} {{ciudad}} {{telefono}} {{correo}} {{proyecto}} {{detalle}} {{totales}} {{subtotal}} {{iva}} {{total}} {{saldo}} {{observaciones}} {{firma}} {{logo}} {{empresa}}. Los scripts se eliminan por seguridad.</span></div>
      <div class="f s12"><div class="btn-row"><label class="btn sm">${ico('upload')}Subir archivo .html<input type="file" accept=".html,.htm,text/html" id="htmlIn" hidden></label>${cfg.html ? `<button class="btn sm ghost" id="htmlDel">Volver a bloques</button>` : ''}</div></div>
      <div class="f s12"><label>Membrete / formato PDF de referencia</label>${cfg.pdfBase ? `<div class="btn-row"><a class="btn sm" href="${cfg.pdfBase}" download="membrete.pdf">${ico('download')}Descargar PDF base</a><button class="btn sm ghost" id="pdfDel">Quitar</button></div>` : ''}<label class="btn sm" style="width:max-content">${ico('upload')}Subir PDF<input type="file" accept="application/pdf" id="pdfIn" hidden></label><span class="hint">Se guarda con la versión como formato oficial de referencia (máx. 1 MB).</span></div></div>`,
    ver: () => `<ul class="timeline">${[...p.versiones].reverse().map((v) => `<li><span class="dot">${ico('clock')}</span><div><b>Versión ${v.version}</b> ${v.version === cur.version ? badge('Activa') : ''}<br><span style="color:var(--text-2)">${esc(v.nota || '')}</span><small>${esc(v.usuario)} · ${fmtDateTime(v.fecha)}</small>${v.version !== cur.version ? `<a class="btn sm mt" href="#/plantillas/${id}?v=${v.version}">${ico('eye')}Ver</a>` : ''}</div></li>`).join('')}</ul>
      <p class="hint">Creada ${fmtDate(p.creado)} por ${esc(p.creadoPor)}.</p>`,
  };
  const showPane = (k) => {
    $$('#tplTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === k));
    $('#tplPane').innerHTML = panes[k]();
    if (k === 'blo') bindBlocks();
    if (k === 'word') bindWord();
    const file = async (sel, max, fn) => $(sel)?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > max) return toast(`Archivo muy grande (máx. ${Math.round(max / 1024)} KB)`, 'bad'); await fn(f); showPane(k); prev(); });
    file('#logoIn', 300 * 1024, async (f) => { cfg.logo = await readFileAsDataURL(f); });
    file('#htmlIn', 200 * 1024, async (f) => { cfg.html = await readFileAsText(f); });
    file('#pdfIn', 1024 * 1024, async (f) => { cfg.pdfBase = await readFileAsDataURL(f); toast('PDF base adjuntado'); });
    $('#logoDel')?.addEventListener('click', () => { cfg.logo = ''; showPane(k); prev(); });
    $('#htmlDel')?.addEventListener('click', () => { cfg.html = ''; showPane(k); prev(); });
    $('#pdfDel')?.addEventListener('click', () => { cfg.pdfBase = ''; showPane(k); });
    if (viewV) $$('#tplPane input, #tplPane textarea, #tplPane select, #tplPane li, #tplPane [data-edit]').forEach((x) => { x.disabled = true; x.draggable = false; if (x.matches('[data-edit]')) x.closest('label,button').style.pointerEvents = 'none'; });
  };
  const loadDocx = async (bytes, nombreArchivo) => {
    $('#wCheck').innerHTML = '<span class="hint">Revisando la plantilla…</span>';
    try {
      const r = await inspectWord(bytes, p.tipo);
      if (r.errores.length) {
        wordCheck = `<div style="padding:12px 14px;border-radius:10px;background:var(--bad-bg);color:var(--bad)"><b>No se pudo usar "${esc(nombreArchivo)}"</b><ul style="margin:6px 0 0;padding-left:18px">${r.errores.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
        return showPane('word');
      }
      cfg.docx = bytesToDataURL(bytes); cfg.docxNombre = nombreArchivo; cfg.formato = 'word';
      wordCheck = `<div style="padding:12px 14px;border-radius:10px;background:var(--ok-bg);color:var(--ok)"><b>Plantilla lista: ${r.tags.length} variable(s) reconocida(s)</b>
        ${!r.tieneItems && p.tipo !== 'abono' ? `<div style="color:var(--warn);margin-top:6px">⚠ No encontramos la fila <code>{{#items}}</code> … <code>{{/items}}</code>: el detalle de conceptos no aparecerá.</div>` : ''}
        ${r.desconocidas.length ? `<div style="color:var(--warn);margin-top:6px">⚠ Variables que el sistema no conoce (quedarán en blanco): ${r.desconocidas.map((t) => `<code>{{${esc(t)}}}</code>`).join(' ')}</div>` : ''}
        <div style="color:var(--text-2);margin-top:6px">Revisa la vista previa y pulsa <b>Guardar como v${cur.version + 1}</b>.</div></div>`;
      showPane('word'); prev();
    } catch (e) { wordCheck = `<div style="color:var(--bad)">${esc(e.message)}</div>`; showPane('word'); }
  };
  const bindWord = () => {
    const pick = async (f) => {
      if (!f) return;
      if (!/\.docx$/i.test(f.name)) return toast('Sube un archivo .docx. Si es .doc, ábrelo en Word y guárdalo como .docx.', 'bad');
      if (f.size > 3 * 1024 * 1024) return toast('La plantilla supera 3 MB. Comprime las imágenes en Word.', 'bad');
      loadDocx(new Uint8Array(await f.arrayBuffer()), f.name);
    };
    $('#wIn')?.addEventListener('change', (e) => pick(e.target.files[0]));
    const drop = $('#wDrop');
    if (drop && !viewV) {
      drop.addEventListener('click', (e) => { if (e.target.id !== 'wIn') $('#wIn').click(); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
    }
    $('#wEj')?.addEventListener('click', async () => {
      try { const r = await fetch('plantillas/cotizacion-zewa.docx'); if (!r.ok) throw 0; loadDocx(new Uint8Array(await r.arrayBuffer()), 'Plantilla_Presupuesto_Zewa.docx'); }
      catch (e) { toast('No se pudo cargar el ejemplo. Abre el sistema desde el servidor local (http://localhost…).', 'bad'); }
    });
    $('#wDown')?.addEventListener('click', () => downloadFile(cfg.docxNombre || 'plantilla.docx', cfg.docx));
    $('#wDel')?.addEventListener('click', () => { cfg.docx = ''; cfg.docxNombre = ''; cfg.formato = 'diseno'; wordCheck = ''; showPane('word'); prev(); });
    $$('#tplPane [name=fmt]').forEach((r) => r.addEventListener('change', () => {
      cfg.formato = r.value;
      if (r.value === 'word' && !cfg.docx) toast('Sube un archivo .docx para usar el formato Word', 'bad');
      showPane('word'); prev();
    }));
    $$('#tplPane .wvar').forEach((c) => c.addEventListener('click', () => { navigator.clipboard?.writeText(c.textContent).then(() => toast('Copiado: ' + c.textContent)); }));
  };
  const bindBlocks = () => {
    let from = null;
    $$('#blocks li').forEach((li) => {
      li.addEventListener('dragstart', () => { from = +li.dataset.i; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
      li.addEventListener('dragleave', () => li.classList.remove('over'));
      li.addEventListener('drop', (e) => { e.preventDefault(); const to = +li.dataset.i; const [m] = cfg.bloques.splice(from, 1); cfg.bloques.splice(to, 0, m); showPane('blo'); prev(); });
      $('input', li).addEventListener('change', (e) => { cfg.bloques[+li.dataset.i].on = e.target.checked; prev(); });
    });
  };
  $('#tplTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showPane(b.dataset.t); });
  $('#tplPane').addEventListener('input', (e) => { const k = e.target.dataset.k; if (!k) return; if (k === '__nombre') { nombre = e.target.value; return; } cfg[k] = e.target.value; prev(); });
  showPane('word'); prev();
  const newVersion = (nota) => {
    const before = cur.config;
    p.versiones.push({ version: cur.version + 1, fecha: new Date().toISOString(), usuario: Store.user().nombre, nota, config: clone(cfg) });
    audit('Editar', 'Plantilla', p.nombre, `v${cur.version + 1}: ${nota}`, diffObjects(before, cfg, ['bloques', 'logo', 'html', 'pdfBase']));
  };
  $('#save')?.addEventListener('click', () => modal({
    title: `Guardar versión ${cur.version + 1}`, okText: 'Guardar versión',
    body: `<div class="f"><label>Descripción del cambio</label><input class="in" name="nota" placeholder="Ej. Nuevo logo y color azul"></div><p class="hint">Los ${usados} documento(s) emitidos con versiones anteriores no cambian. Los nuevos documentos usarán v${cur.version + 1}${p.estado === 'Activa' ? '' : ' cuando actives la plantilla'}.</p>`,
    onOk: (ov) => { if (nombre.trim() && nombre.trim() !== p.nombre) { audit('Editar', 'Plantilla', p.nombre, 'Renombrada a ' + nombre.trim()); p.nombre = nombre.trim(); } newVersion($('[name=nota]', ov).value || 'Actualización de diseño'); persist(); toast('Versión guardada'); route(); },
  }));
  $('#restore')?.addEventListener('click', () => { newVersion(`Restaurada desde v${viewV.version}`); persist(); toast('Versión restaurada como nueva versión'); go('/plantillas/' + id); });
  $('#activar')?.addEventListener('click', () => {
    DB.plantillas.filter((x) => x.tipo === p.tipo && x.estado === 'Activa').forEach((x) => { x.estado = 'Inactiva'; });
    p.estado = 'Activa'; audit('Activar', 'Plantilla', p.nombre, `Plantilla activa para ${p.tipo}`); persist(); toast('Plantilla activada para nuevos documentos'); route();
  });
}

/* ==========================================================
   MÓDULO 7 · BÚSQUEDA INTELIGENTE
   ========================================================== */
function estadoGrupo(estado) {
  return { Pendiente: 'Pendientes', Enviada: 'Pendientes', Enviado: 'Pendientes', Borrador: 'Pendientes', Pagada: 'Pagados', Aplicado: 'Pagados', Vencida: 'Vencidos', Vencido: 'Vencidos', Anulada: 'Anulados', Anulado: 'Anulados', 'En Proceso': 'En Proceso', Aprobada: 'En Proceso', Aprobado: 'En Proceso', Facturada: 'En Proceso', Facturado: 'En Proceso' }[estado] || '';
}
function allDocsIndex() {
  const out = [];
  DB.cotizaciones.forEach((c) => out.push({ tipo: 'Presupuesto', id: c.id, href: '#/cotizaciones/' + c.id, numero: c.numero, fecha: c.fecha, clienteId: c.clienteId, proyecto: c.proyecto, valor: docTotals(c.items).total, estado: cotEstado(c) }));
  DB.facturas.forEach((f) => out.push({ tipo: 'Factura', id: f.id, href: '#/facturas/' + f.id, numero: f.numero, fecha: f.fecha, clienteId: f.clienteId, proyecto: getCot(f.cotizacionId)?.proyecto || '', valor: docTotals(f.items).total, estado: facturaEstado(f) }));
  DB.abonos.forEach((a) => out.push({ tipo: 'Cobro', id: a.id, href: '#/abonos/' + a.id, numero: a.numero, fecha: a.fecha, clienteId: a.clienteId, proyecto: getCot(a.cotizacionId)?.proyecto || '', valor: +a.valor, estado: a.estado, extra: a.referencia }));
  return out;
}
function matchField(r, cli, field, q) {
  const f = {
    nit: () => cli?.nit, empresa: () => [cli?.razonSocial, cli?.nombreComercial].join(' '), numero: () => r.numero, proyecto: () => r.proyecto,
    correo: () => cli?.email, telefono: () => [cli?.telefono, cli?.celular].join(' '),
  };
  const hay = field === 'todo' ? [r.numero, r.proyecto, r.tipo, r.extra, cli?.nit, cli?.razonSocial, cli?.nombreComercial, cli?.email, cli?.telefono, cli?.celular, cli?.contacto, cli?.ciudad].join(' ') : f[field]?.() || '';
  if (field === 'nit' || field === 'telefono') return hay.replace(/\D/g, '').includes(q.replace(/\D/g, '')) && q.replace(/\D/g, '');
  return norm(hay).includes(norm(q));
}
function Busqueda(query = {}) {
  const st = { q: query.q || '', field: 'todo', tipo: '', desde: '', hasta: '', grupo: '' };
  view.innerHTML = pageHead('Búsqueda inteligente', 'Encuentra cualquier documento o cliente por NIF, empresa, número, proyecto, correo, teléfono, fecha o estado') +
    `<div class="card card-pad"><div class="form-grid">
      <div class="f s6"><label>Buscar</label><input class="in" id="q" type="search" value="${esc(st.q)}" placeholder="Escribe un NIF, nombre, PRE-2026-0001, correo…"></div>
      <div class="f s3"><label>Buscar en</label><select class="in" id="field">${[['todo', 'Todos los campos'], ['nit', 'NIF'], ['empresa', 'Empresa / cliente'], ['numero', 'Número de documento'], ['proyecto', 'Proyecto'], ['correo', 'Correo'], ['telefono', 'Teléfono']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="f s3"><label>Tipo de documento</label><select class="in" id="tipo"><option value="">Todos</option><option>Presupuesto</option><option>Factura</option><option>Cobro</option></select></div>
      <div class="f s3"><label>Desde</label><input class="in" type="date" id="desde"></div>
      <div class="f s3"><label>Hasta</label><input class="in" type="date" id="hasta"></div>
      <div class="f s6"><label>Estado</label><div class="chips" id="grupos">${['', 'Pendientes', 'Pagados', 'Vencidos', 'Anulados', 'En Proceso'].map((g) => `<button class="chip ${g === '' ? 'on' : ''}" data-g="${g}">${g || 'Todos'}</button>`).join('')}</div></div>
    </div></div>
    <div class="card mt" id="cliRes"></div><div class="card mt" id="res"></div>`;
  const run = () => {
    const idx = allDocsIndex();
    const res = idx.filter((r) => {
      const cli = getCliente(r.clienteId);
      if (st.q && !matchField(r, cli, st.field, st.q)) return false;
      if (st.tipo && r.tipo !== st.tipo) return false;
      if (st.desde && r.fecha < st.desde) return false;
      if (st.hasta && r.fecha > st.hasta) return false;
      if (st.grupo && estadoGrupo(r.estado) !== st.grupo) return false;
      return true;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const clis = st.q ? DB.clientes.filter((c) => matchField({}, c, ['numero', 'proyecto'].includes(st.field) ? 'none' : st.field, st.q)) : [];
    $('#cliRes').hidden = !clis.length;
    $('#cliRes').innerHTML = `<div class="card-head"><h3>Clientes (${clis.length})</h3></div><div class="tbl-wrap"><table class="tbl"><tbody>${clis.map((c) => `<tr class="click" onclick="go('/clientes/${c.id}')"><td><b>${esc(c.razonSocial)}</b><div class="muted">${c.codigo}</div></td><td>${esc(c.nit)}</td><td>${esc(c.email)}</td><td>${esc(c.celular || c.telefono)}</td><td>${esc(c.ciudad)}</td></tr>`).join('')}</tbody></table></div>`;
    const el = $('#res');
    DataTable(el, {
      rows: () => res, searchText: (r) => r.numero + ' ' + clienteNombre(r.clienteId), sort: 'fecha', csv: 'busqueda', placeholder: 'Refinar resultados…',
      columns: [
        { k: 'tipo', label: 'Tipo', render: (r) => `<span class="tag">${r.tipo}</span>` },
        { k: 'numero', label: 'Número', render: (r) => `<b>${r.numero}</b>` },
        { k: 'cliente', label: 'Cliente', sort: (r) => clienteNombre(r.clienteId), render: (r) => `${esc(clienteNombre(r.clienteId))}<div class="muted">${esc(getCliente(r.clienteId)?.nit || '')}</div>` },
        { k: 'proyecto', label: 'Proyecto', render: (r) => esc(r.proyecto) },
        { k: 'fecha', label: 'Fecha', render: (r) => fmtDate(r.fecha) },
        { k: 'valor', label: 'Importe', cls: 'num', render: (r) => fmtMoney(r.valor) },
        { k: 'estado', label: 'Estado', render: (r) => badge(r.estado) },
      ],
      onRow: (r) => { location.hash = r.href; },
      empty: 'No encontramos documentos con esos criterios.',
    });
  };
  let tmr;
  $('#q').addEventListener('input', (e) => { st.q = e.target.value.trim(); clearTimeout(tmr); tmr = setTimeout(run, 150); });
  ['field', 'tipo', 'desde', 'hasta'].forEach((k) => $('#' + k).addEventListener('change', (e) => { st[k] = e.target.value; run(); }));
  $('#grupos').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; st.grupo = b.dataset.g; $$('#grupos .chip').forEach((c) => c.classList.toggle('on', c === b)); run(); });
  run(); $('#q').focus();
}
/* búsqueda global (barra superior) */
function globalSearch(q) {
  const box = $('#gresults');
  if (!q.trim()) { box.classList.remove('open'); return; }
  const clis = DB.clientes.filter((c) => matchField({}, c, 'todo', q)).slice(0, 4);
  const docs = allDocsIndex().filter((r) => matchField(r, getCliente(r.clienteId), 'todo', q)).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 7);
  box.innerHTML = (clis.length ? `<div class="grp">Clientes</div>` + clis.map((c) => `<a href="#/clientes/${c.id}"><span>${esc(c.razonSocial)}</span><small>${esc(c.nit)}</small></a>`).join('') : '') +
    (docs.length ? `<div class="grp">Documentos</div>` + docs.map((r) => `<a href="${r.href}"><span><b>${r.numero}</b> · ${esc(clienteNombre(r.clienteId))}</span><small>${r.tipo} · ${badge(r.estado)}</small></a>`).join('') : '') +
    `<a href="#/busqueda?q=${encodeURIComponent(q)}"><span>${ico('search')} Búsqueda avanzada de “${esc(q)}”</span></a>`;
  box.classList.add('open');
}

/* ==========================================================
   MÓDULO 8 · GESTIÓN DOCUMENTAL
   ========================================================== */
const MIME_COLOR = (m, n = '') => /pdf/.test(m) ? ['PDF', '#dc2626'] : /image/.test(m) ? ['IMG', '#7c3aed'] : /sheet|excel|csv/.test(m + n) ? ['XLS', '#15803d'] : /word|doc/.test(m + n) ? ['DOC', '#2563eb'] : ['FILE', '#64748b'];
function generatedDocs() {
  return [
    ...DB.cotizaciones.map((c) => ({ virtual: 'cotizacion', id: c.id, nombre: `${c.numero}.pdf`, mime: 'application/pdf', categoria: 'Presupuesto', clienteId: c.clienteId, proyecto: c.proyecto, etiquetas: [cotEstado(c).toLowerCase()], versiones: [{ v: c.plantilla?.version || 1, fecha: c.actualizado || c.creado, usuario: c.creadoPor }], creado: c.creado, href: '#/cotizaciones/' + c.id })),
    ...DB.facturas.map((f) => ({ virtual: 'factura', id: f.id, nombre: `${f.numero}.pdf`, mime: 'application/pdf', categoria: 'Factura', clienteId: f.clienteId, proyecto: getCot(f.cotizacionId)?.proyecto || '', etiquetas: [facturaEstado(f).toLowerCase()], versiones: [{ v: 1, fecha: f.actualizado || f.creado, usuario: f.creadoPor }], creado: f.creado, href: '#/facturas/' + f.id })),
    ...DB.abonos.map((a) => ({ virtual: 'abono', id: a.id, nombre: `${a.numero}.pdf`, mime: 'application/pdf', categoria: 'Cobro', clienteId: a.clienteId, proyecto: getCot(a.cotizacionId)?.proyecto || '', etiquetas: [a.formaPago.toLowerCase()], versiones: [{ v: 1, fecha: a.creado, usuario: a.creadoPor }], creado: a.creado, href: '#/abonos/' + a.id })),
  ];
}
function docRowHTML(d) {
  const [lbl, col] = MIME_COLOR(d.mime, d.nombre), last = d.versiones[d.versiones.length - 1];
  return `<div class="doc-row" data-id="${d.id}" data-virtual="${d.virtual || ''}" style="display:flex;gap:12px;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border)">
    <span class="file-ico" style="background:${col}">${lbl}</span>
    <div style="flex:1;min-width:0"><b style="word-break:break-all">${esc(d.nombre)}</b> <span class="tag" style="background:var(--muted-bg);color:var(--text-2)">${esc(d.categoria)}</span>${d.versiones.length > 1 ? `<span class="tag">v${last.v}</span>` : ''}
      <div style="font-size:12px;color:var(--text-3)">${esc(clienteNombre(d.clienteId))}${d.proyecto ? ' / ' + esc(d.proyecto) : ''} · ${fmtDate(last.fecha)} · ${esc(last.usuario || '')}${last.size ? ' · ' + Math.round(last.size / 1024) + ' KB' : ''}</div>
      <div>${(d.etiquetas || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div></div>
    <div class="btn-row">${d.virtual ? `<a class="btn sm" href="${d.href}">${ico('eye')}Abrir</a>` : `<button class="btn sm" data-dact="ver">${ico('eye')}Ver</button><button class="btn sm ghost" data-dact="ver2" title="Nueva versión">${ico('upload')}</button>`}</div></div>`;
}
function bindDocRows(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dact]'); if (!b) return;
    const d = DB.documentos.find((x) => x.id === b.closest('.doc-row').dataset.id); if (!d) return;
    if (b.dataset.dact === 'ver') docViewer(d);
    if (b.dataset.dact === 'ver2') { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => addVersion(d, i.files[0]); i.click(); }
  });
}
async function addVersion(d, f) {
  if (!f) return; if (f.size > 2 * 1024 * 1024) return toast('Máximo 2 MB por archivo en esta versión local', 'bad');
  const v = d.versiones.length + 1;
  d.versiones.push({ v, fecha: new Date().toISOString(), usuario: Store.user().nombre, size: f.size, data: await readFileAsDataURL(f) });
  audit('Subir', 'Documento', d.nombre, `Nueva versión v${v}`);
  if (persist()) { toast(`Versión v${v} guardada`); route(); } else d.versiones.pop();
}
function docViewer(d) {
  const last = d.versiones[d.versiones.length - 1];
  modal({
    title: d.nombre, size: 'lg', hideOk: true, cancelText: 'Cerrar',
    body: `<div class="grid g-main"><div>${last.data ? (/image/.test(d.mime) ? `<img src="${last.data}" style="max-width:100%;border-radius:8px">` : /pdf/.test(d.mime) ? `<iframe src="${last.data}" style="width:100%;height:60vh;border:1px solid var(--border);border-radius:8px"></iframe>` : emptyState('Vista previa no disponible para este formato')) : emptyState('Documento de ejemplo sin archivo cargado. Sube una nueva versión para adjuntar el archivo real.')}</div>
      <div><div class="kv" style="grid-template-columns:1fr">${[['Cliente', clienteNombre(d.clienteId)], ['Proyecto', d.proyecto || 'General'], ['Categoría', d.categoria], ['Etiquetas', (d.etiquetas || []).join(', ') || '—']].map(([k, v]) => `<div><small>${k}</small><span>${esc(v)}</span></div>`).join('')}</div>
      <h4 class="mt" style="font-size:13px">Versiones</h4><ul class="timeline">${[...d.versiones].reverse().map((v) => `<li><span class="dot">${ico('clock')}</span><div><b>v${v.v}</b>${v.data ? ` · <a href="${v.data}" download="${esc(d.nombre)}">descargar</a>` : ''}<small>${esc(v.usuario)} · ${fmtDateTime(v.fecha)}${v.size ? ' · ' + Math.round(v.size / 1024) + ' KB' : ''}</small></div></li>`).join('')}</ul>
      <div class="f mt"><label>Editar etiquetas</label><input class="in" id="tagsIn" value="${esc((d.etiquetas || []).join(', '))}"></div><button class="btn sm mt" id="tagsSave">Guardar etiquetas</button>
      <button class="btn sm danger mt" id="docDel">${ico('trash')}Eliminar documento</button></div></div>`,
    onOpen: (ov) => {
      $('#tagsSave', ov).addEventListener('click', () => { const before = (d.etiquetas || []).join(', '); d.etiquetas = $('#tagsIn', ov).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean); audit('Editar', 'Documento', d.nombre, 'Etiquetas', [{ campo: 'etiquetas', antes: before, despues: d.etiquetas.join(', ') }]); persist(); toast('Etiquetas actualizadas'); });
      $('#docDel', ov).addEventListener('click', async () => { if (!(await confirmBox('Eliminar documento', `Se eliminará "${esc(d.nombre)}" con todas sus versiones. Esta acción queda registrada en auditoría.`, 'Eliminar'))) return; DB.documentos = DB.documentos.filter((x) => x !== d); audit('Eliminar', 'Documento', d.nombre, clienteNombre(d.clienteId)); persist(); ov.remove(); route(); });
    },
  });
}
function setupDrop(el, onFiles) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.hidden = true; el.appendChild(inp);
  el.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => onFiles([...inp.files]));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); onFiles([...e.dataTransfer.files]); });
}
function uploadDialog(files, preset = {}, done) {
  files = files.filter((f) => { if (f.size > 2 * 1024 * 1024) { toast(`${f.name}: supera 2 MB`, 'bad'); return false; } return true; });
  if (!files.length) return;
  const projOf = (cid) => [...new Set(DB.cotizaciones.filter((c) => c.clienteId === cid).map((c) => c.proyecto))];
  modal({
    title: `Subir ${files.length} archivo(s)`, okText: 'Subir',
    body: `<p class="hint" style="margin-top:0">${files.map((f) => esc(f.name)).join(', ')}</p><div class="form-grid">
      <div class="f s12"><label>Cliente <span class="req">*</span></label><select class="in" name="cli">${DB.clientes.map((c) => `<option value="${c.id}" ${c.id === preset.clienteId ? 'selected' : ''}>${esc(c.razonSocial)}</option>`).join('')}</select></div>
      <div class="f s6"><label>Proyecto (carpeta)</label><input class="in" name="proy" list="proyList" value="${esc(preset.proyecto || '')}" placeholder="General"><datalist id="proyList"></datalist></div>
      <div class="f s6"><label>Categoría</label><select class="in" name="cat">${['Contrato', 'Documento legal', 'Imagen', 'Justificante de pago', 'Pedido', 'Otro'].map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="f s12"><label>Etiquetas (separadas por coma)</label><input class="in" name="tags" placeholder="firmado, 2026, urgente"></div></div>`,
    onOpen: (ov) => {
      const sel = $('[name=cli]', ov), dl = $('#proyList', ov);
      const upd = () => { dl.innerHTML = projOf(sel.value).map((p) => `<option>${esc(p)}</option>`).join(''); };
      sel.addEventListener('change', upd); upd();
      if (files.every((f) => /image/.test(f.type))) $('[name=cat]', ov).value = 'Imagen';
    },
    onOk: async (ov) => {
      const cli = $('[name=cli]', ov).value, proy = $('[name=proy]', ov).value.trim(), cat = $('[name=cat]', ov).value;
      const tags = $('[name=tags]', ov).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      const added = [];
      for (const f of files) {
        const d = { id: uid('doc'), nombre: f.name, mime: f.type || 'application/octet-stream', categoria: cat, clienteId: cli, proyecto: proy, etiquetas: tags, versiones: [{ v: 1, fecha: new Date().toISOString(), usuario: Store.user().nombre, size: f.size, data: await readFileAsDataURL(f) }], creado: new Date().toISOString() };
        DB.documentos.push(d); added.push(d); audit('Subir', 'Documento', d.nombre, `${clienteNombre(cli)}${proy ? ' / ' + proy : ''}`);
      }
      if (!persist()) { DB.documentos = DB.documentos.filter((d) => !added.includes(d)); return false; }
      toast(`${added.length} archivo(s) subido(s)`); done?.();
    },
  });
}
function Documentos(query = {}) {
  const st = { cli: query.cli || '', proy: query.proy ?? null, cat: '', q: '' };
  const all = () => [...DB.documentos, ...generatedDocs()];
  const puede = puedeGestionar('documentos');
  view.innerHTML = pageHead('Gestión documental', 'Carpetas automáticas por cliente y proyecto · control de versiones, etiquetas y auditoría', puede ? `<button class="btn primary" id="upBtn">${ico('upload')}Subir archivos</button>` : '') +
    `<div class="folders"><div class="card"><div class="card-head"><h3>Carpetas</h3></div><ul class="tree" id="tree"></ul></div>
     <div class="card"><div class="tbl-tools"><div class="search">${ico('search')}<input type="search" id="dq" placeholder="Nombre, etiqueta, proyecto…"></div><div class="chips" id="cats">${['', 'Presupuesto', 'Factura', 'Cobro', 'Contrato', 'Imagen', 'Documento legal', 'Justificante de pago'].map((c) => `<button class="chip ${c === '' ? 'on' : ''}" data-c="${c}">${c || 'Todos'}</button>`).join('')}</div></div>
     <div class="card-pad" style="padding-top:8px">${puede ? `<div class="drop" id="drop" style="padding:14px;margin-bottom:6px">${ico('upload')} <b>Arrastra archivos aquí</b> para guardarlos en la carpeta seleccionada</div>` : ''}<div id="list"></div></div></div></div>`;
  const renderTree = () => {
    const docs = all();
    $('#tree').innerHTML = `<li><a href="#" data-cli="" class="${!st.cli ? 'on' : ''}">${ico('folder')}Todos los documentos<span class="count">${docs.length}</span></a></li>` +
      DB.clientes.map((c) => {
        const cd = docs.filter((d) => d.clienteId === c.id);
        const projs = [...new Set(cd.map((d) => d.proyecto || ''))].sort();
        const open = st.cli === c.id;
        return `<li><a href="#" data-cli="${c.id}" data-proy="" class="${open && st.proy === null ? 'on' : ''}">${ico('folder')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nombreComercial || c.razonSocial)}</span><span class="count">${cd.length}</span></a>
          ${open ? `<ul>${projs.map((p) => `<li><a href="#" data-cli="${c.id}" data-proy="${esc(p)}" class="${st.proy === p ? 'on' : ''}">${ico('folder')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p || 'General')}</span><span class="count">${cd.filter((d) => (d.proyecto || '') === p).length}</span></a></li>`).join('')}</ul>` : ''}</li>`;
      }).join('');
  };
  const renderList = () => {
    const q = norm(st.q);
    const docs = all().filter((d) => (!st.cli || d.clienteId === st.cli) && (st.proy === null || (d.proyecto || '') === st.proy) && (!st.cat || d.categoria === st.cat) && (!q || norm([d.nombre, d.proyecto, d.categoria, (d.etiquetas || []).join(' '), clienteNombre(d.clienteId)].join(' ')).includes(q)))
      .sort((a, b) => (b.versiones.at(-1).fecha || '').localeCompare(a.versiones.at(-1).fecha || ''));
    $('#list').innerHTML = `<div class="hint" style="margin:6px 0">${st.cli ? `${esc(clienteNombre(st.cli))}${st.proy !== null ? ' / ' + esc(st.proy || 'General') : ''} · ` : ''}${docs.length} documento(s)</div>` + (docs.slice(0, 80).map(docRowHTML).join('') || emptyState('Carpeta vacía'));
  };
  $('#tree').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); st.cli = a.dataset.cli; st.proy = a.dataset.proy === undefined || a.dataset.proy === '' && !a.closest('ul ul') ? null : a.dataset.proy; renderTree(); renderList(); });
  $('#cats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; st.cat = b.dataset.c; $$('#cats .chip').forEach((c) => c.classList.toggle('on', c === b)); renderList(); });
  $('#dq').addEventListener('input', (e) => { st.q = e.target.value; renderList(); });
  if (puede) {
    const up = (files) => uploadDialog(files, { clienteId: st.cli || DB.clientes[0]?.id, proyecto: st.proy || '' }, () => { renderTree(); renderList(); });
    setupDrop($('#drop'), up);
    $('#upBtn').addEventListener('click', () => $('#drop input').click());
  }
  bindDocRows($('#list'));
  renderTree(); renderList();
}

/* ==========================================================
   MÓDULO 9 · AUDITORÍA Y TRAZABILIDAD
   ========================================================== */
function Auditoria() {
  const ents = [...new Set(DB.auditoria.map((a) => a.entidad))];
  let userF = '';
  view.innerHTML = pageHead('Auditoría y trazabilidad', 'Registro de quién hizo qué y cuándo, con historial de cambios campo a campo') + `<div class="card" id="tbl"></div>`;
  const dt = DataTable($('#tbl'), {
    rows: () => DB.auditoria.filter((a) => !userF || a.usuario === userF), placeholder: 'Usuario, documento, acción…', pageSize: 20,
    searchText: (a) => [a.usuario, a.accion, a.entidad, a.ref, a.detalle].join(' '),
    chips: [{ k: 'all', label: 'Todo' }, ...ents.map((e) => ({ k: e, label: e, test: (a) => a.entidad === e }))],
    sort: 'fecha', csv: 'auditoria',
    tools: `<select id="audUser" aria-label="Filtrar por usuario"><option value="">Todos los usuarios</option>${[...new Set(DB.auditoria.map((a) => a.usuario))].map((u) => `<option>${esc(u)}</option>`).join('')}</select>`,
    columns: [
      { k: 'fecha', label: 'Fecha y hora', render: (a) => fmtDateTime(a.fecha) },
      { k: 'usuario', label: 'Usuario', render: (a) => `${esc(a.usuario)}${a.rol ? `<div class="muted">${esc(a.rol)}</div>` : ''}` },
      { k: 'accion', label: 'Acción', render: (a) => `<span class="tag">${esc(a.accion)}</span>` },
      { k: 'entidad', label: 'Entidad' },
      { k: 'ref', label: 'Referencia', render: (a) => `<b>${esc(a.ref)}</b>` },
      { k: 'detalle', label: 'Detalle / cambios', nosort: 1, csv: (a) => a.detalle + (a.cambios?.length ? ' | ' + a.cambios.map((c) => `${c.campo}: ${c.antes} → ${c.despues}`).join('; ') : ''), render: (a) => `${esc(a.detalle)}${a.cambios?.length ? `<div class="diff">${a.cambios.map((c) => `<div><b>${esc(c.campo)}:</b> <del>${esc(String(c.antes).slice(0, 50))}</del> → <ins>${esc(String(c.despues).slice(0, 50))}</ins></div>`).join('')}</div>` : ''}` },
    ],
  });
  $('#audUser').addEventListener('change', (e) => { userF = e.target.value; dt.render(); });
}

/* ==========================================================
   MÓDULO 10 · USUARIOS Y PERMISOS
   ========================================================== */
function Usuarios(query = {}) {
  const tab = query.tab === 'roles' ? 'roles' : 'usuarios';
  view.innerHTML = pageHead('Usuarios y permisos', 'Gestiona quién puede entrar al sistema y qué puede hacer en cada módulo') +
    `<div class="card"><div class="tabs">${[['usuarios', `Usuarios (${DB.usuarios.length})`], ['roles', `Roles y permisos (${DB.roles.length})`]].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="go('/usuarios?tab=${k}')">${l}</button>`).join('')}</div><div id="tabBody"></div></div>`;
  const body = $('#tabBody');
  if (tab === 'roles') renderRolesTab(body); else renderUsuariosTab(body);
}
function renderUsuariosTab(body) {
  const puede = puedeGestionar('usuarios');
  body.innerHTML = `<div class="card-pad" style="padding-bottom:0"><div class="btn-row" style="justify-content:flex-end">${puede ? `<a class="btn primary" href="#/usuarios/nuevo">${ico('plus')}Nuevo usuario</a>` : ''}</div></div><div id="uTbl"></div>`;
  DataTable($('#uTbl'), {
    rows: () => DB.usuarios,
    placeholder: 'Nombre, correo, rol…',
    searchText: (u) => [u.codigo, u.nombre, u.email, rolDe(u)?.nombre].join(' '),
    chips: [{ k: 'all', label: 'Todos' }, { k: 'activos', label: 'Activos', test: (u) => u.activo !== false }, { k: 'inactivos', label: 'Inactivos', test: (u) => u.activo === false }],
    sort: 'nombre', dir: 1,
    columns: [
      { k: 'codigo', label: 'Código', render: (u) => `<span class="muted">${esc(u.codigo || '—')}</span>` },
      { k: 'nombre', label: 'Nombre', sort: (u) => u.nombre, render: (u) => `<div class="strong">${esc(u.nombre)}${u.id === DB.usuarioActual ? ' <span class="badge b-info">Sesión actual</span>' : ''}</div><div class="muted">${esc(u.email || '')}</div>` },
      { k: 'rol', label: 'Rol', sort: (u) => rolDe(u)?.nombre || '', render: (u) => `<span class="tag">${esc(rolDe(u)?.nombre || '—')}</span>` },
      { k: 'estado', label: 'Estado', render: (u) => badge(u.activo === false ? 'Inactiva' : 'Activa') },
    ],
    onRow: puede ? (u) => go('/usuarios/' + u.id + '/editar') : null,
    empty: 'Sin usuarios registrados.',
  });
}
function renderRolesTab(body) {
  const puede = puedeGestionar('usuarios');
  body.innerHTML = `<div class="card-pad" style="padding-bottom:0"><div class="btn-row" style="justify-content:flex-end">${puede ? `<a class="btn primary" href="#/usuarios/rol/nuevo">${ico('plus')}Nuevo rol</a>` : ''}</div></div>
    <div class="grid g-3" style="padding:0 20px 20px">${DB.roles.map((r) => {
      const nUsers = DB.usuarios.filter((u) => u.rolId === r.id).length;
      const resumen = MODULOS.filter((m) => r.permisos[m.k] === 'gestionar').length;
      return `<a class="card" style="padding:16px;color:inherit" href="#/usuarios/rol/${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>${esc(r.nombre)}</b>${r.sistema ? '<span class="tag">Sistema</span>' : ''}</div>
        <p style="margin:6px 0;color:var(--text-2);font-size:13px">${esc(r.descripcion || '')}</p>
        <small class="muted">${nUsers} usuario(s) · gestiona ${resumen} de ${MODULOS.length} módulos</small></a>`;
    }).join('')}</div>`;
}
function UsuarioForm(id) {
  if (denyGestionar('usuarios', '/usuarios')) return;
  const u = id ? DB.usuarios.find((x) => x.id === id) : { codigo: '(se asigna al guardar)', activo: true, rolId: DB.roles[0]?.id };
  if (id && !u) return notFound();
  view.innerHTML = pageHead(id ? 'Editar usuario' : 'Nuevo usuario', id ? esc(u.nombre) : 'Crea un acceso y asígnale un rol con permisos', '', `<a href="#/usuarios">Usuarios y permisos</a> / ${id ? esc(u.nombre) : 'Nuevo'}`) +
    `<form class="card card-pad" id="frm" novalidate><div class="form-grid">
      <div class="section-title">Identificación</div>
      <div class="f s3"><label>Código</label><input class="in" value="${esc(u.codigo || '(se asigna al guardar)')}" readonly></div>
      <div class="f s5"><label>Nombre completo <span class="req">*</span></label><input class="in" name="nombre" value="${esc(u.nombre || '')}"></div>
      <div class="f s4"><label>Correo electrónico</label><input class="in" name="email" type="email" value="${esc(u.email || '')}"></div>
      <div class="section-title">Acceso</div>
      <div class="f s6"><label>Rol <span class="req">*</span></label><select class="in" name="rolId">${DB.roles.map((r) => `<option value="${r.id}" ${r.id === u.rolId ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select><span class="hint" id="rolHint">${esc(getRol(u.rolId)?.descripcion || '')}</span></div>
      <div class="f s3"><label>Estado</label><select class="in" name="activo"><option value="true" ${u.activo !== false ? 'selected' : ''}>Activo</option><option value="false" ${u.activo === false ? 'selected' : ''}>Inactivo</option></select></div>
      <div class="section-title">Seguridad</div>
      ${id ? `<div class="f s6"><label>Contraseña</label><div style="display:flex;align-items:center;gap:10px;height:38px"><span class="badge ${u.passHash ? 'b-ok' : 'b-muted'}">${u.passHash ? 'Configurada' : 'Sin contraseña'}</span><button type="button" class="btn sm" id="chPass">${ico('shield')}${u.passHash ? 'Cambiar' : 'Establecer'} contraseña</button></div></div>`
        : `<div class="f s12"><span class="hint">Podrás establecer una contraseña para este usuario después de guardarlo.</span></div>`}
    </div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:18px"><a class="btn" href="#/usuarios">Cancelar</a><button class="btn primary">${ico('check')}Guardar usuario</button></div></form>`;
  const form = $('#frm');
  form.rolId.addEventListener('change', () => { $('#rolHint').textContent = getRol(form.rolId.value)?.descripcion || ''; });
  $('#chPass')?.addEventListener('click', () => changePasswordDialog(u));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim();
    form.nombre.classList.toggle('invalid', !nombre);
    if (!nombre) return toast('El nombre es obligatorio.', 'bad');
    const v = { nombre, email: form.email.value.trim(), rolId: form.rolId.value, activo: form.activo.value === 'true' };
    if (id) {
      const willManage = v.activo && getRol(v.rolId)?.permisos?.usuarios === 'gestionar';
      if (u.id === DB.usuarioActual && !willManage && !DB.usuarios.some((x) => x.id !== u.id && x.activo !== false && permisoModulo('usuarios', x) === 'gestionar')) {
        return toast('No puedes quitarte el acceso de gestión de usuarios: eres el único con este permiso.', 'bad');
      }
      const before = clone(u); Object.assign(u, v, { actualizado: new Date().toISOString() });
      audit('Editar', 'Usuario', u.codigo || u.nombre, u.nombre, diffObjects(before, u));
    } else {
      const n = { id: uid('usr'), codigo: Store.nextNumber('USR'), ...v, passHash: '', creado: new Date().toISOString(), creadoPor: Store.user().nombre };
      DB.usuarios.push(n); audit('Crear', 'Usuario', n.codigo, n.nombre);
    }
    persist(); toast('Usuario guardado'); go('/usuarios');
  });
}
/* Diálogo para establecer, cambiar o quitar la contraseña de un usuario (solo quien gestiona el módulo Usuarios) */
function changePasswordDialog(u) {
  modal({
    title: 'Contraseña · ' + u.nombre, okText: 'Guardar',
    body: `<div class="form-grid">
      <div class="f s12"><label>Nueva contraseña</label><input class="in" type="password" id="np" autocomplete="new-password" placeholder="Déjalo en blanco para quitar la contraseña"></div>
      <div class="f s12"><label>Confirmar contraseña</label><input class="in" type="password" id="np2" autocomplete="new-password"></div>
      <div class="f s12"><span class="hint">Mínimo 4 caracteres. Se guarda solo como huella (hash) en este navegador; no es una autenticación de servidor, sirve para evitar cambios de sesión accidentales entre compañeros.</span></div>
    </div>`,
    onOk: async (ov) => {
      const p1 = $('#np', ov).value, p2 = $('#np2', ov).value;
      if (p1 !== p2) { toast('Las contraseñas no coinciden.', 'bad'); return false; }
      if (p1 && p1.length < 4) { toast('La contraseña debe tener al menos 4 caracteres.', 'bad'); return false; }
      await setPassword(u, p1);
      audit('Editar', 'Usuario', u.codigo || u.nombre, p1 ? 'Contraseña actualizada' : 'Contraseña eliminada');
      persist(); toast(p1 ? 'Contraseña actualizada' : 'Contraseña eliminada'); route();
    },
  });
}
/* Pide la contraseña de un usuario antes de activar su sesión; resuelve true/false */
function askPassword(u) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title: `Contraseña de ${u.nombre}`, okText: 'Entrar',
      body: `<div class="f s12"><label>Contraseña</label><input class="in" type="password" id="pwIn" autocomplete="current-password"></div><p class="hint" id="pwErr" style="color:var(--bad);margin-top:8px"></p>`,
      onOk: async (ov) => {
        const valido = await checkPassword(u, $('#pwIn', ov).value);
        if (!valido) { $('#pwErr', ov).textContent = 'Contraseña incorrecta.'; return false; }
        ok = true;
      },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); resolve(ok); } });
    obs.observe(document.body, { childList: true });
  });
}
function RolForm(id) {
  if (denyGestionar('usuarios', '/usuarios?tab=roles')) return;
  const r = id ? getRol(id) : { nombre: '', descripcion: '', sistema: false, permisos: {} };
  if (id && !r) return notFound();
  const perms = { ...Object.fromEntries(MODULOS.map((m) => [m.k, 'ninguno'])), ...(r.permisos || {}) };
  const locked = !!r.sistema;
  view.innerHTML = pageHead(id ? `Editar rol: ${esc(r.nombre)}` : 'Nuevo rol', locked ? 'Este rol es del sistema y no se puede modificar: así siempre queda al menos un rol con acceso total.' : 'Define qué puede ver y gestionar este rol en cada módulo', '', `<a href="#/usuarios?tab=roles">Usuarios y permisos</a> / ${id ? esc(r.nombre) : 'Nuevo'}`) +
    `<form class="card card-pad" id="frm" novalidate><div class="form-grid">
      <div class="f s6"><label>Nombre del rol <span class="req">*</span></label><input class="in" name="nombre" value="${esc(r.nombre)}" ${locked ? 'readonly' : ''}></div>
      <div class="f s12"><label>Descripción</label><input class="in" name="descripcion" value="${esc(r.descripcion || '')}" ${locked ? 'readonly' : ''}></div>
    </div>
    <div class="section-title" style="margin-top:18px">Permisos por módulo</div>
    <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Módulo</th>${PERM_LEVELS.map((p) => `<th style="text-align:center">${p.label}</th>`).join('')}</tr></thead><tbody>
      ${MODULOS.map((m) => `<tr><td>${esc(m.label)}</td>${PERM_LEVELS.map((p) => `<td style="text-align:center"><input type="radio" name="p_${m.k}" value="${p.k}" ${perms[m.k] === p.k ? 'checked' : ''} ${locked ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:18px">
      <a class="btn" href="#/usuarios?tab=roles">Cancelar</a>
      ${!locked && id ? `<button type="button" class="btn danger" id="delRol">${ico('trash')}Eliminar rol</button>` : ''}
      ${!locked ? `<button class="btn primary">${ico('check')}Guardar rol</button>` : ''}
    </div></form>`;
  if (locked) return;
  const form = $('#frm');
  $('#delRol')?.addEventListener('click', async () => {
    const enUso = DB.usuarios.filter((u) => u.rolId === r.id).length;
    if (enUso) return toast(`No puedes eliminar este rol: ${enUso} usuario(s) lo tienen asignado.`, 'bad');
    if (!(await confirmBox('Eliminar rol', `Se eliminará el rol "${esc(r.nombre)}".`, 'Eliminar'))) return;
    DB.roles = DB.roles.filter((x) => x.id !== r.id); audit('Eliminar', 'Rol', r.nombre, ''); persist(); toast('Rol eliminado'); go('/usuarios?tab=roles');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim();
    form.nombre.classList.toggle('invalid', !nombre);
    if (!nombre) return toast('El nombre del rol es obligatorio.', 'bad');
    const permisos = {}; MODULOS.forEach((m) => { permisos[m.k] = form[`p_${m.k}`].value; });
    if (id && !tendriaAccesoAdmin(id, permisos)) return toast('Esta configuración dejaría a nadie con permiso para gestionar usuarios y roles. Ajusta los permisos antes de guardar.', 'bad');
    if (id) {
      const before = clone(r); Object.assign(r, { nombre, descripcion: form.descripcion.value.trim(), permisos }, { actualizado: new Date().toISOString() });
      audit('Editar', 'Rol', r.nombre, '', diffObjects(before, r));
    } else {
      const n = { id: uid('rol'), nombre, descripcion: form.descripcion.value.trim(), sistema: false, permisos };
      DB.roles.push(n); audit('Crear', 'Rol', n.nombre, '');
    }
    persist(); toast('Rol guardado'); go('/usuarios?tab=roles');
  });
}

/* ---------------- Configuración ---------------- */
function Config() {
  const E = DB.empresa;
  const puede = puedeGestionar('config');
  const F = [['sec', 'Datos del emisor'], ['razonSocial', 'Razón social', 's6'], ['nit', 'NIF / CIF', 's3'], ['telefono', 'Teléfono', 's3'], ['direccion', 'Dirección', 's6'], ['codigoPostal', 'Código postal', 's2'], ['ciudad', 'Localidad', 's2'], ['provincia', 'Provincia', 's2'], ['pais', 'País', 's3'], ['email', 'Correo', 's3'],
    ['sec', 'Moneda e impuestos'], ['moneda', 'Moneda', 's3', { options: Object.keys(MONEDAS) }], ['ivaDefault', 'IVA por defecto (%)', 's3', { type: 'number' }], ['sec', 'Datos bancarios por defecto'], ['banco', 'Banco', 's3'], ['titular', 'Titular', 's3'], ['cuenta', 'Cuenta (IBAN)', 's6']];
  view.innerHTML = pageHead('Configuración', 'Datos de la empresa emisora, respaldo y restauración' + (puede ? '' : ' · solo lectura para tu rol')) +
    `<form class="card card-pad" id="frm"><fieldset ${puede ? '' : 'disabled'} style="border:0;padding:0;margin:0"><div class="form-grid">${F.map((f) => fieldHTML(f, E[f[0]])).join('')}</div>${puede ? `<div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary">Guardar</button></div>` : ''}</fieldset></form>
    ${puede ? `<div class="card card-pad mt"><h3 style="font-size:15px;margin-bottom:6px">Respaldo de datos</h3><p class="hint" style="margin-top:0">Esta versión guarda la información en el navegador. Descarga un respaldo periódicamente o conéctala a Supabase para trabajo multiusuario (ver <code>supabase_facturacion.sql</code>).</p>
    <div class="btn-row"><button class="btn" id="exp">${ico('download')}Exportar respaldo (.json)</button><label class="btn">${ico('upload')}Importar respaldo<input type="file" accept=".json" id="imp" hidden></label><button class="btn danger" id="rst">${ico('trash')}Restaurar datos de ejemplo</button></div></div>` : ''}`;
  if (!puede) return;
  $('#frm').addEventListener('submit', (e) => { e.preventDefault(); const before = clone(E); Object.assign(E, formValues(e.target)); audit('Editar', 'Configuración', 'Empresa', 'Datos del emisor', diffObjects(before, E)); persist(); toast('Configuración guardada'); });
  $('#exp').addEventListener('click', () => { downloadFile(`zewa-facturacion-respaldo-${todayISO()}.json`, JSON.stringify(DB, null, 2), 'application/json'); audit('Descargar', 'Configuración', 'Respaldo', 'Exportación completa'); persist(); });
  $('#imp').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await readFileAsText(f)); if (!data.version || !Array.isArray(data.clientes)) throw 0; if (!(await confirmBox('Importar respaldo', 'Se reemplazarán todos los datos actuales por los del archivo.', 'Importar'))) return; DB = data; audit('Restaurar', 'Configuración', 'Respaldo', f.name); persist(); toast('Respaldo importado'); route(); }
    catch (err) { toast('Archivo de respaldo no válido', 'bad'); }
  });
  $('#rst').addEventListener('click', async () => { if (await confirmBox('Restaurar datos de ejemplo', 'Se borrarán todos los datos actuales de este navegador. Exporta un respaldo antes si lo necesitas.', 'Restaurar')) { Store.reset(); toast('Datos de ejemplo restaurados'); route(); } });
}
function notFound() { view.innerHTML = pageHead('No encontrado', 'El registro no existe o fue eliminado.', `<a class="btn" href="#/dashboard">Ir al panel</a>`); }
/* true + redirige si el usuario actual no puede gestionar (crear/editar/eliminar) el módulo */
function denyGestionar(modulo, redirect) {
  if (puedeGestionar(modulo)) return false;
  toast('Tu rol no tiene permiso para gestionar este módulo.', 'bad');
  go(redirect);
  return true;
}

/* ---------------- Arranque ---------------- */
function initShell() {
  const sel = $('#userSel');
  const syncSel = () => { sel.innerHTML = DB.usuarios.filter((u) => u.activo !== false).map((u) => `<option value="${u.id}">${esc(u.nombre)} · ${esc(rolDe(u)?.nombre || '')}</option>`).join(''); };
  syncSel();
  const syncUser = () => { syncSel(); sel.value = DB.usuarioActual; $('#avatar').textContent = Store.user().nombre.split(' ').map((x) => x[0]).slice(0, 2).join(''); };
  sel.addEventListener('change', async () => {
    const target = DB.usuarios.find((u) => u.id === sel.value);
    if (target?.passHash && !(await askPassword(target))) { sel.value = DB.usuarioActual; return; }
    DB.usuarioActual = sel.value; persist(); setLoggedIn(sel.value); syncUser(); toast('Sesión: ' + Store.user().nombre); route();
  });
  syncUser();
  $('#logoutBtn').addEventListener('click', () => { clearLoggedIn(); location.hash = ''; showLogin(); });
  const setThemeIcon = () => { const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); $('#themeBtn').innerHTML = ico(dark ? 'sun' : 'moon'); return dark; };
  $('#themeBtn').addEventListener('click', () => {
    const dark = setThemeIcon(); const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; try { localStorage.setItem('tsf_theme', next); } catch (e) {}
    setThemeIcon();
  });
  setThemeIcon();
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  const gs = $('#gsearch'); let t;
  gs.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => globalSearch(gs.value), 120); });
  gs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && gs.value.trim()) { go('/busqueda?q=' + encodeURIComponent(gs.value.trim())); gs.value = ''; $('#gresults').classList.remove('open'); gs.blur(); }
    if (e.key === 'Escape') { gs.value = ''; $('#gresults').classList.remove('open'); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.gsearch')) $('#gresults').classList.remove('open'); else if (e.target.closest('#gresults a')) { $('#gresults').classList.remove('open'); gs.value = ''; } });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gs.focus(); } });
  document.addEventListener('click', (e) => { if (window.innerWidth <= 900 && !e.target.closest('.sidebar,#menuBtn')) $('#sidebar').classList.remove('open'); });
}

/* ---------------- Sesión (pantalla de inicio) ----------------
   La sesión vive en sessionStorage: se mantiene mientras la pestaña esté abierta,
   pero pide usuario y contraseña de nuevo si se cierra el navegador o se usa "Cerrar sesión". */
const SESSION_KEY = 'tsf_session';
const isLoggedIn = () => { try { return sessionStorage.getItem(SESSION_KEY) === DB.usuarioActual; } catch (e) { return false; } };
const setLoggedIn = (uid) => { try { sessionStorage.setItem(SESSION_KEY, uid); } catch (e) {} };
const clearLoggedIn = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} };
let shellReady = false;
function enterApp() {
  $('#loginScreen').hidden = true;
  $('#appShell').hidden = false;
  if (!shellReady) { initShell(); shellReady = true; }
  route();
}
function showLogin() {
  $('#appShell').hidden = true;
  const ls = $('#loginScreen'); ls.hidden = false;
  const activos = DB.usuarios.filter((u) => u.activo !== false);
  ls.innerHTML = `<div class="login-card">
    <div class="login-brand"><div class="brand-mark">Z</div><div><b>ZEWÁ</b><small>Presupuestos y Facturación</small></div></div>
    <h1>Iniciar sesión</h1>
    <form id="loginForm" novalidate>
      <div class="f s12"><label>Usuario</label><select class="in" id="loginUser">${activos.map((u) => `<option value="${u.id}">${esc(u.nombre)} · ${esc(rolDe(u)?.nombre || '')}</option>`).join('')}</select></div>
      <div class="f s12" id="loginPassWrap"><label>Contraseña</label><input class="in" type="password" id="loginPass" autocomplete="current-password">
        <div style="text-align:right;margin-top:6px"><a href="#" id="forgotLink" style="font-size:12.5px">¿Olvidaste tu contraseña?</a></div></div>
      <p class="hint" id="loginErr" style="color:var(--bad);min-height:16px"></p>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit">${ico('arrow')}Entrar</button>
    </form>
  </div>`;
  if (!activos.length) { ls.innerHTML = `<div class="login-card"><div class="login-brand"><div class="brand-mark">Z</div><div><b>ZEWÁ</b><small>Presupuestos y Facturación</small></div></div><p class="hint">No hay usuarios activos. Restaura un respaldo o los datos de ejemplo para continuar.</p></div>`; return; }
  const userSel = $('#loginUser', ls), passWrap = $('#loginPassWrap', ls), passIn = $('#loginPass', ls), err = $('#loginErr', ls);
  const syncPassField = () => { const u = activos.find((x) => x.id === userSel.value); passWrap.style.display = u?.passHash ? '' : 'none'; };
  userSel.value = activos.some((u) => u.id === DB.usuarioActual) ? DB.usuarioActual : activos[0].id;
  syncPassField();
  userSel.addEventListener('change', () => { err.textContent = ''; syncPassField(); });
  $('#forgotLink', ls).addEventListener('click', async (e) => {
    e.preventDefault();
    const u = activos.find((x) => x.id === userSel.value); if (!u) return;
    if (!(await confirmBox('Quitar contraseña', `Esta aplicación guarda los datos solo en este navegador, sin servidor, así que no existe un correo de recuperación. Se quitará la contraseña de <b>${esc(u.nombre)}</b> (ningún otro dato se borra), y cualquiera con acceso a este navegador podrá entrar como ${esc(u.nombre)} sin contraseña hasta que configures una nueva desde "Usuarios y permisos". ¿Continuar?`, 'Quitar contraseña'))) return;
    u.passHash = ''; persist();
    audit('Editar', 'Usuario', u.codigo || u.nombre, 'Contraseña eliminada desde "Olvidé mi contraseña"');
    err.textContent = ''; passIn.value = ''; syncPassField();
    toast('Contraseña eliminada. Ya puedes entrar.');
  });
  $('#loginForm', ls).addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = activos.find((x) => x.id === userSel.value); if (!u) return;
    if (!(await checkPassword(u, passIn.value))) { err.textContent = 'Contraseña incorrecta.'; passIn.value = ''; passIn.focus(); return; }
    DB.usuarioActual = u.id; persist(); setLoggedIn(u.id);
    enterApp();
  });
  (passWrap.style.display === 'none' ? userSel : passIn).focus();
}
if (isLoggedIn()) enterApp(); else showLogin();
