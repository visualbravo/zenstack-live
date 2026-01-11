import { betterAuth } from 'better-auth'
import { randomUUIDv7, redis } from 'bun'
import { env } from '@newproject/env/server'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { zenstack } from '@newproject/database'
// import { nextCookies } from 'better-auth/next-js'
// import { reactStartCookies } from 'better-auth/react-start'

export const auth = betterAuth({
  appName: 'newproject',
  baseURL: env.NEXT_PUBLIC_BASE_URL,

  plugins: [
    // nextCookies(),
    // reactStartCookies(),
  ],

  database: prismaAdapter(zenstack, {
    provider: 'postgresql',
  }),

  user: {
    modelName: 'User',
  },

  session: {
    modelName: 'Session',
  },

  account: {
    modelName: 'Account',
  },

  verification: {
    modelName: 'Verification',
  },

  advanced: {
    generateId: () => randomUUIDv7(),

    database: {
      generateId: () => randomUUIDv7(),
    },
  },

  secondaryStorage: {
    get: async key => {
      return await redis.get(key)
    },

    set: async (key, value, ttl) => {
      if (ttl) {
        await redis.set(key, value, 'EX', ttl)
        return
      }

      await redis.set(key, value)
    },

    delete: async key => {
      await redis.del(key)
    },
  },
})
