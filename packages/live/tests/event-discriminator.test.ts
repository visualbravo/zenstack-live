import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { schema } from './schemas/basic'
import { EventDiscriminator, type EventDiscriminatorOptions } from '../src/event-discriminator'
import { sourceValues } from '../src/internal'
import { AnyNull, DbNull, JsonNull, ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { RecordCreatedEvent, RecordEvent } from '../'
import Decimal from 'decimal.js'

const baseDate = new Date('2024-01-01T00:00:00.000Z')
const laterDate = new Date('2024-01-01T00:00:00.001Z')
const earlierDate = new Date('2023-12-31T23:59:59.999Z')

const baseEvent = {
  type: 'created',
  created: {
    id: '1',
    string: 'string',
    stringArray: ['stringArray'],
    boolean: true,
    booleanArray: [true],
    dateTime: baseDate,
    dateTimeArray: [baseDate],
    enum: 'USER',
    // enumArray: ['USER'],
    bigInt: BigInt(1),
    bigIntArray: [BigInt(1)],
    int: 1,
    intArray: [1],
    float: 1,
    floatArray: [1],
    decimal: Decimal(1),
    decimalArray: [Decimal(1)],
    jsonArray: [],
    json: {
      string: 'string',
      stringArray: ['stringArray'],
      boolean: true,
      booleanArray: [true],
      dateTime: baseDate,
      dateTimeArray: [baseDate],
      enum: 'USER',
      int: 1,
      intArray: [1],
      float: 1,
      floatArray: [1],
    },
  },
  date: baseDate,
  transactionId: '1',
  id: '1',
} as const satisfies RecordCreatedEvent<typeof schema, 'User'>

let client: ClientContract<typeof schema>

async function matches(
  event: RecordCreatedEvent<typeof schema, 'User'>,
  when: NonNullable<EventDiscriminatorOptions<typeof schema, 'User'>['when']>,
) {
  const discriminator = new EventDiscriminator({
    client,
    model: 'User',
    when,
  })

  const discriminatorMatches = discriminator.eventMatchesWhere(event)

  if (event.type === 'created') {
    await client.user.create({
      data: event.created,
    })

    await expect(client.user.exists({ where: when.created })).resolves.toBe(discriminatorMatches)
  }

  return discriminatorMatches
}

beforeAll(async () => {
  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env['POSTGRES_URL'],
      }),
    }),
  })

  await client.$queryRawUnsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.$pushSchema()
  await Promise.all([
    client.$queryRawUnsafe('ALTER TABLE "User" REPLICA IDENTITY FULL'),
    client.$queryRawUnsafe('ALTER TABLE "Post" REPLICA IDENTITY FULL'),
  ])
})

beforeEach(async () => {
  await client.user.deleteMany({
    where: {
      id: '1',
    },
  })

  await client.contact.deleteMany({
    where: {
      id: '1',
    },
  })
})

afterAll(async () => {
  await client.$disconnect()
})

