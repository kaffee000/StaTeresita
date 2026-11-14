-- =============================================================================
-- 06_registrar_cliente.sql
-- Registra un cliente con su dirección normalizada en una sola transacción:
--   comunas -> sectores -> calles / pasajes -> direcciones -> clientes
--
-- Busca cada nivel por nombre (sin distinguir mayúsculas ni espacios extra) y lo
-- crea si no existe. Si la dirección exacta (calle + pasaje + número) ya está
-- registrada, se reutiliza (por ejemplo, dos clientes en la misma casa).
--
-- Es SECURITY DEFINER porque las políticas RLS solo dejan al dueño crear
-- comunas/sectores/calles/pasajes, y el vendedor también debe poder registrar
-- clientes en calles nuevas. Los permisos se validan dentro de la función.
-- Se puede volver a correr sin problemas (create or replace).
-- =============================================================================

create or replace function public.registrar_cliente(
  p_nombre     text,
  p_rut        text,
  p_telefono   text,
  p_comuna     text,
  p_sector     text,
  p_calle      text,
  p_pasaje     text default null,
  p_numero     text default null,
  p_referencia text default null,
  p_latitud    double precision default null,
  p_longitud   double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user      uuid := auth.uid();
  v_rol       text;
  -- Limpia espacios repetidos y en los extremos
  v_nombre    text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')),     '\s+', ' ', 'g'), '');
  v_rut       text := nullif(upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK-]', '', 'g')), '');
  v_comuna    text := nullif(regexp_replace(btrim(coalesce(p_comuna, '')),     '\s+', ' ', 'g'), '');
  v_sector    text := nullif(regexp_replace(btrim(coalesce(p_sector, '')),     '\s+', ' ', 'g'), '');
  v_calle     text := nullif(regexp_replace(btrim(coalesce(p_calle, '')),      '\s+', ' ', 'g'), '');
  v_pasaje    text := nullif(regexp_replace(btrim(coalesce(p_pasaje, '')),     '\s+', ' ', 'g'), '');
  v_numero    text := nullif(regexp_replace(btrim(coalesce(p_numero, '')),     '\s+', ' ', 'g'), '');
  v_ref       text := nullif(btrim(coalesce(p_referencia, '')), '');
  v_tel       text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_comuna_id uuid;
  v_sector_id uuid;
  v_calle_id  uuid;
  v_pasaje_id uuid;
  v_dir_id    uuid;
  v_cliente   uuid;
  v_texto     text;
  v_tmp       text; -- nombre ya registrado (respeta mayúsculas/tildes originales)
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select rol into v_rol from public.perfiles where id = v_user and activo;
  if v_rol is null or v_rol not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para registrar clientes';
  end if;

  if v_nombre is null then raise exception 'El nombre es obligatorio'; end if;
  if v_rut    is null then raise exception 'El RUT es obligatorio'; end if;
  if v_comuna is null then raise exception 'La comuna es obligatoria'; end if;
  if v_sector is null then raise exception 'El sector es obligatorio'; end if;
  if v_calle  is null then raise exception 'La calle es obligatoria'; end if;

  -- Teléfono: se guarda como 569XXXXXXXX (formato que exige clientes.telefono)
  if length(v_tel) = 8 then
    v_tel := '569' || v_tel;
  elsif length(v_tel) = 9 and left(v_tel, 1) = '9' then
    v_tel := '56' || v_tel;
  end if;
  if v_tel !~ '^569[0-9]{8}$' then
    raise exception 'El teléfono debe ser un celular chileno (ej. +56 9 1234 5678)';
  end if;

  -- RUT: se guarda como 12345678-9 (sin puntos, con guion)
  v_rut := replace(v_rut, '-', '');
  if v_rut !~ '^[0-9]{7,8}[0-9K]$' then
    raise exception 'El RUT no es válido (ej. 12.345.678-9)';
  end if;
  v_rut := left(v_rut, -1) || '-' || right(v_rut, 1);

  if exists (select 1 from public.clientes where upper(rut) = v_rut) then
    raise exception 'Ya existe un cliente con el RUT %', v_rut;
  end if;

  -- 1. Comuna
  select id, nombre into v_comuna_id, v_tmp
    from public.comunas where lower(nombre) = lower(v_comuna) limit 1;
  if v_comuna_id is not null then
    v_comuna := v_tmp;
  else
    insert into public.comunas (nombre) values (v_comuna) returning id into v_comuna_id;
  end if;

  -- 2. Sector (pertenece a la comuna)
  select id, nombre into v_sector_id, v_tmp
    from public.sectores
   where comuna_id = v_comuna_id and lower(nombre) = lower(v_sector) limit 1;
  if v_sector_id is not null then
    v_sector := v_tmp;
  else
    insert into public.sectores (comuna_id, nombre)
    values (v_comuna_id, v_sector) returning id into v_sector_id;
  end if;

  -- 3. Calle (pertenece al sector)
  select id, nombre into v_calle_id, v_tmp
    from public.calles
   where sector_id = v_sector_id and lower(nombre) = lower(v_calle) limit 1;
  if v_calle_id is not null then
    v_calle := v_tmp;
  else
    insert into public.calles (sector_id, nombre)
    values (v_sector_id, v_calle) returning id into v_calle_id;
  end if;

  -- 4. Pasaje (opcional, pertenece al sector)
  if v_pasaje is not null then
    select id, nombre into v_pasaje_id, v_tmp
      from public.pasajes
     where sector_id = v_sector_id and lower(nombre) = lower(v_pasaje) limit 1;
    if v_pasaje_id is not null then
      v_pasaje := v_tmp;
    else
      insert into public.pasajes (sector_id, nombre)
      values (v_sector_id, v_pasaje) returning id into v_pasaje_id;
    end if;
  end if;

  -- 5. Dirección (única por calle + pasaje + número)
  select id into v_dir_id
    from public.direcciones
   where calle_id = v_calle_id
     and pasaje_id is not distinct from v_pasaje_id
     and numero    is not distinct from v_numero
   limit 1;

  if v_dir_id is null then
    insert into public.direcciones
      (sector_id, pasaje_id, calle_id, numero, referencia, latitud, longitud)
    values
      (v_sector_id, v_pasaje_id, v_calle_id, v_numero, v_ref, p_latitud, p_longitud)
    returning id into v_dir_id;
  else
    -- Completa datos que falten en la dirección existente, sin pisar los que ya hay
    update public.direcciones
       set referencia = coalesce(referencia, v_ref),
           latitud    = coalesce(latitud,  p_latitud),
           longitud   = coalesce(longitud, p_longitud)
     where id = v_dir_id;
  end if;

  -- Texto legible (columna clientes.direccion, deprecada pero aún usada en pantallas)
  v_texto := concat_ws(', ',
    concat_ws(' ', v_calle, v_numero),
    v_pasaje,
    v_sector,
    v_comuna);

  -- 6. Cliente
  insert into public.clientes (nombre, rut, telefono, creado_por, direccion_id, direccion)
  values (v_nombre, v_rut, v_tel, v_user, v_dir_id, v_texto)
  returning id into v_cliente;

  return v_cliente;
end;
$function$;

revoke all on function public.registrar_cliente(text, text, text, text, text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.registrar_cliente(text, text, text, text, text, text, text, text, text, double precision, double precision) to authenticated;
