import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/:path*',
      },
      {
        source: '/control/:path*',
        destination: 'http://localhost:9000/:path*',
      },
      {
        source: '/node1/:path*',
        destination: 'http://localhost:3001/:path*',
      },
      {
        source: '/node2/:path*',
        destination: 'http://localhost:3002/:path*',
      },
      {
        source: '/node3/:path*',
        destination: 'http://localhost:3003/:path*',
      },
      {
        source: '/node4/:path*',
        destination: 'http://localhost:3004/:path*',
      },
      {
        source: '/node5/:path*',
        destination: 'http://localhost:3005/:path*',
      },
    ];
  },
};

export default nextConfig;
