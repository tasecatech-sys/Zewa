-- =====================================================================
-- TASECA · Sistema de Cotización y Facturación — esquema para Supabase
-- Ciclo: Cliente → Cotización → Abono → Factura → Pago final
-- Multiempresa (cada suscriptor = una "empresa"), RLS, auditoría automática
-- y plantillas versionadas inmutables.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Empresas (tenant) y usuarios ----------
create table if not exists fac_empresas (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null,
  nit text not null,
  direccion text, ciudad text, telefono text, email text,
  banco text, titular text, cuenta text,
  creado timestamptz not null default now()
);

create table if not exists fac_usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references fac_empresas(id) on delete cascade,
  nombre text not null,
  rol text not null default 'Comercial' check (rol in ('Administrador','Comercial','Contabilidad','Consulta')),
  creado timestamptz not null default now()
);

create or replace function fac_mi_empresa() returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from fac_usuarios where user_id = auth.uid()
$$;

-- Consecutivos por empresa, tipo y año (sin huecos por concurrencia)
create table if not exists fac_consecutivos (
  empresa_id uuid not null references fac_empresas(id) on delete cascade,
  tipo text not null check (tipo in ('PRE','FAC','REC','CLI'))  -- presupuesto, factura, recibo de cobro, cliente,
  anio int not null,
  ultimo int not null default 0,
  primary key (empresa_id, tipo, anio)
);

create or replace function fac_siguiente_numero(p_tipo text) returns text
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := fac_mi_empresa(); v_anio int := extract(year from now()); v_n int;
begin
  insert into fac_consecutivos (empresa_id, tipo, anio, ultimo) values (v_emp, p_tipo, case when p_tipo = 'CLI' then 0 else v_anio end, 1)
  on conflict (empresa_id, tipo, anio) do update set ultimo = fac_consecutivos.ultimo + 1
  returning ultimo into v_n;
  return case when p_tipo = 'CLI' then 'CLI-' || lpad(v_n::text, 4, '0')
              else p_tipo || '-' || v_anio || '-' || lpad(v_n::text, 4, '0') end;
end $$;

-- ---------- Clientes ----------
create table if not exists fac_clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  codigo text not null,
  tipo_persona text not null check (tipo_persona in ('Física','Jurídica')),
  razon_social text not null,
  nombre_comercial text not null,
  nit text not null,
  telefono text, celular text,
  email text not null,
  direccion text not null, ciudad text not null, departamento text not null /* provincia */, codigo_postal text, pais text not null default 'España',
  contacto text not null, cargo_contacto text not null,
  observaciones text,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado timestamptz,
  unique (empresa_id, codigo),
  unique (empresa_id, nit),
  check (coalesce(telefono, '') <> '' or coalesce(celular, '') <> '')
);
create index if not exists fac_clientes_busqueda on fac_clientes using gin (to_tsvector('spanish', razon_social || ' ' || nombre_comercial || ' ' || nit || ' ' || email));

-- ---------- Plantillas versionadas ----------
create table if not exists fac_plantillas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cotizacion','factura','abono')),
  nombre text not null,
  estado text not null default 'Inactiva' check (estado in ('Activa','Inactiva')),
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid()
);
-- Solo una plantilla activa por tipo y empresa
create unique index if not exists fac_plantillas_una_activa on fac_plantillas (empresa_id, tipo) where estado = 'Activa';

-- Las versiones son INMUTABLES: editar = insertar una versión nueva.
-- Los documentos guardan (plantilla_id, plantilla_version), así el histórico nunca cambia.
create table if not exists fac_plantilla_versiones (
  plantilla_id uuid not null references fac_plantillas(id) on delete cascade,
  version int not null,
  config jsonb not null,           -- colores, fuente, logo_url, encabezado, pie, firma, bloques[], html, pdf_base_url
  nota text,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  primary key (plantilla_id, version)
);

-- ---------- Cotizaciones (presupuestos) ----------
create table if not exists fac_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  vence date not null,
  proyecto text not null,
  descripcion text,
  cliente_id uuid not null references fac_clientes(id),
  validez text, forma_pago text, tiempo_ejecucion text, observaciones text,
  responsable text,
  estado text not null default 'Borrador' check (estado in ('Borrador','Enviado','Aprobado','Facturado','Anulado')),
  plantilla_id uuid, plantilla_version int,
  firmas jsonb not null default '{}'::jsonb,   -- {emisor:{img_url,nombre,fecha,usuario}, cliente:{...}}
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado timestamptz,
  unique (empresa_id, numero),
  check (vence >= fecha),
  foreign key (plantilla_id, plantilla_version) references fac_plantilla_versiones(plantilla_id, version)
);

