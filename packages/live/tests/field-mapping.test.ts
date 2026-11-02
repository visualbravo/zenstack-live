// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { schema } from './schemas/field-mapping'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive } from '../src'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import { randomUUID } from 'node:crypto'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

const required = { firstName: 'Ada', left: 'left value', right: 'right value', plain: 'plain' }

// ZenStack's `$pushSchema` has no way to leave a column out of the schema, so the tables are created
// by hand. `nickname` isn't in the schema, and shares its name with a field mapped to `nick_name`.
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

  await client.$queryRawUnsafe(`
    DROP TABLE IF EXISTS people;
    DROP TABLE IF EXISTS teams;
    DROP TYPE IF EXISTS role;
    DROP TYPE IF EXISTS "Swapped";
    CREATE TYPE role AS ENUM ('admin', 'team_member', 'GUEST');
    CREATE TYPE "Swapped" AS ENUM ('SECOND', 'FIRST');
    CREATE TABLE teams (team_id TEXT PRIMARY KEY, team_name TEXT NOT NULL);
    CREATE TABLE people (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
      first_name TEXT NOT NULL,
      nick_name TEXT,
      nickname TEXT,
      person_age INT,
      account_balance BIGINT,
      annual_salary DECIMAL(65, 30),
      last_seen TIMESTAMP(3),
      avatar_bytes BYTEA,
      person_tags TEXT[],
      person_scores INT[],
      meta_data JSONB,
      user_settings JSONB,
      user_role role NOT NULL DEFAULT 'team_member',
      user_roles role[],
      backup_role role,
      swapped_enum "Swapped",
      "right" TEXT NOT NULL,
      "left" TEXT NOT NULL,
      plain TEXT NOT NULL,
      team_id TEXT REFERENCES teams (team_id)
    );
  `)

  await Promise.all(
    (['Person', 'Team'] as const).map(model =>
      live.stream({ model, slug: 'test-setup' })['prepare'](),
    ),
  )

  // The new tables reach Debezium through their publication, which takes a moment to be noticed.
  await new Promise(resolve => setTimeout(resolve, 2000))
})

beforeEach(async () => {
  await redis.flushall()
})

afterAll(async () => {
  live.disconnect()
  redis.disconnect()

  await client.$queryRawUnsafe(`
    DROP TABLE people;
    DROP TABLE teams;
    DROP TYPE role;
    DROP TYPE "Swapped";
  `)

  await client.$disconnect()
})

