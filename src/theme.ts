// Palette roles for canvas rendering, mirrored by the CSS custom properties in
// styles.css. Categorical slots validated (all-pairs CVD + contrast) per mode;
// sub-3:1 slots rely on shape + legend + drill-down table as relief.

export type Mode = 'light' | 'dark'

export interface ThemeColors {
  surface: string
  plane: string
  inkPrimary: string
  inkSecondary: string
  inkMuted: string
  gridline: string
  baseline: string
  weekendWash: string
  hoverWash: string
  focusRing: string
  series: string[] // categorical slots 1..4
  otherMark: string // fold-in color for events beyond 4 types
  ordinal: string[] // blue ordinal ramp for cohort curves, oldest -> newest
}

export const COLORS: Record<Mode, ThemeColors> = {
  light: {
    surface: '#fcfcfb',
    plane: '#f9f9f7',
    inkPrimary: '#0b0b0b',
    inkSecondary: '#52514e',
    inkMuted: '#898781',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
    weekendWash: 'rgba(11,11,11,0.035)',
    hoverWash: 'rgba(11,11,11,0.05)',
    focusRing: '#2a78d6',
    series: ['#2a78d6', '#1baf7a', '#eda100', '#008300'],
    otherMark: '#898781',
    ordinal: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  },
  dark: {
    surface: '#1a1a19',
    plane: '#0d0d0d',
    inkPrimary: '#ffffff',
    inkSecondary: '#c3c2b7',
    inkMuted: '#898781',
    gridline: '#2c2c2a',
    baseline: '#383835',
    weekendWash: 'rgba(255,255,255,0.045)',
    hoverWash: 'rgba(255,255,255,0.07)',
    focusRing: '#3987e5',
    series: ['#3987e5', '#199e70', '#c98500', '#008300'],
    otherMark: '#898781',
    ordinal: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'],
  },
}

export function seriesColor(colors: ThemeColors, slot: number): string {
  return slot < 0 ? colors.otherMark : colors.series[slot % colors.series.length]
}
