import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Security Headers for FinTrack Pro v2
 *
 * Applied to all routes via Next.js headers() config.
 *
 * CSP NOTES:
 * ──────────
 * 'unsafe-inline' is required by Next.js for inline scripts/styles in production
 * (hydration, styled-components, emotion, etc.).
 * 'unsafe-eval' is required by Next.js webpack runtime in development.
 * A nonce-based CSP (eliminating unsafe-inline/unsafe-eval) is a future
 * improvement that requires Next.js nonce integration.
 *
 * IMPLEMENTED controls:
 *   - frame-ancestors 'none'    → prevents clickjacking (replaces X-Frame-Options)
 *   - X-Content-Type-Options: nosniff → prevents MIME sniffing attacks
 *   - Referrer-Policy            → limits information leakage in Referer header
 *   - Permissions-Policy         → disables sensitive browser APIs not needed by app
 *
 * NOT implemented yet:
 *   - Strict-Transport-Security (HSTS) — requires HTTPS deployment; add at reverse proxy level
 *   - Nonce-based CSP            — future improvement
 *   - Cross-Origin-Opener-Policy  — evaluate before adding to avoid breaking OAuth popups
 *
 * OWASP A02 (Security Misconfiguration) — PARTIAL (implemented baseline)
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline for hydration scripts and styles
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // data: for base64 receipts; blob: for object URLs (export, chart canvas)
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      // Prevent the page from being embedded in iframes (clickjacking)
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  {
    // Prevent browsers from MIME-sniffing a response away from the declared Content-Type
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Control how much referrer information is sent with requests
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Disable browser features the app does not need
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lucide-react'],

  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