describe('field mapping', () => {
  test('reads every type of field from its column', async () => {
    const id = randomUUID()
    const teamId = randomUUID()
    const date = new Date('2024-03-04T05:06:07.123Z')

    const stream = live.stream({
      model: 'Person',
      slug: 'test-every-type',
      when: { created: { id } },
    })

    await client.team.create({ data: { id: teamId, name: 'Engineering' } })
    await client.person.create({
      data: {
        ...required,
        id,
        createdAt: date,
        nickname: 'Countess',
        age: 36,
        balance: 9007199254740993n,
        salary: new Decimal('1234.5'),
        lastSeen: date,
        avatar: new Uint8Array([1, 2, 3]),
        tags: ['math'],
        scores: [1, 2],
        metadata: { nested: true },
        settings: { theme: 'dark', role: 'ADMIN' },
        role: 'ADMIN',
        roles: ['ADMIN', 'MEMBER', 'GUEST'],
        backupRole: 'GUEST',
        swapped: 'FIRST',
        teamId,
      },
    })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual({
      ...required,
      id,
      createdAt: date,
      nickname: 'Countess',
      age: 36,
      balance: 9007199254740993n,
      salary: new Decimal('1234.5'),
      lastSeen: date,
      avatar: new Uint8Array([1, 2, 3]),
      tags: ['math'],
      scores: [1, 2],
      metadata: { nested: true },
      settings: { theme: 'dark', role: 'ADMIN' },
      role: 'ADMIN',
      roles: ['ADMIN', 'MEMBER', 'GUEST'],
      backupRole: 'GUEST',
      swapped: 'FIRST',
      teamId,
    })
  }, 10000)

  test('matches what ZenStack reads', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-same-as-client',
      when: { created: { id } },
    })

    await client.person.create({
      data: { ...required, id, role: 'ADMIN', roles: ['MEMBER'], swapped: 'SECOND' },
    })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual(await client.person.findUnique({ where: { id } }))
  }, 10000)

  test('reads a mapped ID', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Team',
      slug: 'test-mapped-id',
      when: { created: { id } },
    })

    await client.team.create({ data: { id, name: 'Engineering' } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual({ id, name: 'Engineering' })
  }, 10000)

  test('reads fields mapped to the name of another field', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-swapped-columns',
      when: { created: { id, left: 'left value', right: 'right value' } },
    })

    await client.person.create({ data: { ...required, id } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created.left).toBe('left value')
    expect(event.created.right).toBe('right value')

    const [row] = await client.$queryRawUnsafe<{ left: string; right: string }[]>(
      `SELECT "left", "right" FROM people WHERE id = '${id}'`,
    )

    expect(row).toEqual({ left: 'right value', right: 'left value' })
  }, 10000)

  test('reads a field from its column over a column with its name', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-unknown-column',
      when: { updated: { after: { nickname: 'mapped' } } },
    })

    await client.person.create({ data: { ...required, id } })
    await client.$queryRawUnsafe(
      `UPDATE people SET nick_name = 'mapped', nickname = 'unmapped' WHERE id = '${id}'`,
    )

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.updated.after.nickname).toBe('mapped')
  }, 10000)

  test('reads enum values that are mapped to each other', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-swapped-enum',
      when: { created: { id, swapped: 'FIRST' } },
    })

    await client.person.create({ data: { ...required, id, swapped: 'FIRST' } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created.swapped).toBe('FIRST')
  }, 10000)

  test('reads an enum value that was added to the database as it is', async () => {
    const id = randomUUID()

    await client.$queryRawUnsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'unknown'`)

    const stream = live.stream({
      model: 'Person',
      slug: 'test-unknown-enum',
      when: { created: { id } },
    })

    await client.$queryRawUnsafe(
      `INSERT INTO people (id, first_name, "left", "right", plain, user_role, user_roles)
       VALUES ('${id}', 'Ada', '', '', '', 'unknown', '{unknown,admin}')`,
    )

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created.role).toBe('unknown')
    expect(event.created.roles).toEqual(['unknown', 'ADMIN'])
  }, 10000)

  test('reads a NULL in a mapped array as empty', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-null-array',
      when: { created: { id } },
    })

    await client.$queryRawUnsafe(
      `INSERT INTO people (id, first_name, "left", "right", plain)
       VALUES ('${id}', 'Ada', '', '', '')`,
    )

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toMatchObject({ tags: [], roles: [], nickname: null, role: 'MEMBER' })
  }, 10000)

  test('filters on mapped fields and enum values', async () => {
    const id = randomUUID()
    const skippedId = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-filters',
      when: {
        created: {
          id: { in: [id, skippedId] },
          firstName: { startsWith: 'A' },
          age: { gte: 18 },
          role: 'ADMIN',
          roles: { has: 'MEMBER' },
          tags: { has: 'math' },
          settings: { is: { theme: 'dark' } },
          metadata: { path: '$.nested', equals: true },
        },
      },
    })

    await client.person.create({
      data: {
        ...required,
        id: skippedId,
        age: 18,
        role: 'MEMBER',
        roles: ['MEMBER'],
        tags: ['math'],
        settings: { theme: 'dark', role: 'ADMIN' },
        metadata: { nested: true },
      },
    })

    await client.person.create({
      data: {
        ...required,
        id,
        age: 18,
        role: 'ADMIN',
        roles: ['MEMBER'],
        tags: ['math'],
        settings: { theme: 'dark', role: 'ADMIN' },
        metadata: { nested: true },
      },
    })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created.id).toBe(id)
  }, 10000)

  test('maps both sides of an update', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-update',
      when: { updated: { before: { id, role: 'ADMIN' }, after: { role: 'GUEST' } } },
    })

    await client.person.create({ data: { ...required, id, role: 'ADMIN' } })
    await client.person.update({ where: { id }, data: { firstName: 'Grace', role: 'GUEST' } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.updated.before).toMatchObject({ firstName: 'Ada', role: 'ADMIN' })
    expect(event.updated.after).toMatchObject({ firstName: 'Grace', role: 'GUEST' })
  }, 10000)

  test('maps a deleted record', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Person',
      slug: 'test-delete',
      when: { deleted: { id, firstName: 'Ada', role: 'ADMIN' } },
    })

    await client.person.create({ data: { ...required, id, role: 'ADMIN' } })
    await client.person.delete({ where: { id } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.deleted).toMatchObject({ firstName: 'Ada', role: 'ADMIN' })
  }, 10000)
})