describe('EventDiscriminator', () => {
  describe('when', () => {
    const { created: record, ...eventBase } = baseEvent

    const events = [
      baseEvent,
      { ...eventBase, type: 'updated', updated: { before: record, after: record } },
      { ...eventBase, type: 'deleted', deleted: record },
    ] as RecordEvent<typeof schema, 'User'>[]

    function matchedTypes(when?: EventDiscriminatorOptions<typeof schema, 'User'>['when']) {
      const discriminator = new EventDiscriminator({ client, model: 'User', when })

      return events.filter(event => discriminator.eventMatchesWhere(event)).map(({ type }) => type)
    }

    test('matches all events when omitted', () => {
      expect(matchedTypes()).toEqual(['created', 'updated', 'deleted'])
    })

    test('matches all events when empty', () => {
      expect(matchedTypes({})).toEqual(['created', 'updated', 'deleted'])
    })

    test('matches only the subscribed event', () => {
      expect(matchedTypes({ created: {} })).toEqual(['created'])
    })

    test('matches multiple subscribed events', () => {
      expect(matchedTypes({ created: {}, deleted: {} })).toEqual(['created', 'deleted'])
    })
  })

  describe('types', () => {
    describe('String', () => {
      test('equals (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { equals: 'string' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { equals: 'other' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('in (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { in: ['foo', 'string', 'bar'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { in: ['foo', 'bar'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { notIn: ['foo', 'bar'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { notIn: ['string'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lt (lexicographic)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { lt: 'z' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('lte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { lte: 'string' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (lexicographic)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { gt: 'a' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { gte: 'string' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('contains (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { contains: 'tri' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('contains (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { contains: 'xyz' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('startsWith (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { startsWith: 'str' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('startsWith (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { startsWith: 'ing' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('endsWith (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { endsWith: 'ing' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('endsWith (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { endsWith: 'str' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('case-sensitive by default', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { equals: 'STRING' },
            },
          }),
        ).resolves.toBe(false)
      })

      test.skip('mode: insensitive (equals)', async () => {
        // const r = await client.user.findMany({
        //   where: {
        //     string: {
        //       equals: 'STRING',
        //       mode: 'insensitive',
        //     }
        //   }
        // })

        // await expect(r).toHaveLength(0)
        await expect(
          matches(baseEvent, {
            created: {
              string: {
                equals: 'STRING',
                mode: 'insensitive',
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test.skip('mode: insensitive (contains)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: {
                contains: 'TRI',
                mode: 'insensitive',
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (value)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { not: 'other' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (value negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { not: 'string' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: {
                not: { contains: 'tri' },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('empty string equals (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                string: '',
              },
            },
            {
              created: {
                string: '',
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('contains empty string (edge case)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              string: { contains: '' },
            },
          }),
        ).resolves.toBe(true)
      })
    })

    describe('String[]', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['a', 'b', 'c'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date(),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date(),
        transactionId: '1',
        id: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('has (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { has: 'a' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('has (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { has: 'z' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasEvery (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { hasEvery: ['a', 'b'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasEvery (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { hasEvery: ['a', 'z'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasSome (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { hasSome: ['x', 'b'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasSome (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { hasSome: ['x', 'y'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('isEmpty (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { isEmpty: false },
            },
          }),
        ).resolves.toBe(true)
      })

      test('isEmpty (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { isEmpty: true },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (exact match)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { equals: ['a', 'b', 'c'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (order mismatch)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { equals: ['c', 'b', 'a'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (subset)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              stringArray: { equals: ['a', 'b'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('empty array equals (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                stringArray: [],
              },
            },
            {
              created: {
                stringArray: { equals: [] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('empty array isEmpty true (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                stringArray: [],
              },
            },
            {
              created: {
                stringArray: { isEmpty: true },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('has on empty array (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                stringArray: [],
              },
            },
            {
              created: {
                stringArray: { has: 'a' },
              },
            },
          ),
        ).resolves.toBe(false)
      })
    })

    describe('Int', () => {
      test('equals (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { equals: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { equals: 2 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('top-level equals shorthand', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: 1,
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { in: [0, 1, 2] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { in: [2, 3, 4] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { notIn: [2, 3, 4] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { notIn: [1] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { lt: 2 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('lt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { lt: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { lte: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { gt: 0 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { gt: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('gte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { gte: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { not: 2 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: { not: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: {
                not: { gt: 0 },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('between (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: {
                between: [1, 2],
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('between (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              int: {
                between: [10, 20],
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('zero value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                int: 0,
              },
            },
            {
              created: {
                int: { equals: 0 },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('negative value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                int: -5,
              },
            },
            {
              created: {
                int: { lt: 0 },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('Int[]', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date(),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1, 2, 3],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date(),
        id: '1',
        transactionId: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('has (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { has: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('has (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { has: 99 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasEvery (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { hasEvery: [1, 3] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasEvery (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { hasEvery: [1, 99] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasSome (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { hasSome: [99, 2] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasSome (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { hasSome: [99, 100] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('isEmpty (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { isEmpty: false },
            },
          }),
        ).resolves.toBe(true)
      })

      test('isEmpty (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { isEmpty: true },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (exact match)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { equals: [1, 2, 3] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (order mismatch)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { equals: [3, 2, 1] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (subset)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              intArray: { equals: [1, 2] },
            },
          }),
        ).resolves.toBe(false)
      })

      // test('not (nested positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         intArray: {
      //           not: { has: 99 },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)
      // })

      // test('not (nested negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         intArray: {
      //           not: { has: 1 },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(false)
      // })

      test('empty array equals (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                intArray: [],
              },
            },
            {
              created: {
                intArray: { equals: [] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('empty array isEmpty true (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                intArray: [],
              },
            },
            {
              created: {
                intArray: { isEmpty: true },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('has on empty array (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                intArray: [],
              },
            },
            {
              created: {
                intArray: { has: 1 },
              },
            },
          ),
        ).resolves.toBe(false)
      })

      test('negative and zero values (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                intArray: [-1, 0, 1],
              },
            },
            {
              created: {
                intArray: { hasEvery: [-1, 0] },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('Float', () => {
      test('equals (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { equals: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { equals: 2 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('top-level equals shorthand', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: 1,
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { in: [0, 1, 2] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { in: [2, 3] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { notIn: [2, 3] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { notIn: [1] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { lt: 2 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('lt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { lt: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { lte: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { gt: 0 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { gt: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('gte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { gte: 1 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { not: 2 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: { not: 1 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: {
                not: { gt: 0 },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('zero value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                float: 0,
              },
            },
            {
              created: {
                float: { equals: 0 },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('negative value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                float: -10.5,
              },
            },
            {
              created: {
                float: { lt: 0 },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('decimal precision (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                float: 0.000123,
              },
            },
            {
              created: {
                float: { equals: 0.000123 },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('very large value (edge case)', async () => {
        const huge = 1e18
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                float: huge,
              },
            },
            {
              created: {
                float: { gte: huge },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('between (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: {
                between: [1, 2],
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('between (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              float: {
                between: [10, 20],
              },
            },
          }),
        ).resolves.toBe(false)
      })
    })

    describe('Float[]', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date('2024-01-01T00:00:00.000Z'),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1.1, 2.2, 3.3],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date('2024-01-01T00:00:00.000Z'),
        id: '1',
        transactionId: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('has (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { has: 2.2 },
            },
          }),
        ).resolves.toBe(true)
      })

      test('has (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { has: 9.9 },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasEvery (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { hasEvery: [1.1, 3.3] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasEvery (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { hasEvery: [1.1, 9.9] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasSome (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { hasSome: [0, 2.2] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasSome (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { hasSome: [9.9, 10.1] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('isEmpty (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { isEmpty: false },
            },
          }),
        ).resolves.toBe(true)
      })

      test('isEmpty (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { isEmpty: true },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (exact match)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { equals: [1.1, 2.2, 3.3] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (order mismatch)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { equals: [3.3, 2.2, 1.1] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (subset)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              floatArray: { equals: [1.1, 2.2] },
            },
          }),
        ).resolves.toBe(false)
      })

      // test('not (nested positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         floatArray: {
      //           not: { has: 9.9 },
      //         },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('not (nested negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         floatArray: {
      //           not: { has: 1.1 },
      //         },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      test('empty array equals (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [],
              },
            },
            {
              created: {
                floatArray: { equals: [] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('empty array isEmpty true (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [],
              },
            },
            {
              created: {
                floatArray: { isEmpty: true },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('has on empty array (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [],
              },
            },
            {
              created: {
                floatArray: { has: 1.1 },
              },
            },
          ),
        ).resolves.toBe(false)
      })

      test('negative and zero values (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [-1.5, 0, 1.5],
              },
            },
            {
              created: {
                floatArray: { hasEvery: [-1.5, 0] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('decimal precision (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [0.0001, 0.0002, 0.0003],
              },
            },
            {
              created: {
                floatArray: { hasSome: [0.0002] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('very large value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                floatArray: [1e18, 2e18, 3e18],
              },
            },
            {
              created: {
                floatArray: { hasSome: [2e18] },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('Enum', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date('2024-01-01T00:00:00.000Z'),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date('2024-01-01T00:00:00.000Z'),
        transactionId: '1',
        id: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('top-level equals (matching value)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: 'USER',
            },
          }),
        ).resolves.toBe(true)
      })

      test('top-level equals (non-matching value)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: 'ADMIN',
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (matching value)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { equals: 'USER' },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (non-matching value)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { equals: 'ADMIN' },
            },
          }),
        ).resolves.toBe(false)
      })

      test('in (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { in: ['USER', 'ADMIN'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { in: ['ADMIN'] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { notIn: ['ADMIN'] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              enum: { notIn: ['USER', 'ADMIN'] },
            },
          }),
        ).resolves.toBe(false)
      })
    })

    // describe('Enum[]', () => {
    //   const baseEvent = {
    //     type: 'created',
    //     before: null,
    //     created: {
    //       id: '1',
    //       string: 'string',
    //       stringArray: ['stringArray'],
    //       boolean: true,
    //       booleanArray: [true],
    //       dateTime: new Date('2024-01-01T00:00:00.000Z'),
    //       enum: 'USER',
    //       enumArray: ['ADMIN', 'USER'],
    //       bigInt: BigInt(1),
    //       bigIntArray: [BigInt(1)],
    //       int: 1,
    //       intArray: [1],
    //       float: 1,
    //       floatArray: [1],
    //           json: {
    //   string: 'string',
    //   stringArray: ['stringArray'],
    //   boolean: true,
    //   booleanArray: [true],
    //   dateTime: baseDate,
    //   enum: 'USER',
    //   int: 1,
    //   intArray: [1],
    //   float: 1,
    //   floatArray: [1],
    // },
    //     },
    //     date: new Date('2024-01-01T00:00:00.000Z'),
    //     id: '1',
    //   } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

    //   test('has (positive)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { has: 'USER' },
    //         },
    //       }),
    //     ).resolves.toBe(true)
    //   })

    //   // test('has (negative)', async () => {
    //   //   await expect(
    //   //     matches(baseEvent, {
    //   //       created: {
    //   //         enumArray: { has: 'GUEST' }, // non-existent enum
    //   //       },
    //   //     }),
    //   //   ).resolves.toBe(false)
    //   // })

    //   test('hasEvery (positive)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { hasEvery: ['ADMIN', 'USER'] },
    //         },
    //       }),
    //     ).resolves.toBe(true)
    //   })

    //   // test('hasEvery (negative)', async () => {
    //   //   await expect(
    //   //     matches(baseEvent, {
    //   //       created: {
    //   //         enumArray: { hasEvery: ['ADMIN', 'GUEST'] },
    //   //       },
    //   //     }),
    //   //   ).resolves.toBe(false)
    //   // })

    //   // test('hasSome (positive)', async () => {
    //   //   await expect(
    //   //     matches(baseEvent, {
    //   //       created: {
    //   //         enumArray: { hasSome: ['GUEST', 'USER'] },
    //   //       },
    //   //     }),
    //   //   ).resolves.toBe(true)
    //   // })

    //   // test('hasSome (negative)', async () => {
    //   //   await expect(
    //   //     matches(baseEvent, {
    //   //       created: {
    //   //         enumArray: { hasSome: ['GUEST', 'MODERATOR'] },
    //   //       },
    //   //     }),
    //   //   ).resolves.toBe(false)
    //   // })

    //   test('isEmpty (false)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { isEmpty: false },
    //         },
    //       }),
    //     ).resolves.toBe(true)
    //   })

    //   test('isEmpty (true)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { isEmpty: true },
    //         },
    //       }),
    //     ).resolves.toBe(false)
    //   })

    //   test('equals (exact match)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { equals: ['ADMIN', 'USER'] },
    //         },
    //       }),
    //     ).resolves.toBe(true)
    //   })

    //   test('equals (order mismatch)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { equals: ['USER', 'ADMIN'] },
    //         },
    //       }),
    //     ).resolves.toBe(false)
    //   })

    //   test('equals (subset)', async () => {
    //     await expect(
    //       matches(baseEvent, {
    //         created: {
    //           enumArray: { equals: ['ADMIN'] },
    //         },
    //       }),
    //     ).resolves.toBe(false)
    //   })

    //   test('empty array equals and isEmpty edge case', async () => {
    //     await expect(
    //       matches(
    //         {
    //           ...baseEvent,
    //           created: {
    //             ...baseEvent.created,
    //             enumArray: [],
    //           },
    //         },
    //         {
    //           created: {
    //             enumArray: { equals: [] },
    //           },
    //         },
    //       ),
    //     ).resolves.toBe(true)

    //     await expect(
    //       matches(
    //         {
    //           ...baseEvent,
    //           created: {
    //             ...baseEvent.created,
    //             enumArray: [],
    //           },
    //         },
    //         {
    //           created: {
    //             enumArray: { isEmpty: true },
    //           },
    //         },
    //       ),
    //     ).resolves.toBe(true)
    //   })

    //   test('has on empty array (edge case)', async () => {
    //     await expect(
    //       matches(
    //         {
    //           ...baseEvent,
    //           created: {
    //             ...baseEvent.created,
    //             enumArray: [],
    //           },
    //         },
    //         {
    //           created: {
    //             enumArray: { has: 'ADMIN' },
    //           },
    //         },
    //       ),
    //     ).resolves.toBe(false)
    //   })
    // })

    describe('Decimal', () => {
      // `WhereInput` only types these filters as numbers, but `Decimal` instances work too.
      const decimalMatches = (event: Parameters<typeof matches>[0], when: any) =>
        matches(event, when)

      test('equals (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { equals: Decimal(1) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { equals: Decimal(2) },
            },
          }),
        ).resolves.toBe(false)
      })

      test('top-level equals shorthand', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: Decimal(1),
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { in: [Decimal(0), Decimal(1), Decimal(2)] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { in: [Decimal(2), Decimal(3)] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { notIn: [Decimal(2), Decimal(3)] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { notIn: [Decimal(1)] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lt (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { lt: Decimal(2) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('lt (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { lt: Decimal(1) },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lte (boundary)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { lte: Decimal(1) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { gt: Decimal(0) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { gt: Decimal(1) },
            },
          }),
        ).resolves.toBe(false)
      })

      test('gte (boundary)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { gte: Decimal(1) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { not: Decimal(2) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: { not: Decimal(1) },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: {
                not: { gt: Decimal(0) },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('between (positive)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: {
                between: [Decimal(0), Decimal(2)],
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('between (negative)', async () => {
        await expect(
          decimalMatches(baseEvent, {
            created: {
              decimal: {
                between: [Decimal(10), Decimal(20)],
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('zero value (edge case)', async () => {
        await expect(
          decimalMatches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimal: Decimal(0),
              },
            },
            {
              created: {
                decimal: { equals: Decimal(0) },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('negative value (edge case)', async () => {
        await expect(
          decimalMatches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimal: Decimal(-10.5),
              },
            },
            {
              created: {
                decimal: { lt: Decimal(0) },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('high precision (edge case)', async () => {
        await expect(
          decimalMatches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimal: Decimal('0.123456789012345678901234567890'),
              },
            },
            {
              created: {
                decimal: { equals: Decimal('0.123456789012345678901234567890') },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('very large value (edge case)', async () => {
        const huge = Decimal('99999999999999999999999999999999')
        await expect(
          decimalMatches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimal: huge,
              },
            },
            {
              created: {
                decimal: { gte: huge },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('Decimal[]', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date('2024-01-01T00:00:00.000Z'),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal('1.1'), Decimal('2.2'), Decimal('3.3')],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date('2024-01-01T00:00:00.000Z'),
        id: '1',
        transactionId: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('has (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { has: Decimal('2.2') },
            },
          }),
        ).resolves.toBe(true)
      })

      test('has (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { has: Decimal('9.9') },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasEvery (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { hasEvery: [Decimal('1.1'), Decimal('3.3')] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasEvery (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { hasEvery: [Decimal('1.1'), Decimal('9.9')] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('hasSome (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { hasSome: [Decimal('0'), Decimal('2.2')] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('hasSome (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { hasSome: [Decimal('9.9'), Decimal('10.1')] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('isEmpty (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { isEmpty: false },
            },
          }),
        ).resolves.toBe(true)
      })

      // ZenStack compiles this to `!= '{}'`, so the database can't confirm it. See 'strict filters'.
      test.skip('isEmpty (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { isEmpty: true },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (exact match)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { equals: [Decimal('1.1'), Decimal('2.2'), Decimal('3.3')] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (order mismatch)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { equals: [Decimal('3.3'), Decimal('2.2'), Decimal('1.1')] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('equals (subset)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              decimalArray: { equals: [Decimal('1.1'), Decimal('2.2')] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('empty array equals (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimalArray: [],
              },
            },
            {
              created: {
                decimalArray: { equals: [] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      // ZenStack compiles this to `!= '{}'`, so the database can't confirm it. See 'strict filters'.
      test.skip('empty array isEmpty true (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimalArray: [],
              },
            },
            {
              created: {
                decimalArray: { isEmpty: true },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('has on empty array (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimalArray: [],
              },
            },
            {
              created: {
                decimalArray: { has: Decimal('1.1') },
              },
            },
          ),
        ).resolves.toBe(false)
      })

      test('negative and zero values (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimalArray: [Decimal('-1.5'), Decimal('0'), Decimal('1.5')],
              },
            },
            {
              created: {
                decimalArray: { hasEvery: [Decimal('-1.5'), Decimal('0')] },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('high precision values (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                decimalArray: [Decimal('0.000000000000001'), Decimal('0.000000000000002')],
              },
            },
            {
              created: {
                decimalArray: { hasSome: [Decimal('0.000000000000002')] },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('BigInt', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: new Date(),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date(),
        transactionId: '1',
        id: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      // test('equals (positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { equals: BigInt(1) },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('equals (negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { equals: BigInt(2) },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      test('top-level equals shorthand', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              bigInt: BigInt(1),
            },
          }),
        ).resolves.toBe(true)
      })

      // test('in (positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { in: [BigInt(0), BigInt(1), BigInt(2)] },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('in (negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { in: [BigInt(2), BigInt(3)] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('notIn (positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { notIn: [BigInt(2), BigInt(3)] },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('notIn (negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { notIn: [BigInt(1)] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('lt (positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { lt: BigInt(2) },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('lt (negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { lt: BigInt(1) },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('lte (boundary)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { lte: BigInt(1) },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('gt (positive)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { gt: BigInt(0) },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('gt (negative)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { gt: BigInt(1) },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('gte (boundary)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: { gte: BigInt(1) },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      test('not (scalar positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              bigInt: { not: BigInt(2) },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              bigInt: { not: BigInt(1) },
            },
          }),
        ).resolves.toBe(false)
      })

      test('between (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              bigInt: {
                between: [1, 2],
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('between (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              bigInt: {
                between: [10, 20],
              },
            },
          }),
        ).resolves.toBe(false)
      })

      // test('not (nested filter)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         bigInt: {
      //           not: { gt: BigInt(0) },
      //         },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('zero value (edge case)', async () => {
      //   await expect(
      //     matches(
      //       {
      //         ...baseEvent,
      //         created: {
      //           ...baseEvent.created,
      //           bigInt: BigInt(0),
      //         },
      //       },
      //       {
      //         created: {
      //           bigInt: { equals: BigInt(0) },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)
      // })

      // test('negative value (edge case)', async () => {
      //   await expect(
      //     matches(
      //       {
      //         ...baseEvent,
      //         created: {
      //           ...baseEvent.created,
      //           bigInt: BigInt(-10),
      //         },
      //       },
      //       {
      //         created: {
      //           bigInt: { lt: BigInt(0) },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)
      // })

      // test('very large value (edge case)', async () => {
      //   const huge = BigInt('900719925474099312345')

      //   await expect(
      //     matches(
      //       {
      //         ...baseEvent,
      //         created: {
      //           ...baseEvent.created,
      //           bigInt: huge,
      //         },
      //       },
      //       {
      //         created: {
      //           bigInt: { gte: BigInt('900719925474099312345') },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)
      // })
    })

    describe('Boolean', () => {
      test('equals (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: { equals: true },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: { equals: false },
            },
          }),
        ).resolves.toBe(false)
      })

      test('top-level equals shorthand (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: true,
            },
          }),
        ).resolves.toBe(true)
      })

      test('top-level equals shorthand (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: false,
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (scalar positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: { not: false },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: { not: true },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              boolean: {
                not: { equals: true },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('explicit false value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                boolean: false,
              },
            },
            {
              created: {
                boolean: false,
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('not false with explicit false value (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                boolean: false,
              },
            },
            {
              created: {
                boolean: { not: true },
              },
            },
          ),
        ).resolves.toBe(true)
      })
    })

    describe('Boolean[]', () => {
      const baseEvent = {
        type: 'created',
        created: {
          id: '1',
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true, false, true],
          dateTime: new Date('2024-01-01T00:00:00.000Z'),
          enum: 'USER',
          bigInt: BigInt(1),
          bigIntArray: [BigInt(1)],
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
          dateTimeArray: [baseDate],
          decimal: Decimal(1),
          decimalArray: [Decimal(1)],
          jsonArray: [],
          json: {
            string: 'string',
            stringArray: ['stringArray'],
            boolean: true,
            booleanArray: [true],
            dateTime: baseDate,
            dateTimeArray: [baseDate],
            enum: 'USER',
            int: 1,
            intArray: [1],
            float: 1,
            floatArray: [1],
          },
        },
        date: new Date('2024-01-01T00:00:00.000Z'),
        id: '1',
        transactionId: '1',
      } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

      test('has (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              booleanArray: { has: true },
            },
          }),
        ).resolves.toBe(true)
      })

      test('has (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              booleanArray: { has: false },
            },
          }),
        ).resolves.toBe(true)
      })

      // test('has (non-existent value)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { has: null as any },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      test('hasEvery (true + false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              booleanArray: { hasEvery: [true, false] },
            },
          }),
        ).resolves.toBe(true)
      })

      // test('hasEvery (missing value)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { hasEvery: [true, null as any] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('hasSome (true or false)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { hasSome: [false, null as any] },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('hasSome (non-existent value)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { hasSome: [null as any] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      test('isEmpty (false)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              booleanArray: { isEmpty: false },
            },
          }),
        ).resolves.toBe(true)
      })

      test('isEmpty (true)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              booleanArray: { isEmpty: true },
            },
          }),
        ).resolves.toBe(false)
      })

      // test('equals (exact match)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { equals: [true, false, true] },
      //       },
      //     }),
      //   ).resolves.toBe(true)
      // })

      // test('equals (order mismatch)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { equals: [true, true, false] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('equals (subset)', async () => {
      //   await expect(
      //     matches(baseEvent, {
      //       created: {
      //         booleanArray: { equals: [true, false] },
      //       },
      //     }),
      //   ).resolves.toBe(false)
      // })

      // test('empty array equals and isEmpty edge case', async () => {
      //   await expect(
      //     matches(
      //       {
      //         ...baseEvent,
      //         created: {
      //           ...baseEvent.created,
      //           booleanArray: [],
      //         },
      //       },
      //       {
      //         created: {
      //           booleanArray: { equals: [] },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)

      //   await expect(
      //     matches(
      //       {
      //         ...baseEvent,
      //         created: {
      //           ...baseEvent.created,
      //           booleanArray: [],
      //         },
      //       },
      //       {
      //         created: {
      //           booleanArray: { isEmpty: true },
      //         },
      //       },
      //     ),
      //   ).resolves.toBe(true)
      // })

      test('has on empty array (edge case)', async () => {
        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                booleanArray: [],
              },
            },
            {
              created: {
                booleanArray: { has: true },
              },
            },
          ),
        ).resolves.toBe(false)
      })
    })

    describe('DateTime', () => {
      test('equals (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { equals: baseDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('equals (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { equals: laterDate },
            },
          }),
        ).resolves.toBe(false)
      })

      test('top-level equals shorthand', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: baseDate,
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { in: [earlierDate, baseDate, laterDate] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('in (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { in: [earlierDate, laterDate] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('notIn (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { notIn: [earlierDate, laterDate] },
            },
          }),
        ).resolves.toBe(true)
      })

      test('notIn (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { notIn: [baseDate] },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { lt: laterDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('lt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { lt: baseDate },
            },
          }),
        ).resolves.toBe(false)
      })

      test('lte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { lte: baseDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { gt: earlierDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('gt (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { gt: baseDate },
            },
          }),
        ).resolves.toBe(false)
      })

      test('gte (boundary)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { gte: baseDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { not: laterDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('not (scalar negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { not: baseDate },
            },
          }),
        ).resolves.toBe(false)
      })

      test('not (nested filter)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: {
                not: { lt: laterDate },
              },
            },
          }),
        ).resolves.toBe(false)
      })

      test('millisecond precision boundary', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: { lt: laterDate },
            },
          }),
        ).resolves.toBe(true)
      })

      test('epoch date (edge case)', async () => {
        const epoch = new Date(0)

        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                dateTime: epoch,
              },
            },
            {
              created: {
                dateTime: { equals: epoch },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('timezone-equivalent dates (same instant)', async () => {
        const utc = new Date('2024-01-01T00:00:00.000Z')
        const offset = new Date('2023-12-31T19:00:00.000-05:00')

        await expect(
          matches(
            {
              ...baseEvent,
              created: {
                ...baseEvent.created,
                dateTime: utc,
              },
            },
            {
              created: {
                dateTime: { equals: offset },
              },
            },
          ),
        ).resolves.toBe(true)
      })

      test('between (positive)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: {
                between: [baseDate, laterDate],
              },
            },
          }),
        ).resolves.toBe(true)

        await client.user.deleteMany()

        await expect(
          matches(baseEvent, {
            created: {
              dateTime: {
                between: [earlierDate, baseDate],
              },
            },
          }),
        ).resolves.toBe(true)
      })

      test('between (negative)', async () => {
        await expect(
          matches(baseEvent, {
            created: {
              dateTime: {
                between: [new Date(laterDate.getTime() + 1), new Date(laterDate.getTime() + 2)],
              },
            },
          }),
        ).resolves.toBe(false)
      })
    })
  })

  describe('operators', () => {
    const baseEvent = {
      type: 'created',
      created: {
        id: '1',
        string: 'hello',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date('2024-01-01T00:00:00.000Z'),
        enum: 'USER',
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        dateTimeArray: [baseDate],
        decimal: Decimal(1),
        decimalArray: [Decimal(1)],
        jsonArray: [],
        json: {
          string: 'string',
          stringArray: ['stringArray'],
          boolean: true,
          booleanArray: [true],
          dateTime: baseDate,
          dateTimeArray: [baseDate],
          enum: 'USER',
          int: 1,
          intArray: [1],
          float: 1,
          floatArray: [1],
        },
      },
      date: new Date('2024-01-01T00:00:00.000Z'),
      id: '1',
      transactionId: '1',
    } as const satisfies RecordCreatedEvent<typeof schema, 'User'>

    test('AND - both conditions true', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            AND: [{ string: 'hello' }, { string: { equals: 'hello' } }],
          },
        }),
      ).resolves.toBe(true)
    })

    test('AND - one condition false', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            AND: [{ string: 'hello' }, { string: { equals: 'world' } }],
          },
        }),
      ).resolves.toBe(false)
    })

    test('OR - one condition true', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            OR: [{ string: 'world' }, { string: { equals: 'hello' } }],
          },
        }),
      ).resolves.toBe(true)
    })

    test('OR - all conditions false', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            OR: [{ string: 'world' }, { string: { equals: 'foo' } }],
          },
        }),
      ).resolves.toBe(false)
    })

    test('NOT - condition false', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            NOT: { string: { equals: 'world' } },
          },
        }),
      ).resolves.toBe(true)
    })

    test('NOT - condition true', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            NOT: { string: 'hello' },
          },
        }),
      ).resolves.toBe(false)
    })

    test('nested AND + OR', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            AND: [
              {
                OR: [{ string: 'foo' }, { string: 'hello' }],
              },
              { string: { equals: 'hello' } },
            ],
          },
        }),
      ).resolves.toBe(true)
    })

    test('nested OR + NOT', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            OR: [{ string: 'world' }, { NOT: { string: 'foo' } }],
          },
        }),
      ).resolves.toBe(true)
    })

    test('complex nested AND + OR + NOT (false)', async () => {
      await expect(
        matches(baseEvent, {
          created: {
            AND: [
              {
                OR: [{ string: 'foo' }, { string: 'bar' }],
              },
              { NOT: { string: 'hello' } },
            ],
          },
        }),
      ).resolves.toBe(false)
    })
  })
})

