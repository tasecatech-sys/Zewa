// ZEWÁ · Entrega del PDF de un documento enviado a partir de un enlace corto.
// La app publica https://<dominio>/d/<codigo>; Vercel reenvía la petición aquí (?c=<codigo>),
// así el cliente no ve rutas internas ni datos del almacenamiento. Pública: el código aleatorio es la llave.
import { createClient } from 'npm:@supabase/supabase-js@2';

const texto = (msg: string, status: number) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return texto('Método no permitido', 405);
  const codigo = new URL(req.url).searchParams.get('c') || '';
  if (!/^[A-Za-z0-9]{10,32}$/.test(codigo)) return texto('Enlace no válido.', 404);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: e } = await admin.from('fac_enlaces').select('*').eq('codigo', codigo).maybeSingle();
  if (!e || e.revocado) return texto('Este enlace no existe o ha sido anulado. Solicita el documento de nuevo a ZEWÁ Reformas.', 404);
  if (new Date(e.expira) < new Date()) return texto('Este enlace ha caducado. Solicita el documento de nuevo a ZEWÁ Reformas.', 410);

  const { data: archivo, error } = await admin.storage.from('fac-documentos').download(e.storage_path);
  if (error || !archivo) return texto('No se encontró el documento. Solicita el documento de nuevo a ZEWÁ Reformas.', 404);

  if (req.method === 'GET') {
    await admin.from('fac_enlaces').update({ descargas: (e.descargas || 0) + 1, ultima_descarga: new Date().toISOString() }).eq('codigo', codigo);
  }
  const nombre = String(e.nombre_archivo || 'documento.pdf');
  const ascii = nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
  return new Response(req.method === 'HEAD' ? null : archivo.stream(), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
