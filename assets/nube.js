/* ==========================================================
   ZEWÁ · Conexión con Supabase
   - Inicio de sesión real (Supabase Auth).
   - Carga inicial: lee las tablas fac_* y arma el modelo en memoria (DB).
   - Guardado: cada persist() compara el modelo con la última versión
     sincronizada y escribe solo lo que cambió, tabla por tabla, en orden
     de dependencias. Las líneas de presupuesto/factura van a fac_lineas;
     las versiones de plantilla y documento son de solo inserción; los
     archivos van al bucket privado fac-documentos.
   ========================================================== */
const NUBE_CFG = {
  url: 'https://ekjcdmxtzcpkbexilzrf.supabase.co',
  key: 'sb_publishable_QlGOGt8RrZJBotoyyMj2yQ_4ci9HStN', // clave publicable: segura en el navegador (los datos los protege RLS)
  funcion: 'zewa-usuarios',
  bucket: 'fac-documentos',
};

const Nube = (() => {
  const sb = window.supabase.createClient(NUBE_CFG.url, NUBE_CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  /* ---------- conversión app ↔ columnas ---------- */
  // tipos: t texto · r referencia (null si vacío) · n número · d fecha · ts fecha-hora · b booleano · j json · a lista de texto
  const C = (k, col, tipo = 't') => ({ k, col: col || k, tipo });
  const AUD = [C('creado', 'creado', 'ts'), C('creadoPor', 'creado_por'), C('actualizado', 'actualizado', 'ts')];
  const SPECS = {
    roles: { table: 'fac_roles', cols: [C('nombre'), C('descripcion'), C('sistema', 'sistema', 'b'), C('permisos', 'permisos', 'j'), C('actualizado', 'actualizado', 'ts')] },
    usuarios: { table: 'fac_usuarios', noInsert: true, ret: 'codigo', cols: [C('codigo'), C('nombre'), C('email'), C('rolId', 'rol_id', 'r'), C('activo', 'activo', 'b'), ...AUD], skip: ['passHash', 'authUserId'] },
    clientes: { table: 'fac_clientes', ret: 'codigo', cols: [C('codigo'), C('tipo'), C('razonSocial', 'razon_social'), C('nombreComercial', 'nombre_comercial'), C('nit', 'nif'), C('telefono'), C('celular', 'movil'), C('email'), C('direccion'), C('codigoPostal', 'codigo_postal'), C('ciudad', 'localidad'), C('departamento', 'provincia'), C('pais'), C('contacto'), C('cargo'), C('observaciones'), ...AUD] },
    inventario: { table: 'fac_inventario', ret: 'codigo', cols: [C('codigo'), C('tipo'), C('categoria'), C('unidad'), C('nombre'), C('descripcion'), C('costo', 'costo', 'n'), C('precioVenta', 'precio_venta', 'n'), C('iva', 'iva', 'n'), C('estado'), ...AUD] },
    plantillas: { table: 'fac_plantillas', versiones: 'plantilla', cols: [C('tipo'), C('nombre'), C('estado'), C('creado', 'creado', 'ts'), C('creadoPor', 'creado_por')], skip: ['versiones'] },
    cotizaciones: { table: 'fac_cotizaciones', ret: 'numero', lineas: 'cotizacion', plantilla: true, cols: [C('numero'), C('fecha', 'fecha', 'd'), C('vence', 'vence', 'd'), C('proyecto'), C('descripcion'), C('clienteId', 'cliente_id', 'r'), C('validez'), C('formaPago', 'forma_pago'), C('tiempoEjecucion', 'tiempo_ejecucion'), C('observaciones'), C('responsable'), C('estado'), C('facturaId', 'factura_id', 'r'), C('firmas', 'firmas', 'j'), ...AUD], skip: ['items'] },
    facturas: { table: 'fac_facturas', ret: 'numero', lineas: 'factura', plantilla: true, cols: [C('numero'), C('fecha', 'fecha', 'd'), C('fechaOperacion', 'fecha_operacion', 'd'), C('vence', 'vence', 'd'), C('clienteId', 'cliente_id', 'r'), C('cotizacionId', 'cotizacion_id', 'r'), C('metodoPago', 'metodo_pago'), C('banco'), C('titular'), C('cuenta'), C('observaciones'), C('estado'), C('firmas', 'firmas', 'j'), ...AUD], skip: ['items'] },
    abonos: { table: 'fac_abonos', ret: 'numero', plantilla: true, cols: [C('numero'), C('fecha', 'fecha', 'd'), C('clienteId', 'cliente_id', 'r'), C('cotizacionId', 'cotizacion_id', 'r'), C('facturaId', 'factura_id', 'r'), C('concepto'), C('referencia'), C('formaPago', 'forma_pago'), C('banco'), C('valor', 'valor', 'n'), C('estado'), C('firmas', 'firmas', 'j'), ...AUD] },
    documentos: { table: 'fac_documentos', versiones: 'documento', cols: [C('clienteId', 'cliente_id', 'r'), C('proyecto'), C('nombre'), C('mime'), C('categoria'), C('etiquetas', 'etiquetas', 'a'), C('creado', 'creado', 'ts'), C('creadoPor', 'creado_por')], skip: ['versiones'] },
    auditoria: { table: 'fac_auditoria', insertOnly: true, noExtra: true, cols: [C('fecha', 'fecha', 'ts'), C('usuario'), C('rol'), C('accion'), C('entidad'), C('ref'), C('detalle'), C('cambios', 'cambios', 'j')] },
  };
  const ORDEN = ['roles', 'usuarios', 'clientes', 'inventario', 'plantillas', 'cotizaciones', 'facturas', 'abonos', 'documentos', 'auditoria'];
  const EMPRESA_COLS = [C('razonSocial', 'razon_social'), C('nit', 'nif'), C('direccion'), C('codigoPostal', 'codigo_postal'), C('ciudad', 'localidad'), C('provincia'), C('pais'), C('telefono'), C('email'), C('banco'), C('titular'), C('cuenta'), C('moneda'), C('ivaDefault', 'iva_default', 'n')];

  const aCol = (v, tipo) => {
    if (v === undefined) return null;
    switch (tipo) {
      case 'n': return v === '' || v === null || isNaN(+v) ? null : +v;
      case 'b': return v === true || v === 'true';
      case 'r': case 'd': case 'ts': return v === '' || v === null ? null : v;
      case 'j': return v ?? null;
      case 'a': return Array.isArray(v) ? v : [];
      default: return v === null ? null : String(v);
    }
  };
  const aApp = (v, tipo) => {
    if (tipo === 'ts') return v ? new Date(v).toISOString() : '';
    if (tipo === 'r') return v ?? null;
    if (tipo === 'n') return v === null ? '' : +v;
    if (tipo === 'j' || tipo === 'b' || tipo === 'a') return v;
    return v ?? '';
  };
  function toRow(spec, o, empresaId) {
    const row = { id: o.id, empresa_id: empresaId };
    const extra = { ...o };
    delete extra.id;
    spec.cols.forEach((c) => { row[c.col] = aCol(o[c.k], c.tipo); delete extra[c.k]; });
    (spec.skip || []).forEach((k) => delete extra[k]);
    if (spec.plantilla) { row.plantilla_id = o.plantilla?.id || null; row.plantilla_version = o.plantilla?.version ?? null; delete extra.plantilla; }
    if (!spec.noExtra) row.extra = JSON.parse(JSON.stringify(extra));
    if (row.firmas === null) row.firmas = {};
    if (row.cambios === null) row.cambios = [];
    if (row.permisos === null) row.permisos = {};
    // columnas obligatorias con valor por defecto: si vienen vacías, que las ponga el servidor
    ['creado', 'fecha', 'estado', 'sistema', 'activo'].forEach((c) => { if (row[c] === null) delete row[c]; });
    return row;
  }
  function fromRow(spec, r) {
    const o = { ...(r.extra || {}), id: r.id };
    spec.cols.forEach((c) => { o[c.k] = aApp(r[c.col], c.tipo); });
    if (spec.plantilla) o.plantilla = r.plantilla_id ? { id: r.plantilla_id, version: r.plantilla_version } : null;
    return o;
  }
  const lineaApp = (l) => {
    const it = { ...(l.extra || {}), concepto: l.concepto, descripcion: l.descripcion || '', cantidad: +l.cantidad, valor: +l.valor_unitario, iva: +l.iva_pct, desc: +l.descuento_pct };
    if (l.inventario_id) it.invId = l.inventario_id;
    return it;
  };

  /* ---------- estado de sincronización ---------- */
  let SNAP = {};          // colección → Map(id → JSON)
  let VSET = {};          // 'plantillas'|'documentos' → Map(id → Set(versiones ya guardadas))
  let VPATH = {};         // documento → [rutas en Storage] (para borrar archivos)
  let empSnap = '';
  let ready = false;
  let me = null;
  let lastLoad = 0;
  const queue = [];
  let running = false, fails = 0, retryT = null;

  const snapStr = (o) => JSON.stringify(o, (k, v) => (k === 'data' ? undefined : v));
  const empStr = () => JSON.stringify(DB.empresa);
  const setStatus = (st, msg) => {
    const el = document.getElementById('syncState'); if (!el) return;
    el.dataset.st = st;
    el.textContent = { ok: 'Datos sincronizados con el servidor', run: 'Guardando en el servidor…', bad: 'Error al guardar · reintentando' }[st] || msg;
    if (msg) el.title = msg;
  };

  function rebuildSnap() {
    SNAP = {}; VSET = { plantillas: new Map(), documentos: new Map() };
    ORDEN.forEach((k) => { SNAP[k] = new Map((DB[k] || []).map((o) => [o.id, snapStr(o)])); });
    DB.plantillas.forEach((p) => VSET.plantillas.set(p.id, new Set(p.versiones.map((v) => v.version))));
    DB.documentos.forEach((d) => VSET.documentos.set(d.id, new Set(d.versiones.map((v) => v.v))));
    empSnap = empStr();
  }

  /* ---------- carga ---------- */
  async function fetchAll(table, order = 'id', asc = true, limit = Infinity) {
    const out = []; const page = 1000;
    for (let from = 0; out.length < limit; from += page) {
      const { data, error } = await sb.from(table).select('*').order(order, { ascending: asc }).range(from, Math.min(from + page, limit) - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...data);
      if (data.length < page) break;
    }
    return out;
  }
  async function loadAll() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sesión caducada. Vuelve a iniciar sesión.');
    const { data: yo, error } = await sb.from('fac_usuarios').select('*').eq('auth_user_id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!yo || !yo.activo) throw new Error('Tu acceso existe pero no está asociado a un usuario activo de ZEWÁ. Pide al administrador que lo revise.');
    me = yo;
    const [emp, roles, usuarios, cons, clientes, inventario, plantillas, pver, cots, facs, lineas, abonos, docs, dver, auditoria] = await Promise.all([
      sb.from('fac_empresas').select('*').eq('id', yo.empresa_id).single().then((r) => { if (r.error) throw new Error(r.error.message); return r.data; }),
      fetchAll('fac_roles', 'creado'), fetchAll('fac_usuarios', 'creado'), fetchAll('fac_consecutivos', 'tipo'),
      fetchAll('fac_clientes', 'creado'), fetchAll('fac_inventario', 'creado'), fetchAll('fac_plantillas', 'creado'),
      fetchAll('fac_plantilla_versiones', 'version'), fetchAll('fac_cotizaciones', 'creado'), fetchAll('fac_facturas', 'creado'),
      fetchAll('fac_lineas', 'orden'), fetchAll('fac_abonos', 'creado'), fetchAll('fac_documentos', 'creado'),
      fetchAll('fac_documento_versiones', 'version'), fetchAll('fac_auditoria', 'fecha', false, 2000),
    ]);
    const empresa = { id: emp.id, ...(emp.extra || {}) };
    EMPRESA_COLS.forEach((c) => { empresa[c.k] = aApp(emp[c.col], c.tipo); });
    const lin = { cotizacion: new Map(), factura: new Map() };
    lineas.forEach((l) => {
      const [k, id] = l.cotizacion_id ? ['cotizacion', l.cotizacion_id] : ['factura', l.factura_id];
      if (!lin[k].has(id)) lin[k].set(id, []);
      lin[k].get(id).push(lineaApp(l));
    });
    const year = new Date().getFullYear();
    const seq = { COT: 0, FAC: 0, ABO: 0, CLI: 0, INV: 0, USR: 0 };
    cons.forEach((c) => { if (c.anio === 0 || c.anio === year) seq[c.tipo] = Math.max(seq[c.tipo] || 0, c.ultimo); });
    VPATH = {};
    const db = {
      version: 2, lexico: 'es-ES', usuarioActual: yo.id, seq, empresa,
      roles: roles.map((r) => fromRow(SPECS.roles, r)),
      usuarios: usuarios.map((r) => ({ ...fromRow(SPECS.usuarios, r), authUserId: r.auth_user_id })),
      clientes: clientes.map((r) => ({ adjuntos: [], ...fromRow(SPECS.clientes, r) })),
      inventario: inventario.map((r) => fromRow(SPECS.inventario, r)),
      plantillas: plantillas.map((r) => ({ ...fromRow(SPECS.plantillas, r), versiones: pver.filter((v) => v.plantilla_id === r.id).map((v) => ({ version: v.version, fecha: new Date(v.fecha).toISOString(), usuario: v.usuario || '', nota: v.nota || '', config: v.config })) })),
      cotizaciones: cots.map((r) => ({ ...fromRow(SPECS.cotizaciones, r), items: lin.cotizacion.get(r.id) || [] })),
      facturas: facs.map((r) => ({ ...fromRow(SPECS.facturas, r), items: lin.factura.get(r.id) || [] })),
      abonos: abonos.map((r) => fromRow(SPECS.abonos, r)),
      documentos: docs.map((r) => {
        const vs = dver.filter((v) => v.documento_id === r.id);
        VPATH[r.id] = vs.map((v) => v.storage_path).filter(Boolean);
        return { ...fromRow(SPECS.documentos, r), versiones: vs.map((v) => ({ v: v.version, fecha: new Date(v.fecha).toISOString(), usuario: v.usuario || '', size: +v.tamano || 0, data: '', storagePath: v.storage_path || '' })) };
      }),
      auditoria: auditoria.map((r) => fromRow(SPECS.auditoria, r)),
    };
    db.plantillas = db.plantillas.filter((p) => p.versiones.length);
    lastLoad = Date.now();
    return db;
  }

  /* ---------- guardado por diferencias ---------- */
  function persist() {
    if (!ready || !DB) return true;
    const ups = [], dels = [];
    if (empStr() !== empSnap) { ups.push({ coll: 'empresa' }); empSnap = empStr(); }
    ORDEN.forEach((coll) => {
      const spec = SPECS[coll], snap = SNAP[coll], vivos = new Set();
      (DB[coll] || []).forEach((o) => {
        if (!o?.id) return;
        vivos.add(o.id);
        const s = snapStr(o);
        if (snap.get(o.id) !== s) { ups.push({ coll, obj: o }); snap.set(o.id, s); }
      });
      if (!spec.insertOnly) [...snap.keys()].forEach((id) => { if (!vivos.has(id)) { dels.unshift({ coll, id }); snap.delete(id); } });
    });
    if (!ups.length && !dels.length) return true;
    queue.push({ ups, dels });
    run();
    return true;
  }
  const pending = () => running || queue.length > 0;

  async function run() {
    if (running) return;
    running = true; setStatus('run');
    while (queue.length) {
      const job = queue.shift();
      try { await flush(job); fails = 0; }
      catch (e) {
        console.error('[Nube]', e);
        fails++;
        // lo que no se pudo escribir queda marcado como pendiente para el siguiente intento
        job.ups.forEach((u) => { if (u.coll === 'empresa') empSnap = ''; else if (!job.done?.has(u)) SNAP[u.coll].delete(u.obj.id); });
        job.dels.forEach((d) => { if (!job.done?.has(d)) SNAP[d.coll].set(d.id, '__borrar__'); });
        setStatus('bad', e.message);
        if (window.toast) toast('No se pudo guardar en el servidor: ' + e.message, 'bad');
        clearTimeout(retryT);
        if (fails <= 3) retryT = setTimeout(persist, 8000 * fails);
      }
    }
    running = false;
    if (!fails) setStatus('ok');
  }

  async function flush(job) {
    const emp = DB.empresa.id;
    job.done = new Set();
    // 1) borrados (dependientes primero)
    for (const d of job.dels) {
      const spec = SPECS[d.coll];
      if (d.coll === 'documentos' && VPATH[d.id]?.length) { await sb.storage.from(NUBE_CFG.bucket).remove(VPATH[d.id]); delete VPATH[d.id]; }
      const { error } = await sb.from(spec.table).delete().eq('id', d.id);
      if (error) throw new Error(`${spec.table}: ${error.message}`);
      job.done.add(d);
    }
    // 2) altas y cambios, en orden de dependencias, agrupados por tabla
    const grupos = [];
    job.ups.forEach((u) => { const g = grupos.at(-1); if (g && g.coll === u.coll) g.items.push(u); else grupos.push({ coll: u.coll, items: [u] }); });
    for (const g of grupos) {
      if (g.coll === 'empresa') {
        const row = {}; EMPRESA_COLS.forEach((c) => { row[c.col] = aCol(DB.empresa[c.k], c.tipo); });
        row.actualizado = new Date().toISOString();
        const { error } = await sb.from('fac_empresas').update(row).eq('id', emp);
        if (error) throw new Error('Empresa: ' + error.message);
        g.items.forEach((u) => job.done.add(u));
        continue;
      }
      const spec = SPECS[g.coll];
      const objs = g.items.map((u) => u.obj);
      const rows = objs.map((o) => toRow(spec, o, emp));
      let q = sb.from(spec.table).upsert(rows, { onConflict: 'id', ignoreDuplicates: !!spec.insertOnly, defaultToNull: false });
      if (spec.ret) q = q.select('id,' + spec.ret);
      const { data, error } = await q;
      if (error) throw new Error(`${spec.table}: ${traducir(error)}`);
      if (spec.ret) reconciliarNumeros(g.coll, spec.ret, objs, data || []);
      for (const o of objs) {
        if (spec.lineas) {
          const { error: e2 } = await sb.rpc('fac_guardar_lineas', { p_tipo: spec.lineas, p_doc: o.id, p_lineas: o.items || [] });
          if (e2) throw new Error('Líneas de ' + (o.numero || o.id) + ': ' + traducir(e2));
        }
        if (spec.versiones === 'plantilla') await guardarVersionesPlantilla(o, emp);
        if (spec.versiones === 'documento') await guardarVersionesDocumento(o, emp);
      }
      g.items.forEach((u) => job.done.add(u));
    }
  }
  // Si el servidor asignó otro número (otro usuario usó el propuesto), se corrige aquí y en la auditoría
  function reconciliarNumeros(coll, campo, objs, rows) {
    const k = campo;
    rows.forEach((r) => {
      const o = objs.find((x) => x.id === r.id);
      if (!o || !r[k] || o[k] === r[k]) return;
      const antes = o[k];
      o[k] = r[k];
      DB.auditoria.forEach((a) => { if (a.ref === antes) a.ref = r[k]; });
      SNAP[coll].set(o.id, snapStr(o));
      Store.syncSeq();
      if (window.toast) toast(`${antes} ya estaba en uso: el documento se guardó como ${r[k]}`, 'warn');
      if (window.route && location.hash.includes(o.id)) setTimeout(route, 50);
    });
  }
  async function guardarVersionesPlantilla(p, emp) {
    const set = VSET.plantillas.get(p.id) || new Set();
    const nuevas = p.versiones.filter((v) => !set.has(v.version));
    if (!nuevas.length) return;
    const { error } = await sb.from('fac_plantilla_versiones').upsert(nuevas.map((v) => ({ plantilla_id: p.id, version: v.version, empresa_id: emp, fecha: v.fecha || new Date().toISOString(), usuario: v.usuario || '', nota: v.nota || '', config: v.config })), { onConflict: 'plantilla_id,version', ignoreDuplicates: true });
    if (error) throw new Error('Versiones de plantilla: ' + traducir(error));
    nuevas.forEach((v) => set.add(v.version)); VSET.plantillas.set(p.id, set);
  }
  const dataURLaBlob = async (u) => (await fetch(u)).blob();
  async function guardarVersionesDocumento(d, emp) {
    const set = VSET.documentos.get(d.id) || new Set();
    for (const v of d.versiones.filter((x) => !set.has(x.v))) {
      let path = v.storagePath || null;
      if (!path && typeof v.data === 'string' && v.data.startsWith('data:')) {
        path = `${emp}/${d.id}/v${v.v}-${String(d.nombre).normalize('NFD').replace(/[^\w.\-]+/g, '_')}`;
        const { error: eu } = await sb.storage.from(NUBE_CFG.bucket).upload(path, await dataURLaBlob(v.data), { upsert: true, contentType: d.mime || 'application/octet-stream' });
        if (eu) throw new Error('Archivo ' + d.nombre + ': ' + eu.message);
      }
      const { error } = await sb.from('fac_documento_versiones').upsert({ documento_id: d.id, version: v.v, empresa_id: emp, fecha: v.fecha, usuario: v.usuario || '', tamano: v.size || null, storage_path: path }, { onConflict: 'documento_id,version', ignoreDuplicates: true });
      if (error) throw new Error('Versión de documento: ' + traducir(error));
      v.storagePath = path || '';
      if (path) (VPATH[d.id] = VPATH[d.id] || []).push(path);
      set.add(v.v);
    }
    VSET.documentos.set(d.id, set);
    SNAP.documentos.set(d.id, snapStr(d));
  }
  function traducir(e) {
    const m = e?.message || String(e);
    if (/row-level security/i.test(m)) return 'tu rol no tiene permiso para esta operación';
    if (/duplicate key/i.test(m)) return 'ya existe un registro con ese código o número';
    if (/foreign key/i.test(m)) return 'el registro está relacionado con otro que no existe o que no se puede borrar';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'sin conexión con el servidor';
    return m;
  }

  /* ---------- archivos ---------- */
  async function urlArchivo(path, segundos = 600) {
    const { data, error } = await sb.storage.from(NUBE_CFG.bucket).createSignedUrl(path, segundos);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  /* ---------- sesión y función de usuarios ---------- */
  async function invocar(action, body = {}) {
    const { data, error } = await sb.functions.invoke(NUBE_CFG.funcion, { body: { action, ...body } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { /* sin cuerpo */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function entrar(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message);
  }
  async function salir() {
    ready = false; queue.length = 0;
    await sb.auth.signOut();
  }

  return {
    sb,
    get ready() { return ready; },
    get yo() { return me; },
    async sesion() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth: (cb) => sb.auth.onAuthStateChange(cb),
    entrar, salir,
    recuperar: async (email) => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw new Error(error.message);
    },
    nuevaPassword: async (password) => { const { error } = await sb.auth.updateUser({ password }); if (error) throw new Error(error.message); },
    estado: () => invocar('estado'),
    invocar,
    async cargar() { const db = await loadAll(); DB = db; Store.prepare(); rebuildSnap(); ready = true; setStatus('ok'); return db; },
    persist, pending,
    // Vuelve a leer del servidor si no hay cambios pendientes; devuelve true si recargó
    async refrescar(minMs = 60000) {
      if (!ready || pending() || Date.now() - lastLoad < minMs) return false;
      const db = await loadAll();
      if (pending()) return false;
      DB = db; Store.prepare(); rebuildSnap(); return true;
    },
    marcarGuardado(coll, obj) { SNAP[coll]?.set(obj.id, snapStr(obj)); },
    urlArchivo,
    fromUsuarioRow: (r) => ({ ...fromRow(SPECS.usuarios, r), authUserId: r.auth_user_id }),
  };
})();

window.addEventListener('beforeunload', (e) => { if (Nube.pending()) { e.preventDefault(); e.returnValue = ''; } });
