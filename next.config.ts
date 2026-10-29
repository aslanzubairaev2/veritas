import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Die Wissensbasis liegt als Datei im Ordner /tenant und wird zur Laufzeit gelesen.
  // Damit Vercel sie mit in die Serverfunktionen packt:
  outputFileTracingIncludes: {
    "/api/**/*": ["./tenant/**/*"],
    "/**/*": ["./tenant/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
      {
        // Das Widget darf auf fremden Seiten eingebunden werden
        source: "/widget.js",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