describe('custom types', () => {
  type Contact = RecordCreatedEvent<typeof schema, 'Contact'>['created']
  type ContactWhen = NonNullable<
    EventDiscriminatorOptions<typeof schema, 'Contact'>['when']
  >['created']

  const hanoi = {
    city: 'Hanoi',
    country: 'VN',
    geo: { lat: 21, lng: 105 },
    tags: ['home', 'office'],
    role: 'ADMIN' as const,
  }

  const lima = {
    city: 'Lima',
    tags: [],
  }

  const contact = {
    id: '1',
    createdAt: baseDate,
    email: 'a@example.com',
    emails: ['a@example.com', 'b@example.com'],
    age: 30,
    balance: Decimal(10),
    visits: BigInt(5),
    lastSeen: baseDate,
    profile: {
      name: 'Ada',
      nickname: 'ada@example.com',
      age: 30,
      address: hanoi,
      addresses: [hanoi, lima],
    },
    addresses: [hanoi, lima],
  } as Contact

  function discriminatorMatches(when: ContactWhen, event: Contact = contact) {
    return new EventDiscriminator({
      client,
      model: 'Contact',
      when: { created: when },
    }).eventMatchesWhere({
      type: 'created',
      created: event,
      date: baseDate,
      transactionId: '1',
      id: '1',
    })
  }

  describe('primitive', () => {
    // Unlike `matches`, this fails if either side disagrees, rather than only if both match.
    async function expectMatch(when: ContactWhen, expected: boolean, event: Contact = contact) {
      await client.contact.create({ data: event as any })

      await expect(client.contact.exists({ where: when })).resolves.toBe(expected)
      expect(discriminatorMatches(when, event)).toBe(expected)
    }

    test.each<[string, ContactWhen, boolean]>([
      ['String (positive)', { email: 'a@example.com' }, true],
      ['String (negative)', { email: 'z@example.com' }, false],
      ['String filter', { email: { endsWith: '@example.com' } }, true],
      ['String array (positive)', { emails: { has: 'b@example.com' } }, true],
      ['String array (negative)', { emails: { has: 'z@example.com' } }, false],
      ['Int (positive)', { age: { gte: 30 } }, true],
      ['Int (negative)', { age: { gt: 30 } }, false],
      ['BigInt (positive)', { visits: { lt: 6 } }, true],
      ['BigInt (negative)', { visits: { lt: 5 } }, false],
      ['Decimal (positive)', { balance: { gt: 9 } }, true],
      ['Decimal (negative)', { balance: { gt: 10 } }, false],
      ['BigInt shorthand (positive)', { visits: 5 }, true],
      ['BigInt shorthand (negative)', { visits: 6 }, false],
      ['BigInt equals (positive)', { visits: { equals: 5 } }, true],
      ['BigInt equals (negative)', { visits: { equals: 6 } }, false],
      ['BigInt equals null (negative)', { visits: { equals: null } }, false],
      ['Decimal shorthand (positive)', { balance: 10 }, true],
      ['Decimal shorthand (negative)', { balance: 11 }, false],
      ['Decimal equals (positive)', { balance: { equals: 10 } }, true],
      ['Decimal equals (negative)', { balance: { equals: 11 } }, false],
      ['Decimal equals null (negative)', { balance: { equals: null } }, false],
      ['Decimal notIn (positive)', { balance: { notIn: [9, 11] } }, true],
      ['Decimal notIn (negative)', { balance: { notIn: [10, 11] } }, false],
      ['DateTime (positive)', { lastSeen: { lt: laterDate } }, true],
      ['DateTime (negative)', { lastSeen: { lt: earlierDate } }, false],
      ['null (negative)', { age: null }, false],
      ['mixin (positive)', { createdAt: { lt: laterDate } }, true],
      ['mixin (negative)', { createdAt: { gt: laterDate } }, false],
    ])('%s', async (_, when, expected) => {
      await expectMatch(when, expected)
    })

    test('null (positive)', async () => {
      await expectMatch({ age: null }, true, { ...contact, age: null })
    })

    const nullableFields = [
      ['Int', 'age'],
      ['BigInt', 'visits'],
      ['Decimal', 'balance'],
      ['DateTime', 'lastSeen'],
    ] as const

    test.each(nullableFields)('%s not null (set)', async (_, field) => {
      await expectMatch({ [field]: { not: null } }, true)
    })

    test.each(nullableFields)('%s not null (null)', async (_, field) => {
      await expectMatch({ [field]: { not: null } }, false, { ...contact, [field]: null })
    })

    test.each(nullableFields)('%s not equals null (set)', async (_, field) => {
      await expectMatch({ [field]: { not: { equals: null } } }, true)
    })

    test.each(nullableFields)('%s not equals null (null)', async (_, field) => {
      await expectMatch({ [field]: { not: { equals: null } } }, false, {
        ...contact,
        [field]: null,
      })
    })

    test.each(nullableFields)('%s equals null (set)', async (_, field) => {
      await expectMatch({ [field]: { equals: null } }, false)
    })

    test.each(nullableFields)('%s equals null (null)', async (_, field) => {
      await expectMatch({ [field]: { equals: null } }, true, { ...contact, [field]: null })
    })

    test('BigInt equals null (positive)', async () => {
      await expectMatch({ visits: { equals: null } }, true, { ...contact, visits: null })
    })

    test('Decimal equals null (positive)', async () => {
      await expectMatch({ balance: { equals: null } }, true, { ...contact, balance: null })
    })
  })

  // ZenStack's JSON filters need Postgres 12, so these can't be compared with the database.
  describe('json', () => {
    test.each<[string, ContactWhen, boolean]>([
      ['field (positive)', { profile: { name: 'Ada' } }, true],
      ['field (negative)', { profile: { name: 'Bob' } }, false],
      ['field filter', { profile: { name: { startsWith: 'A' } } }, true],
      ['multiple fields (positive)', { profile: { name: 'Ada', age: 30 } }, true],
      ['multiple fields (negative)', { profile: { name: 'Ada', age: 31 } }, false],
      ['primitive field (positive)', { profile: { nickname: 'ada@example.com' } }, true],
      ['primitive field (negative)', { profile: { age: { gt: 30 } } }, false],
      ['absent field', { profile: { balance: { gt: 0 } } }, false],
      ['absent field null', { profile: { balance: null } }, true],
      ['is (positive)', { profile: { is: { name: 'Ada' } } }, true],
      ['is (negative)', { profile: { is: { name: 'Bob' } } }, false],
      ['isNot (positive)', { profile: { isNot: { name: 'Bob' } } }, true],
      ['isNot (negative)', { profile: { isNot: { name: 'Ada' } } }, false],
      ['is and isNot', { profile: { is: { name: 'Ada' }, isNot: { age: 30 } } }, false],
      ['nested (positive)', { profile: { address: { city: 'Hanoi' } } }, true],
      ['nested (negative)', { profile: { address: { city: 'Lima' } } }, false],
      ['deeply nested (positive)', { profile: { address: { geo: { lat: 21 } } } }, true],
      ['deeply nested (negative)', { profile: { address: { geo: { lat: 22 } } } }, false],
      ['nested is', { profile: { address: { is: { country: 'VN' } } } }, true],
      ['enum (positive)', { profile: { address: { role: 'ADMIN' } } }, true],
      ['enum (negative)', { profile: { address: { role: 'USER' } } }, false],
      ['enum filter', { profile: { address: { role: { in: ['USER'] } } } }, false],
      ['array field (positive)', { profile: { address: { tags: { has: 'home' } } } }, true],
      ['array field (negative)', { profile: { address: { tags: { has: 'gym' } } } }, false],
      ['some (positive)', { profile: { addresses: { some: { city: 'Lima' } } } }, true],
      ['some (negative)', { profile: { addresses: { some: { city: 'Oslo' } } } }, false],
      ['none (positive)', { profile: { addresses: { none: { city: 'Oslo' } } } }, true],
      ['none (negative)', { profile: { addresses: { none: { city: 'Lima' } } } }, false],
      [
        'every (positive)',
        { profile: { addresses: { every: { city: { in: ['Hanoi', 'Lima'] } } } } },
        true,
      ],
      ['every (negative)', { profile: { addresses: { every: { city: 'Lima' } } } }, false],
      [
        'some and none',
        { profile: { addresses: { some: { city: 'Lima' }, none: { city: 'Hanoi' } } } },
        false,
      ],
    ])('%s', (_, when, expected) => {
      expect(discriminatorMatches(when)).toBe(expected)
    })

    test('hydrated fields', () => {
      const event = {
        ...contact,
        profile: { ...contact.profile!, joinedAt: baseDate, balance: Decimal(10) },
      }

      expect(discriminatorMatches({ profile: { joinedAt: { lt: laterDate } } }, event)).toBe(true)
      expect(discriminatorMatches({ profile: { joinedAt: { gt: laterDate } } }, event)).toBe(false)
      expect(discriminatorMatches({ profile: { balance: { gt: 9 } } }, event)).toBe(true)
      expect(discriminatorMatches({ profile: { balance: { gt: 10 } } }, event)).toBe(false)
    })

    test('null', () => {
      const event = { ...contact, profile: null }

      for (const when of [null, DbNull, AnyNull]) {
        expect(discriminatorMatches({ profile: when }, event)).toBe(true)
        expect(discriminatorMatches({ profile: when })).toBe(false)
      }

      expect(discriminatorMatches({ profile: JsonNull }, event)).toBe(false)
    })

    test('null never matches field filters', () => {
      const event = { ...contact, profile: null }

      expect(discriminatorMatches({ profile: { name: 'Ada' } }, event)).toBe(false)
      expect(discriminatorMatches({ profile: { is: { name: 'Ada' } } }, event)).toBe(false)
      expect(discriminatorMatches({ profile: { isNot: { name: 'Ada' } } }, event)).toBe(false)
    })

    test('rejects filters that have to run in the database', () => {
      expect(() =>
        discriminatorMatches({ profile: { path: '$.age ? (@ > 1)', equals: 1 } }),
      ).toThrow('JSON path "$.age ? (@ > 1)" is not supported')

      expect(() => discriminatorMatches({ $expr: () => null } as any)).toThrow(
        'Filter "$expr" is not supported',
      )
    })
  })

  describe('json array', () => {
    const empty = { ...contact, addresses: [] }

    test.each<[string, ContactWhen, boolean]>([
      ['equals (positive)', { addresses: { equals: [hanoi, lima] } }, true],
      [
        'equals (key order)',
        {
          addresses: {
            equals: [
              { ...hanoi, city: 'Hanoi' },
              { tags: [], city: 'Lima' },
            ],
          },
        },
        true,
      ],
      ['equals (element order)', { addresses: { equals: [lima, hanoi] } }, false],
      ['equals (subset)', { addresses: { equals: [hanoi] } }, false],
      ['has (positive)', { addresses: { has: lima } }, true],
      ['has (negative)', { addresses: { has: { city: 'Oslo', tags: [] } } }, false],
      ['hasEvery (positive)', { addresses: { hasEvery: [lima, hanoi] } }, true],
      [
        'hasEvery (negative)',
        { addresses: { hasEvery: [lima, { city: 'Oslo', tags: [] }] } },
        false,
      ],
      ['hasSome (positive)', { addresses: { hasSome: [{ city: 'Oslo', tags: [] }, lima] } }, true],
      ['hasSome (negative)', { addresses: { hasSome: [{ city: 'Oslo', tags: [] }] } }, false],
      ['isEmpty (false)', { addresses: { isEmpty: false } }, true],
      ['isEmpty (true)', { addresses: { isEmpty: true } }, false],
    ])('%s', (_, when, expected) => {
      expect(discriminatorMatches(when)).toBe(expected)
    })

    test.each<[string, ContactWhen, boolean]>([
      ['isEmpty (true)', { addresses: { isEmpty: true } }, true],
      ['isEmpty (false)', { addresses: { isEmpty: false } }, false],
      ['equals', { addresses: { equals: [] } }, true],
      ['has', { addresses: { has: lima } }, false],
    ])('%s on empty array', (_, when, expected) => {
      expect(discriminatorMatches(when, empty)).toBe(expected)
    })

    test('compares hydrated values', () => {
      const address = { ...hanoi, movedAt: baseDate }
      const event = { ...contact, addresses: [address] }

      expect(
        discriminatorMatches({ addresses: { has: { ...hanoi, movedAt: baseDate } } }, event),
      ).toBe(true)
      expect(
        discriminatorMatches({ addresses: { has: { ...hanoi, movedAt: laterDate } } }, event),
      ).toBe(false)
    })
  })
})

