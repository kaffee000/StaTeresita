// Formato de pesos chilenos: 150000 -> "150.000"
export const formatearMiles = (valor: string | number | null | undefined) => {
  const numero = String(valor ?? 0).replace(/\D/g, '')
  return numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export const clp = (valor: number | null | undefined) => '$' + formatearMiles(Math.round(valor ?? 0))

export const fechaCorta = (fecha?: string | null) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CL')
}
