// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { schema } from '../common/schema'
import type { ClientContract } from '@zenstackhq/orm'
import { Redis } from 'ioredis'
import { ZenStackLive } from '../../src'
import { MysqlDatabase } from '../../src/databases/mysql'
import { clearRedis } from '../helpers/clear-redis'
import { createTestDatabase, mysql, type TestDatabase } from '../helpers/dialects'

const RETENTION = 300

let database: TestDatabase<typeof schema>
let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis
let userStream: string

// MySQL has no publication. Every table in the database is captured, so `prune` can't release one.
beforeAll(async () => {
  database = await createTestDatabase(mysql, schema, { isolated: 'zenstack_live_test_capture' })
  client = database.client
  userStream = database.streamName('common_users')
  live = new ZenStackLive({
    client,
    retention: RETENTION,
    redis: { url: process.env['REDIS_URL']! },
  })
  redis = new Redis(process.env['REDIS_URL']!)
}, 15000)

beforeEach(async () => {
  await clearRedis(redis, 'mysql')
})

afterAll(async () => {
  await clearRedis(redis, 'mysql')
  live?.disconnect()
  redis?.disconnect()
  await client?.$disconnect()
})

describe('capture', () => {
  test('names streams after the database', async () => {
    const stream = live.stream({ model: 'User', slug: 'mysql-names' })

    await stream['prepare']()

    expect(stream['streamName']).toBe(
      `zenstack.mysql.table.zenstack_live_test_capture.common_users`,
    )
    expect(stream['consumerGroupName']).toBe(`${userStream}.${stream.id}`)
  })

  test('reports every table in the database as captured', async () => {
    const tables = await new MysqlDatabase(client).getCapturedTables()

    expect(tables.toSorted((a, b) => a.tableName.localeCompare(b.tableName))).toEqual([
      {
        schemaName: database.schemaName,
        tableName: 'common_contacts',
        allTables: true,
        replicaIdentityFull: true,
      },
      {
        schemaName: database.schemaName,
        tableName: 'common_users',
        allTables: true,
        replicaIdentityFull: true,
      },
    ])
  })

  test.each([false, true])(
    'keeps a table with no streams left captured (dry run: %s)',
    async dryRun => {
      const stream = live.stream({ model: 'User', slug: 'mysql-gone' })

      await stream['prepare']()
      await new Promise(resolve => setTimeout(resolve, RETENTION + 50))

      const report = await live.prune({ olderThan: RETENTION, dryRun })

      expect(report.streams.map(({ slug }) => slug)).toEqual(['mysql-gone'])
      expect(report.tables).toEqual([])
      expect(report.allTables).toContainEqual({
        table: { schema: database.schemaName, name: 'common_users' },
        redisStream: userStream,
        replicaIdentityFull: true,
      })
      expect(await redis.exists(userStream)).toBe(1)
    },
  )
})
