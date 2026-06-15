/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src-web/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          50: '#f8f7f4',
          100: '#edeae3',
          200: '#dbd5c8',
          300: '#c4baa5',
          400: '#ab9b7e',
          500: '#978467',
          600: '#846f57',
          700: '#6c5a49',
          800: '#5a4b40',
          900: '#4d4138',
        },
        sidebar: {
          bg: '#1e1e2e',
          hover: '#313244',
          active: '#45475a',
          text: '#cdd6f4',
          muted: '#6c7086',
        },
      },
    },
  },
  plugins: [],
}
