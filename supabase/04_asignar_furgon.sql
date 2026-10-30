-- =====================================================================
-- Santa Teresita: asignar furgones a los trabajadores
-- Pegar completo en Supabase > SQL Editor > Run.
-- Agrega UNA columna nueva a ubicaciones_inventario (responsable_id) y
-- asigna el furgón Citroën al usuario con rol 'dueno'.
-- Se puede ejecutar más de una vez sin duplicar nada.
-- =====================================================================

-- 1) Quién trabaja con cada furgón (null = sin asignar)
alter table public.ubicaciones_inventario
  add column if not exists responsable_id uuid references auth.users(id);

-- 2) Una persona trabaja con un solo furgón activo a la vez
create unique index if not exists un_furgon_por_responsable
  on public.ubicaciones_inventario (responsable_id)
  where tipo = 'furgon' and activo and responsable_id is not null;

-- 3) Asignar el Citroën al dueño (el gerente que hace de casero)
do $$
declare
  v_dueno uuid;
  v_furgon uuid;
  v_duenos int;
  v_citroen int;
begin
  select count(*) into v_duenos from public.perfiles where rol = 'dueno';
  if v_duenos = 0 then raise exception 'No hay ningún usuario con rol dueno en perfiles'; end if;
  if v_duenos > 1 then
    raise exception 'Hay % usuarios con rol dueno; asigna a mano con: update public.ubicaciones_inventario set responsable_id = ''<id del usuario>'' where id = ''<id del furgón>'';', v_duenos;
  end if;
  select id into v_dueno from public.perfiles where rol = 'dueno';

  select count(*) into v_citroen
    from public.ubicaciones_inventario
   where tipo = 'furgon' and activo and (nombre ilike '%citroen%' or nombre ilike '%citroën%');
  if v_citroen = 0 then raise exception 'No encontré un furgón activo con "Citroen" en el nombre'; end if;
  if v_citroen > 1 then raise exception 'Hay % furgones con "Citroen" en el nombre; asigna a mano', v_citroen; end if;

  select id into v_furgon
    from public.ubicaciones_inventario
   where tipo = 'furgon' and activo and (nombre ilike '%citroen%' or nombre ilike '%citroën%');

  update public.ubicaciones_inventario set responsable_id = v_dueno where id = v_furgon;
end $$;

-- 4) Comprobación: debe mostrar el Citroën con el nombre del dueño
select u.nombre as furgon, u.patente, p.nombre as responsable
  from public.ubicaciones_inventario u
  left join public.perfiles p on p.id = u.responsable_id
 where u.tipo = 'furgon' and u.activo;
