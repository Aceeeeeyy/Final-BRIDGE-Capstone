/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Noto Sans', 'sans-serif'],
      },
      colors: {
        'bridge-dark': '#053225',
        'bridge-green': '#6E9277',
        'bridge-light': '#F1FFF5',
      },
    },
  },
  plugins: [],
}
