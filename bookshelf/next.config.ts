import type { NextConfig } from "next";

/**
 * Uploads are served from a CDN (Azure Front Door in production, the blob
 * emulator locally). The hostname is environment-specific, so it is read from
 * CDN_URL rather than hardcoded — this must be set at build time as well as
 * runtime, because both the image config and the CSP below are baked into the
 * build.
 */
const cdnOrigin = process.env.CDN_URL
  ? new URL(process.env.CDN_URL).origin
  : undefined;
const cdnHostname = cdnOrigin ? new URL(cdnOrigin).hostname : undefined;
// Derived, not assumed: a local blob emulator is served over http, and
// hardcoding https here made next/image reject every upload locally.
const cdnProtocol = cdnOrigin
  ? (new URL(cdnOrigin).protocol.replace(":", "") as "http" | "https")
  : undefined;
const cdnPort = cdnOrigin ? new URL(cdnOrigin).port : undefined;

const nextConfig: NextConfig = {
  // Standalone bundles the server and only the dependencies it actually uses,
  // which is what makes a deployable container small. Without it the image
  // carries the whole of node_modules.
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "covers.openlibrary.org",
        pathname: "/b/**",
      },
      {
        protocol: "https",
        hostname: "archive.org",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        pathname: "/**",
      },
      // User uploads (avatars, fictional-world maps), served via the CDN.
      ...(cdnHostname && cdnProtocol
        ? [
            {
              protocol: cdnProtocol,
              hostname: cdnHostname,
              ...(cdnPort ? { port: cdnPort } : {}),
              pathname: "/**",
            },
          ]
        : []),
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-eval' has no consumer in the application — no eval and
              // no `new Function` anywhere in src — but Next's dev server needs
              // it for hot reload, so it is scoped to development instead of
              // being granted in production.
              //
              // 'unsafe-inline' is still required by the one inline script in
              // layout.tsx (the theme bootstrap, a constant string with no
              // interpolation). Removing that needs a per-request nonce or
              // moving the script to a file; recorded, not done here.
              `script-src 'self' 'unsafe-inline'${
                process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
              }`,
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: https://covers.openlibrary.org https://archive.org https://api.dicebear.com https://*.tile.openstreetmap.org${cdnOrigin ? ` ${cdnOrigin}` : ""}`,
              "font-src 'self'",
              `connect-src 'self' https://openlibrary.org${cdnOrigin ? ` ${cdnOrigin}` : ""}`,
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
