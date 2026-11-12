// ZEWÁ · Función de servidor para accesos de usuarios (Supabase Auth)
// Acciones:
//   estado     → ¿ya existe una empresa? (sin sesión)
//   bootstrap  → alta inicial: empresa, roles y administrador (sin sesión, solo si no hay ninguna empresa)
//   crear      → alta de un usuario con acceso (requiere gestionar "usuarios")
//   password   → cambiar contraseña (la propia, o la de otro si gestiona "usuarios")
//   email      → cambiar el correo de acceso de un usuario (requiere gestionar "usuarios")
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const uid = (p: string) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método no permitido', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail('Petición no válida'); }
  const action = body.action;

  if (action === 'estado') {
    const { count, error } = await admin.from('fac_empresas').select('id', { count: 'exact', head: true });
    if (error) return fail(error.message, 500);
    return json({ inicializado: (count ?? 0) > 0 });
  }

  if (action === 'bootstrap') {
    const { count } = await admin.from('fac_empresas').select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) return fail('El sistema ya está configurado.', 409);
    const { empresa, usuario, roles } = body;
    if (!empresa?.razon_social || !usuario?.email || !usuario?.password || !usuario?.nombre || !Array.isArray(roles) || !roles.length) {
      return fail('Faltan datos para la configuración inicial.');
    }
    if (String(usuario.password).length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
    const { data: au, error: e1 } = await admin.auth.admin.createUser({
      email: usuario.email, password: usuario.password, email_confirm: true, user_metadata: { nombre: usuario.nombre },
    });
    if (e1) return fail(e1.message);
    const { data: emp, error: e2 } = await admin.from('fac_empresas').insert({
      razon_social: empresa.razon_social, nif: empresa.nif || null, email: empresa.email || usuario.email,
      telefono: empresa.telefono || null, pais: 'España', moneda: 'EUR', iva_default: 21,
    }).select().single();
    if (e2) { await admin.auth.admin.deleteUser(au.user.id); return fail(e2.message, 500); }
    const rows = roles.map((r: any) => ({ id: uid('rol'), empresa_id: emp.id, nombre: r.nombre, descripcion: r.descripcion || '', sistema: !!r.sistema, permisos: r.permisos || {}, _orig: r.id }));
    const adminRol = rows.find((r: any) => r.sistema) || rows[0];
    const { error: e3 } = await admin.from('fac_roles').insert(rows.map(({ _orig, ...r }: any) => r));
    const { error: e4 } = e3 ? { error: e3 } : await admin.from('fac_usuarios').insert({
      id: uid('usr'), empresa_id: emp.id, auth_user_id: au.user.id, nombre: usuario.nombre, email: usuario.email,
      rol_id: adminRol.id, activo: true, creado_por: 'Configuración inicial',
    });
    if (e3 || e4) {
      await admin.from('fac_empresas').delete().eq('id', emp.id);
      await admin.auth.admin.deleteUser(au.user.id);
      return fail((e3 || e4)!.message, 500);
    }
    return json({ ok: true });
  }

  // ---------- acciones con sesión ----------
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who, error: eAuth } = await admin.auth.getUser(token);
  if (eAuth || !who?.user) return fail('Sesión no válida. Vuelve a iniciar sesión.', 401);
  const { data: yo } = await admin.from('fac_usuarios').select('id, empresa_id, nombre, activo, fac_roles(permisos)')
    .eq('auth_user_id', who.user.id).maybeSingle();
  if (!yo || !yo.activo) return fail('Tu usuario no está activo en ZEWÁ.', 403);
  const gestiona = (yo as any).fac_roles?.permisos?.usuarios === 'gestionar';

  const objetivo = async (id: string) => {
    const { data } = await admin.from('fac_usuarios').select('*').eq('id', id).eq('empresa_id', yo.empresa_id).maybeSingle();
    return data;
  };

  if (action === 'crear') {
    if (!gestiona) return fail('Tu rol no puede crear usuarios.', 403);
    const { nombre, email, password, rolId, activo, id } = body;
    if (!nombre || !email || !password || !rolId) return fail('Nombre, correo, contraseña y rol son obligatorios.');
    if (String(password).length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
    const { data: rol } = await admin.from('fac_roles').select('id').eq('id', rolId).eq('empresa_id', yo.empresa_id).maybeSingle();
    if (!rol) return fail('El rol no existe.');
    const { data: au, error: e1 } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre } });
    if (e1) return fail(/already/i.test(e1.message) ? 'Ya existe un acceso con ese correo.' : e1.message);
    const { data: row, error: e2 } = await admin.from('fac_usuarios').insert({
      id: id || uid('usr'), empresa_id: yo.empresa_id, auth_user_id: au.user.id, nombre, email, rol_id: rolId,
      activo: activo !== false, creado_por: yo.nombre,
    }).select().single();
    if (e2) { await admin.auth.admin.deleteUser(au.user.id); return fail(e2.message, 500); }
    return json({ usuario: row });
  }

  if (action === 'password') {
    const t = await objetivo(body.usuarioId);
    if (!t) return fail('Usuario no encontrado.', 404);
    if (t.id !== yo.id && !gestiona) return fail('Solo puedes cambiar tu propia contraseña.', 403);
    if (!t.auth_user_id) return fail('Este usuario no tiene acceso configurado.');
    if (String(body.password || '').length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
    const { error } = await admin.auth.admin.updateUserById(t.auth_user_id, { password: body.password });
    if (error) return fail(error.message);
    return json({ ok: true });
  }

  if (action === 'email') {
    if (!gestiona) return fail('Tu rol no puede cambiar accesos.', 403);
    const t = await objetivo(body.usuarioId);
    if (!t?.auth_user_id) return fail('Usuario no encontrado.', 404);
    const { error } = await admin.auth.admin.updateUserById(t.auth_user_id, { email: body.email, email_confirm: true });
    if (error) return fail(/already/i.test(error.message) ? 'Ya existe un acceso con ese correo.' : error.message);
    await admin.from('fac_usuarios').update({ email: body.email }).eq('id', t.id);
    return json({ ok: true });
  }

  return fail('Acción desconocida');
});
