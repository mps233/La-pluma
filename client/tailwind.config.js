/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: 'var(--app-radius-xs)',
        sm: 'var(--app-radius-xs)',
        md: 'var(--app-radius-sm)',
        lg: 'var(--app-radius-md)',
        xl: 'var(--app-radius-lg)',
        '2xl': 'var(--app-radius-lg)',
        '3xl': 'var(--app-radius-lg)',
        full: 'var(--app-radius-pill)',
      },
      gap: {
        3: 'var(--app-space-card)',
        4: 'var(--app-space-card)',
        5: 'var(--app-space-section)',
        6: 'var(--app-space-section)',
      },
      space: {
        4: 'var(--app-space-card)',
        5: 'var(--app-space-section)',
        6: 'var(--app-space-section)',
      },
      animation: {
        'shimmer': 'shimmer 2s infinite linear',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
