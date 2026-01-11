import { z } from 'zod'

const mode = z.enum(['development', 'production', 'test']).default('development')

export const schema = z.object({
  NODE_ENV: mode,
  MODE: mode,

  NEXT_PUBLIC_BASE_URL: z.string(),
  NEXT_PUBLIC_REALTIME_URL: z.string(),

  NEXT_PUBLIC_UMAMI_URL: z.string(),
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string(),

  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
})

export const env = schema.parse({
  NODE_ENV: process.env['MODE'] || process.env['NODE_ENV'],
  MODE: process.env['MODE'],

  NEXT_PUBLIC_BASE_URL: process.env['NEXT_PUBLIC_BASE_URL'],
  NEXT_PUBLIC_REALTIME_URL: process.env['NEXT_PUBLIC_REALTIME_URL'],
  NEXT_PUBLIC_UMAMI_URL: process.env['NEXT_PUBLIC_UMAMI_URL'],
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env['NEXT_PUBLIC_UMAMI_WEBSITE_ID'],
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
})
