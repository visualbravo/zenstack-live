// oxlint-disable init-declarations
// oxlint-disable no-unused-vars
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { schema } from './schemas/basic'
import { ZenStackLive } from '../src'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

describe('live', () => {
  let client: ClientContract<typeof schema>
  let live: ZenStackLive<typeof schema>

  beforeEach(async () => {
    client = new ZenStackClient(schema, {
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env['POSTGRES_URL'],
        }),
      }),
    })

    await Promise.all([
      client.$queryRawUnsafe('ALTER TABLE "User" REPLICA IDENTITY FULL'),
      client.$queryRawUnsafe('ALTER TABLE "Post" REPLICA IDENTITY FULL'),
      client.$queryRawUnsafe('ALTER TABLE "Profile" REPLICA IDENTITY FULL'),
    ])

    live = new ZenStackLive({
      schema,
      id: 'zenstack',

      redis: {
        url: process.env['REDIS_URL'] as string,
      },
    })
  })

  afterEach(async () => {
    await Promise.all([client.$disconnect(), live.disconnect()])
  })

  test('streaming', async () => {
    const stream = live.stream({
      model: 'User',
      id: 'all-user-changes',
      created: {},
      updated: {},
    })

    for await (const event of stream) {
      
    }
  })
})
