// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { schema } from './schemas/basic'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive } from '../../src'
import { Redis } from 'ioredis'
import { clearRedis } from '../helpers/clear-redis'
import { postgres } from '../helpers/dialects'

const PUBLICATION = 'zenstack_live'
const RETENTION = 300
const USER_STREAM = 'zenstack.postgres.table.public.User'
const CONTACT_STREAM = 'zenstack.postgres.table.public.Contact'

let client: ClientContract<typeof schema>
let redis: Redis
const instances: ZenStackLive<typeof schema>[] = []

function makeLive(options: { retention?: number; id?: string } = {}): ZenStackLive<typeof schema> {
  const live = new ZenStackLive({
    client,
    retention: RETENTION,
    ...options,

    redis: {
      url: process.env['REDIS_URL']!,
    },
  })

  instances.push(live)

  return live
}

async function prepareStream(
  live: ZenStackLive<typeof schema>,
  slug: string,
  when?: { created?: object },
) {
  const stream = live.stream({ model: 'User', slug, when: when as {} })

  await stream['prepare']()

  return stream
}

async function isPublished(table: string) {
  const rows = await client.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM pg_publication_tables WHERE pubname = '${PUBLICATION}' AND tablename = '${table}'`,
  )

  return rows.length > 0
}

function groupsOf(streamName: string) {
  return redis.xinfo('GROUPS', streamName).catch(() => []) as Promise<unknown[]>
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

beforeAll(async () => {
  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: await postgres.createIsolatedDatabase('zenstack_live_test_prune'),
      }),
    }),
  })

  await client.$pushSchema()

  redis = new Redis(process.env['REDIS_URL']!)
})

beforeEach(async () => {
  await clearRedis(redis, 'postgres')
  await client.$queryRawUnsafe(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
})

afterEach(() => {
  for (const live of instances.splice(0)) {
    live.disconnect()
  }
})

afterAll(async () => {
  await client.$queryRawUnsafe(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
  await clearRedis(redis, 'postgres')
  redis.disconnect()
  await client.$disconnect()
})

// What `prune` does with the publication. Streams, consumers and trimming are in `common/prune`.
describe('publication', () => {
  test('keeps a table published while it still has a stream', async () => {
    const live = makeLive()

    await prepareStream(live, 'kept')
    await sleep(RETENTION + 50)
    await prepareStream(live, 'current')

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.streams.map(({ slug }) => slug)).toEqual(['kept'])
    expect(report.tables).toEqual([])
    expect(await isPublished('User')).toBe(true)
  })

  test('reports the table it would drop during a dry run, and keeps it published', async () => {
    const live = makeLive()

    await prepareStream(live, 'gone')
    await sleep(RETENTION + 50)

    const report = await live.prune({ olderThan: RETENTION, dryRun: true })

    expect(report.tables.map(({ redisStream }) => redisStream)).toEqual([USER_STREAM])
    expect(await isPublished('User')).toBe(true)
  })

  test('drops a table with no streams left, and reports its replica identity', async () => {
    const live = makeLive()

    await prepareStream(live, 'gone')
    await sleep(RETENTION + 50)

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.tables).toEqual([
      {
        table: { schema: 'public', name: 'User' },
        redisStream: USER_STREAM,
        replicaIdentityFull: true,
      },
    ])

    expect(await isPublished('User')).toBe(false)
    expect(await redis.exists(USER_STREAM)).toBe(0)
    expect(await redis.hlen('zenstack.postgres.metadata.streams')).toBe(0)
  })

  test('captures a table again when a stream comes back', async () => {
    const live = makeLive()

    await prepareStream(live, 'returning')
    await sleep(RETENTION + 50)
    await live.prune({ olderThan: RETENTION })
    await prepareStream(live, 'returning')

    expect(await isPublished('User')).toBe(true)
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
  })

  test('only reports tables under FOR ALL TABLES', async () => {
    await client.$queryRawUnsafe(`CREATE PUBLICATION ${PUBLICATION} FOR ALL TABLES`)

    const live = makeLive()

    await prepareStream(live, 'gone')
    await sleep(RETENTION + 50)

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.tables).toEqual([])
    expect(report.streams.map(({ slug }) => slug)).toEqual(['gone'])
    expect(report.allTables.map(({ redisStream }) => redisStream)).toContain(USER_STREAM)
    expect(await isPublished('User')).toBe(true)
  })

  test('deletes Redis streams of tables that are no longer published', async () => {
    const live = makeLive()

    await redis.xadd(CONTACT_STREAM, '*', 'key', 'value')

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.tables).toEqual([
      { table: undefined, redisStream: CONTACT_STREAM, replicaIdentityFull: false },
    ])

    expect(await redis.exists(CONTACT_STREAM)).toBe(0)
  })

  test('restores the table if a stream comes back while it is being removed', async () => {
    const live = makeLive()

    await prepareStream(live, 'racing')
    await sleep(RETENTION + 50)

    const {database} = live
    const release = database.releaseTable.bind(database)

    vi.spyOn(database, 'releaseTable').mockImplementationOnce(async table => {
      await release(table)
      await redis.xgroup('CREATE', USER_STREAM, 'returned', '$', 'MKSTREAM')
    })

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.tables).toEqual([])
    expect(await isPublished('User')).toBe(true)
    expect(await redis.exists(USER_STREAM)).toBe(1)
  })
})
