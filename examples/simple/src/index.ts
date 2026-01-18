import { schema } from './schema'
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
  client,

  redis: {
    url: process.env['REDIS_URL'],
  },
})

const stream = live.stream({
  model: 'User',
  id: 'all-user-changes',
  created: {},
})

async function main() {
  for await (const event of stream) {
    const { before, after } = beforeAfter(event)

    console.log({
      event,
      before,
      after,
    })
  }
}

main()