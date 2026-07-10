/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/frontend/html/**/*.html',
    './src/frontend/js/**/*.js',
  ],
  safelist: ['hidden-item'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0A192F',
          light:   '#102A43',
        },
        accent: {
          DEFAULT: '#0078D4',
          bright:  '#0099FF',
          light:   '#00B4D8',
          sky:     '#48CAE4',
          pale:    '#90E0EF',
          subtle:  '#AFC8E8',
          muted:   '#7895B2',
        },
        gold: {
          DEFAULT: '#dfce82',
          dark:    '#c4b55e',
        },
        whatsapp: {
          DEFAULT: '#25d366',
          dark:    '#1da851',
        },
        navy: {
          950: '#050A14',
          900: '#07111F',
          800: '#0A192F',
          700: '#102A43',
          600: '#0B2447',
        },
      },
      fontFamily: {
        heading: ['Montserrat', 'sans-serif'],
        body:    ['Poppins',    'sans-serif'],
      },
      keyframes: {
        msgIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        popIn: {
          '0%':   { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        revealUp: {
          '0%':   { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        spinAnim: {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        zoomIn: {
          '0%':   { opacity: '0', transform: 'scale(0.5)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        alertPulse: {
          '0%':   { opacity: '1', transform: 'scale(1)' },
          '50%':  { opacity: '0.7', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'msg-in':    'msgIn 0.2s ease-out',
        'fade-in':   'fadeIn 0.3s ease',
        'pop-in':    'popIn 0.25s ease-out',
        'reveal-up': 'revealUp 0.4s ease-out',
        'spin-loader': 'spinAnim 1s linear infinite',
        'zoom-in':   'zoomIn 0.3s ease-out',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      boxShadow: {
        'glow-accent': '0 0 40px rgba(0,153,255,0.22), 0 0 80px rgba(0,120,212,0.1)',
        'glow-gold':   '0 0 40px rgba(223,206,130,0.15), 0 0 80px rgba(223,206,130,0.06)',
        'glow-white':  '0 0 30px rgba(255,255,255,0.05)',
        'premium':     '0 8px 32px 0 rgba(31,38,135,0.07)',
        'ambient':     '0 10px 40px rgba(0,0,0,0.04)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
