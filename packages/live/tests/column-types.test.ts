// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { schema } from './schemas/column-types'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive } from '../src'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

const timestamp = `'2024-03-04 05:06:07.123456'`
const timestamptz = `'2024-03-04 05:06:07.123456+02'`

const date = new Date('2024-03-04T05:06:07.123Z')
const dateWithoutFraction = new Date('2024-03-04T05:06:07.000Z')
const dateWithZone = new Date('2024-03-04T03:06:07.123Z')
const dateWithZoneWithoutFraction = new Date('2024-03-04T03:06:07.000Z')

const dateOnly = new Date('2024-03-04T00:00:00.000Z')
const time = new Date('1970-01-01T05:06:07.123Z')
const timeWithZone = new Date('1970-01-01T03:06:07.123Z')

async function insert(columns: Record<string, string>) {
  await client.$queryRawUnsafe(
    `INSERT INTO "ColumnTypes" (${Object.keys(columns)
      .map(column => `"${column}"`)
      .join(', ')})
     VALUES (${Object.values(columns).join(', ')})`,
  )
}

// ZenStack's `$pushSchema` can't express these without `@db` attributes, so the table is created by hand.
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
    DROP TABLE IF EXISTS "ColumnTypes";
    CREATE TABLE "ColumnTypes" (
      id TEXT PRIMARY KEY,
      timestamp0 TIMESTAMP(0),
      timestamp3 TIMESTAMP(3),
      timestamp6 TIMESTAMP(6),
      "timestamp" TIMESTAMP,
      timestamptz0 TIMESTAMPTZ(0),
      timestamptz3 TIMESTAMPTZ(3),
      timestamptz6 TIMESTAMPTZ(6),
      "date" DATE,
      "time" TIME,
      timetz TIMETZ,
      "decimal" DECIMAL,
      decimal6530 DECIMAL(65, 30),
      decimal102 DECIMAL(10, 2),
      decimal100 DECIMAL(10, 0),
      money MONEY,
      "timestamp3Array" TIMESTAMP(3)[],
      "timestamp6Array" TIMESTAMP(6)[],
      "timestamptz3Array" TIMESTAMPTZ(3)[],
      "dateArray" DATE[],
      "timeArray" TIME[],
      "decimalArray" DECIMAL[],
      "decimal102Array" DECIMAL(10, 2)[],
      "decimal6530Array" DECIMAL(65, 30)[]
    );
  `)

  await live.stream({ model: 'ColumnTypes', slug: 'test-setup' })['prepare']()

  // The new table reaches Debezium through its publication, which takes a moment to be noticed.
  await new Promise(resolve => setTimeout(resolve, 2000))
})

beforeEach(async () => {
  await redis.flushall()
  await client.columnTypes.deleteMany()
})

afterAll(async () => {
  live.disconnect()
  redis.disconnect()

  await client.$queryRawUnsafe(`DROP TABLE "ColumnTypes"`)
  await client.$disconnect()
})

describe('column types', () => {
  test.each<[string, string, Date]>([
    ['timestamp0', timestamp, dateWithoutFraction],
    ['timestamp3', timestamp, date],
    ['timestamp6', timestamp, date],
    ['timestamp', timestamp, date],
    ['timestamptz0', timestamptz, dateWithZoneWithoutFraction],
    ['timestamptz3', timestamptz, dateWithZone],
    ['timestamptz6', timestamptz, dateWithZone],
    ['date', `'2024-03-04'`, dateOnly],
    ['time', `'05:06:07.123456'`, time],
    ['timetz', `'05:06:07.123456+02'`, timeWithZone],
  ])(
    'hydrates %s',
    async (column, value, expected) => {
      const stream = live.stream({
        model: 'ColumnTypes',
        slug: `test-${column}`,
        when: { created: {} },
      })

      await insert({ id: `'${column}'`, [column]: value })

      for await (const event of stream) {
        expect((event.created as any)[column]).toEqual(expected)

        break
      }
    },
    10000,
  )

  test.each<[string, string, string]>([
    ['decimal', `'-12.50'`, '-12.5'],
    ['decimal6530', `'-12.50'`, '-12.5'],
    ['decimal102', `'-12.50'`, '-12.5'],
    ['decimal100', `'-12'`, '-12'],
    ['money', `'-12.50'`, '-12.5'],
    [
      'decimal6530',
      `'12345678901234567890123456789012345.123456789012345678901234567890'`,
      '12345678901234567890123456789012345.12345678901234567890123456789',
    ],
    ['decimal', `'NaN'`, 'NaN'],
    ['decimal', `'Infinity'`, 'Infinity'],
    ['decimal', `'-Infinity'`, '-Infinity'],
  ])(
    'hydrates %s from %s',
    async (column, value, expected) => {
      const stream = live.stream({
        model: 'ColumnTypes',
        slug: `test-${column}-${expected}`,
        when: { created: {} },
      })

      await insert({ id: `'${column}'`, [column]: value })

      for await (const event of stream) {
        const decimal = (event.created as any)[column]

        expect(decimal).toBeInstanceOf(Decimal)
        expect(decimal.toFixed()).toBe(expected)

        break
      }
    },
    10000,
  )

  test('hydrates arrays', async () => {
    const stream = live.stream({
      model: 'ColumnTypes',
      slug: 'test-arrays',
      when: { created: {} },
    })

    await insert({
      id: `'arrays'`,
      timestamp3Array: `ARRAY[${timestamp}]::TIMESTAMP(3)[]`,
      timestamp6Array: `ARRAY[${timestamp}]::TIMESTAMP(6)[]`,
      timestamptz3Array: `ARRAY[${timestamptz}]::TIMESTAMPTZ(3)[]`,
      dateArray: `ARRAY['2024-03-04']::DATE[]`,
      timeArray: `ARRAY['05:06:07.123456']::TIME[]`,
      decimalArray: `ARRAY['-12.50']::DECIMAL[]`,
      decimal102Array: `ARRAY['-12.50']::DECIMAL(10, 2)[]`,
      decimal6530Array: `ARRAY['-12.50']::DECIMAL(65, 30)[]`,
    })

    for await (const event of stream) {
      expect(event.created.timestamp3Array).toEqual([date])
      expect(event.created.timestamp6Array).toEqual([date])
      expect(event.created.timestamptz3Array).toEqual([dateWithZone])
      expect(event.created.dateArray).toEqual([dateOnly])
      expect(event.created.timeArray).toEqual([time])
      expect(event.created.decimalArray.map(String)).toEqual(['-12.5'])
      expect(event.created.decimal102Array.map(String)).toEqual(['-12.5'])
      expect(event.created.decimal6530Array.map(String)).toEqual(['-12.5'])

      break
    }
  }, 10000)

  test('matches what a query returns', async () => {
    const stream = live.stream({
      model: 'ColumnTypes',
      slug: 'test-query-parity',
      when: { created: {} },
    })

    await insert({
      id: `'parity'`,
      timestamp0: timestamp,
      timestamp3: timestamp,
      timestamp6: timestamp,
      timestamptz0: timestamptz,
      timestamptz3: timestamptz,
      timestamptz6: timestamptz,
      date: `'2024-03-04'`,
      time: `'05:06:07.123456'`,
      timetz: `'05:06:07.123456+02'`,
      decimal: `'-12.50'`,
      decimal6530: `'-12.50'`,
      decimal102: `'-12.50'`,
      timestamp3Array: `ARRAY[${timestamp}]::TIMESTAMP(3)[]`,
      decimal102Array: `ARRAY['-12.50']::DECIMAL(10, 2)[]`,
    })

    const expected = await client.columnTypes.findUniqueOrThrow({ where: { id: 'parity' } })

    for await (const event of stream) {
      expect(event.created).toEqual(expected)

      break
    }
  }, 10000)

  test.each<[string, Record<string, unknown>]>([
    ['TIMESTAMP(3)', { timestamp3: { gt: new Date('2024-03-04T00:00:00.000Z') } }],
    ['TIMESTAMPTZ(3)', { timestamptz3: { equals: dateWithZone } }],
    ['DATE', { date: { equals: dateOnly } }],
    ['DECIMAL(65, 30)', { decimal6530: { gt: new Decimal('10.5') } }],
    ['DECIMAL(10, 2)', { decimal102: { equals: new Decimal('12.5') } }],
  ])(
    'filters on %s',
    async (type, when) => {
      const stream = live.stream({
        model: 'ColumnTypes',
        slug: `test-filter-${type}`,
        when: { created: when as any },
      })

      await insert({
        id: `'other'`,
        timestamp3: `'2024-03-03 00:00:00'`,
        timestamptz3: `'2024-03-03 00:00:00+00'`,
        date: `'2024-03-03'`,
        decimal6530: `'1'`,
        decimal102: `'1'`,
      })

      await insert({
        id: `'match'`,
        timestamp3: timestamp,
        timestamptz3: timestamptz,
        date: `'2024-03-04'`,
        decimal6530: `'12.5'`,
        decimal102: `'12.5'`,
      })

      for await (const event of stream) {
        expect(event.created.id).toBe('match')

        break
      }
    },
    10000,
  )
})
