-- =====================================================================
-- ZEWÁ · Presupuestos y Facturación — esquema Supabase (v2)
-- Alineado con el modelo de la aplicación (assets/data.js) y con España
-- (EUR, IVA 21 %, NIF, provincia, localidad).
--
-- Los identificadores son de texto para conservar los que genera la app
-- (cli_xxx, cot_xxx…) y poder importar respaldos JSON sin transformarlos.
-- Toda tabla tiene RLS por empresa y por permiso de módulo del rol.
-- Los campos que la app maneja y no tienen columna propia se guardan en
-- `extra` (jsonb), así no se pierde ningún dato.
-- =====================================================================

-- ---------- Limpieza del esquema v1 (estaba vacío) ----------
drop view if exists public.fac_v_facturas, public.fac_v_proyectos;
drop table if exists public.fac_auditoria, public.fac_documento_versiones, public.fac_documentos,
  public.fac_abonos, public.fac_lineas, public.fac_facturas, public.fac_cotizaciones,
  public.fac_plantilla_versiones, public.fac_plantillas, public.fac_inventario, public.fac_clientes,
  public.fac_consecutivos, public.fac_usuarios, public.fac_roles, public.fac_empresas cascade;
drop function if exists public.fac_mi_empresa() cascade;
drop function if exists public.fac_crear_empresa(text, text, text) cascade;
drop function if exists public.fac_siguiente_numero(text) cascade;
drop function if exists public.fac_trasladar_abonos() cascade;
drop function if exists public.fac_auditar() cascade;
drop function if exists public.fac_permiso(text) cascade;
drop function if exists public.fac_gestiona(text[]) cascade;
drop function if exists public.fac_asignar_numero() cascade;
drop function if exists public.fac_guardar_lineas(text, text, jsonb) cascade;
drop policy if exists fac_docs_select on storage.objects;
drop policy if exists fac_docs_insert on storage.objects;
drop policy if exists fac_docs_update on storage.objects;
drop policy if exists fac_docs_delete on storage.objects;

-- ---------- Tablas ----------
create table public.fac_empresas (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null,
  nif text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  pais text not null default 'España',
  telefono text,
  email text,
  banco text,
  titular text,
  cuenta text,
  moneda text not null default 'EUR' check (moneda in ('EUR', 'COP', 'USD', 'MXN')),
  iva_default numeric not null default 21,
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  actualizado timestamptz
);

create table public.fac_roles (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  nombre text not null,
  descripcion text,
  sistema boolean not null default false,
  permisos jsonb not null default '{}',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  actualizado timestamptz,
  unique (empresa_id, nombre)
);

create table public.fac_usuarios (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  auth_user_id uuid unique references auth.users on delete set null,
  codigo text,
  nombre text not null,
  email text,
  rol_id text not null references public.fac_roles,
  activo boolean not null default true,
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, codigo)
);

create table public.fac_consecutivos (
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  tipo text not null,          -- COT, FAC, ABO, CLI, INV, USR
  anio integer not null,       -- 0 para códigos sin año (CLI, INV, USR)
  ultimo integer not null default 0,
  primary key (empresa_id, tipo, anio)
);

create table public.fac_clientes (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  codigo text,
  tipo text,                   -- Física / Jurídica
  razon_social text not null,
  nombre_comercial text,
  nif text,
  telefono text,
  movil text,
  email text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  pais text default 'España',
  contacto text,
  cargo text,
  observaciones text,
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, codigo)
);
create index on public.fac_clientes (empresa_id, nif);

create table public.fac_inventario (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  codigo text,
  tipo text,                   -- Servicio / Material
  categoria text,
  unidad text,
  nombre text not null,
  descripcion text,
  costo numeric,
  precio_venta numeric,
  iva numeric,
  estado text default 'Activo',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, codigo)
);

create table public.fac_plantillas (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  tipo text not null check (tipo in ('cotizacion', 'factura', 'abono')),
  nombre text not null,
  estado text not null default 'Inactiva' check (estado in ('Activa', 'Inactiva')),
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text
);

