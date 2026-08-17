import type { NextConfig } from "next";

/**
 * Uploads are served from CloudFront. The hostname is environment-specific, so
 * it is read from CDN_URL rather than hardcoded — this must be set at build
 * time as well as runtime, because both the image config and the CSP below
 * are baked into the build.
 */
const cdnOrigin = process.env.CDN_URL
  ? new URL(process.env.CDN_URL).origin
  : undefined;
const cdnHostname = cdnOrigin ? new URL(cdnOrigin).hostname : undefined;

const nextConfig: NextConfig = {
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
      // User uploads (avatars, fictional-world maps), served via CloudFront.
      ...(cdnHostname
        ? [
            {
              protocol: "https" as const,
              hostname: cdnHostname,
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: https://covers.openlibrary.org https://archive.org https://api.dicebear.com https://*.tile.openstreetmap.org${cdnOrigin ? ` ${cdnOrigin}` : ""}`,
              "font-src 'self'",
              `connect-src 'self' https://openlibrary.org${cdnOrigin ? ` ${cdnOrigin}` : ""}`,
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
