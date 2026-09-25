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
      /*
        Pointed at the theme variables rather than at fixed values, so a class
        like bg-night follows whichever palette is on. The raw-channel form is
        what lets bg-gold/14 and text-dust/75 keep working.
      */
      colors: {
        ink: 'rgb(var(--s1-rgb) / <alpha-value>)',
        night: 'rgb(var(--s3-rgb) / <alpha-value>)',
        gold: 'rgb(var(--accent-rgb) / <alpha-value>)',
        clay: 'rgb(var(--accent2-rgb) / <alpha-value>)',
        cream: 'rgb(var(--paper-rgb) / <alpha-value>)',
        dust: 'rgb(var(--paper-dim-rgb) / <alpha-value>)',
        ash: 'rgb(var(--ash-rgb) / <alpha-value>)',
        onpaper: 'rgb(var(--on-paper-rgb) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"Space Grotesk"', 'ui-sans-serif', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