-- Versiones inmutables: solo INSERT (no hay políticas de UPDATE ni DELETE)
create table public.fac_plantilla_versiones (
  plantilla_id text not null references public.fac_plantillas on delete cascade,
  version integer not null,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  fecha timestamptz not null default now(),
  usuario text,
  nota text,
  config jsonb not null,
  primary key (plantilla_id, version)
);

create table public.fac_cotizaciones (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  vence date,
  proyecto text,
  descripcion text,
  cliente_id text not null references public.fac_clientes,
  validez text,
  forma_pago text,
  tiempo_ejecucion text,
  observaciones text,
  responsable text,
  estado text not null default 'Borrador'
    check (estado in ('Borrador', 'Enviado', 'Aprobado', 'Facturado', 'Vencido', 'Anulado')),
  plantilla_id text,
  plantilla_version integer,
  factura_id text,             -- sin FK para evitar el ciclo presupuesto ↔ factura
  firmas jsonb not null default '{}',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, numero)
);
create index on public.fac_cotizaciones (empresa_id, cliente_id);

create table public.fac_facturas (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  fecha_operacion date,
  vence date,
  cliente_id text not null references public.fac_clientes,
  cotizacion_id text references public.fac_cotizaciones on delete set null,
  metodo_pago text,
  banco text,
  titular text,
  cuenta text,
  observaciones text,
  estado text not null default 'Emitida' check (estado in ('Emitida', 'Anulada')),
  plantilla_id text,
  plantilla_version integer,
  firmas jsonb not null default '{}',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, numero)
);
create index on public.fac_facturas (empresa_id, cliente_id);

create table public.fac_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  cotizacion_id text references public.fac_cotizaciones on delete cascade,
  factura_id text references public.fac_facturas on delete cascade,
  orden integer not null default 0,
  inventario_id text,
  concepto text not null default '',
  descripcion text,
  cantidad numeric not null default 0,
  valor_unitario numeric not null default 0,
  descuento_pct numeric not null default 0,
  iva_pct numeric not null default 21,
  subtotal numeric generated always as (round(cantidad * valor_unitario * (1 - descuento_pct / 100), 2)) stored,
  total_linea numeric generated always as (round(cantidad * valor_unitario * (1 - descuento_pct / 100) * (1 + iva_pct / 100), 2)) stored,
  extra jsonb not null default '{}',
  check ((cotizacion_id is null) <> (factura_id is null))
);
create index on public.fac_lineas (cotizacion_id);
create index on public.fac_lineas (factura_id);

create table public.fac_abonos (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  cliente_id text not null references public.fac_clientes,
  cotizacion_id text references public.fac_cotizaciones on delete set null,
  factura_id text references public.fac_facturas on delete set null,
  concepto text not null default '',
  referencia text,
  forma_pago text,
  banco text,
  valor numeric not null default 0,
  estado text not null default 'Aplicado' check (estado in ('Aplicado', 'Anulado')),
  plantilla_id text,
  plantilla_version integer,
  firmas jsonb not null default '{}',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, numero)
);

create table public.fac_documentos (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  cliente_id text references public.fac_clientes on delete set null,
  proyecto text,
  nombre text not null,
  mime text,
  categoria text,
  etiquetas text[] not null default '{}',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text
);

-- El archivo vive en Storage: bucket privado fac-documentos, ruta {empresa}/{documento}/v{n}-{nombre}
create table public.fac_documento_versiones (
  documento_id text not null references public.fac_documentos on delete cascade,
  version integer not null,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  fecha timestamptz not null default now(),
  usuario text,
  tamano bigint,
  storage_path text,
  primary key (documento_id, version)
);

-- Auditoría escrita por la app (quién, qué, cambio campo a campo). Solo inserción.
create table public.fac_auditoria (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  fecha timestamptz not null default now(),
  auth_user_id uuid default auth.uid(),
  usuario text,
  rol text,
  accion text,
  entidad text,
  ref text,
  detalle text,
  cambios jsonb not null default '[]'
);
create index on public.fac_auditoria (empresa_id, fecha desc);