-- ---------- Facturas ----------
create table if not exists fac_facturas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  fecha_operacion date,
  vence date,
  cliente_id uuid not null references fac_clientes(id),
  cotizacion_id uuid references fac_cotizaciones(id),
  metodo_pago text check (metodo_pago in ('Transferencia','Bizum','Tarjeta','Domiciliación','Efectivo')),
  banco text, titular text, cuenta text, observaciones text,
  estado text not null default 'Emitida' check (estado in ('Emitida','Anulada')),  -- Pendiente/En Proceso/Pagada/Vencida se calculan (vista)
  plantilla_id uuid, plantilla_version int,
  firmas jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado timestamptz,
  unique (empresa_id, numero),
  foreign key (plantilla_id, plantilla_version) references fac_plantilla_versiones(plantilla_id, version)
);
create unique index if not exists fac_facturas_una_por_cotizacion on fac_facturas (cotizacion_id) where estado <> 'Anulada' and cotizacion_id is not null;

-- ---------- Líneas de detalle (cotizaciones y facturas) ----------
create table if not exists fac_lineas (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid references fac_cotizaciones(id) on delete cascade,
  factura_id uuid references fac_facturas(id) on delete cascade,
  orden int not null default 0,
  concepto text not null,
  descripcion text,
  cantidad numeric(14,4) not null check (cantidad >= 0),
  valor_unitario numeric(16,2) not null check (valor_unitario >= 0),
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  iva_pct numeric(5,2) not null default 21 check (iva_pct between 0 and 100),
  subtotal numeric(16,2) generated always as (round(cantidad * valor_unitario * (1 - descuento_pct / 100), 2)) stored,
  total_linea numeric(16,2) generated always as (round(cantidad * valor_unitario * (1 - descuento_pct / 100) * (1 + iva_pct / 100), 2)) stored,
  check ((cotizacion_id is null) <> (factura_id is null))
);

-- ---------- Abonos (cobros / pagos a cuenta) ----------
create table if not exists fac_abonos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  cliente_id uuid not null references fac_clientes(id),
  cotizacion_id uuid references fac_cotizaciones(id),
  factura_id uuid references fac_facturas(id),
  concepto text not null,
  referencia text,
  forma_pago text not null check (forma_pago in ('Transferencia','Bizum','Tarjeta','Domiciliación','Efectivo')),
  banco text,
  valor numeric(16,2) not null check (valor > 0),
  estado text not null default 'Aplicado' check (estado in ('Aplicado','Anulado')),
  plantilla_id uuid, plantilla_version int,
  firmas jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  unique (empresa_id, numero),
  check (cotizacion_id is not null or factura_id is not null)
);

-- Al facturar un presupuesto, sus anticipos pasan a la factura
create or replace function fac_trasladar_abonos() returns trigger language plpgsql as $$
begin
  if new.cotizacion_id is not null and new.estado = 'Emitida' then
    update fac_abonos set factura_id = new.id where cotizacion_id = new.cotizacion_id and estado = 'Aplicado' and factura_id is null;
    update fac_cotizaciones set estado = 'Facturado' where id = new.cotizacion_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_fac_trasladar_abonos on fac_facturas;
create trigger trg_fac_trasladar_abonos after insert on fac_facturas for each row execute function fac_trasladar_abonos();

-- ---------- Vistas financieras ----------
create or replace view fac_v_facturas with (security_invoker = on) as
select f.*,
  coalesce(t.base, 0) as base_imponible,
  coalesce(t.iva, 0) as iva,
  coalesce(t.total, 0) as total,
  coalesce(a.abonado, 0) as abonos_aplicados,
  greatest(coalesce(t.total, 0) - coalesce(a.abonado, 0), 0) as saldo_pendiente,
  case
    when f.estado = 'Anulada' then 'Anulada'
    when coalesce(t.total, 0) - coalesce(a.abonado, 0) <= 0.5 then 'Pagada'
    when f.vence < current_date then 'Vencida'
    when coalesce(a.abonado, 0) > 0 then 'En Proceso'
    else 'Pendiente'
  end as estado_pago
from fac_facturas f
left join lateral (select sum(subtotal) base, sum(total_linea - subtotal) iva, sum(total_linea) total from fac_lineas l where l.factura_id = f.id) t on true
left join lateral (select sum(valor) abonado from fac_abonos ab where ab.factura_id = f.id and ab.estado = 'Aplicado') a on true;

create or replace view fac_v_proyectos with (security_invoker = on) as
select c.id as cotizacion_id, c.empresa_id, c.numero, c.proyecto, c.cliente_id, c.estado,
  coalesce(t.total, 0) as total_proyecto,
  coalesce(a.abonado, 0) as total_abonado,
  greatest(coalesce(t.total, 0) - coalesce(a.abonado, 0), 0) as saldo_pendiente
from fac_cotizaciones c
left join lateral (select sum(total_linea) total from fac_lineas l where l.cotizacion_id = c.id) t on true
left join lateral (
  select sum(ab.valor) abonado from fac_abonos ab
  where ab.estado = 'Aplicado'
    and (ab.cotizacion_id = c.id or ab.factura_id in (select id from fac_facturas where cotizacion_id = c.id and estado <> 'Anulada'))
) a on true;

-- ---------- Gestión documental ----------
-- Archivos en Storage: bucket privado "fac-documentos", ruta {empresa_id}/{cliente_id}/{proyecto|general}/{documento_id}/v{n}-{nombre}
create table if not exists fac_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default fac_mi_empresa() references fac_empresas(id) on delete cascade,
  cliente_id uuid references fac_clientes(id),
  proyecto text,
  nombre text not null,
  mime text,
  categoria text not null,
  etiquetas text[] not null default '{}',
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  eliminado timestamptz          -- borrado lógico, queda en auditoría
);
create index if not exists fac_documentos_etiquetas on fac_documentos using gin (etiquetas);

