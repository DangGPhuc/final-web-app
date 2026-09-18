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
 *   - Strict-Transport-Security (HSTS) → max-age=31536000 in production
 *
 * NOT implemented yet:
 *   - Nonce-based CSP            — future improvement
 *   - Cross-Origin-Opener-Policy  — evaluate before adding to avoid breaking OAuth popups
 *
 * OWASP A02 (Security Misconfiguration) — PARTIAL (implemented baseline)
 */
const isDev = process.env.NODE_ENV !== 'production';

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // data: for base64 receipts; blob: for object URLs (export, chart canvas)
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
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
    // Legacy defense-in-depth alongside CSP frame-ancestors 'none'
    key: 'X-Frame-Options',
    value: 'DENY',
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

// In production, add HSTS (max-age=31536000). Do NOT add includeSubDomains unless explicitly controlled.
if (!isDev) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000',
  });
}

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
