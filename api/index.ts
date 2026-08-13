/**
 * Vercel serverless entry. The Express app is bundled to plain ESM at build
 * time (`npm run build:api`) because the source uses .ts import specifiers,
 * which the platform's compiler will not resolve at runtime.
 */
// @ts-expect-error generated at build time
export { default } from './_bundle.mjs'
