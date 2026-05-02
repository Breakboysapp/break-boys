/**
 * Twitter Card image — Twitter / X uses a different meta tag chain
 * (twitter:image instead of og:image), so Next.js wants a separate
 * file even when the asset is identical to the OG image.
 *
 * We delegate to opengraph-image.tsx so the design only lives in one
 * place — change there, both update.
 */
export { runtime, size, contentType, alt, default } from "./opengraph-image";
