/** Content-Security-Policy for the SPA. style-src needs 'unsafe-inline'
 * for React inline styles; no unsafe-eval. */
export const SPA_CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; " +
  "font-src 'self' data:; connect-src 'self' ws: wss: https:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; object-src 'none'; form-action 'self'";
