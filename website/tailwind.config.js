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
        The names are the old ones; what they point at is now a role that
        flips with the theme. "cream" was the readable colour on a dark page
        and still is the readable colour — it is simply near-black when the
        page is white. "gold" was the accent and is now the brand purple.
        Clay and sage are things rather than surfaces, so they are fixed.

        Written as rgb(... / <alpha-value>) rather than as var(--x) so every
        existing opacity modifier — bg-cream/70, ring-gold/40 — still
        compiles.
      */
      colors: {
        ink: 'rgb(var(--fg-rgb) / <alpha-value>)',
        cream: 'rgb(var(--fg-rgb) / <alpha-value>)',
        dust: 'rgb(var(--fg2-rgb) / <alpha-value>)',
        ash: 'rgb(var(--fg3-rgb) / <alpha-value>)',
        night: 'rgb(var(--bed-rgb) / <alpha-value>)',
        paper: 'rgb(var(--paper-rgb) / <alpha-value>)',
        gold: 'rgb(var(--accent-rgb) / <alpha-value>)',
        onaccent: 'rgb(var(--on-accent-rgb) / <alpha-value>)',
        clay: '#b9563c',
        sage: '#7fae9f',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"Space Grotesk"', 'ui-sans-serif', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
