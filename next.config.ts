import withNextIntl from 'next-intl/plugin';
import type { NextConfig } from "next";

// Create the withNextIntl wrapper
const withNextIntlConfig = withNextIntl('./i18n.config.ts');

/**  
 * @type {import('next').NextConfig}  
 */
const config: NextConfig = {
  webpack(config) {
    config.cache = {
      type: 'memory',
    };
    return config;
  },
  // Images configuration for external domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.vietqr.io',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.vietqr.io',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.vietqr.net',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'vietqr.net',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Existing configs  
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  },

  // This disables Edge Runtime completely to prevent Node.js API warnings
  // Works with stable Next.js versions
  serverExternalPackages: ['node-appwrite'],

  // Disable powered by header  
  poweredByHeader: false,

  // Disable server timing  
  generateEtags: false,

  // Empty experimental section since we moved serverComponentsExternalPackages
  experimental: {
    // Server Actions configuration for large backup files
    serverActions: {
      bodySizeLimit: '2mb', // Allow up to 500MB for backup files
    },
  },

  // Headers configuration  
  headers: async () => {
    return [
      {
        source: '/OneSignalSDKWorker.js',
        headers: [
          {
            key: 'Service-Worker-Allowed',
            value: '/'
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate'
          },
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8'
          }
        ]
      },
      {
        source: '/OneSignalSDK.sw.js',
        headers: [
          {
            key: 'Service-Worker-Allowed',
            value: '/'
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate'
          },
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8'
          }
        ]
      },
      {
        source: '/:path*',
        headers: [
          {
            // Remove x-powered-by  
            key: 'X-Powered-By',
            value: '',
          },
          {
            // Remove server  
            key: 'Server',
            value: '',
          },
          {
            // Remove all Vercel headers  
            key: 'x-vercel-protection',
            value: '',
          },
          {
            key: 'x-vercel-ip-timezone',
            value: '',
          },
          {
            key: 'x-vercel-ip-latitude',
            value: '',
          },
          {
            key: 'x-vercel-ip-longitude',
            value: '',
          },
          {
            key: 'x-vercel-ip-country-region',
            value: '',
          },
          {
            key: 'x-vercel-ip-country',
            value: '',
          },
          {
            key: 'x-vercel-ip-city',
            value: '',
          },
          {
            key: 'x-vercel-cache',
            value: '',
          },
          {
            key: 'x-vercel-id',
            value: '',
          },
          {
            // Remove early hints  
            key: 'Link',
            value: '',
          },
          // Security headers  
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          }
        ],
      },
      // Cache static files  
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable'
          }
        ]
      }
    ];
  }
};

// Apply the withNextIntl higher-order function
const nextConfig = withNextIntlConfig(config);

export default nextConfig;