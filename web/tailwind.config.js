module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Brand surface ladder: the whole UI grows out of the login-screen
        // black (#0E1319). Never introduce a brighter surface than `card`.
        brand: '#0E1319', // login screen / deepest brand black
        lobby: '#151C23', // lobby screen background
        floor: '#1A222A', // game-room floor; recessed wells & flat buttons
        table: '#111A20', // table felt; darkest chrome
        tablehi: '#162229', // table rim; raised panels (old zinc-900)
        card: '#202A33', // cards / modals / list rows
        cardhi: '#2A3642', // card hover
        ink: '#E8EDF1', // primary text
        muted: '#8996A3', // secondary text
      },
    },
  },

  plugins: [],
}
