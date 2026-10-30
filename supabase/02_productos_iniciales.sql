-- =====================================================================
-- Santa Teresita: carga inicial de productos en la bodega
-- Pegar en Supabase > SQL Editor > Run. EJECUTAR UNA SOLA VEZ
-- (si lo corres de nuevo, vuelve a sumar las cantidades a la bodega).
-- Requisitos: haber ejecutado inventario.sql y tener un usuario con rol 'dueno'.
-- Los PRECIOS son referenciales: cámbialos desde la app (botón de lápiz en la bodega).
-- =====================================================================
do $$
declare
  r record;
  v_prod uuid;
  v_bodega uuid;
  v_user uuid;
begin
  select id into v_bodega from public.ubicaciones_inventario where tipo = 'bodega' limit 1;
  select id into v_user from public.perfiles where rol = 'dueno' limit 1;
  if v_bodega is null then raise exception 'No existe la bodega: ejecuta primero inventario.sql'; end if;
  if v_user is null then raise exception 'No hay ningún usuario con rol dueno en perfiles'; end if;

  for r in
    select * from (values
      ('Colchón',          '1 plaza',   45000, 8),
      ('Colchón',          '1.5 plazas', 60000, 6),
      ('Colchón',          '2 plazas',  80000, 5),
      ('Sábanas',          '1 plaza',    9000, 20),
      ('Sábanas',          '1.5 plazas', 12000, 15),
      ('Sábanas',          '2 plazas',  15000, 12),
      ('Cobertor',         '1 plaza',   18000, 10),
      ('Cobertor',         '1.5 plazas', 24000, 8),
      ('Cobertor',         '2 plazas',  30000, 6),
      ('Verdulero',        null::text,  14000, 12),
      ('Set de servicios', null::text,  22000, 9)
    ) as t(nombre, especificacion, precio, cantidad)
  loop
    select id into v_prod from public.productos
     where nombre = r.nombre and coalesce(especificacion, '') = coalesce(r.especificacion, '')
     limit 1;

    if v_prod is null then
      insert into public.productos (nombre, especificacion, precio_venta, creado_por)
      values (r.nombre, r.especificacion, r.precio, v_user)
      returning id into v_prod;
    end if;

    insert into public.inventario_stock (ubicacion_id, producto_id, cantidad)
    values (v_bodega, v_prod, r.cantidad)
    on conflict (ubicacion_id, producto_id)
    do update set cantidad = public.inventario_stock.cantidad + excluded.cantidad, actualizado_en = now();

    insert into public.inventario_movimientos (producto_id, ubicacion_destino_id, cantidad, tipo, nota, usuario_id)
    values (v_prod, v_bodega, r.cantidad, 'ingreso', 'Carga inicial', v_user);
  end loop;
end $$;