describe('strict filters', () => {
  const user = baseEvent.created

  function discriminatorMatches(when: any, created: any = user) {
    return new EventDiscriminator({
      client,
      model: 'User',
      when: { created: when },
    }).eventMatchesWhere({ ...baseEvent, created })
  }

  // The schema has no enum array, because they can't be replicated yet, so one is added just here.
  function enumArrayMatches(enumArray: unknown, value: string[]) {
    const { User } = schema.models
    const enumArraySchema = {
      ...schema,
      models: {
        ...schema.models,
        User: {
          ...User,
          fields: { ...User.fields, enumArray: { name: 'enumArray', type: 'Role', array: true } },
        },
      },
    }

    return new EventDiscriminator({
      client: { ...client, $schema: enumArraySchema, $options: client.$options } as any,
      model: 'User',
      when: { created: { enumArray } as any },
    }).eventMatchesWhere({ ...baseEvent, created: { ...user, enumArray: value } as any })
  }

  // Unlike `matches`, this fails if either side disagrees, rather than only if both match.
  async function expectMatch(when: any, expected: boolean, created: any = user) {
    await client.user.create({ data: created })

    await expect(client.user.exists({ where: when })).resolves.toBe(expected)
    expect(discriminatorMatches(when, created)).toBe(expected)
  }

  describe('BigInt', () => {
    test.each<[string, unknown, boolean]>([
      ['number shorthand (positive)', 1, true],
      ['number shorthand (negative)', 5, false],
      ['bigint shorthand (positive)', 1n, true],
      ['bigint shorthand (negative)', 5n, false],
      ['number equals (positive)', { equals: 1 }, true],
      ['number equals (negative)', { equals: 5 }, false],
      ['bigint equals (positive)', { equals: 1n }, true],
      ['bigint equals (negative)', { equals: 5n }, false],
      ['number not (positive)', { not: 5 }, true],
      ['number not (negative)', { not: 1 }, false],
      ['in (positive)', { in: [1n, 2n] }, true],
      ['in (negative)', { in: [2n, 3n] }, false],
      ['notIn (positive)', { notIn: [2n, 3n] }, true],
      ['notIn (negative)', { notIn: [1n, 2n] }, false],
      ['number in (positive)', { in: [1, 2] }, true],
      ['number in (negative)', { in: [2, 3] }, false],
      ['number notIn (positive)', { notIn: [2, 3] }, true],
      ['number notIn (negative)', { notIn: [1, 2] }, false],
      ['empty in', { in: [] }, false],
      ['empty notIn', { notIn: [] }, true],
    ])('%s', async (_, bigInt, expected) => {
      await expectMatch({ bigInt }, expected)
    })

    test('rejects a number that is not an integer', async () => {
      expect(() => discriminatorMatches({ bigInt: 1.5 })).toThrow('expected int')
      await expect(client.user.exists({ where: { bigInt: 1.5 } })).rejects.toThrow('expected int')
    })
  })

  describe('Decimal', () => {
    test.each<[string, unknown, boolean]>([
      ['Decimal shorthand (positive)', Decimal(1), true],
      ['Decimal shorthand (negative)', Decimal(5), false],
      ['number shorthand (positive)', 1, true],
      ['number shorthand (negative)', 5, false],
      ['string shorthand (positive)', '1.0', true],
      ['string shorthand (negative)', '1.5', false],
      ['Decimal equals (positive)', { equals: Decimal(1) }, true],
      ['Decimal equals (negative)', { equals: Decimal(5) }, false],
      ['number equals (positive)', { equals: 1 }, true],
      ['number equals (negative)', { equals: 5 }, false],
      ['in (positive)', { in: [Decimal(1), Decimal(2)] }, true],
      ['in (negative)', { in: [Decimal(2), Decimal(3)] }, false],
      ['notIn (positive)', { notIn: [Decimal(2), Decimal(3)] }, true],
      ['notIn (negative)', { notIn: [Decimal(1), Decimal(2)] }, false],
      ['number in (positive)', { in: [1, 2] }, true],
      ['number in (negative)', { in: [2, 3] }, false],
      ['number notIn (positive)', { notIn: [2, 3] }, true],
      ['number notIn (negative)', { notIn: [1, 2] }, false],
      ['not (positive)', { not: Decimal(5) }, true],
      ['not (negative)', { not: Decimal(1) }, false],
      ['number not (negative)', { not: 1 }, false],
      ['nested not (negative)', { not: { equals: Decimal(1) } }, false],
      ['number gt (positive)', { gt: 0 }, true],
      ['number gt (negative)', { gt: 1 }, false],
      ['number between (positive)', { between: [0, 2] }, true],
      ['number between (negative)', { between: [2, 3] }, false],
    ])('%s', async (_, decimal, expected) => {
      await expectMatch({ decimal }, expected)
    })

    // `WhereInput` allows a bigint here, but ZenStack rejects it at runtime.
    test('rejects a bigint', async () => {
      expect(() => discriminatorMatches({ decimal: 1n })).toThrow('Invalid exists args')
      await expect(client.user.exists({ where: { decimal: 1n } })).rejects.toThrow()
    })
  })

  describe('DateTime', () => {
    const iso = (date: Date) => date.toISOString()

    test.each<[string, unknown, boolean]>([
      ['notIn (positive)', { notIn: [laterDate, earlierDate] }, true],
      ['notIn with the value first', { notIn: [baseDate, laterDate] }, false],
      ['notIn with the value last', { notIn: [laterDate, baseDate] }, false],
      ['notIn with only the value', { notIn: [baseDate] }, false],
      ['string shorthand (positive)', iso(baseDate), true],
      ['string shorthand (negative)', iso(laterDate), false],
      ['string equals (positive)', { equals: iso(baseDate) }, true],
      ['string equals (negative)', { equals: iso(laterDate) }, false],
      ['string in (positive)', { in: [iso(baseDate), iso(laterDate)] }, true],
      ['string in (negative)', { in: [iso(laterDate)] }, false],
      ['string notIn (positive)', { notIn: [iso(laterDate)] }, true],
      ['string notIn (negative)', { notIn: [iso(laterDate), iso(baseDate)] }, false],
      ['string gt (positive)', { gt: iso(earlierDate) }, true],
      ['string gt (negative)', { gt: iso(baseDate) }, false],
      ['string gte (positive)', { gte: iso(baseDate) }, true],
      ['string gte (negative)', { gte: iso(laterDate) }, false],
      ['string lt (positive)', { lt: iso(laterDate) }, true],
      ['string lt (negative)', { lt: iso(baseDate) }, false],
      ['string lte (positive)', { lte: iso(baseDate) }, true],
      ['string lte (negative)', { lte: iso(earlierDate) }, false],
      ['string not (positive)', { not: iso(laterDate) }, true],
      ['string not (negative)', { not: iso(baseDate) }, false],
      ['string between (positive)', { between: [iso(earlierDate), iso(laterDate)] }, true],
      ['string between (negative)', { between: [iso(laterDate), iso(laterDate)] }, false],
      ['date-only string (positive)', '2024-01-01', true],
      ['date-only string (negative)', '2024-01-02', false],
      ['offset string (positive)', '2024-01-01T02:00:00+02:00', true],
      ['offset string (negative)', '2024-01-01T00:00:00+02:00', false],
    ])('%s', async (_, dateTime, expected) => {
      await expectMatch({ dateTime }, expected)
    })

    test.each([
      ['nonsense', 'not a date'],
      ['an impossible date', '2024-13-45T00:00:00Z'],
      ['an empty string', ''],
    ])('rejects %s', async (_, value) => {
      expect(() => discriminatorMatches({ dateTime: value })).toThrow('Invalid exists args')
      await expect(client.user.exists({ where: { dateTime: value } })).rejects.toThrow()
    })

    test.each([
      ['equals', { equals: 'bad' }],
      ['in', { in: [baseDate, 'bad'] }],
      ['gt', { gt: 'bad' }],
      ['not', { not: 'bad' }],
      ['nested not', { not: { not: { gt: 'bad' } } }],
      ['between', { between: ['bad', baseDate] }],
    ])('rejects %s when the stream is created', (_, dateTime) => {
      expect(
        () =>
          new EventDiscriminator({
            client,
            model: 'User',
            when: { created: { dateTime } as any },
          }),
      ).toThrow('Invalid exists args')
    })

    test.each([
      ['AND', { AND: [{ dateTime: 'bad' }] }],
      ['OR', { OR: [{ dateTime: { gt: 'bad' } }] }],
      ['NOT', { NOT: { dateTime: { not: 'bad' } } }],
    ])('rejects inside %s when the stream is created', (_, created) => {
      expect(
        () => new EventDiscriminator({ client, model: 'User', when: { created: created as any } }),
      ).toThrow('Invalid exists args')
    })
  })

  describe('array equals', () => {
    const fields = [
      ['stringArray', ['a', 'b'], 'c'],
      ['booleanArray', [true, false], true],
      ['intArray', [1, 2], 3],
      ['floatArray', [1.5, 2.5], 3.5],
      ['bigIntArray', [1n, 2n], 3n],
      ['decimalArray', [Decimal(1), Decimal(2)], Decimal(3)],
    ] as const

    test.each(fields)('%s (same)', async (field, items) => {
      await expectMatch({ [field]: { equals: items } }, true, { ...user, [field]: items })
    })

    test.each(fields)('%s (shorter than the filter)', async (field, items, extra) => {
      await expectMatch({ [field]: { equals: [...items, extra] } }, false, {
        ...user,
        [field]: items,
      })
    })

    test.each(fields)('%s (longer than the filter)', async (field, items) => {
      await expectMatch({ [field]: { equals: items.slice(0, 1) } }, false, {
        ...user,
        [field]: items,
      })
    })

    test.each(fields)('%s (empty against a populated filter)', async (field, items) => {
      await expectMatch({ [field]: { equals: items } }, false, { ...user, [field]: [] })
    })

    test.each(fields)('%s (populated against an empty filter)', async (field, items) => {
      await expectMatch({ [field]: { equals: [] } }, false, { ...user, [field]: items })
    })

    test.each(fields)('%s (rejects equals null)', async field => {
      expect(() => discriminatorMatches({ [field]: { equals: null } })).toThrow(
        'Invalid exists args',
      )
      await expect(client.user.exists({ where: { [field]: { equals: null } } })).rejects.toThrow()
    })

    test('rejects has null', async () => {
      expect(() => discriminatorMatches({ decimalArray: { has: null } })).toThrow(
        'Invalid exists args',
      )
    })

    test.each([
      [['USER'], ['USER'], true],
      [['USER'], ['USER', 'ADMIN'], false],
      [['USER', 'ADMIN'], ['USER'], false],
      [[], ['USER'], false],
    ])('Enum[] (%j, %j)', (value, equals, expected) => {
      expect(enumArrayMatches({ equals }, value)).toBe(expected)
    })
  })

  describe('isEmpty', () => {
    const fields = ['stringArray', 'booleanArray', 'intArray', 'floatArray', 'bigIntArray'] as const

    test.each(fields)('%s (false, populated)', async field => {
      await expectMatch({ [field]: { isEmpty: false } }, true)
    })

    test.each(fields)('%s (false, empty)', async field => {
      await expectMatch({ [field]: { isEmpty: false } }, false, { ...user, [field]: [] })
    })

    test.each(fields)('%s (true, populated)', async field => {
      await expectMatch({ [field]: { isEmpty: true } }, false)
    })

    test.each(fields)('%s (true, empty)', async field => {
      await expectMatch({ [field]: { isEmpty: true } }, true, { ...user, [field]: [] })
    })

    test.each(fields)('%s (combined with has)', async field => {
      await expectMatch({ [field]: { isEmpty: true, has: user[field][0] } }, false)
    })

    // ZenStack compiles `isEmpty` on a `Decimal[]` to `!= '{}'`, even when it's true.
    test.each([
      [false, [Decimal(1)], true],
      [false, [], false],
      [true, [Decimal(1)], false],
      [true, [], true],
    ])('Decimal[] (%s, %j)', (isEmpty, decimalArray, expected) => {
      expect(discriminatorMatches({ decimalArray: { isEmpty } }, { ...user, decimalArray })).toBe(
        expected,
      )
    })

    test.each([
      [false, ['USER'], true],
      [false, [], false],
      [true, ['USER'], false],
      [true, [], true],
    ])('Enum[] (%s, %j)', (isEmpty, value, expected) => {
      expect(enumArrayMatches({ isEmpty }, value)).toBe(expected)
    })
  })
})

