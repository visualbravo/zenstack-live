import { schema } from './zenstack/schema'
import { ZenStackLive, beforeAfter } from '@visualbravo/zenstack-live'
import { ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const client = new ZenStackClient(schema, {
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env['POSTGRES_URL'],
    }),
  }),
})

const live = new ZenStackLive({
  id: process.pid.toString(),
  client,

  redis: {
    url: process.env['REDIS_URL']!,
  },
})

function log(message: any, ...rest: any[]) {
  console.log(`[PID ${process.pid}] ${message}`, ...rest)
}

const userStream = live.stream({
  model: 'User',
  slug: 'all-user-changes',
})

log(`Waiting for "User" changes`)

for await (const event of userStream) {
  log(event.type, event.id, JSON.stringify(beforeAfter(event), null, 2))
}

