# Scripts de Supabase – Santa Teresita

Se pegan en Supabase > SQL Editor > Run, en este orden (todos se pueden repetir sin duplicar datos):

1. `01_inventario.sql`        – ubicaciones (bodega y furgones), stock, movimientos y la función `mover_stock`.
2. `02_productos_iniciales.sql` – productos de ejemplo (colchones, sábanas, cobertores, verduleros, sets de servicios).
3. `03_ventas_productos.sql`  – ajustes de ventas/productos.
4. `04_asignar_furgon.sql`    – agrega `responsable_id` a los furgones y asigna el Citroën al dueño.
5. `05_registrar_venta.sql`   – `solicitudes_descuento`, `venta_items` y la función `registrar_venta`
                                (vende solo desde el furgón asignado; descuento > 10 % requiere aprobación).

Ojo: `03` y `05` definen las mismas tablas/función de venta (`solicitudes_descuento`, `venta_items`, `registrar_venta`).
En una base nueva corre solo `05` (es la versión con furgón asignado); si ya corriste `03`, `05` reemplaza la función.

Las pantallas de la app (src/app) ya usan estas tablas y funciones.