-- ---------- Funciones de seguridad ----------
create function public.fac_mi_empresa() returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from public.fac_usuarios where auth_user_id = auth.uid() and activo limit 1
$$;

create function public.fac_permiso(modulo text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(r.permisos ->> modulo, 'ninguno')
  from public.fac_usuarios u join public.fac_roles r on r.id = u.rol_id
  where u.auth_user_id = auth.uid() and u.activo limit 1
$$;

create function public.fac_gestiona(variadic modulos text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(modulos) m where public.fac_permiso(m) = 'gestionar')
$$;

-- ---------- Numeración sin duplicados por empresa, tipo y año ----------
-- Respeta el número que propone la app si está libre (así se importan respaldos tal cual);
-- si está ocupado (dos usuarios a la vez) asigna el siguiente libre.
-- Args: tipo, columna, prefijo, anual
create function public.fac_asignar_numero() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tipo text := tg_argv[0];
  v_col text := tg_argv[1];
  v_pref text := tg_argv[2];
  v_anual boolean := tg_argv[3]::boolean;
  v_num text := to_jsonb(new) ->> v_col;
  v_anio integer;
  v_n integer;
  v_ult integer;
  v_ocupado boolean;
  v_m text[];
begin
  -- Un upsert de un registro existente también dispara BEFORE INSERT: no tocarlo
  execute format('select exists (select 1 from %I where id = $1)', tg_table_name) into v_ocupado using new.id;
  if v_ocupado then return new; end if;

  if v_anual then
    v_m := regexp_match(coalesce(v_num, ''), '^' || v_pref || '-(\d{4})-(\d+)$');
    v_anio := coalesce(v_m[1]::integer, extract(year from current_date)::integer);
    v_n := v_m[2]::integer;
  else
    v_m := regexp_match(coalesce(v_num, ''), '^' || v_pref || '-(\d+)$');
    v_anio := 0;
    v_n := v_m[1]::integer;
  end if;

  insert into fac_consecutivos (empresa_id, tipo, anio, ultimo) values (new.empresa_id, v_tipo, v_anio, 0)
  on conflict do nothing;
  select ultimo into v_ult from fac_consecutivos
  where empresa_id = new.empresa_id and tipo = v_tipo and anio = v_anio for update;

  execute format('select exists (select 1 from %I where empresa_id = $1 and %I = $2)', tg_table_name, v_col)
    into v_ocupado using new.empresa_id, v_num;

  if v_n is null or v_ocupado then
    v_n := v_ult;
    loop  -- siguiente número realmente libre
      v_n := v_n + 1;
      v_num := case when v_anual then format('%s-%s-%s', v_pref, v_anio, lpad(v_n::text, 4, '0'))
                    else format('%s-%s', v_pref, lpad(v_n::text, 4, '0')) end;
      execute format('select exists (select 1 from %I where empresa_id = $1 and %I = $2)', tg_table_name, v_col)
        into v_ocupado using new.empresa_id, v_num;
      exit when not v_ocupado;
    end loop;
  end if;

  update fac_consecutivos set ultimo = greatest(ultimo, v_n)
  where empresa_id = new.empresa_id and tipo = v_tipo and anio = v_anio;

  new := jsonb_populate_record(new, jsonb_build_object(v_col, v_num));
  return new;
end $$;

create trigger trg_num before insert on public.fac_cotizaciones for each row execute function public.fac_asignar_numero('COT', 'numero', 'PRE', 'true');
create trigger trg_num before insert on public.fac_facturas     for each row execute function public.fac_asignar_numero('FAC', 'numero', 'FAC', 'true');
create trigger trg_num before insert on public.fac_abonos       for each row execute function public.fac_asignar_numero('ABO', 'numero', 'REC', 'true');
create trigger trg_num before insert on public.fac_clientes     for each row execute function public.fac_asignar_numero('CLI', 'codigo', 'CLI', 'false');
create trigger trg_num before insert on public.fac_inventario   for each row execute function public.fac_asignar_numero('INV', 'codigo', 'INV', 'false');
create trigger trg_num before insert on public.fac_usuarios     for each row execute function public.fac_asignar_numero('USR', 'codigo', 'USR', 'false');

-- ---------- Líneas de un documento: se reemplazan en una sola transacción ----------
create function public.fac_guardar_lineas(p_tipo text, p_doc text, p_lineas jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare v_emp uuid := public.fac_mi_empresa();
begin
  if p_tipo = 'cotizacion' then delete from fac_lineas where cotizacion_id = p_doc;
  else delete from fac_lineas where factura_id = p_doc; end if;
  insert into fac_lineas (empresa_id, cotizacion_id, factura_id, orden, inventario_id, concepto, descripcion,
                          cantidad, valor_unitario, descuento_pct, iva_pct, extra)
  select v_emp,
         case when p_tipo = 'cotizacion' then p_doc end,
         case when p_tipo = 'factura' then p_doc end,
         (e.ord - 1)::integer,
         nullif(e.x ->> 'invId', ''),
         coalesce(e.x ->> 'concepto', ''),
         e.x ->> 'descripcion',
         coalesce(nullif(e.x ->> 'cantidad', '')::numeric, 0),
         coalesce(nullif(e.x ->> 'valor', '')::numeric, 0),
         coalesce(nullif(e.x ->> 'desc', '')::numeric, 0),
         coalesce(nullif(e.x ->> 'iva', '')::numeric, 0),
         e.x - array['invId', 'concepto', 'descripcion', 'cantidad', 'valor', 'desc', 'iva']
  from jsonb_array_elements(coalesce(p_lineas, '[]')) with ordinality as e(x, ord);
end $$;

-- ---------- Vistas de control financiero ----------
create view public.fac_v_facturas with (security_invoker = true) as
select f.id, f.empresa_id, f.numero, f.fecha, f.vence, f.cliente_id, f.estado,
       coalesce(sum(l.total_linea), 0) as total,
       coalesce((select sum(a.valor) from public.fac_abonos a where a.factura_id = f.id and a.estado = 'Aplicado'), 0) as cobrado
from public.fac_facturas f left join public.fac_lineas l on l.factura_id = f.id
group by f.id;

create view public.fac_v_proyectos with (security_invoker = true) as
select c.id, c.empresa_id, c.numero, c.proyecto, c.cliente_id, c.estado,
       coalesce(sum(l.total_linea), 0) as total,
       coalesce((select sum(a.valor) from public.fac_abonos a
                 where a.estado = 'Aplicado' and (a.cotizacion_id = c.id or (c.factura_id is not null and a.factura_id = c.factura_id))), 0) as cobrado
from public.fac_cotizaciones c left join public.fac_lineas l on l.cotizacion_id = c.id
group by c.id;

-- ---------- RLS ----------
alter table public.fac_empresas enable row level security;
alter table public.fac_roles enable row level security;
alter table public.fac_usuarios enable row level security;
alter table public.fac_consecutivos enable row level security;
alter table public.fac_clientes enable row level security;
alter table public.fac_inventario enable row level security;
alter table public.fac_plantillas enable row level security;
alter table public.fac_plantilla_versiones enable row level security;
alter table public.fac_cotizaciones enable row level security;
alter table public.fac_facturas enable row level security;
alter table public.fac_lineas enable row level security;
alter table public.fac_abonos enable row level security;
alter table public.fac_documentos enable row level security;
alter table public.fac_documento_versiones enable row level security;
alter table public.fac_auditoria enable row level security;

-- Empresa: la ven sus usuarios; la edita quien gestiona Configuración. Se crea con la función de alta.
create policy sel on public.fac_empresas for select to authenticated using (id = public.fac_mi_empresa());
create policy upd on public.fac_empresas for update to authenticated using (id = public.fac_mi_empresa() and public.fac_gestiona('config')) with check (id = public.fac_mi_empresa());

create policy sel on public.fac_consecutivos for select to authenticated using (empresa_id = public.fac_mi_empresa());

-- Roles: los del sistema no se modifican ni se borran
create policy sel on public.fac_roles for select to authenticated using (empresa_id = public.fac_mi_empresa());
create policy ins on public.fac_roles for insert to authenticated with check (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('usuarios') and not sistema);
create policy upd on public.fac_roles for update to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('usuarios') and not sistema) with check (empresa_id = public.fac_mi_empresa() and not sistema);
create policy del on public.fac_roles for delete to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('usuarios') and not sistema);

