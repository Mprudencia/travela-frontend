import type { NextConfig } from "next";

/** Security headers applied to every response. */
const securityHeaders = [
  // Prevent the site from being embedded in iframes (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing a response away from the declared content type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Force HTTPS for 1 year (including subdomains)
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // Restrict what information is passed in the Referer header
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable unnecessary browser features
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Legacy XSS filter (belt-and-suspenders for older browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Content Security Policy — tightened to allow only our own origins.
  // Adjust 'connect-src' if you add third-party API calls; adjust 'script-src'
  // if you add a CDN. Keep 'unsafe-eval' out — Next.js does not need it in prod.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: only same-origin (Next.js bundles). Remove 'unsafe-inline'
      // once next.js removes inline scripts (they use nonces in newer versions).
      "script-src 'self' 'unsafe-inline'",
      // Styles: inline styles are used heavily by Tailwind
      "style-src 'self' 'unsafe-inline'",
      // Images: allow data URIs and our own origin
      "img-src 'self' data: blob:",
      // Fonts: same origin
      "font-src 'self' data:",
      // API calls + payment gateway redirects. Extend this list only when needed.
      `connect-src 'self' https://api.thetravela.com`,
      // Frames: deny entirely (matches X-Frame-Options)
      "frame-ancestors 'none'",
      // Disallow plugins
      "object-src 'none'",
      // Base URI must be same origin
      "base-uri 'self'",
      // Only same-origin forms
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
