-- =====================================================================
-- Santa Teresita: venta de productos con descuentos y pie inicial
-- Pegar completo en Supabase > SQL Editor > Run.
-- Requiere haber ejecutado antes inventario.sql.
-- Solo CREA tablas y funciones nuevas; no modifica ventas_pedidos, pagos,
-- clientes ni perfiles (la función escribe en ellas como lo haría la app).
-- Reglas: el descuento es por producto (en $ o en %). El dueño puede aplicar
-- cualquiera; un vendedor (casero) hasta 10%. Si quiere más, pide una
-- solicitud y el dueño la aprueba.
-- =====================================================================

-- 1) Solicitudes de descuento (casero -> dueño)
create table if not exists public.solicitudes_descuento (
  id uuid not null default uuid_generate_v4(),
  solicitante_id uuid not null references public.perfiles(id),
  producto_id uuid not null references public.productos(id),
  cliente_id uuid references public.clientes(id),
  tipo varchar not null check (tipo in ('porcentaje','monto')),
  valor numeric not null check (valor > 0),          -- % o $ por unidad, según tipo
  motivo text,
  estado varchar not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','usada')),
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  creado_en timestamptz default now(),
  constraint solicitudes_descuento_pkey primary key (id)
);

-- 2) Detalle de cada venta (qué producto, cuántas unidades, a qué precio)
create table if not exists public.venta_items (
  id uuid not null default uuid_generate_v4(),
  venta_pedido_id uuid not null references public.ventas_pedidos(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  ubicacion_id uuid references public.ubicaciones_inventario(id),   -- de dónde salió el stock
  cantidad integer not null check (cantidad > 0),
  precio_lista numeric not null check (precio_lista >= 0),          -- precio del producto al momento de vender
  descuento_tipo varchar not null default 'ninguno' check (descuento_tipo in ('ninguno','porcentaje','monto')),
  descuento_valor numeric not null default 0 check (descuento_valor >= 0),  -- % o $ por unidad
  precio_unitario numeric not null check (precio_unitario >= 0),    -- precio final por unidad (ya con descuento)
  subtotal numeric not null check (subtotal >= 0),                  -- precio_unitario * cantidad
  solicitud_descuento_id uuid references public.solicitudes_descuento(id),
  creado_en timestamptz default now(),
  constraint venta_items_pkey primary key (id)
);

-- 3) Registrar una venta completa de forma atómica
--    p_items: [{"producto_id":"...","cantidad":2,"descuento_tipo":"porcentaje","descuento_valor":5,"solicitud_id":null}, ...]
create or replace function public.registrar_venta(
  p_cliente uuid,
  p_ubicacion uuid,
  p_items jsonb,
  p_contado boolean default false,
  p_pie numeric default 0,
  p_metodo text default 'efectivo',
  p_nota text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_rol text;
  v_venta uuid;
  v_item jsonb;
  v_prod record;
  v_sol record;
  v_cant int;
  v_tipo text;
  v_valor numeric;
  v_unit numeric;
  v_pct numeric;
  v_pct_sol numeric;
  v_sol_id uuid;
  v_total numeric := 0;
  v_pagado numeric := 0;
  v_desc text := '';
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select rol into v_rol from public.perfiles where id = v_user;
  if v_rol is null or v_rol not in ('dueno','vendedor') then
    raise exception 'No tienes permiso para registrar ventas';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then raise exception 'Cliente no encontrado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;
  if p_ubicacion is null or not exists (select 1 from public.ubicaciones_inventario where id = p_ubicacion and activo) then
    raise exception 'Origen de stock inválido';
  end if;

  -- Se crea con valores provisorios y se corrige al final con el total real
  insert into public.ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente)
  values (p_cliente, v_user, 1, 1)
  returning id into v_venta;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    v_tipo := coalesce(nullif(v_item->>'descuento_tipo',''), 'ninguno');
    v_valor := coalesce(nullif(v_item->>'descuento_valor','')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;

    select id, nombre, precio_venta, controla_stock into v_prod
      from public.productos where id = (v_item->>'producto_id')::uuid and activo;
    if not found then raise exception 'Producto no disponible'; end if;

    if v_tipo = 'porcentaje' then
      if v_valor < 0 or v_valor > 100 then raise exception 'Porcentaje de descuento inválido'; end if;
      v_unit := round(v_prod.precio_venta * (1 - v_valor / 100));
    elsif v_tipo = 'monto' then
      if v_valor < 0 or v_valor > v_prod.precio_venta then raise exception 'Descuento inválido en %', v_prod.nombre; end if;
      v_unit := v_prod.precio_venta - v_valor;
    else
      v_tipo := 'ninguno'; v_valor := 0; v_unit := v_prod.precio_venta;
    end if;

    v_pct := case when v_prod.precio_venta > 0 then (v_prod.precio_venta - v_unit) / v_prod.precio_venta * 100 else 0 end;
    v_sol_id := null;

    -- Tope del 10% para vendedores: más requiere una solicitud aprobada
    if v_rol = 'vendedor' and v_pct > 10.0001 then
      select * into v_sol from public.solicitudes_descuento
       where id = nullif(v_item->>'solicitud_id','')::uuid
         and solicitante_id = v_user and estado = 'aprobada' and producto_id = v_prod.id;
      if not found then
        raise exception 'El descuento de % supera el 10 por ciento. Solicítalo al gerente.', v_prod.nombre;
      end if;
      v_pct_sol := case when v_sol.tipo = 'porcentaje' then v_sol.valor
                        else v_sol.valor / nullif(v_prod.precio_venta, 0) * 100 end;
      if coalesce(v_pct_sol, 0) < v_pct - 0.0001 then
        raise exception 'El descuento de % supera lo aprobado por el gerente.', v_prod.nombre;
      end if;
      v_sol_id := v_sol.id;
      update public.solicitudes_descuento set estado = 'usada' where id = v_sol.id;
    end if;

    if v_prod.controla_stock then
      update public.inventario_stock
         set cantidad = cantidad - v_cant, actualizado_en = now()
       where ubicacion_id = p_ubicacion and producto_id = v_prod.id and cantidad >= v_cant;
      if not found then raise exception 'Stock insuficiente de %', v_prod.nombre; end if;
      insert into public.inventario_movimientos (producto_id, ubicacion_origen_id, cantidad, tipo, nota, usuario_id)
      values (v_prod.id, p_ubicacion, v_cant, 'venta', 'Venta ' || v_venta::text, v_user);
    end if;

    insert into public.venta_items (venta_pedido_id, producto_id, ubicacion_id, cantidad, precio_lista,
                                    descuento_tipo, descuento_valor, precio_unitario, subtotal, solicitud_descuento_id)
    values (v_venta, v_prod.id, p_ubicacion, v_cant, v_prod.precio_venta,
            v_tipo, v_valor, v_unit, v_unit * v_cant, v_sol_id);

    v_total := v_total + v_unit * v_cant;
    v_desc := v_desc || case when v_desc = '' then '' else ', ' end || v_cant::text || ' x ' || v_prod.nombre;
  end loop;

  if v_total <= 0 then raise exception 'El total de la venta debe ser mayor a 0'; end if;

  if coalesce(p_contado, false) then
    v_pagado := v_total;
  else
    v_pagado := coalesce(p_pie, 0);
    if v_pagado < 0 or v_pagado > v_total then raise exception 'El pie no puede ser mayor al total'; end if;
  end if;

  update public.ventas_pedidos
     set monto_total = v_total,
         saldo_pendiente = v_total - v_pagado,
         estado_pago = case when v_total - v_pagado <= 0 then 'pagada' else 'pendiente' end,
         descripcion = v_desc || coalesce(' - ' || nullif(p_nota, ''), '')
   where id = v_venta;

  if v_pagado > 0 then
    insert into public.pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago)
    values (v_venta, v_user, v_pagado, coalesce(nullif(p_metodo, ''), 'efectivo'));
  end if;

  return v_venta;
