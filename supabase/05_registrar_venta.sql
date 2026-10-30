-- =====================================================================
-- Santa Teresita: ventas desde el furgón asignado
-- EJECUTAR DESPUÉS de asignar_furgon.sql (usa ubicaciones_inventario.responsable_id)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez.
-- Crea: solicitudes_descuento, venta_items y la función registrar_venta.
-- =====================================================================

-- 1) Solicitudes de descuento (casero pide, gerente aprueba)
create table if not exists public.solicitudes_descuento (
  id uuid primary key default uuid_generate_v4(),
  solicitante_id uuid not null references public.perfiles(id),
  producto_id uuid not null references public.productos(id),
  cliente_id uuid references public.clientes(id),
  tipo text not null check (tipo in ('porcentaje','monto')),
  valor numeric not null check (valor > 0),
  motivo text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','usada')),
  creado_en timestamptz default now(),
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz
);
alter table public.solicitudes_descuento enable row level security;

drop policy if exists sd_select on public.solicitudes_descuento;
create policy sd_select on public.solicitudes_descuento for select to authenticated
  using (solicitante_id = auth.uid() or public.es_dueno());
drop policy if exists sd_insert on public.solicitudes_descuento;
create policy sd_insert on public.solicitudes_descuento for insert to authenticated
  with check (solicitante_id = auth.uid() and estado = 'pendiente');
drop policy if exists sd_update on public.solicitudes_descuento;
create policy sd_update on public.solicitudes_descuento for update to authenticated
  using (public.es_dueno()) with check (public.es_dueno());