-- Usuarios: el alta (con su acceso) la hace la función zewa-usuarios; aquí solo se editan
create policy sel on public.fac_usuarios for select to authenticated using (empresa_id = public.fac_mi_empresa());
create policy upd on public.fac_usuarios for update to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('usuarios')) with check (empresa_id = public.fac_mi_empresa());

-- Tablas de negocio: leer = pertenecer a la empresa; escribir = gestionar alguno de los módulos indicados
do $$
declare t record;
begin
  for t in select * from (values
    ('fac_clientes', array['clientes']),
    ('fac_inventario', array['inventario']),
    ('fac_plantillas', array['plantillas']),
    ('fac_cotizaciones', array['cotizaciones', 'facturas', 'abonos']),
    ('fac_facturas', array['facturas', 'cotizaciones', 'abonos']),
    ('fac_lineas', array['cotizaciones', 'facturas']),
    ('fac_abonos', array['abonos', 'facturas', 'cotizaciones']),
    ('fac_documentos', array['documentos'])
  ) as v(tabla, modulos) loop
    execute format('create policy sel on public.%I for select to authenticated using (empresa_id = public.fac_mi_empresa())', t.tabla);
    execute format('create policy ins on public.%I for insert to authenticated with check (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[]))', t.tabla, t.modulos);
    execute format('create policy upd on public.%I for update to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[])) with check (empresa_id = public.fac_mi_empresa())', t.tabla, t.modulos);
    execute format('create policy del on public.%I for delete to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[]))', t.tabla, t.modulos);
  end loop;
