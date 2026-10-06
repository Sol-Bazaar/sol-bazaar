/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        line: 'var(--line)',
        grid: 'var(--grid)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        money: 'var(--money)',
      },
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-roboto-mono)', 'monospace'],
      },
      animation: {
        'shimmer': 'shimmer 2.4s linear infinite',
        'pulse-ring': 'pulse-ring 2.2s ease-out infinite',
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-up': 'slide-up 0.22s ease-out',
        'scale-in': 'scale-in 0.15s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent)' },
          '70%': { boxShadow: '0 0 0 14px transparent' },
          '100%': { boxShadow: '0 0 0 0 transparent' },
        },
        'fade-in': {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
        'slide-up': {
          'from': { opacity: '0', transform: 'translateY(4px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          'from': { opacity: '0', transform: 'scale(0.96)' },
          'to': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}