-- 2) Detalle de cada venta (qué productos, a qué precio, desde qué ubicación)
create table if not exists public.venta_items (
  id uuid primary key default uuid_generate_v4(),
  venta_pedido_id uuid not null references public.ventas_pedidos(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  ubicacion_id uuid not null references public.ubicaciones_inventario(id),
  cantidad integer not null check (cantidad > 0),
  precio_lista numeric not null,
  descuento_tipo text not null default 'ninguno' check (descuento_tipo in ('ninguno','porcentaje','monto')),
  descuento_valor numeric not null default 0,
  precio_final numeric not null check (precio_final >= 0),
  solicitud_id uuid references public.solicitudes_descuento(id)
);
alter table public.venta_items enable row level security;

drop policy if exists vi_select on public.venta_items;
create policy vi_select on public.venta_items for select to authenticated
  using (exists (select 1 from public.ventas_pedidos v
                  where v.id = venta_pedido_id
                    and (v.vendedor_id = auth.uid() or public.es_dueno()
                         or exists (select 1 from public.clientes c where c.id = v.cliente_id and c.usuario_id = auth.uid()))));
-- (sin policy de insert/update: solo la función registrar_venta escribe aquí)

-- 3) La venta. Toda la lógica y las reglas viven en el servidor.
create or replace function public.registrar_venta(
  p_cliente uuid,
  p_ubicacion uuid,
  p_items jsonb,
  p_contado boolean,
  p_pie numeric,
  p_metodo text,
  p_nota text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rol text;
  v_ub public.ubicaciones_inventario%rowtype;
  v_propio uuid;
  v_item jsonb;
  v_prod public.productos%rowtype;
  v_cant int;
  v_tipo text;
  v_valor numeric;
  v_final numeric;
  v_pct numeric;
  v_sol public.solicitudes_descuento%rowtype;
  v_stock int;
  v_total numeric := 0;
  v_pagado numeric;
  v_venta uuid;
  v_metodo text := coalesce(nullif(p_metodo,''), 'efectivo');
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select rol into v_rol from public.perfiles where id = v_user;
  if v_rol not in ('dueno','vendedor') then raise exception 'No tienes permiso para vender'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente no encontrado';
  end if;

  select * into v_ub from public.ubicaciones_inventario where id = p_ubicacion and activo;
  if not found then raise exception 'La ubicación de venta no existe o está inactiva'; end if;

  -- Regla: quien tiene un furgón asignado solo vende desde ese furgón
  select id into v_propio from public.ubicaciones_inventario
   where tipo = 'furgon' and activo and responsable_id = v_user limit 1;
  if v_propio is not null and p_ubicacion <> v_propio then
    raise exception 'Solo puedes vender con el stock de tu furgón asignado';
  end if;
  if v_propio is null and v_rol = 'vendedor' then
    raise exception 'No tienes un furgón asignado; pide al gerente que te asigne uno';
  end if;

  -- Primera pasada: validar todo y calcular el total
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid and activo;
    if not found then raise exception 'Producto no válido'; end if;

    v_cant  := (v_item->>'cantidad')::int;
    v_tipo  := coalesce(v_item->>'descuento_tipo','ninguno');
    v_valor := coalesce((v_item->>'descuento_valor')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en %', v_prod.nombre; end if;
    if v_valor < 0 then raise exception 'Descuento inválido en %', v_prod.nombre; end if;

    if v_tipo = 'porcentaje' and v_valor > 0 then
      if v_valor > 100 then raise exception 'Descuento inválido en %', v_prod.nombre; end if;
      v_final := v_prod.precio_venta * (1 - v_valor/100);
    elsif v_tipo = 'monto' and v_valor > 0 then
      if v_valor > v_prod.precio_venta then raise exception 'Descuento inválido en %', v_prod.nombre; end if;
      v_final := v_prod.precio_venta - v_valor;
    else
      v_final := v_prod.precio_venta; v_valor := 0;
    end if;
    v_final := round(v_final);

    -- Descuento mayor al 10% solo con solicitud aprobada (el dueño no necesita)
    v_pct := case when v_prod.precio_venta > 0 then (v_prod.precio_venta - v_final) / v_prod.precio_venta * 100 else 0 end;
    if v_rol <> 'dueno' and v_pct > 10.0001 then
      select * into v_sol from public.solicitudes_descuento
       where id = nullif(v_item->>'solicitud_id','')::uuid
         and solicitante_id = v_user and producto_id = v_prod.id
         and estado = 'aprobada' and tipo = v_tipo and valor >= v_valor;
      if not found then
        raise exception 'El descuento de % supera el 10%% y no tiene aprobación', v_prod.nombre;
      end if;
    end if;

    if v_prod.controla_stock then
      select cantidad into v_stock from public.inventario_stock
       where ubicacion_id = p_ubicacion and producto_id = v_prod.id;
      if coalesce(v_stock,0) < v_cant then
        raise exception 'Stock insuficiente de % en %', v_prod.nombre, v_ub.nombre;
      end if;
    end if;

    v_total := v_total + v_final * v_cant;
  end loop;

  if v_total <= 0 then raise exception 'El total debe ser mayor a 0'; end if;
  v_pagado := case when p_contado then v_total else least(greatest(coalesce(p_pie,0),0), v_total) end;

  insert into public.ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, estado_pago, descripcion)
  values (p_cliente, v_user, v_total, v_total, 'pendiente', p_nota)
  returning id into v_venta;

  -- Segunda pasada: guardar items y descontar stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid;
    v_cant  := (v_item->>'cantidad')::int;
    v_tipo  := coalesce(v_item->>'descuento_tipo','ninguno');
    v_valor := coalesce((v_item->>'descuento_valor')::numeric, 0);
    if v_tipo = 'porcentaje' and v_valor > 0 then v_final := round(v_prod.precio_venta * (1 - v_valor/100));
    elsif v_tipo = 'monto' and v_valor > 0 then v_final := round(v_prod.precio_venta - v_valor);
    else v_final := v_prod.precio_venta; v_tipo := 'ninguno'; v_valor := 0; end if;

    insert into public.venta_items (venta_pedido_id, producto_id, ubicacion_id, cantidad, precio_lista,
                                    descuento_tipo, descuento_valor, precio_final, solicitud_id)
    values (v_venta, v_prod.id, p_ubicacion, v_cant, v_prod.precio_venta, v_tipo, v_valor, v_final,
            nullif(v_item->>'solicitud_id','')::uuid);

    if nullif(v_item->>'solicitud_id','') is not null then
      update public.solicitudes_descuento set estado = 'usada'
       where id = (v_item->>'solicitud_id')::uuid and estado = 'aprobada';
    end if;

    if v_prod.controla_stock then
      update public.inventario_stock set cantidad = cantidad - v_cant, actualizado_en = now()
       where ubicacion_id = p_ubicacion and producto_id = v_prod.id;
      insert into public.inventario_movimientos (producto_id, ubicacion_origen_id, cantidad, tipo, nota, usuario_id)
      values (v_prod.id, p_ubicacion, v_cant, 'venta', 'Venta ' || v_venta::text, v_user);
    end if;
  end loop;

  if v_pagado > 0 then
    insert into public.pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago)
    values (v_venta, v_user, v_pagado, v_metodo);
  end if;

  -- Valores finales fijados explícitamente (por si existe algún trigger en pagos)
  update public.ventas_pedidos
     set saldo_pendiente = v_total - v_pagado,
         estado_pago = case when v_total - v_pagado <= 0 then 'pagada' else 'pendiente' end
   where id = v_venta;

  return v_venta;
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text) from public;
grant execute on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text) to authenticated;
