import { createAuthClient } from 'better-auth/react'
import { env } from '@newproject/env/client'

export const auth = createAuthClient({
  baseURL: env.NEXT_PUBLIC_BASE_URL,
})