describe('Enum filters', () => {
  test('are applied by the discriminator', () => {
    const discriminator = new EventDiscriminator({
      client,
      model: 'User',
      when: { created: { enum: 'ADMIN' } },
    })

    expect(discriminator.eventMatchesWhere(baseEvent)).toBe(false)
  })
})

// Each filter runs through ZenStack and the discriminator against each row, and they have to agree.
describe('ZenStack parity', () => {
  const profile = {
    name: 'Ada',
    age: 30,
    nickname: 'ada@example.com',
    address: { city: 'Hanoi', geo: { lat: 21, lng: 105 }, tags: ['home'], role: 'ADMIN' },
    addresses: [
      { city: 'Hanoi', tags: [], role: 'ADMIN' },
      { city: 'Lima', tags: [] },
    ],
  }

  const columns = {
    full: {
      email: `'Ada@Example.com'`,
      emails: `'{a@example.com,b@example.com}'`,
      age: '30',
      balance: '10.50',
      visits: '5',
      lastSeen: `'2024-01-01T00:00:00.000Z'`,
      profile: `'${JSON.stringify(profile)}'`,
      addresses: `'[]'`,
      metadata: `'{"plan":"pro","limits":[1,2],"nested":{"ok":true},"none":null,"text":"Hi_%"}'`,
      history: `ARRAY['{"a":1}','2']::jsonb[]`,
      avatar: `'\\x0102'`,
      seenAt: `ARRAY['2024-01-01T00:00:00.000Z']::timestamp[]`,
    },
    nulls: { email: `'b@example.com'`, addresses: `'[]'`, emails: `'{}'`, seenAt: `'{}'` },
    jsonNull: {
      email: `'c@example.com'`,
      addresses: `'[]'`,
      metadata: `'null'`,
      profile: `'null'`,
    },
    jsonString: { email: `'d@example.com'`, addresses: `'[]'`, metadata: `'"Hello"'` },
    jsonNumber: { email: `'e@example.com'`, addresses: `'[]'`, metadata: `'5'` },
    jsonArray: { email: `'f@example.com'`, addresses: `'[]'`, metadata: `'[1,"x",{"a":1,"b":2}]'` },
    mismatched: {
      email: `'g@example.com'`,
      addresses: `'[]'`,
      profile: `'{"name":5,"age":"x","nickname":null,"address":null}'`,
    },
  }

  const rows: Record<string, any> = {}

  beforeAll(async () => {
    await client.contact.deleteMany({ where: { id: { startsWith: 'parity-' } } })

    for (const [name, row] of Object.entries(columns)) {
      const id = `parity-${name}`

      await client.$queryRawUnsafe(
        `INSERT INTO "Contact" ("id", ${Object.keys(row).map(column => `"${column}"`)})
         VALUES ('${id}', ${Object.values(row)})`,
      )

      const [source] = await client.$queryRawUnsafe<Record<string, string | boolean | null>[]>(
        `SELECT "metadata"::text, "profile"::text, "emails" IS NULL AS "emailsNull",
                "history" IS NULL AS "historyNull", "seenAt" IS NULL AS "seenAtNull"
         FROM "Contact" WHERE "id" = '${id}'`,
      )

      const { metadata, profile, emailsNull, historyNull, seenAtNull } = source!

      rows[id] = await client.contact.findUniqueOrThrow({ where: { id } })

      Object.defineProperty(rows[id], sourceValues, {
        value: {
          ...(metadata === null ? {} : { metadata: JSON.parse(metadata as string) }),
          ...(profile === null ? {} : { profile: JSON.parse(profile as string) }),
          ...(emailsNull ? { emails: undefined } : {}),
          ...(historyNull ? { history: undefined } : {}),
          ...(seenAtNull ? { seenAt: undefined } : {}),
        },
      })
    }
  })

  afterAll(async () => {
    await client.contact.deleteMany({ where: { id: { startsWith: 'parity-' } } })
  })

  const filters: Record<string, unknown>[] = [
    // Logic
    {},
    { AND: [] },
    { OR: [] },
    { NOT: [] },
    { AND: [{}] },
    { OR: [{}] },
    { NOT: [{}] },
    { OR: [{}, { age: 30 }] },
    { NOT: {} },
    { NOT: { age: 30 } },
    { NOT: { age: 31 } },
    { NOT: { age: null } },
    { NOT: [{ age: 30 }, { visits: 6 }] },
    { NOT: [{ age: 30 }, { visits: 5 }] },
    { NOT: { NOT: { age: 30 } } },
    { NOT: { OR: [{ age: 31 }, { visits: 5 }] } },
    { NOT: { AND: [{ age: 30 }, { visits: 6 }] } },
    { OR: [{ age: 31 }, { visits: 5 }] },
    { AND: { age: 30 } },
    { AND: [{ age: 30 }], OR: [{ visits: 6 }, { visits: 5 }], NOT: { balance: 1 } },
    { age: undefined },
    { age: {} },
    { age: { not: {} } },
    { age: { equals: undefined } },
    { age: 30, visits: 5 },

    // Int
    { age: 30 },
    { age: null },
    { age: { equals: 30 } },
    { age: { equals: null } },
    { age: { not: null } },
    { age: { not: 30 } },
    { age: { not: { equals: null } } },
    { age: { not: { not: 30 } } },
    { age: { not: { gt: 40 } } },
    { age: { in: [30, 31] } },
    { age: { in: [] } },
    { age: { notIn: [30] } },
    { age: { notIn: [31] } },
    { age: { notIn: [] } },
    { age: { gt: 20, lt: 40 } },
    { age: { gt: 40, lt: 50 } },
    { age: { equals: 30, gt: 40 } },
    { age: { equals: 31, gt: 20 } },
    { age: { lte: 30, gte: 30 } },
    { age: { between: [30, 30] } },
    { age: { between: [31, 40] } },

    // BigInt
    { visits: 5 },
    { visits: 5n },
    { visits: null },
    { visits: { equals: 5 } },
    { visits: { in: [5n, 6] } },
    { visits: { notIn: [5] } },
    { visits: { notIn: [6n] } },
    { visits: { gt: 4n } },
    { visits: { lt: 5 } },
    { visits: { not: 5 } },
    { visits: { not: null } },
    { visits: { between: [1, 5n] } },

    // Decimal
    { balance: 10.5 },
    { balance: '10.5' },
    { balance: '10.50' },
    { balance: Decimal('10.5') },
    { balance: 11 },
    { balance: null },
    { balance: { equals: '10.500' } },
    { balance: { in: [10.5, '11'] } },
    { balance: { in: [Decimal(1)] } },
    { balance: { notIn: [Decimal('10.5')] } },
    { balance: { notIn: ['1'] } },
    { balance: { gt: '10' } },
    { balance: { gte: 10.5 } },
    { balance: { lt: Decimal(10) } },
    { balance: { lte: 10.5 } },
    { balance: { between: ['10', 11] } },
    { balance: { not: 10.5 } },
    { balance: { not: null } },
    { balance: { not: { gt: 11 } } },

    // DateTime
    { lastSeen: baseDate },
    { lastSeen: baseDate.toISOString() },
    { lastSeen: '2024-01-01' },
    { lastSeen: '2024-01-01T02:00:00+02:00' },
    { lastSeen: 'Jan 1 2024 00:00 UTC' },
    { lastSeen: 'banana 1' },
    { lastSeen: '00:00' },
    { lastSeen: null },
    { lastSeen: { equals: null } },
    { lastSeen: { not: null } },
    { lastSeen: { equals: laterDate } },
    { lastSeen: { in: [baseDate, laterDate] } },
    { lastSeen: { in: ['banana 1'] } },
    { lastSeen: { notIn: [laterDate, baseDate] } },
    { lastSeen: { notIn: [laterDate, earlierDate] } },
    { lastSeen: { gt: earlierDate.toISOString() } },
    { lastSeen: { lt: 'banana 1' } },
    { lastSeen: { between: [earlierDate, laterDate] } },
    { lastSeen: { not: baseDate } },
    { lastSeen: { not: { gt: laterDate } } },

    // String
    { email: 'Ada@Example.com' },
    { email: 'ada@example.com' },
    { email: { equals: 'ADA@EXAMPLE.COM', mode: 'insensitive' } },
    { email: { equals: 'nope@example.com', mode: 'insensitive' } },
    { email: { in: ['ADA@EXAMPLE.COM'], mode: 'insensitive' } },
    { email: { notIn: ['ADA@EXAMPLE.COM'], mode: 'insensitive' } },
    { email: { in: ['ADA@EXAMPLE.COM'] } },
    { email: { contains: 'EXAMPLE', mode: 'insensitive' } },
    { email: { contains: 'EXAMPLE' } },
    { email: { contains: 'Example' } },
    { email: { contains: '%' } },
    { email: { contains: '_' } },
    { email: { contains: '' } },
    { email: { startsWith: 'ADA', mode: 'insensitive' } },
    { email: { startsWith: 'ADA' } },
    { email: { startsWith: 'Ada', endsWith: '.com' } },
    { email: { endsWith: '.COM', mode: 'insensitive' } },
    { email: { endsWith: '.COM' } },
    { email: { not: 'ADA@EXAMPLE.COM', mode: 'insensitive' } },
    { email: { not: { equals: 'ADA@EXAMPLE.COM', mode: 'insensitive' } } },
    { email: { not: { contains: 'example' } } },
    { email: { contains: 'example', not: 'b@example.com' } },
    { email: { equals: 'ADA@EXAMPLE.COM', contains: 'nope', mode: 'insensitive' } },

    // Scalar arrays
    { emails: {} },
    { emails: { equals: ['a@example.com', 'b@example.com'] } },
    { emails: { equals: ['b@example.com', 'a@example.com'] } },
    { emails: { equals: ['a@example.com'] } },
    { emails: { equals: [] } },
    { emails: { has: 'a@example.com' } },
    { emails: { has: 'z@example.com' } },
    { emails: { hasEvery: ['a@example.com', 'b@example.com'] } },
    { emails: { hasEvery: ['a@example.com', 'z@example.com'] } },
    { emails: { hasEvery: [] } },
    { emails: { hasSome: ['z@example.com', 'a@example.com'] } },
    { emails: { hasSome: ['z@example.com'] } },
    { emails: { hasSome: [] } },
    { emails: { isEmpty: true } },
    { emails: { isEmpty: false } },
    { emails: { has: 'a@example.com', isEmpty: true } },
    { seenAt: { has: baseDate } },
    { seenAt: { has: laterDate } },
    { seenAt: { equals: [baseDate] } },
    { seenAt: { hasEvery: [baseDate] } },
    { seenAt: { hasSome: [laterDate] } },
    { seenAt: { isEmpty: true } },
    { seenAt: { isEmpty: false } },

    // Bytes
    { avatar: new Uint8Array([1, 2]) },
    { avatar: new Uint8Array([1, 3]) },
    { avatar: null },
    { avatar: { equals: new Uint8Array([1, 2]) } },
    { avatar: { equals: null } },
    { avatar: { in: [new Uint8Array([1, 2])] } },
    { avatar: { notIn: [new Uint8Array([1, 2])] } },
    { avatar: { not: new Uint8Array([1, 2]) } },

    // Json
    {
      metadata: {
        equals: { plan: 'pro', limits: [1, 2], nested: { ok: true }, none: null, text: 'Hi_%' },
      },
    },
    { metadata: { equals: { limits: [1, 2], plan: 'pro' } } },
    { metadata: { equals: 'Hello' } },
    { metadata: { equals: 5 } },
    { metadata: { equals: [1, 'x', { b: 2, a: 1 }] } },
    { metadata: { equals: null } },
    { metadata: { equals: DbNull } },
    { metadata: { equals: JsonNull } },
    { metadata: { equals: AnyNull } },
    { metadata: { not: 5 } },
    { metadata: { not: null } },
    { metadata: { not: DbNull } },
    { metadata: { not: JsonNull } },
    { metadata: { not: AnyNull } },
    { metadata: { path: '$.plan', equals: 'pro' } },
    { metadata: { path: '$.plan', equals: 'free' } },
    { metadata: { path: '$.plan', not: 'free' } },
    { metadata: { path: '$.missing', equals: DbNull } },
    { metadata: { path: '$.none', equals: DbNull } },
    { metadata: { path: '$.none', equals: JsonNull } },
    { metadata: { path: '$.none', equals: AnyNull } },
    { metadata: { path: '$.missing', equals: AnyNull } },
    { metadata: { path: '$.limits[0]', equals: 1 } },
    { metadata: { path: '$.limits[1]', equals: 1 } },
    { metadata: { path: '$.limits[last]', equals: 2 } },
    { metadata: { path: '$.limits[*]', equals: 1 } },
    { metadata: { path: '$.limits[5]', equals: 1 } },
    { metadata: { path: '$.nested.ok', equals: true } },
    { metadata: { path: '$.nested."ok"', equals: true } },
    { metadata: { path: '$.*', equals: 'pro' } },
    { metadata: { path: '$[0]', equals: 1 } },
    { metadata: { path: '$[2].a', equals: 1 } },
    { metadata: { path: '$.a', equals: 1 } },
    { metadata: { path: '$.plan[0]', equals: 'pro' } },
    { metadata: { string_contains: 'ell' } },
    { metadata: { string_contains: 'ELL' } },
    { metadata: { string_contains: 'ELL', mode: 'insensitive' } },
    { metadata: { string_starts_with: 'He' } },
    { metadata: { string_starts_with: 'el' } },
    { metadata: { string_ends_with: 'lo' } },
    { metadata: { string_ends_with: 'LO', mode: 'insensitive' } },
    { metadata: { path: '$.plan', string_contains: 'r' } },
    { metadata: { path: '$.text', string_contains: '_' } },
    { metadata: { path: '$.text', string_contains: '%' } },
    { metadata: { path: '$.limits', string_contains: '1' } },
    { metadata: { path: '$.missing', string_contains: 'r' } },
    { metadata: { array_contains: 1 } },
    { metadata: { array_contains: 'x' } },
    { metadata: { array_contains: 9 } },
    { metadata: { array_contains: [1, 'x'] } },
    { metadata: { array_contains: { a: 1 } } },
    { metadata: { array_contains: { a: 2 } } },
    { metadata: { array_contains: [] } },
    { metadata: { array_starts_with: 1 } },
    { metadata: { array_starts_with: 'x' } },
    { metadata: { path: '$.limits', array_contains: 2 } },
    { metadata: { path: '$.limits', array_starts_with: 1 } },
    { metadata: { path: '$.limits', array_ends_with: 2 } },
    { metadata: { path: '$.limits', array_ends_with: 1 } },
    { metadata: { path: '$.missing', array_contains: 1 } },
    { metadata: { path: '$.missing', array_starts_with: 1 } },
    { metadata: { equals: 'Hello', string_contains: 'nope' } },
    { history: { has: { a: 1 } } },
    { history: { has: 2 } },
    { history: { has: 3 } },
    { history: { equals: [{ a: 1 }, 2] } },
    { history: { equals: [2, { a: 1 }] } },
    { history: { hasEvery: [2] } },
    { history: { hasSome: [3, { a: 1 }] } },

    // Custom types
    { profile: null },
    { profile: DbNull },
    { profile: JsonNull },
    { profile: AnyNull },
    { profile: {} },
    { profile: { name: 'Ada' } },
    { profile: { name: 'Bob' } },
    { profile: { name: '5' } },
    { profile: { name: { contains: 'd' } } },
    { profile: { name: { equals: 'ADA', mode: 'insensitive' } } },
    { profile: { name: { not: 'Bob' } } },
    { profile: { age: 30 } },
    { profile: { age: 31 } },
    { profile: { age: null } },
    { profile: { age: { gt: 5 } } },
    { profile: { age: { lt: 5 } } },
    { profile: { age: { in: [30] } } },
    { profile: { age: { not: 31 } } },
    { profile: { age: { not: null } } },
    { profile: { nickname: null } },
    { profile: { nickname: { equals: null } } },
    { profile: { nickname: { not: null } } },
    { profile: { nickname: 'null' } },
    { profile: { joinedAt: null } },
    { profile: { address: null } },
    { profile: { address: { city: 'Hanoi' } } },
    { profile: { address: { city: 'Lima' } } },
    { profile: { address: { role: 'ADMIN' } } },
    { profile: { address: { role: { in: ['USER'] } } } },
    { profile: { address: { role: { not: 'USER' } } } },
    { profile: { address: { geo: { lat: 21 } } } },
    { profile: { address: { geo: { lat: { gt: 5, lt: 25 } } } } },
    { profile: { address: { geo: null } } },
    { profile: { address: { is: { city: 'Hanoi' } } } },
    { profile: { address: { isNot: { city: 'Lima' } } } },
    { profile: { is: {} } },
    { profile: { isNot: {} } },
    { profile: { is: { name: 'Ada' } } },
    { profile: { is: { name: 'Bob' } } },
    { profile: { isNot: { name: 'Bob' } } },
    { profile: { isNot: { name: 'Ada' } } },
    { profile: { is: { name: 'Ada' }, isNot: { age: 30 } } },
    { profile: { addresses: { some: { city: 'Lima' } } } },
    { profile: { addresses: { some: { city: 'Oslo' } } } },
    { profile: { addresses: { none: { city: 'Oslo' } } } },
    { profile: { addresses: { none: { city: 'Lima' } } } },
    { profile: { addresses: { every: { city: { in: ['Hanoi', 'Lima'] } } } } },
    { profile: { addresses: { every: { city: 'Lima' } } } },
    { profile: { addresses: { every: { role: 'ADMIN' } } } },
    { profile: { addresses: { some: { role: null } } } },
    { profile: { addresses: { some: { city: 'Lima' }, none: { city: 'Hanoi' } } } },
    { profile: { addresses: {} } },
    { profile: { path: '$.name', equals: 'Ada' } },
    { profile: { path: '$.age', equals: 30 } },
    { profile: { path: '$.address.city', string_starts_with: 'Ha' } },
    { profile: { path: '$.address.tags', array_contains: 'home' } },
    { profile: { path: '$.addresses[1].city', equals: 'Lima' } },
    { profile: { path: '$.addresses[*].city', equals: 'Hanoi' } },
    { profile: { equals: DbNull } },
    { profile: { equals: JsonNull } },
    { profile: { not: JsonNull } },
    { profile: { string_contains: 'Ada' } },
  ]

  const name = (filter: unknown) =>
    JSON.stringify(filter, (_, value) => {
      if (typeof value === 'bigint') {
        return `${value}n`
      }

      return value instanceof Uint8Array ? `bytes(${[...value]})` : value
    })

  describe.each(Object.keys(columns))('%s', rowName => {
    const id = `parity-${rowName}`

    test.each(filters.map(filter => [name(filter), filter] as const))('%s', async (_, filter) => {
      const discriminator = new EventDiscriminator({
        client,
        model: 'Contact',
        when: { created: filter as any },
      })

      await expect(
        client.contact.exists({ where: { AND: [{ id }, filter] } as any }),
      ).resolves.toBe(discriminator.eventMatchesWhere({ ...baseEvent, created: rows[id] } as any))
    })
  })

  test.each([
    ['parity-jsonArray', { a: 1, b: 2 }],
    ['parity-jsonArray', 1],
  ])('array_ends_with on %s (%j)', async (id, value) => {
    const filter = { metadata: { array_ends_with: value } }

    await expect(client.contact.exists({ where: { AND: [{ id }, filter] } as any })).resolves.toBe(
      new EventDiscriminator({
        client,
        model: 'Contact',
        when: { created: filter as any },
      }).eventMatchesWhere({ ...baseEvent, created: rows[id] } as any),
    )
  })

  test.each<[string, unknown]>([
    ['Int with a fraction', { age: 1.5 }],
    ['BigInt with a fraction', { visits: { gt: 1.5 } }],
    ['Decimal with a bigint', { balance: 1n }],
    ['invalid Decimal', { balance: 'x' }],
    ['invalid DateTime', { lastSeen: 'not a date' }],
    ['unknown field', { nope: 1 }],
    ['unknown operator', { age: { nope: 1 } }],
    ['string operator on a number', { age: { contains: '1' } }],
    ['array operator on a scalar', { age: { has: 1 } }],
    ['null array equals', { emails: { equals: null } }],
    ['null array has', { emails: { has: null } }],
    ['bare null on plain JSON', { metadata: null }],
    ['bare value on plain JSON', { metadata: 5 }],
    ['some on a top-level custom type array', { addresses: { some: { city: 'Hanoi' } } }],
    ['nullable filter on a required field', { email: null }],
  ])('rejects %s', async (_, filter) => {
    expect(
      () => new EventDiscriminator({ client, model: 'Contact', when: { created: filter as any } }),
    ).toThrow('Invalid exists args')

    await expect(client.contact.exists({ where: filter as any })).rejects.toThrow(
      'Invalid exists args',
    )
  })
})
