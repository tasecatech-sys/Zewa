// ZEWÁ · Limpieza: borra los PDF de envíos (carpeta envios/) que ya no tienen un enlace registrado en
// fac_enlaces (documentos borrados o envíos del sistema anterior). No toca ningún otro archivo, por lo
// que es seguro ejecutarla en cualquier momento. Devuelve la lista de archivos borrados.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = admin.storage.from('fac-documentos');
  const { data: empresas } = await admin.from('fac_empresas').select('id');
  const { data: enlaces } = await admin.from('fac_enlaces').select('storage_path');
  const usados = new Set((enlaces || []).map((e) => e.storage_path));
  const archivos: string[] = [];
  const recorrer = async (carpeta: string, nivel = 0) => {
    const { data } = await bucket.list(carpeta, { limit: 1000 });
    for (const it of data || []) {
      const ruta = `${carpeta}/${it.name}`;
      if (it.id === null) { if (nivel < 2) await recorrer(ruta, nivel + 1); } else archivos.push(ruta);
    }
  };
  for (const e of empresas || []) await recorrer(`${e.id}/envios`);
  const borrar = archivos.filter((a) => !usados.has(a));
  if (borrar.length) {
    const { error } = await bucket.remove(borrar);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ revisados: archivos.length, borrados: borrar.length }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
});
