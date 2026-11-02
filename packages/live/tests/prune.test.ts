// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { schema } from './schemas/basic'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive } from '../src'
import { Redis } from 'ioredis'
import { createIsolatedDatabase } from './isolated-database'

const PUBLICATION = 'zenstack_live'
const RETENTION = 300
const USER_STREAM = 'zenstack.table.public.User'
const CONTACT_STREAM = 'zenstack.table.public.Contact'

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

// An empty claim counts as activity the same way that a read does, except that it doesn't block.
async function read(stream: Awaited<ReturnType<typeof prepareStream>>) {
  await stream['getErroredEvents']()
}

// Leaves events pending on the stream's consumer.
async function deliver(stream: Awaited<ReturnType<typeof prepareStream>>) {
  await redis.xreadgroup(
    'GROUP',
    stream['consumerGroupName'],
    stream['consumerName'],
    'COUNT',
    5,
    'STREAMS',
    stream['streamName'],
    '>',
  )
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
        connectionString: await createIsolatedDatabase('zenstack_live_test_prune'),
      }),
    }),
  })

  await client.$pushSchema()

  redis = new Redis(process.env['REDIS_URL']!)
})

beforeEach(async () => {
  await redis.flushall()
  await client.$queryRawUnsafe(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
})

afterEach(() => {
  for (const live of instances.splice(0)) {
    live.disconnect()
  }
})

afterAll(async () => {
  await client.$queryRawUnsafe(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
  await redis.flushall()
  redis.disconnect()
  await client.$disconnect()
})

describe('prune', () => {
  test('rejects olderThan shorter than retention', async () => {
    await expect(makeLive().prune({ olderThan: RETENTION - 1 })).rejects.toThrow(/olderThan/u)
  })

  test('keeps a stream on a quiet table that is still being read', async () => {
    const live = makeLive()
    const stream = await prepareStream(live, 'quiet')

    await read(stream)
    await sleep(RETENTION + 50)
    await read(stream)

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.streams).toEqual([])
    expect(report.tables).toEqual([])
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
    expect(await isPublished('User')).toBe(true)
  })

  test('keeps a new stream that has not been read yet', async () => {
    const live = makeLive()

    await prepareStream(live, 'unread')

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.streams).toEqual([])
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
  })

  test('removes the stream of an edited filter, and keeps the new one', async () => {
    const live = makeLive()

    await prepareStream(live, 'edited', { created: { enum: 'USER' } })
    await sleep(RETENTION + 50)

    const current = await prepareStream(live, 'edited', { created: { enum: 'ADMIN' } })

    await read(current)

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.streams.map(({ slug, model }) => [slug, model])).toEqual([['edited', 'User']])
    expect(report.streams[0]!.consumerGroup).toContain('USER')
    expect(report.tables).toEqual([])
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
    expect(await isPublished('User')).toBe(true)
    expect(await redis.hlen('zenstack.metadata.streams')).toBe(1)
  })

  test('removes an orphaned stream along with its pending events', async () => {
    const live = makeLive()
    const stream = await prepareStream(live, 'orphan')
    const other = await prepareStream(live, 'other')

    await redis.xadd(USER_STREAM, '*', 'key', 'value')
    await deliver(stream)
    await sleep(RETENTION + 50)
    await read(other)

    const { streams } = await live.prune({ olderThan: RETENTION })

    expect(streams.map(({ slug }) => slug)).toEqual(['orphan'])
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
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
    expect(await redis.hlen('zenstack.metadata.streams')).toBe(0)
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

  test('changes nothing during a dry run', async () => {
    const live = makeLive()

    await prepareStream(live, 'gone')
    await sleep(RETENTION + 50)

    const report = await live.prune({ olderThan: RETENTION, dryRun: true })

    expect(report.dryRun).toBe(true)
    expect(report.streams.map(({ slug }) => slug)).toEqual(['gone'])
    expect(report.tables.map(({ redisStream }) => redisStream)).toEqual([USER_STREAM])
    expect(await groupsOf(USER_STREAM)).toHaveLength(1)
    expect(await isPublished('User')).toBe(true)
    expect(await redis.hlen('zenstack.metadata.streams')).toBe(1)
  })

  test('respects a longer retention recorded by another service', async () => {
    const longRetention = makeLive({ retention: 60_000 })
    const live = makeLive()

    await prepareStream(longRetention, 'long')
    await sleep(RETENTION + 50)

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.streams).toEqual([])
    expect(report.tables).toEqual([])
    expect(await isPublished('User')).toBe(true)
  })

  test('removes idle consumers with nothing pending', async () => {
    const oldInstance = makeLive({ id: 'old' })
    const pendingInstance = makeLive({ id: 'pending' })
    const newInstance = makeLive({ id: 'new' })
    const oldStream = await prepareStream(oldInstance, 'scaled')
    const pendingStream = await prepareStream(pendingInstance, 'scaled')
    const newStream = await prepareStream(newInstance, 'scaled')

    await read(oldStream)
    await redis.xadd(USER_STREAM, '*', 'key', 'value')
    await deliver(pendingStream)
    await sleep(RETENTION + 50)
    await read(newStream)

    const { streams, consumers } = await newInstance.prune({ olderThan: RETENTION })
    const remaining = (await redis.xinfo(
      'CONSUMERS',
      USER_STREAM,
      await redis.hkeys('zenstack.metadata.streams').then(([consumerGroup]) => consumerGroup!),
    )) as string[][]

    expect(streams).toEqual([])
    expect(consumers.map(({ name }) => name)).toEqual(['zenstack.old'])
    expect(remaining.map(consumer => consumer[1]).sort()).toEqual([
      'zenstack.new',
      'zenstack.pending',
    ])
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

  test('keeps a group that has no consumers and no record', async () => {
    const live = makeLive()

    await redis.xgroup('CREATE', CONTACT_STREAM, 'unrecorded', '$', 'MKSTREAM')

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.unknownStreams.map(({ consumerGroup }) => consumerGroup)).toEqual(['unrecorded'])
    expect(report.tables).toEqual([])
    expect(await redis.exists(CONTACT_STREAM)).toBe(1)
  })

  test('restores the table if a stream comes back while it is being removed', async () => {
    const live = makeLive()

    await prepareStream(live, 'racing')
    await sleep(RETENTION + 50)

    const update = live['updatePublication'].bind(live)
    const spy = vi.spyOn(live as any, 'updatePublication')

    spy.mockImplementationOnce(async (...args: any[]) => {
      await (update as any)(...args)
      await redis.xgroup('CREATE', USER_STREAM, 'returned', '$', 'MKSTREAM')
    })

    const report = await live.prune({ olderThan: RETENTION })

    expect(report.tables).toEqual([])
    expect(await isPublished('User')).toBe(true)
    expect(await redis.exists(USER_STREAM)).toBe(1)
  })
})

describe('trimming', () => {
  const oldEntry = () => `${Date.now() - 3_600_000}-0`

  test('trims a published table with no streams', async () => {
    const live = makeLive()

    await prepareStream(live, 'gone')
    await redis.hdel(
      'zenstack.metadata.streams',
      ...(await redis.hkeys('zenstack.metadata.streams')),
    )
    await redis.xadd(USER_STREAM, oldEntry(), 'key', 'value')
    await redis.xadd(USER_STREAM, '*', 'key', 'value')
    await live['trimTables']()

    expect(await redis.xlen(USER_STREAM)).toBe(1)
  })

  test('keeps events for the longest retention recorded for a table', async () => {
    const longRetention = makeLive({ retention: 2 * 3_600_000 })
    const live = makeLive()

    await prepareStream(longRetention, 'long')
    await prepareStream(live, 'short')
    await redis.xadd(USER_STREAM, oldEntry(), 'key', 'value')
    await live['trimTables']()

    expect(await redis.xlen(USER_STREAM)).toBe(1)
  })

  test('runs without being blocked by a stream reading', async () => {
    const live = makeLive()
    const stream = await prepareStream(live, 'blocking')
    const reading = stream['getNewEvents']()
    const started = Date.now()

    await live['trimTables']()

    expect(Date.now() - started).toBeLessThan(500)
    await reading
  })
})

describe('consume new', () => {
  test('keeps polling on a quiet table, so that it stays visible to prune', async () => {
    const live = makeLive()
    const stream = await prepareStream(live, 'quiet-new')
    const started = Date.now()

    await stream['getNewEvents']()

    expect(Date.now() - started).toBeLessThan(2500)
  }, 5000)
})
