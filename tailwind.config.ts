import type { Config } from 'tailwindcss'

/**
 * Broadcast SN Remote Call — palette de régie.
 * Les valeurs sont celles de la charte, pas des approximations.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B111B',
        surface: '#151E2B',
        surface2: '#202D3D',
        line: '#2A3A4D',
        accent: { DEFAULT: '#FF9B26', muted: '#B86E18' },
        txt: '#F5F7FA',
        txt2: '#9BAABD',
        ok: '#2BD67B',
        warn: '#FFC53D',
        crit: '#FF4D4F',
        onair: '#FF2D2D',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: { md: '0.375rem', lg: '0.5rem' },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        onair: '0 0 0 1px rgba(255,45,45,0.6), 0 0 18px -4px rgba(255,45,45,0.55)',
      },
      transitionDuration: { 120: '120ms' },
      keyframes: {
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
      animation: { pulseSoft: 'pulseSoft 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
}
export default config
