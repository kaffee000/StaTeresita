// Paleta visual de Santa Teresita (azul marino + crema + acento naranja).
// Archivo independiente de theme.ts para no arrastrar el import de global.css.

export const Palette = {
  // Marca
  navy: '#262C60',
  navyDark: '#1B2050',
  navySoft: '#EAEBF5',
  orange: '#E8590C',

  // Fondos y superficies
  cream: '#F6F3EA',
  card: '#FFFFFF',
  border: '#E7E3D6',
  inputFill: '#EFEDE4',

  // Texto
  text: '#1E2243',
  textMuted: '#6F6F68',
  textFaint: '#9A988E',

  // Estados
  green: '#1E7A46',
  greenSoft: '#DDF3E6',
  amber: '#9A6200',
  amberSoft: '#FDF0D2',
  grayPill: '#ECEBE5',

  // Sobre fondo azul marino
  onNavy: '#FFFFFF',
  onNavyMuted: 'rgba(255,255,255,0.72)',
  onNavyFill: 'rgba(255,255,255,0.14)',
} as const

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
} as const
