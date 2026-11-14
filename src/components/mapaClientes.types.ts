// Tipos compartidos por el mapa de clientes (versión nativa y web).

/** Un punto del mapa = una dirección con coordenadas guardadas en `direcciones`. */
export type UbicacionMapa = {
  id: string; // direcciones.id
  latitud: number;
  longitud: number;
  direccion: string; // "Calle 123, Pasaje, Sector, Comuna"
  clientes: { id: string; nombre: string; deuda: number }[];
};

export type MapaClientesProps = {
  ubicaciones: UbicacionMapa[];
  onPressCliente?: (clienteId: string) => void;
};

// Centro de Colbún: vista inicial cuando aún no hay puntos
export const CENTRO_INICIAL = { latitud: -35.6975, longitud: -71.4214 };

export const titulo = (u: UbicacionMapa) =>
  u.clientes.length === 1 ? u.clientes[0].nombre : `${u.clientes.length} clientes`;

export const deudaTotal = (u: UbicacionMapa) =>
  u.clientes.reduce((s, c) => s + c.deuda, 0);
