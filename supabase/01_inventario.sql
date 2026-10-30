-- =====================================================================
-- Santa Teresita: inventario (bodega + furgones) y catálogo de productos
-- Pegar completo en Supabase > SQL Editor > Run.
-- Ejecutar UNA sola vez. Solo CREA tablas/funciones nuevas. No modifica perfiles, clientes,
-- ventas_pedidos, pagos ni auditoria_movimientos.
-- =====================================================================

-- Ayuda para las políticas: ¿el usuario logueado es dueño/gerente?
create or replace function public.es_dueno()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'dueno');
$$;

-- 1) Catálogo de productos (la marca y la especificación son opcionales)
create table if not exists public.productos (
  id uuid not null default uuid_generate_v4(),
  nombre text not null,                       -- Ej: "Sofá 3 cuerpos", "Verdulero", "Sábanas 2 plazas"
  marca text,                                 -- opcional
  especificacion text,                        -- opcional. Ej: "tela gris, 1.8 m"
  precio_venta numeric not null default 0 check (precio_venta >= 0),
  controla_stock boolean not null default true, -- false para servicios (no tienen stock)
  activo boolean not null default true,
  creado_por uuid references auth.users(id),
  creado_en timestamptz default now(),
  constraint productos_pkey primary key (id)
);

-- 2) Ubicaciones de inventario: una bodega y uno o más furgones
create table if not exists public.ubicaciones_inventario (
  id uuid not null default uuid_generate_v4(),
  tipo varchar not null check (tipo in ('bodega','furgon')),
  nombre text not null,                       -- Ej: "Bodega", "Furgón 1"
  patente varchar,                            -- opcional, solo furgones
  activo boolean not null default true,
  creado_en timestamptz default now(),
  constraint ubicaciones_inventario_pkey primary key (id)
);
-- Solo puede existir una bodega
create unique index if not exists una_sola_bodega
  on public.ubicaciones_inventario (tipo) where tipo = 'bodega';

-- 3) Stock actual de cada producto en cada ubicación
create table if not exists public.inventario_stock (
  id uuid not null default uuid_generate_v4(),
  ubicacion_id uuid not null references public.ubicaciones_inventario(id),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null default 0 check (cantidad >= 0),
  actualizado_en timestamptz default now(),
  constraint inventario_stock_pkey primary key (id),
  constraint inventario_stock_unico unique (ubicacion_id, producto_id)
);

-- 4) Historial de movimientos (ingresos, cargas de furgón, devoluciones, ajustes)
create table if not exists public.inventario_movimientos (
  id uuid not null default uuid_generate_v4(),
  producto_id uuid not null references public.productos(id),
  ubicacion_origen_id uuid references public.ubicaciones_inventario(id),   -- null = viene de afuera (compra/ingreso)
  ubicacion_destino_id uuid references public.ubicaciones_inventario(id),  -- null = sale del inventario (venta/merma)
  cantidad integer not null check (cantidad > 0),
  tipo varchar not null check (tipo in ('ingreso','carga','devolucion','venta','ajuste','merma')),
  nota text,
  usuario_id uuid not null references auth.users(id),
  fecha timestamptz default now(),
  constraint inventario_movimientos_pkey primary key (id),
  constraint movimiento_con_ubicacion check (ubicacion_origen_id is not null or ubicacion_destino_id is not null)
);

-- Bodega inicial
insert into public.ubicaciones_inventario (tipo, nombre)
select 'bodega', 'Bodega'
where not exists (select 1 from public.ubicaciones_inventario where tipo = 'bodega');

-- 5) Mover stock de forma atómica (descuenta origen, suma destino y deja el movimiento)
--    Ingreso a bodega:  p_origen = null,  p_destino = id bodega,  tipo 'ingreso'
--    Cargar un furgón:  p_origen = bodega, p_destino = furgón,    tipo 'carga'
--    Devolver:          p_origen = furgón, p_destino = bodega,    tipo 'devolucion'
--    Merma / ajuste:    p_origen = ubicación, p_destino = null,   tipo 'merma' o 'ajuste'
create or replace function public.mover_stock(
  p_producto uuid, p_origen uuid, p_destino uuid, p_cantidad int, p_tipo text, p_nota text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno() then raise exception 'Solo el dueño puede mover stock'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida'; end if;
  if p_origen is null and p_destino is null then raise exception 'Indica origen o destino'; end if;

  if p_origen is not null then
    update public.inventario_stock
       set cantidad = cantidad - p_cantidad, actualizado_en = now()
     where ubicacion_id = p_origen and producto_id = p_producto and cantidad >= p_cantidad;
    if not found then raise exception 'Stock insuficiente en la ubicación de origen'; end if;
  end if;

  if p_destino is not null then
    insert into public.inventario_stock (ubicacion_id, producto_id, cantidad)
    values (p_destino, p_producto, p_cantidad)
    on conflict (ubicacion_id, producto_id)
    do update set cantidad = public.inventario_stock.cantidad + excluded.cantidad, actualizado_en = now();
  end if;

  insert into public.inventario_movimientos (producto_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, tipo, nota, usuario_id)
  values (p_producto, p_origen, p_destino, p_cantidad, p_tipo, p_nota, auth.uid());
end $$;

-- 6) Seguridad (RLS): todos los usuarios logueados leen; solo el dueño escribe directo.
--    Los movimientos de stock se hacen con mover_stock().
alter table public.productos enable row level security;
alter table public.ubicaciones_inventario enable row level security;
alter table public.inventario_stock enable row level security;
alter table public.inventario_movimientos enable row level security;

create policy "productos_leer" on public.productos for select to authenticated using (true);
create policy "ubicaciones_leer" on public.ubicaciones_inventario for select to authenticated using (true);
create policy "stock_leer" on public.inventario_stock for select to authenticated using (true);
create policy "movimientos_leer" on public.inventario_movimientos for select to authenticated using (true);

create policy "productos_dueno" on public.productos for all to authenticated
  using (public.es_dueno()) with check (public.es_dueno());
create policy "ubicaciones_dueno" on public.ubicaciones_inventario for all to authenticated
  using (public.es_dueno()) with check (public.es_dueno());
-- inventario_stock e inventario_movimientos: sin política de escritura; solo se modifican vía mover_stock().
