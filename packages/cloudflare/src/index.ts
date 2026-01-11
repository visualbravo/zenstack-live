import { env } from '@newproject/env/server'
import * as CloudflareBase from 'cloudflare'

export const cloudflare = new CloudflareBase.Cloudflare({
  apiToken: env.CLOUDFLARE_API_TOKEN,
})