end $$;

-- Versiones (plantillas y documentos): solo lectura e inserción
create policy sel on public.fac_plantilla_versiones for select to authenticated using (empresa_id = public.fac_mi_empresa());
create policy ins on public.fac_plantilla_versiones for insert to authenticated with check (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('plantillas'));
create policy sel on public.fac_documento_versiones for select to authenticated using (empresa_id = public.fac_mi_empresa());
create policy ins on public.fac_documento_versiones for insert to authenticated with check (empresa_id = public.fac_mi_empresa() and public.fac_gestiona('documentos'));

-- Auditoría: cualquier usuario de la empresa registra; nadie modifica ni borra
create policy sel on public.fac_auditoria for select to authenticated using (empresa_id = public.fac_mi_empresa());
create policy ins on public.fac_auditoria for insert to authenticated with check (empresa_id = public.fac_mi_empresa());

grant execute on function public.fac_guardar_lineas(text, text, jsonb) to authenticated;

-- ---------- Storage: bucket privado por empresa ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fac-documentos', 'fac-documentos', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

create policy fac_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'fac-documentos' and (storage.foldername(name))[1] = public.fac_mi_empresa()::text);
create policy fac_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fac-documentos' and (storage.foldername(name))[1] = public.fac_mi_empresa()::text and public.fac_gestiona('documentos'));
create policy fac_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fac-documentos' and (storage.foldername(name))[1] = public.fac_mi_empresa()::text and public.fac_gestiona('documentos'));

-- ---------- Permisos de ejecución de funciones ----------
-- La de numeración solo la usan los triggers; las de seguridad, las políticas RLS.
revoke execute on function public.fac_asignar_numero() from public, anon, authenticated;
revoke execute on function public.fac_mi_empresa() from public, anon;
revoke execute on function public.fac_permiso(text) from public, anon;
revoke execute on function public.fac_gestiona(text[]) from public, anon;
revoke execute on function public.fac_guardar_lineas(text, text, jsonb) from public, anon;
grant execute on function public.fac_mi_empresa() to authenticated;
grant execute on function public.fac_permiso(text) to authenticated;
grant execute on function public.fac_gestiona(text[]) to authenticated;
grant execute on function public.fac_guardar_lineas(text, text, jsonb) to authenticated;
