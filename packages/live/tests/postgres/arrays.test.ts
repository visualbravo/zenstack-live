// oxlint-disable no-promise-executor-return no-unreachable-loop
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { schema } from './schemas/basic'
import type { ClientContract } from '@zenstackhq/orm'
import { ZenStackLive } from '../../src'
import { Redis } from 'ioredis'
import { clearRedis } from '../helpers/clear-redis'
import { postgres } from '../helpers/dialects'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

async function first<T>(stream: AsyncIterable<T>) {
  for await (const event of stream) {
    return event
  }

  throw new Error('The stream ended without an event')
}

// Only Postgres has columns that hold arrays. Arrays inside JSON are covered in `common/hydration`.
beforeAll(async () => {
  client = postgres.connect(schema, postgres.url()) as unknown as ClientContract<typeof schema>

  // `$pushSchema` skips tables that exist, but not enum types.
  await client.$queryRawUnsafe('DROP TABLE IF EXISTS "Post", "User", "Contact" CASCADE')
  await client.$queryRawUnsafe('DROP TYPE IF EXISTS "Role" CASCADE')
  await client.$pushSchema()

  live = new ZenStackLive({ client, redis: { url: process.env['REDIS_URL']! } })
  redis = new Redis(process.env['REDIS_URL']!)

  await live.stream({ model: 'Contact', slug: 'test-setup' })['prepare']()

  // Let Debezium flush events from earlier test files so that they don't reach these streams.
  await new Promise(resolve => setTimeout(resolve, 2000))
}, 15000)

beforeEach(async () => {
  await clearRedis(redis, 'postgresql')
  await client.contact.deleteMany()
})

afterAll(async () => {
  live?.disconnect()
  redis?.disconnect()
  await client?.$disconnect()
})

describe('array columns', () => {
  const joinedAt = new Date('2024-01-01T00:00:00.000Z')

  const address = {
    city: 'Hanoi',
    geo: { lat: 21.5, lng: 105 },
    tags: ['home'],
    role: 'ADMIN' as const,
    movedAt: joinedAt,
  }

  test('hydrates arrays of scalars and custom types', async () => {
    const stream = live.stream({
      model: 'Contact',
      slug: 'test-arrays-hydrate',
      when: { created: { emails: { has: 'a@example.com' } } },
    })

    await client.contact.create({ data: { email: 'b@example.com', addresses: [] } })

    await client.contact.create({
      data: {
        email: 'a@example.com',
        emails: ['a@example.com', 'b@example.com'],
        addresses: [address],
      },
    })

    const { created: contact } = await first(stream)

    expect(contact.emails).toEqual(['a@example.com', 'b@example.com'])
    expect(contact.addresses).toEqual([address])
  }, 10000)

  test('hydrates arrays of plain json', async () => {
    const stream = live.stream({
      model: 'Contact',
      slug: 'test-arrays-json',
      when: { created: {} },
    })
    const history = [{ event: 'joined' }, 'text', 1]

    await client.contact.create({ data: { email: 'a@example.com', addresses: [], history } })

    const event = await first(stream)

    expect(event.created.history).toEqual(history)
  }, 10000)

  test('hydrates bytes and date arrays', async () => {
    const avatar = new Uint8Array([1, 2, 255])

    const stream = live.stream({
      model: 'Contact',
      slug: 'test-arrays-bytes',
      when: { created: { avatar: { equals: avatar }, seenAt: { has: joinedAt } } },
    })

    await client.contact.create({
      data: { email: 'b@example.com', addresses: [], avatar: new Uint8Array([1]) },
    })

    await client.contact.create({
      data: { email: 'a@example.com', addresses: [], avatar, seenAt: [joinedAt] },
    })

    const event = await first(stream)

    expect(event.created.avatar).toEqual(avatar)
    expect(event.created.seenAt).toEqual([joinedAt])
  }, 10000)

  test('reads a NULL array as empty', async () => {
    const stream = live.stream({
      model: 'Contact',
      slug: 'test-arrays-null',
      when: { created: {} },
    })

    await client.$queryRawUnsafe(
      `INSERT INTO "Contact" (id, email, addresses) VALUES ('null', 'a@example.com', '[]')`,
    )

    const event = await first(stream)

    expect(event.created.emails).toEqual([])
    expect(event.created.history).toEqual([])
  }, 10000)

  test('matches a NULL array like the database', async () => {
    const stream = live.stream({
      model: 'Contact',
      slug: 'test-arrays-null-filter',
      when: { created: { emails: { isEmpty: true } } },
    })

    await client.$queryRawUnsafe(
      `INSERT INTO "Contact" (id, email, addresses, emails)
       VALUES ('null', 'a@example.com', '[]', NULL), ('empty', 'b@example.com', '[]', '{}')`,
    )

    const event = await first(stream)

    expect(event.created.id).toBe('empty')
  }, 10000)
})
