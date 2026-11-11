import { RetryChunkLoadPlugin } from "webpack-retry-chunk-load-plugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow dev tunnel hostnames for HMR and API requests
  experimental: {
    serverActions: {
      allowedOrigins: [
        "127.0.0.1:3000",
        "localhost:3000",
        "*.devtunnels.ms",
        "*.asse.devtunnels.ms",
        "*.ngrok-free.app",
        "*.ngrok.io",
      ],
    },
  },
  webpack: (config, { isServer }) => {
    // Retry loading chunks on client side when dev tunnels or network drops occur
    if (!isServer) {
      config.plugins.push(
        new RetryChunkLoadPlugin({
          maxRetries: 3,
          retryDelay: 1000,
          cacheBust: "function() { return Date.now(); }",
          lastResortScript: "window.location.reload();",
        })
      );
    }
    return config;
  },
  // Ensure headers for static chunks
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
