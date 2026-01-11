import umami from '@umami/node'
import { env } from '@newproject/env/server'

umami.init({
  websiteId: env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  hostUrl: env.NEXT_PUBLIC_UMAMI_URL,
})

export { umami }
