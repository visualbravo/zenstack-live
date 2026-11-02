// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { schema } from './schemas/basic'
import { AnyNull, DbNull, JsonNull, ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive, type DatabaseEventType } from '../src'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import hash from 'stable-hash'
import Decimal from 'decimal.js'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

beforeAll(async () => {
  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env['POSTGRES_URL'],
      }),
    }),
  })

  live = new ZenStackLive({
    client,

    redis: {
      url: process.env['REDIS_URL']!,
    },
  })

  redis = new Redis(process.env['REDIS_URL']!)

  // A table is only captured from the moment that a stream publishes it.
  await Promise.all(
    (['User', 'Contact'] as const).map(model =>
      live.stream({ model, slug: 'test-setup' })['prepare'](),
    ),
  )

  // Let Debezium flush events from earlier test files so that they don't reach these streams.
  await new Promise(resolve => setTimeout(resolve, 2000))
})

beforeEach(async () => {
  await redis.flushall()
})

afterAll(async () => {
  await client.$disconnect()
})

describe('ZenStackLive', () => {
  describe('when', () => {
    test.each([
      ['omitted', undefined],
      ['empty', {}],
    ])(
      'listens for all events when %s',
      async (name, when) => {
        const userStream = live.stream({
          model: 'User',
          slug: `test-when-${name}`,
          when,
        })

        const user = await client.user.create({
          data: {
            enum: 'USER',
          },
        })

        await client.user.update({
          data: {
            enum: 'ADMIN',
          },

          where: {
            id: user.id,
          },
        })

        await client.user.delete({
          where: {
            id: user.id,
          },
        })

        const iterations: DatabaseEventType[] = []

        for await (const event of userStream) {
          iterations.push(event.type)

          if (event.type === 'deleted') {
            break
          }
        }

        expect(iterations).toEqual(['created', 'updated', 'deleted'])
      },
      10000,
    )
  })

  describe('consume', () => {
    test('new', async () => {
      // This test leaves a read blocking, which would stall other streams sharing the connection.
      const blockingLive = new ZenStackLive({
        client,

        redis: {
          url: process.env['REDIS_URL']!,
        },
      })

      const userStream = blockingLive.stream({
        model: 'User',
        slug: 'test-consume-new',
        consume: 'new',
        when: {
          created: {},
          updated: {},
          deleted: {},
        },
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      try {
        for await (const event of userStream) {
          iterations.push(event.type)

          if (event.type === 'deleted') {
            throw new Error('Test')
          }
        }
      } catch {
        // Ensure no new events arrive within 2 seconds.
        const it = userStream[Symbol.asyncIterator]() as AsyncIterator<any>

        const result = await Promise.race<any>([
          it.next(),
          // oxlint-disable-next-line no-promise-executor-return
          new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000)),
        ])

        if (!result || result.timeout) {
          // no new events received within timeout -> test passes
        } else {
          // oxlint-disable-next-line no-lonely-if
          if (!result.done) {
            iterations.push(result.value.type)
          }
        }
      }

      blockingLive.disconnect()

      expect(iterations).toHaveLength(3)
    }, 10000)

    test('errored', async () => {
      const userStream = live.stream({
        model: 'User',
        slug: 'test-consume-errored',
        consume: 'errored',
        timeout: 2000,
        when: {
          created: {},
          updated: {},
          deleted: {},
        },
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      // Ensure no new events arrive within 2 seconds.
      const it = userStream[Symbol.asyncIterator]() as AsyncIterator<any>

      const result = await Promise.race<any>([
        it.next(),
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000)),
      ])

      if (!result || result.timeout) {
        const user = await client.user.create({
          data: {
            enum: 'USER',
          },
        })

        await client.user.update({
          data: {
            enum: 'ADMIN',
          },

          where: {
            id: user.id,
          },
        })

        await client.user.delete({
          where: {
            id: user.id,
          },
        })

        const innerUserStream = live.stream({
          model: 'User',
          slug: 'test-consume-errored',
          consume: 'new',
          when: {
            created: {},
            updated: {},
            deleted: {},
          },
        })

        try {
          for await (const event of innerUserStream) {
            iterations.push(event.type)

            if (event.type === 'deleted') {
              throw new Error()
            }
          }
        } catch {
          await new Promise(resolve => setTimeout(resolve, 2000))

          for await (const event of userStream) {
            iterations.push(event.type)

            if (event.type === 'deleted') {
              break
            }
          }

          expect(iterations).toHaveLength(4)
        }
      } else {
        // oxlint-disable-next-line no-lonely-if
        if (!result.done) {
          iterations.push(result.value.type)
        }
      }
    }, 10000)

    test('all', async () => {
      const userStream = live.stream({
        model: 'User',
        slug: 'test-consume-all',
        consume: 'all',
        timeout: 500,
        when: {
          created: {},
          updated: {},
          deleted: {},
        },
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.update({
        data: {
          enum: 'USER',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      try {
        for await (const event of userStream) {
          iterations.push(event.type)

          if (iterations.length === 3) {
            throw new Error('Test')
          }
        }
      } catch {
        // The retried event can arrive after `deleted`, so wait for the full count.
        for await (const event of userStream) {
          iterations.push(event.type)

          if (iterations.length === 5) {
            break
          }
        }
      }

      expect(iterations).toHaveLength(5)
    }, 10000)
  })

  test('retries unacknowledged events by default', async () => {
    const id = randomUUID()
    const defaultLive = new ZenStackLive({ client, redis: { url: process.env['REDIS_URL']! } })

    const stream = defaultLive.stream({
      model: 'User',
      slug: 'test-consume-default',
      timeout: 500,
      when: { created: { id } },
    })

    await client.user.create({ data: { id, enum: 'USER' } })

    const delivered: string[] = []

    try {
      for await (const event of stream) {
        delivered.push(event.id)

        throw new Error('Test')
      }
    } catch {
      const retried = await Promise.race<any>([
        stream[Symbol.asyncIterator]().next(),
        // The first claim is too soon, and the next one comes after a blocking read and a pause.
        new Promise(resolve => setTimeout(() => resolve({ value: { id: 'none' } }), 6000)),
      ])

      delivered.push(retried.value.id)
    }

    defaultLive.disconnect()

    expect(delivered).toHaveLength(2)
    expect(delivered[1]).toBe(delivered[0])
  }, 10000)

  describe('skipped events', () => {
    const streamName = 'zenstack.table.public.User'

    // These leave reads blocking, which would stall other streams sharing the connection.
    const lives: ZenStackLive<typeof schema>[] = []

    function makeLive() {
      const skippedLive = new ZenStackLive({ client, redis: { url: process.env['REDIS_URL']! } })

      lives.push(skippedLive)

      return skippedLive
    }

    async function pendingIds(hash: string) {
      const pending = (await redis.xpending(
        streamName,
        `${streamName}.${hash}`,
        '-',
        '+',
        100,
      )) as [string, ...unknown[]][]

      return pending.map(([id]) => id)
    }

    async function streamIds() {
      return (await redis.xrange(streamName, '-', '+')).map(([id]) => id)
    }

    afterEach(() => {
      for (const skippedLive of lives.splice(0)) {
        skippedLive.disconnect()
      }
    })

    test.each(['new', 'all'] as const)(
      'acknowledges events that do not match (%s)',
      async consume => {
        const matchedId = randomUUID()

        const stream = makeLive().stream({
          model: 'User',
          slug: `test-skipped-${consume}`,
          consume,
          when: { created: { id: matchedId } },
        })

        await client.user.create({ data: { enum: 'USER' } })
        await client.user.create({ data: { id: matchedId, enum: 'USER' } })

        const { value: event } = await stream[Symbol.asyncIterator]().next()

        expect(await pendingIds(stream.id)).toEqual([event.id])
        expect((await streamIds()).length).toBeGreaterThan(1)
      },
      10000,
    )

    test('leaves events that one stream skips for other streams', async () => {
      const skippingId = randomUUID()
      const wantingId = randomUUID()

      const skipping = makeLive().stream({
        model: 'User',
        slug: 'test-skipped-shared-a',
        when: { created: { id: skippingId } },
      })

      const wanting = makeLive().stream({
        model: 'User',
        slug: 'test-skipped-shared-b',
        when: { created: { id: wantingId } },
      })

      await client.user.create({ data: { id: wantingId, enum: 'USER' } })
      await client.user.create({ data: { id: skippingId, enum: 'USER' } })

      await skipping[Symbol.asyncIterator]().next()

      const { value: event } = await wanting[Symbol.asyncIterator]().next()

      expect(event.type === 'created' && event.created.id).toBe(wantingId)
    }, 10000)

    test('acknowledges tombstones', async () => {
      const id = randomUUID()

      const stream = makeLive().stream({
        model: 'User',
        slug: 'test-skipped-tombstone',
        when: { deleted: { id } },
      })

      await client.user.create({ data: { id, enum: 'USER' } })
      await client.user.delete({ where: { id } })

      // The event and its tombstone have to arrive in the same read.
      await new Promise(resolve => setTimeout(resolve, 2000))

      const { value: event } = await stream[Symbol.asyncIterator]().next()

      expect(await pendingIds(stream.id)).toEqual([event.id])
    }, 10000)
  })

  describe('shared streams', () => {
    const streamName = 'zenstack.table.public.User'

    const makeLive = (retention?: number) =>
      new ZenStackLive({ client, retention, redis: { url: process.env['REDIS_URL']! } })

    const groupName = (hash: string) => `${streamName}.${hash}`

    test('delivers an event to every stream that wants it', async () => {
      const id = randomUUID()
      const lives = [makeLive(), makeLive()]

      const [first, second] = lives.map((instance, index) =>
        instance.stream({
          model: 'User',
          slug: `test-shared-${index}`,
          when: { created: { id } },
        }),
      )

      await client.user.create({ data: { id, enum: 'USER' } })

      const firstIterator = first![Symbol.asyncIterator]()
      const { value: event } = await firstIterator.next()

      // Resuming the iterator is what acknowledges the event.
      const resumed = firstIterator.next()

      await new Promise(resolve => setTimeout(resolve, 300))

      expect(await redis.xpending(streamName, groupName(first!.id), '-', '+', 10)).toEqual([])

      const { value: other } = await second![Symbol.asyncIterator]().next()

      expect(other.id).toBe(event.id)

      for (const instance of lives) {
        instance.disconnect()
      }

      // Disconnecting rejects the read that the resumed iterator is blocked on.
      await Promise.allSettled([resumed])
    }, 10000)

    test('trims events older than the retention period', async () => {
      const id = randomUUID()
      const instance = makeLive(1000)

      const stream = instance.stream({
        model: 'User',
        slug: 'test-shared-trim',
        when: { created: { id } },
      })

      const oldId = (await redis.xadd(streamName, '*', 'key', 'default'))!

      await new Promise(resolve => setTimeout(resolve, 1200))
      await client.user.create({ data: { id, enum: 'USER' } })

      const { value: event } = await stream[Symbol.asyncIterator]().next()
      const ids = (await redis.xrange(streamName, '-', '+')).map(([entryId]) => entryId)

      expect(ids).not.toContain(oldId)
      expect(ids).toContain(event.id)

      instance.disconnect()
    }, 10000)

    test('keeps events within the retention period', async () => {
      const id = randomUUID()
      const instance = makeLive()

      const stream = instance.stream({
        model: 'User',
        slug: 'test-shared-keep',
        when: { created: { id } },
      })

      const recentId = (await redis.xadd(streamName, '*', 'key', 'default'))!

      await client.user.create({ data: { id, enum: 'USER' } })
      await stream[Symbol.asyncIterator]().next()

      expect((await redis.xrange(streamName, '-', '+')).map(([entryId]) => entryId)).toContain(
        recentId,
      )

      instance.disconnect()
    }, 10000)

    test('drops pending events once they have been trimmed', async () => {
      const id = randomUUID()
      const instance = makeLive(1000)

      const stream = instance.stream({
        model: 'User',
        slug: 'test-shared-pending',
        when: { created: { id } },
      })

      const group = groupName(stream.id)

      // The group has to exist first, and this leaves an old entry pending for another instance.
      await new Promise(resolve => setTimeout(resolve, 300))

      const oldId = (await redis.xadd(streamName, '*', 'key', 'default'))!

      await redis.xreadgroup('GROUP', group, 'other', 'STREAMS', streamName, '>')
      await new Promise(resolve => setTimeout(resolve, 1200))
      await client.user.create({ data: { id, enum: 'USER' } })

      const { value: event } = await stream[Symbol.asyncIterator]().next()
      const pending = (await redis.xpending(streamName, group, '-', '+', 10)) as [string][]

      expect(pending.map(([entryId]) => entryId)).toEqual([event.id])
      expect(pending.map(([entryId]) => entryId)).not.toContain(oldId)

      instance.disconnect()
    }, 10000)

    test.each(['errored', 'all'] as const)(
      'survives claiming an entry that no longer exists (%s)',
      async consume => {
        const id = randomUUID()
        const instance = makeLive()

        const stream = instance.stream({
          model: 'User',
          slug: `test-shared-missing-${consume}`,
          consume,
          timeout: 1,
          when: { created: { id } },
        })

        const group = groupName(stream.id)

        await new Promise(resolve => setTimeout(resolve, 300))

        const missingId = (await redis.xadd(streamName, '*', 'key', 'default'))!

        await redis.xreadgroup('GROUP', group, 'other', 'STREAMS', streamName, '>')
        await redis.xdel(streamName, missingId)
        await client.user.create({ data: { id, enum: 'USER' } })

        // Debezium has to deliver the event before it can be left pending.
        await new Promise(resolve => setTimeout(resolve, 1500))
        await redis.xreadgroup('GROUP', group, 'other', 'STREAMS', streamName, '>')
        await new Promise(resolve => setTimeout(resolve, 20))

        const { value: event } = await stream[Symbol.asyncIterator]().next()

        expect(event.type === 'created' && event.created.id).toBe(id)

        instance.disconnect()
      },
      10000,
    )
  })

  describe('horizontal scaling', () => {
    test.each(['new', 'all'] as const)(
      'delivers each event to one instance (%s)',
      async consume => {
        const instances = [
          new ZenStackLive({ client, id: 'one', redis: { url: process.env['REDIS_URL']! } }),
          new ZenStackLive({ client, id: 'two', redis: { url: process.env['REDIS_URL']! } }),
        ]

        const delivered: string[] = []
        const ids = Array.from({ length: 12 }, () => randomUUID())

        const consumers = instances.map(async instance => {
          const stream = instance.stream({
            model: 'User',
            slug: `test-scaling-${consume}`,
            consume,
            when: { created: { id: { in: ids } } },
          })

          for await (const event of stream) {
            delivered.push(event.created.id)

            // Long enough for the other instance to try to claim this event.
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        })

        for (const id of ids) {
          await client.user.create({ data: { id, enum: 'USER' } })
        }

        await new Promise(resolve => setTimeout(resolve, 4000))

        for (const instance of instances) {
          instance.disconnect()
        }

        await Promise.allSettled(consumers)

        expect(delivered.toSorted()).toEqual(ids.toSorted())
      },
      10000,
    )
  })

  describe('hash', () => {
    const filter = (created: unknown) =>
      live.stream({ model: 'Contact', slug: 'test-hash', when: { created: created as any } }).id

    test.each<[string, () => unknown]>([
      ['Decimal', () => ({ balance: new Decimal('1.5') })],
      ['Decimal in a list', () => ({ balance: { in: [new Decimal('1.5')] } })],
      ['Decimal in a logical operator', () => ({ OR: [{ balance: new Decimal('1.5') }] })],
      ['Bytes', () => ({ avatar: new Uint8Array([1, 2]) })],
      ['JsonNull', () => ({ metadata: { equals: JsonNull } })],
      ['DbNull', () => ({ metadata: { equals: DbNull } })],
      ['AnyNull', () => ({ metadata: { equals: AnyNull } })],
    ])('hashes %s by value', (_, created) => {
      // `stable-hash` marks values it can only tell apart by a counter, which differs per process.
      expect(filter(created())).not.toContain('~')
      expect(filter(created())).toBe(filter(created()))
    })

    test.each<[string, unknown, unknown]>([
      ['Decimal', { balance: new Decimal(1) }, { balance: new Decimal(2) }],
      ['Bytes', { avatar: new Uint8Array([1]) }, { avatar: new Uint8Array([2]) }],
      ['JSON nulls', { metadata: { equals: JsonNull } }, { metadata: { equals: DbNull } }],
    ])('tells different %s apart', (_, left, right) => {
      expect(filter(left)).not.toBe(filter(right))
    })

    test('treats equal decimals as the same filter', () => {
      expect(filter({ balance: new Decimal('1.50') })).toBe(filter({ balance: new Decimal('1.5') }))
    })

    // A different hash means a different consumer group, which would skip any unread events.
    test.each<[string, unknown]>([
      ['no filter', undefined],
      ['scalars', { age: { gt: 5 }, email: 'a@example.com' }],
      ['logical operators', { OR: [{ age: 1 }, { NOT: { age: null } }] }],
      ['dates', { lastSeen: { gt: new Date(0) } }],
    ])('keeps the hash of %s', (_, created) => {
      expect(filter(created)).toBe(
        hash({
          id: 'test-hash',
          model: 'Contact',
          created,
          updated: undefined,
          deleted: undefined,
        }),
      )
    })
  })

  test('rejects an invalid DateTime filter when the stream is created', () => {
    expect(() =>
      live.stream({
        model: 'User',
        slug: 'test-invalid-date-time',
        when: { created: { dateTime: { gt: 'not a date' } } },
      }),
    ).toThrow('Invalid exists args')
  })

  describe('custom types', () => {
    const joinedAt = new Date('2024-01-01T00:00:00.000Z')

    const address = {
      city: 'Hanoi',
      geo: { lat: 21.5, lng: 105 },
      tags: ['home'],
      role: 'ADMIN' as const,
      movedAt: joinedAt,
    }

    beforeEach(async () => {
      await client.contact.deleteMany()
    })

    test('hydrates events', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-hydrate',
        when: {
          created: {
            profile: { name: 'Ada', address: { geo: { lat: { gt: 21 } } } },
          },
        },
      })

      await client.contact.create({
        data: { email: 'b@example.com', profile: { name: 'Bob', addresses: [] }, addresses: [] },
      })

      await client.contact.create({
        data: {
          email: 'a@example.com',
          emails: ['a@example.com', 'b@example.com'],
          age: 30,
          balance: new Decimal('10.5'),
          visits: 9007199254740993n,
          lastSeen: joinedAt,
          profile: {
            name: 'Ada',
            age: 30,
            joinedAt,
            balance: new Decimal('10.5'),
            address,
            addresses: [address],
          },
          addresses: [address],
        },
      })

      for await (const event of stream) {
        const contact = event.created

        expect(contact.email).toBe('a@example.com')
        expect(contact.emails).toEqual(['a@example.com', 'b@example.com'])
        expect(contact.age).toBe(30)
        expect(contact.balance).toEqual(new Decimal('10.5'))
        expect(contact.visits).toBe(9007199254740993n)
        expect(contact.lastSeen).toEqual(joinedAt)
        expect(contact.createdAt).toBeInstanceOf(Date)
        expect(contact.profile).toEqual({
          name: 'Ada',
          age: 30,
          joinedAt,
          balance: new Decimal('10.5'),
          address,
          addresses: [address],
        })
        expect(contact.addresses).toEqual([address])

        break
      }
    }, 10000)

    test('hydrates plain json', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-plain-json',
        when: { created: {} },
      })

      const metadata = { plan: 'pro', limits: [1, 2], nested: { ok: true } }
      const history = [{ event: 'joined' }, 'text', 1]

      await client.contact.create({
        data: { email: 'a@example.com', addresses: [], metadata, history },
      })

      for await (const event of stream) {
        expect(event.created.metadata).toEqual(metadata)
        expect(event.created.history).toEqual(history)

        break
      }
    }, 10000)

    test.each<[string, string]>([
      ['string', '"text"'],
      ['number', '0'],
      ['boolean', 'false'],
    ])(
      'hydrates plain json holding a %s',
      async (type, json) => {
        const stream = live.stream({
          model: 'Contact',
          slug: `test-custom-types-plain-json-${type}`,
          when: { created: {} },
        })

        await client.$queryRawUnsafe(
          `INSERT INTO "Contact" (id, email, emails, addresses, history, metadata)
         VALUES ('scalar', 'a@example.com', '{}', '[]', '{}', '${json}')`,
        )

        for await (const event of stream) {
          expect(event.created.metadata).toBe(JSON.parse(json))

          break
        }
      },
      10000,
    )

    test('hydrates null plain json', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-plain-json-null',
        when: { created: {} },
      })

      await client.contact.create({ data: { email: 'a@example.com', addresses: [] } })

      for await (const event of stream) {
        expect(event.created.metadata).toBeNull()
        expect(event.created.history).toEqual([])

        break
      }
    }, 10000)

    test('hydrates bytes and date arrays', async () => {
      const avatar = new Uint8Array([1, 2, 255])

      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-bytes',
        when: { created: { avatar: { equals: avatar }, seenAt: { has: joinedAt } } },
      })

      await client.contact.create({
        data: { email: 'b@example.com', addresses: [], avatar: new Uint8Array([1]) },
      })

      await client.contact.create({
        data: { email: 'a@example.com', addresses: [], avatar, seenAt: [joinedAt] },
      })

      for await (const event of stream) {
        expect(event.created.avatar).toEqual(avatar)
        expect(event.created.seenAt).toEqual([joinedAt])

        break
      }
    }, 10000)

    test('keeps the precision of decimals', async () => {
      const balance = new Decimal('1234567890.12345678901234567890123456')

      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-decimal',
        when: { created: { balance: { equals: balance.toString() as any } } },
      })

      await client.contact.create({ data: { email: 'a@example.com', addresses: [], balance } })

      for await (const event of stream) {
        expect(event.created.balance?.toString()).toBe(balance.toString())

        break
      }
    }, 10000)

    test.each<[string, unknown, string]>([
      ['JsonNull', JsonNull, 'json'],
      ['DbNull', DbNull, 'db'],
    ])(
      'tells %s apart',
      async (_, equals, expected) => {
        const stream = live.stream({
          model: 'Contact',
          slug: `test-custom-types-${expected}-null`,
          when: { created: { metadata: { equals } as any } },
        })

        await client.$queryRawUnsafe(
          `INSERT INTO "Contact" (id, email, addresses, metadata)
         VALUES ('json', 'a@example.com', '[]', 'null'), ('db', 'b@example.com', '[]', NULL)`,
        )

        for await (const event of stream) {
          expect(event.created.id).toBe(expected)
          expect(event.created.metadata).toBeNull()

          break
        }
      },
      10000,
    )

    test('matches a NULL array like the database', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-null-array',
        when: { created: { emails: { isEmpty: true } } },
      })

      await client.$queryRawUnsafe(
        `INSERT INTO "Contact" (id, email, addresses, emails)
         VALUES ('null', 'a@example.com', '[]', NULL), ('empty', 'b@example.com', '[]', '{}')`,
      )

      for await (const event of stream) {
        expect(event.created.id).toBe('empty')

        break
      }
    }, 10000)

    test('hydrates null json', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-null',
        when: { created: { profile: null } },
      })

      await client.contact.create({ data: { email: 'a@example.com', addresses: [] } })

      for await (const event of stream) {
        expect(event.created.profile).toBeNull()

        break
      }
    }, 10000)

    test('survives json that does not match its type', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-malformed',
        when: { created: {} },
      })

      const profile = {
        name: 'Ada',
        balance: 'not a decimal',
        address: 'not an object',
        addresses: 'not an array',
      }

      await client.$queryRawUnsafe(
        `INSERT INTO "Contact" (id, email, emails, addresses, history, profile)
         VALUES ('malformed', 'a@example.com', '{}', '[]', '{}', '${JSON.stringify(profile)}')`,
      )

      for await (const event of stream) {
        expect(event.created.profile).toEqual(profile)

        break
      }
    }, 10000)

    test('keeps large json that is unchanged by an update', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-toast',
        when: { updated: {} },
      })

      // Random text can't be compressed, so Postgres has to store this out of line.
      const name = Array.from({ length: 2000 }, () => Math.random().toString(36)).join('')

      const contact = await client.contact.create({
        data: { email: 'a@example.com', profile: { name, addresses: [] }, addresses: [] },
      })

      await client.contact.update({ where: { id: contact.id }, data: { age: 30 } })

      for await (const event of stream) {
        expect(event.updated.before.profile?.name).toBe(name)
        expect(event.updated.after.profile?.name).toBe(name)

        break
      }
    }, 10000)
  })
})
