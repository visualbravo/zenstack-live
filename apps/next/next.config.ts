import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // reactCompiler: true,
  transpilePackages: ['@newproject/env'],
  typedRoutes: true,

  experimental: {
    turbopackFileSystemCacheForDev: true,
  },

  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
}

export default withPayload(nextConfig)
