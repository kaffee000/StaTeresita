// Datos de ejemplo en memoria para las pantallas de gestión (inventario y rutas).
// Es solo apariencia: NO usa Supabase ni guarda nada; se reinicia al cerrar la app.

export type EstadoJornada = 'preparacion' | 'en_curso' | 'finalizada'

export interface Producto { id: string; nombre: string; precio: number; stock_bodega: number }
export interface CargaItem { producto_id: string; nombre: string; cantidad: number }
export interface FurgonHoy {
  id: string
  nombre: string
  casero_id: string | null
  casero_nombre: string | null
  carga: CargaItem[]
}
export interface Parada {
  id: string
  casero_id: string
  cliente_id: string
  nombre: string
  direccion: string | null
  orden: number
  estado_visita: 'pendiente' | 'visitado' | 'no_esta'
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const store = {
  estado: 'preparacion' as EstadoJornada,
  productos: [
    { id: 'p1', nombre: 'Sofá de tela', precio: 249990, stock_bodega: 6 },
    { id: 'p2', nombre: 'Mesa de centro', precio: 89990, stock_bodega: 4 },
    { id: 'p3', nombre: 'Juego de comedor', precio: 329990, stock_bodega: 2 },
    { id: 'p4', nombre: 'Sábanas 2 plazas', precio: 8000, stock_bodega: 20 },
  ] as Producto[],
  catalogoFurgones: [
    { id: 'f1', nombre: 'Furgón 1' },
    { id: 'f2', nombre: 'Furgón 2' },
  ] as { id: string; nombre: string }[],
  furgones: [] as FurgonHoy[],
  paradas: [] as Parada[],
}

export const esGerente = (rol?: string | null) => rol === 'dueno' || rol === 'gerente'

export const textoEstado = (estado?: EstadoJornada | null) =>
  estado === 'en_curso' ? 'En curso' : estado === 'finalizada' ? 'Finalizada' : 'En preparación'

// Caseros que trabajan hoy = los que tienen un furgón asignado
export const caserosHoy = () => {
  const lista: { casero_id: string; nombre: string; furgon: string }[] = []
  store.furgones.forEach((f) => {
    if (f.casero_id && !lista.some((c) => c.casero_id === f.casero_id)) {
      lista.push({ casero_id: f.casero_id, nombre: f.casero_nombre ?? 'Casero', furgon: f.nombre })
    }
  })
  return lista
}