end $$;

-- 4) Seguridad (RLS)
alter table public.solicitudes_descuento enable row level security;
alter table public.venta_items enable row level security;

drop policy if exists "sol_desc_leer" on public.solicitudes_descuento;
create policy "sol_desc_leer" on public.solicitudes_descuento for select to authenticated
  using (public.es_dueno() or solicitante_id = auth.uid());

drop policy if exists "sol_desc_crear" on public.solicitudes_descuento;
create policy "sol_desc_crear" on public.solicitudes_descuento for insert to authenticated
  with check (solicitante_id = auth.uid() and estado = 'pendiente');

drop policy if exists "sol_desc_resolver" on public.solicitudes_descuento;
create policy "sol_desc_resolver" on public.solicitudes_descuento for update to authenticated
  using (public.es_dueno()) with check (public.es_dueno());

-- El detalle de venta lo ve el dueño, el vendedor de esa venta y el propio cliente.
-- Se escribe solo a través de registrar_venta().
drop policy if exists "venta_items_leer" on public.venta_items;
create policy "venta_items_leer" on public.venta_items for select to authenticated
  using (
    public.es_dueno() or exists (
      select 1 from public.ventas_pedidos v
      where v.id = venta_items.venta_pedido_id
        and (v.vendedor_id = auth.uid()
             or exists (select 1 from public.clientes c where c.id = v.cliente_id and c.usuario_id = auth.uid()))
    )
  );
