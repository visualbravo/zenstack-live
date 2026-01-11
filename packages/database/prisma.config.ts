import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { env } from '@newproject/env/server'

const basePath = path.join('src', '.generated', 'prisma')

export default defineConfig({
  experimental: {
    externalTables: true,
  },

  tables: {
    external: ['public.User', 'public.Session', 'public.Account', 'public.Verification'],
  },

  schema: path.join('src', '.generated', 'schema.prisma'),

  migrations: {
    path: path.join(basePath, 'migrations'),
  },

  views: {
    path: path.join(basePath, 'views'),
  },

  typedSql: {
    path: path.join(basePath, 'queries'),
  },

  datasource: {
    url: env.POSTGRES_URL,
  },
})
