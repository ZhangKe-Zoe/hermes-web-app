import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  generateBuildId: async () => {
    return `build-${Date.now()}`
  },
  async headers() {
    return [
      {
        source: '/rubik-cube',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ]
  },
}

export default nextConfig