create table if not exists fac_documento_versiones (
  documento_id uuid not null references fac_documentos(id) on delete cascade,
  version int not null,
  storage_path text not null,
  tamano bigint,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  primary key (documento_id, version)
);

-- ---------- Auditoría (solo inserción) ----------
create table if not exists fac_auditoria (
  id bigint generated always as identity primary key,
  empresa_id uuid,
  fecha timestamptz not null default now(),
  usuario_id uuid default auth.uid(),
  accion text not null,          -- INSERT / UPDATE / DELETE o acción de negocio (Firmar, Enviar, Descargar…)
  tabla text not null,
  registro_id text,
  antes jsonb,
  despues jsonb,
  cambios jsonb                  -- {campo: [antes, despues]}
);
create index if not exists fac_auditoria_registro on fac_auditoria (tabla, registro_id);

create or replace function fac_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        v_cambios jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(v_old -> k, v_new -> k)) into v_cambios
    from jsonb_object_keys(v_new) k where v_old -> k is distinct from v_new -> k;
    if v_cambios is null then return new; end if;
  end if;
  insert into fac_auditoria (empresa_id, accion, tabla, registro_id, antes, despues, cambios)
  values (coalesce(v_new ->> 'empresa_id', v_old ->> 'empresa_id')::uuid, tg_op, tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'plantilla_id', v_new ->> 'documento_id'), v_old, v_new, v_cambios);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['fac_clientes','fac_cotizaciones','fac_facturas','fac_lineas','fac_abonos','fac_plantillas','fac_plantilla_versiones','fac_documentos','fac_documento_versiones','fac_empresas']
  loop
    execute format('drop trigger if exists trg_auditar on %I', t);
    execute format('create trigger trg_auditar after insert or update or delete on %I for each row execute function fac_auditar()', t);
  end loop;
end $$;

-- ---------- Seguridad: RLS por empresa ----------
do $$
declare t text;
begin
  foreach t in array array['fac_clientes','fac_cotizaciones','fac_facturas','fac_abonos','fac_plantillas','fac_documentos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_empresa on %I', t);
    execute format('create policy p_empresa on %I for all to authenticated using (empresa_id = fac_mi_empresa()) with check (empresa_id = fac_mi_empresa())', t);
  end loop;
end $$;

alter table fac_empresas enable row level security;
drop policy if exists p_empresa on fac_empresas;
create policy p_empresa on fac_empresas for all to authenticated using (id = fac_mi_empresa()) with check (id = fac_mi_empresa());

alter table fac_usuarios enable row level security;
drop policy if exists p_empresa on fac_usuarios;
create policy p_empresa on fac_usuarios for select to authenticated using (empresa_id = fac_mi_empresa());

alter table fac_lineas enable row level security;
drop policy if exists p_empresa on fac_lineas;
create policy p_empresa on fac_lineas for all to authenticated
  using (exists (select 1 from fac_cotizaciones c where c.id = cotizacion_id and c.empresa_id = fac_mi_empresa())
      or exists (select 1 from fac_facturas f where f.id = factura_id and f.empresa_id = fac_mi_empresa()))
  with check (exists (select 1 from fac_cotizaciones c where c.id = cotizacion_id and c.empresa_id = fac_mi_empresa())
      or exists (select 1 from fac_facturas f where f.id = factura_id and f.empresa_id = fac_mi_empresa()));

alter table fac_plantilla_versiones enable row level security;
drop policy if exists p_leer on fac_plantilla_versiones;
drop policy if exists p_insertar on fac_plantilla_versiones;
create policy p_leer on fac_plantilla_versiones for select to authenticated
  using (exists (select 1 from fac_plantillas p where p.id = plantilla_id and p.empresa_id = fac_mi_empresa()));
create policy p_insertar on fac_plantilla_versiones for insert to authenticated
  with check (exists (select 1 from fac_plantillas p where p.id = plantilla_id and p.empresa_id = fac_mi_empresa()));
-- sin políticas de UPDATE/DELETE → las versiones no se pueden modificar

alter table fac_documento_versiones enable row level security;
drop policy if exists p_empresa on fac_documento_versiones;
create policy p_empresa on fac_documento_versiones for all to authenticated
  using (exists (select 1 from fac_documentos d where d.id = documento_id and d.empresa_id = fac_mi_empresa()))
  with check (exists (select 1 from fac_documentos d where d.id = documento_id and d.empresa_id = fac_mi_empresa()));

alter table fac_auditoria enable row level security;
drop policy if exists p_leer on fac_auditoria;
create policy p_leer on fac_auditoria for select to authenticated using (empresa_id = fac_mi_empresa());
-- sin políticas de escritura: solo el trigger (security definer) inserta; nadie edita ni borra

alter table fac_consecutivos enable row level security;  -- solo vía fac_siguiente_numero()
