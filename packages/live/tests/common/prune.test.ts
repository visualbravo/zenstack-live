// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { schema } from './schema'
import type { ClientContract } from '@zenstackhq/orm'
import { ZenStackLive } from '../../src'
import { Redis } from 'ioredis'
import { clearRedis } from '../helpers/clear-redis'
import { createTestDatabase, dialects, type TestDatabase } from '../helpers/dialects'

const RETENTION = 300

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// What `prune` does with streams, consumers and events is the same for every dialect. What it does
// with the tables they leave behind isn't, so that's tested for each dialect on its own.
describe.each(dialects)('prune on $name', dialect => {
  let database: TestDatabase<typeof schema>
  let client: ClientContract<typeof schema>
  let redis: Redis
  let userStream: string
  let contactStream: string
  const instances: ZenStackLive<typeof schema>[] = []

  function makeLive(options: { retention?: number; id?: string } = {}) {
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

  function groupsOf(streamName: string) {
    return redis.xinfo('GROUPS', streamName).catch(() => []) as Promise<unknown[]>
  }

  // An isolated database keeps Debezium from writing to the streams these tests inspect.
  beforeAll(async () => {
    database = await createTestDatabase(dialect, schema, {
      isolated: 'zenstack_live_test_common_prune',
    })
    client = database.client
    userStream = database.streamName('common_users')
    contactStream = database.streamName('common_contacts')
    redis = new Redis(process.env['REDIS_URL']!)
  }, 15000)

  beforeEach(async () => {
    await clearRedis(redis, dialect.name)
  })

  afterEach(() => {
    for (const live of instances.splice(0)) {
      live.disconnect()
    }
  })

  afterAll(async () => {
    await clearRedis(redis, dialect.name)
    redis?.disconnect()
    await client?.$disconnect()
  })

  describe('streams', () => {
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
      expect(await groupsOf(userStream)).toHaveLength(1)
    })

    test('keeps a new stream that has not been read yet', async () => {
      const live = makeLive()

      await prepareStream(live, 'unread')

      const report = await live.prune({ olderThan: RETENTION })

      expect(report.streams).toEqual([])
      expect(await groupsOf(userStream)).toHaveLength(1)
    })

    test('removes the stream of an edited filter, and keeps the new one', async () => {
      const live = makeLive()

      await prepareStream(live, 'edited', { created: { enum: 'FREE' } })
      await sleep(RETENTION + 50)

      const current = await prepareStream(live, 'edited', { created: { enum: 'PRO' } })

      await read(current)

      const report = await live.prune({ olderThan: RETENTION })

      expect(report.streams.map(({ slug, model }) => [slug, model])).toEqual([['edited', 'User']])
      expect(report.streams[0]!.consumerGroup).toContain('FREE')
      expect(report.tables).toEqual([])
      expect(await groupsOf(userStream)).toHaveLength(1)
      expect(await redis.hlen(database.recordedStreams)).toBe(1)
    })

    test('removes an orphaned stream along with its pending events', async () => {
      const live = makeLive()
      const stream = await prepareStream(live, 'orphan')
      const other = await prepareStream(live, 'other')

      await redis.xadd(userStream, '*', 'key', 'value')
      await deliver(stream)
      await sleep(RETENTION + 50)
      await read(other)

      const { streams } = await live.prune({ olderThan: RETENTION })

      expect(streams.map(({ slug }) => slug)).toEqual(['orphan'])
      expect(await groupsOf(userStream)).toHaveLength(1)
    })

    test('changes nothing during a dry run', async () => {
      const live = makeLive()

      await prepareStream(live, 'gone')
      await sleep(RETENTION + 50)

      const report = await live.prune({ olderThan: RETENTION, dryRun: true })

      expect(report.dryRun).toBe(true)
      expect(report.streams.map(({ slug }) => slug)).toEqual(['gone'])
      expect(await groupsOf(userStream)).toHaveLength(1)
      expect(await redis.hlen(database.recordedStreams)).toBe(1)
    })

    test('respects a longer retention recorded by another service', async () => {
      const longRetention = makeLive({ retention: 60_000 })
      const live = makeLive()

      await prepareStream(longRetention, 'long')
      await sleep(RETENTION + 50)

      const report = await live.prune({ olderThan: RETENTION })

      expect(report.streams).toEqual([])
      expect(report.tables).toEqual([])
    })

    test('removes idle consumers with nothing pending', async () => {
      const oldInstance = makeLive({ id: 'old' })
      const pendingInstance = makeLive({ id: 'pending' })
      const newInstance = makeLive({ id: 'new' })
      const oldStream = await prepareStream(oldInstance, 'scaled')
      const pendingStream = await prepareStream(pendingInstance, 'scaled')
      const newStream = await prepareStream(newInstance, 'scaled')

      await read(oldStream)
      await redis.xadd(userStream, '*', 'key', 'value')
      await deliver(pendingStream)
      await sleep(RETENTION + 50)
      await read(newStream)

      const { streams, consumers } = await newInstance.prune({ olderThan: RETENTION })
      const remaining = (await redis.xinfo(
        'CONSUMERS',
        userStream,
        await redis.hkeys(database.recordedStreams).then(([consumerGroup]) => consumerGroup!),
      )) as string[][]

      expect(streams).toEqual([])
      expect(consumers.map(({ name }) => name)).toEqual(['zenstack.old'])
      expect(remaining.map(consumer => consumer[1]).sort()).toEqual([
        'zenstack.new',
        'zenstack.pending',
      ])
    })

    test('keeps a group that has no consumers and no record', async () => {
      const live = makeLive()

      await redis.xgroup('CREATE', contactStream, 'unrecorded', '$', 'MKSTREAM')

      const report = await live.prune({ olderThan: RETENTION })

      expect(report.unknownStreams.map(({ consumerGroup }) => consumerGroup)).toEqual([
        'unrecorded',
      ])
      expect(report.tables.map(({ redisStream }) => redisStream)).not.toContain(contactStream)
      expect(await redis.exists(contactStream)).toBe(1)
    })
  })

  describe('trimming', () => {
    const oldEntry = () => `${Date.now() - 3_600_000}-0`

    test('trims a captured table with no streams', async () => {
      const live = makeLive()

      await prepareStream(live, 'gone')
      await redis.hdel(database.recordedStreams, ...(await redis.hkeys(database.recordedStreams)))
      await redis.xadd(userStream, oldEntry(), 'key', 'value')
      await redis.xadd(userStream, '*', 'key', 'value')
      await live['trimTables']()

      expect(await redis.xlen(userStream)).toBe(1)
    })

    test('keeps events for the longest retention recorded for a table', async () => {
      const longRetention = makeLive({ retention: 2 * 3_600_000 })
      const live = makeLive()

      await prepareStream(longRetention, 'long')
      await prepareStream(live, 'short')
      await redis.xadd(userStream, oldEntry(), 'key', 'value')
      await live['trimTables']()

      expect(await redis.xlen(userStream)).toBe(1)
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
})
