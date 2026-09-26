/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
        Rich, and disciplined.

        Three passes got here. Near-black with one amber accent read as every
        AI-generated product page; the correction to saturated turquoise and
        hot pink read as cheap. What is expensive is depth and restraint: deep
        jewel beds that differ scene to scene, terracotta and gold as the only
        accents, and cream doing all the talking.
      */
      colors: {
        ink: '#191125',
        night: '#271640',
        clay: '#b9563c',
        gold: '#d9a441',
        sage: '#7fae9f',
        cream: '#f4ede1',
        dust: '#dfd3c1',
        ash: '#9a9097',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"Space Grotesk"', 'ui-sans-serif', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
