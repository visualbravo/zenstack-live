// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { schema } from './schema'
import { DbNull, JsonNull, type ClientContract } from '@zenstackhq/orm'
import { ZenStackLive } from '../../src'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import { clearRedis } from '../helpers/clear-redis'
import { createTestDatabase, dialects } from '../helpers/dialects'

async function first<T>(stream: AsyncIterable<T>) {
  for await (const event of stream) {
    return event
  }

  throw new Error('The stream ended without an event')
}

// Collects events until there are `count`, or nothing more arrives in time.
async function take<T>(stream: AsyncIterable<T>, count: number, timeout = 4000) {
  const events: T[] = []
  const iterator = stream[Symbol.asyncIterator]()
  const deadline = Date.now() + timeout

  while (events.length < count) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now())),
    ])

    if (!next || next.done) {
      break
    }

    events.push(next.value)
  }

  return events
}

describe.each(dialects)('hydration on $name', dialect => {
  let client: ClientContract<typeof schema>
  let live: ZenStackLive<typeof schema>
  let redis: Redis

  beforeAll(async () => {
    client = (await createTestDatabase(dialect, schema)).client
    live = new ZenStackLive({ client, redis: { url: process.env['REDIS_URL']! } })
    redis = new Redis(process.env['REDIS_URL']!)

    await Promise.all(
      (['User', 'Contact'] as const).map(model =>
        live.stream({ model, slug: 'test-setup' })['prepare'](),
      ),
    )

    // Let Debezium catch up with the tables being created, so that nothing earlier reaches these.
    await new Promise(resolve => setTimeout(resolve, 2000))
  }, 15000)

  beforeEach(async () => {
    await clearRedis(redis, dialect.name)
    await client.user.deleteMany()
    await client.contact.deleteMany()
  })

  afterAll(async () => {
    live?.disconnect()
    redis?.disconnect()
    await client?.$disconnect()
  })

  describe('scalars', () => {
    test('hydrates every type of field', async () => {
      const stream = live.stream({
        model: 'User',
        slug: 'test-hydrate-scalars',
        when: { created: {} },
      })

      const user = await client.user.create({
        data: {
          string: 'hello',
          boolean: true,
          int: 42,
          float: 1.5,
          dateTime: new Date('2024-01-02T03:04:05.678Z'),
          bigInt: 9007199254740993n,
          decimal: new Decimal('1.25'),
          bytes: new Uint8Array([1, 2, 255]),
          json: { nested: [1, 'two'] },
          enum: 'FREE',
          displayName: 'Ada',
        },
      })

      const event = await first(stream)

      expect(event.type === 'created' && event.created).toEqual({
        id: user.id,
        string: 'hello',
        boolean: true,
        int: 42,
        float: 1.5,
        dateTime: new Date('2024-01-02T03:04:05.678Z'),
        bigInt: 9007199254740993n,
        decimal: new Decimal('1.25'),
        bytes: new Uint8Array([1, 2, 255]),
        json: { nested: [1, 'two'] },
        enum: 'FREE',
        displayName: 'Ada',
      })
    }, 10000)

    test('hydrates both sides of an update', async () => {
      const stream = live.stream({
        model: 'User',
        slug: 'test-hydrate-update',
        when: { updated: {} },
      })
      const user = await client.user.create({ data: { boolean: true, enum: 'FREE' } })

      await client.user.update({ where: { id: user.id }, data: { boolean: false, enum: 'PRO' } })

      const event = await first(stream)

      expect(event.updated.before).toMatchObject({ boolean: true, enum: 'FREE' })
      expect(event.updated.after).toMatchObject({ boolean: false, enum: 'PRO' })
    }, 10000)

    test('hydrates a deleted record', async () => {
      const user = await client.user.create({ data: { displayName: 'Ada', enum: 'FREE' } })

      // Cleaning up between tests deletes records too, so this only listens for its own.
      const stream = live.stream({
        model: 'User',
        slug: 'test-hydrate-delete',
        when: { deleted: { id: user.id } },
      })

      await stream['prepare']()
      await client.user.delete({ where: { id: user.id } })

      const event = await first(stream)

      expect(event.deleted).toMatchObject({ id: user.id, displayName: 'Ada', enum: 'FREE' })
    }, 10000)

    test('filters on booleans', async () => {
      const stream = live.stream({
        model: 'User',
        slug: 'test-filter-boolean',
        when: { updated: { after: { boolean: true } } },
      })

      const user = await client.user.create({ data: { boolean: false, enum: 'FREE' } })

      await client.user.update({ where: { id: user.id }, data: { string: 'unrelated' } })
      await client.user.update({ where: { id: user.id }, data: { boolean: true } })

      const events = await take(stream, 2)

      expect(events.map(({ type }) => type)).toEqual(['updated'])
    }, 10000)

    test('filters on mapped fields and enum values', async () => {
      const stream = live.stream({
        model: 'User',
        slug: 'test-filter-mapped',
        when: { created: { displayName: 'Ada', enum: 'FREE' } },
      })

      await client.user.create({ data: { displayName: 'Ada', enum: 'PRO' } })
      await client.user.create({ data: { displayName: 'Bob', enum: 'FREE' } })
      await client.user.create({ data: { displayName: 'Ada', enum: 'FREE' } })

      const events = await take(stream, 2)

      expect(events).toHaveLength(1)
      expect(events[0]?.created).toMatchObject({ displayName: 'Ada', enum: 'FREE' })
    }, 10000)

    test('keeps the precision of decimals', async () => {
      const balance = new Decimal('1234567890.12345678901234567890123456')

      const stream = live.stream({
        model: 'Contact',
        slug: 'test-hydrate-decimal',
        when: { created: { balance: { equals: balance.toString() as any } } },
      })

      await client.contact.create({ data: { email: 'a@example.com', balance } })

      const event = await first(stream)

      expect(event.created.balance?.toString()).toBe(balance.toString())
    }, 10000)
  })

  describe('custom types', () => {
    const joinedAt = new Date('2024-01-01T00:00:00.000Z')

    const address = {
      city: 'Hanoi',
      geo: { lat: 21.5, lng: 105 },
      tags: ['home'],
      plan: 'PRO' as const,
      movedAt: joinedAt,
    }

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
        data: { email: 'b@example.com', profile: { name: 'Bob', addresses: [] } },
      })

      await client.contact.create({
        data: {
          email: 'a@example.com',
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
        },
      })

      const { created: contact } = await first(stream)

      expect(contact.email).toBe('a@example.com')
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
    }, 10000)

    test('hydrates null json', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-null',
        when: { created: { profile: null } },
      })

      await client.contact.create({ data: { email: 'a@example.com' } })

      const event = await first(stream)

      expect(event.created.profile).toBeNull()
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
        `INSERT INTO common_contacts (id, email, profile)
         VALUES ('malformed', 'a@example.com', '${JSON.stringify(profile)}')`,
      )

      const event = await first(stream)

      expect(event.created.profile).toEqual(profile)
    }, 10000)

    test('keeps large json that is unchanged by an update', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-custom-types-large',
        when: { updated: {} },
      })

      // Random text can't be compressed, so Postgres has to store this out of line.
      const name = Array.from({ length: 2000 }, () => Math.random().toString(36)).join('')

      const contact = await client.contact.create({
        data: { email: 'a@example.com', profile: { name, addresses: [] } },
      })

      await client.contact.update({ where: { id: contact.id }, data: { age: 30 } })

      const event = await first(stream)

      expect(event.updated.before.profile?.name).toBe(name)
      expect(event.updated.after.profile?.name).toBe(name)
    }, 10000)
  })

  describe('plain json', () => {
    test('hydrates objects', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-plain-json',
        when: { created: {} },
      })
      const metadata = { plan: 'pro', limits: [1, 2], nested: { ok: true } }

      await client.contact.create({ data: { email: 'a@example.com', metadata } })

      const event = await first(stream)

      expect(event.created.metadata).toEqual(metadata)
    }, 10000)

    test.each<[string, string]>([
      ['string', '"text"'],
      ['number', '0'],
      ['boolean', 'false'],
    ])(
      'hydrates a %s',
      async (type, json) => {
        const stream = live.stream({
          model: 'Contact',
          slug: `test-plain-json-${type}`,
          when: { created: {} },
        })

        await client.$queryRawUnsafe(
          `INSERT INTO common_contacts (id, email, metadata) VALUES ('scalar', 'a@example.com', '${json}')`,
        )

        const event = await first(stream)

        expect(event.created.metadata).toBe(JSON.parse(json))
      },
      10000,
    )

    test('hydrates NULL', async () => {
      const stream = live.stream({
        model: 'Contact',
        slug: 'test-plain-json-null',
        when: { created: {} },
      })

      await client.contact.create({ data: { email: 'a@example.com' } })

      const event = await first(stream)

      expect(event.created.metadata).toBeNull()
    }, 10000)

    test.each<[string, unknown, string]>([
      ['JsonNull', JsonNull, 'json'],
      ['DbNull', DbNull, 'db'],
    ])(
      'tells %s apart',
      async (_, equals, expected) => {
        const stream = live.stream({
          model: 'Contact',
          slug: `test-plain-json-${expected}-null`,
          when: { created: { metadata: { equals } as any } },
        })

        await client.$queryRawUnsafe(
          `INSERT INTO common_contacts (id, email, metadata)
           VALUES ('json', 'a@example.com', 'null'), ('db', 'b@example.com', NULL)`,
        )

        const event = await first(stream)

        expect(event.created.id).toBe(expected)
        expect(event.created.metadata).toBeNull()
      },
      10000,
    )
  })
})
