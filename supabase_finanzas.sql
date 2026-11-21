-- =====================================================================
-- ZEWÁ · Finanzas: compras y gastos, proveedores, empleados y nóminas,
-- movimientos de tesorería (flujo de caja).
--
-- Script ADITIVO: no borra nada. Se puede ejecutar más de una vez.
-- Requiere haber ejecutado antes supabase_facturacion.sql.
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.fac_proveedores (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  codigo text,
  razon_social text not null,
  nif text,
  email text,
  telefono text,
  categoria text,
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, codigo)
);
create index if not exists fac_proveedores_nif on public.fac_proveedores (empresa_id, nif);

-- Facturas recibidas, tiques y gastos. Las líneas van en `lineas` (jsonb):
-- [{ concepto, descripcion, cantidad, valor, desc, iva, invId }]
create table if not exists public.fac_compras (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  numero text not null,                 -- registro interno COM-AAAA-NNNN
  numero_factura text,                  -- número que figura en la factura del proveedor
  fecha date not null default current_date,
  vence date,
  proveedor_id text not null references public.fac_proveedores,
  categoria text,
  obra_id text references public.fac_cotizaciones on delete set null,
  estado text not null default 'Registrada' check (estado in ('Registrada', 'Anulada')),
  lineas jsonb not null default '[]',
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, numero)
);
create index if not exists fac_compras_prov on public.fac_compras (empresa_id, proveedor_id);
create index if not exists fac_compras_obra on public.fac_compras (obra_id);

create table if not exists public.fac_empleados (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  codigo text,
  nombre text not null,
  nif text,                             -- DNI / NIE
  puesto text,
  estado text not null default 'Alta' check (estado in ('Alta', 'Baja')),
  salario_bruto_anual numeric,
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, codigo)
);

create table if not exists public.fac_nominas (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  periodo text not null check (periodo ~ '^\d{4}-\d{2}$'),   -- AAAA-MM
  empleado_id text not null references public.fac_empleados,
  obra_id text references public.fac_cotizaciones on delete set null,
  estado text not null default 'Calculada' check (estado in ('Calculada', 'Anulada')),
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz
);
create index if not exists fac_nominas_periodo on public.fac_nominas (empresa_id, periodo);

-- Entradas y salidas de dinero que no son cobros de clientes (esos están en fac_abonos):
-- pagos a proveedores, nóminas, Seguridad Social, Hacienda, préstamos, comisiones…
create table if not exists public.fac_movimientos (
  id text primary key,
  empresa_id uuid not null references public.fac_empresas on delete cascade,
  numero text not null,                 -- MOV-AAAA-NNNN
  fecha date not null default current_date,
  tipo text not null check (tipo in ('Entrada', 'Salida')),
  categoria text not null,
  concepto text not null default '',
  importe numeric not null default 0 check (importe >= 0),
  cuenta text,                          -- Banco / Caja
  compra_id text references public.fac_compras on delete set null,
  nomina_id text references public.fac_nominas on delete set null,
  obra_id text references public.fac_cotizaciones on delete set null,
  referencia text,
  estado text not null default 'Aplicado' check (estado in ('Aplicado', 'Anulado')),
  extra jsonb not null default '{}',
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz,
  unique (empresa_id, numero)
);
create index if not exists fac_movimientos_fecha on public.fac_movimientos (empresa_id, fecha);
create index if not exists fac_movimientos_compra on public.fac_movimientos (compra_id);

-- ---------- Numeración automática sin duplicados ----------
drop trigger if exists trg_num on public.fac_proveedores;
drop trigger if exists trg_num on public.fac_compras;
drop trigger if exists trg_num on public.fac_empleados;
drop trigger if exists trg_num on public.fac_movimientos;
create trigger trg_num before insert on public.fac_proveedores for each row execute function public.fac_asignar_numero('PRV', 'codigo', 'PRV', 'false');
create trigger trg_num before insert on public.fac_compras     for each row execute function public.fac_asignar_numero('COM', 'numero', 'COM', 'true');
create trigger trg_num before insert on public.fac_empleados   for each row execute function public.fac_asignar_numero('EMP', 'codigo', 'EMP', 'false');
create trigger trg_num before insert on public.fac_movimientos for each row execute function public.fac_asignar_numero('MOV', 'numero', 'MOV', 'true');

-- ---------- RLS ----------
alter table public.fac_proveedores enable row level security;
alter table public.fac_compras enable row level security;
alter table public.fac_empleados enable row level security;
alter table public.fac_nominas enable row level security;
alter table public.fac_movimientos enable row level security;

do $$
declare t record;
begin
  -- tabla, módulos que pueden escribir, módulo necesario para LEER (null = cualquier usuario de la empresa)
  for t in select * from (values
    ('fac_proveedores', array['compras'], null::text),
    ('fac_compras', array['compras'], null::text),
    ('fac_empleados', array['nominas'], 'nominas'),      -- salarios: solo quien tiene acceso a Nóminas
    ('fac_nominas', array['nominas'], 'nominas'),
    ('fac_movimientos', array['tesoreria', 'compras', 'nominas', 'impuestos'], null::text)
  ) as v(tabla, modulos, lectura) loop
    execute format('drop policy if exists sel on public.%I', t.tabla);
    execute format('drop policy if exists ins on public.%I', t.tabla);
    execute format('drop policy if exists upd on public.%I', t.tabla);
    execute format('drop policy if exists del on public.%I', t.tabla);
    if t.lectura is null then
      execute format('create policy sel on public.%I for select to authenticated using (empresa_id = public.fac_mi_empresa())', t.tabla);
    else
      execute format('create policy sel on public.%I for select to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_permiso(%L) <> ''ninguno'')', t.tabla, t.lectura);
    end if;
    execute format('create policy ins on public.%I for insert to authenticated with check (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[]))', t.tabla, t.modulos);
    execute format('create policy upd on public.%I for update to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[])) with check (empresa_id = public.fac_mi_empresa())', t.tabla, t.modulos);
    execute format('create policy del on public.%I for delete to authenticated using (empresa_id = public.fac_mi_empresa() and public.fac_gestiona(variadic %L::text[]))', t.tabla, t.modulos);
  end loop;
end $$;

-- ---------- Permisos de los roles para los módulos nuevos ----------
-- Administrador (rol de sistema): gestiona todo.
update public.fac_roles
set permisos = permisos || '{"compras":"gestionar","nominas":"gestionar","tesoreria":"gestionar","obras":"gestionar","impuestos":"gestionar","resultados":"gestionar"}'::jsonb
where sistema;
-- Contabilidad: gestiona finanzas (solo añade lo que falte; no cambia lo ya configurado).
update public.fac_roles
set permisos = '{"compras":"gestionar","nominas":"gestionar","tesoreria":"gestionar","obras":"ver","impuestos":"gestionar","resultados":"ver"}'::jsonb || permisos
where not sistema and nombre = 'Contabilidad';
-- Comercial: ve los costes de obra.
update public.fac_roles
set permisos = '{"compras":"ninguno","nominas":"ninguno","tesoreria":"ninguno","obras":"ver","impuestos":"ninguno","resultados":"ninguno"}'::jsonb || permisos
where not sistema and nombre = 'Comercial';
