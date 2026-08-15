export const colors = {
  ink: '#10233F',
  inkSoft: '#36506F',
  muted: '#718198',
  border: '#E4EAF2',
  canvas: '#F4F7FB',
  surface: '#FFFFFF',
  primary: '#3157D5',
  primaryDark: '#203DA5',
  primarySoft: '#EAF0FF',
  teal: '#159B8C',
  tealSoft: '#E4F8F4',
  amber: '#F5A524',
  amberSoft: '#FFF4D9',
  red: '#DC4C64',
  redSoft: '#FDECEF',
  purple: '#7758D6',
  purpleSoft: '#F0ECFF',
  success: '#17875E',
  shadow: '#1A3354',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const shadow = {
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 3,
} as const;
