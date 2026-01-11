import { z } from 'zod'

import { schema as clientSchema } from './client'

export const schema = clientSchema.extend({
  TZ: z.string(),

  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  POSTGRES_PORT: z.coerce.number(),
  POSTGRES_HOST: z.string(),
  POSTGRES_URL: z.string(),

  PAYLOAD_SECRET: z.string(),
  PAYLOAD_DATABASE_URL: z.string(),

  RESEND_API_KEY: z.string(),

  CLOUDFLARE_API_TOKEN: z.string(),

  BETTER_AUTH_SECRET: z.string(),

  STRIPE_SECRET_KEY: z.string(),
})

export const env = schema.parse(process.env)
