// oxlint-disable max-statements
// oxlint-disable max-lines
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { schema } from './schemas/basic'
import { EventDiscriminator, type EventDiscriminatorOptions } from '../src/discriminator'
import type { ZenStackLiveEvent } from '../'
import { ZenStackClient, type ClientContract, type SimplifiedPlainResult } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const baseDate = new Date('2024-01-01T00:00:00.000Z')
const laterDate = new Date('2024-01-01T00:00:00.001Z')
const earlierDate = new Date('2023-12-31T23:59:59.999Z')

const baseEvent = {
  type: 'created',
  before: null,
  after: {
    id: '1',
    string: 'string',
    stringArray: ['stringArray'],
    boolean: true,
    booleanArray: [true],
    dateTime: baseDate,
    enum: 'USER',
    enumArray: ['USER'],
    bigInt: BigInt(1),
    bigIntArray: [BigInt(1)],
    int: 1,
    intArray: [1],
    float: 1,
    floatArray: [1],
    json: {},
  },
  date: baseDate,
  id: '1',
} as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

let client: ClientContract<typeof schema>

function matches(
  event: ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>,
  options: Pick<
    EventDiscriminatorOptions<typeof schema, 'User'>,
    'created' | 'updated' | 'deleted'
  >,
) {
  const discriminator = new EventDiscriminator({
    schema,
    model: 'User',
    ...options,
  })

  return discriminator.eventMatchesWhere(event)
}

beforeAll(async () => {
  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env['POSTGRES_URL'],
      }),
    }),
  })

  await client.$pushSchema()
  await Promise.all([
    client.$queryRawUnsafe('ALTER TABLE "User" REPLICA IDENTITY FULL'),
    client.$queryRawUnsafe('ALTER TABLE "Post" REPLICA IDENTITY FULL'),
    client.$queryRawUnsafe('ALTER TABLE "Profile" REPLICA IDENTITY FULL'),
  ])
})

afterAll(() => {
  client.$disconnect()
})

describe('EventDiscriminator', () => {
  describe('String', () => {
    test('equals (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { equals: 'string' },
          },
        }),
      ).toBe(true)
    })

    test('equals (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { equals: 'other' },
          },
        }),
      ).toBe(false)
    })

    test('in (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { in: ['foo', 'string', 'bar'] },
          },
        }),
      ).toBe(true)
    })

    test('in (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { in: ['foo', 'bar'] },
          },
        }),
      ).toBe(false)
    })

    test('notIn (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { notIn: ['foo', 'bar'] },
          },
        }),
      ).toBe(true)
    })

    test('notIn (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { notIn: ['string'] },
          },
        }),
      ).toBe(false)
    })

    test('lt (lexicographic)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { lt: 'z' },
          },
        }),
      ).toBe(true)
    })

    test('lte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { lte: 'string' },
          },
        }),
      ).toBe(true)
    })

    test('gt (lexicographic)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { gt: 'a' },
          },
        }),
      ).toBe(true)
    })

    test('gte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { gte: 'string' },
          },
        }),
      ).toBe(true)
    })

    test('contains (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { contains: 'tri' },
          },
        }),
      ).toBe(true)
    })

    test('contains (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { contains: 'xyz' },
          },
        }),
      ).toBe(false)
    })

    test('startsWith (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { startsWith: 'str' },
          },
        }),
      ).toBe(true)
    })

    test('startsWith (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { startsWith: 'ing' },
          },
        }),
      ).toBe(false)
    })

    test('endsWith (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { endsWith: 'ing' },
          },
        }),
      ).toBe(true)
    })

    test('endsWith (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { endsWith: 'str' },
          },
        }),
      ).toBe(false)
    })

    test('case-sensitive by default', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { equals: 'STRING' },
          },
        }),
      ).toBe(false)
    })

    test('mode: insensitive (equals)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: {
              equals: 'STRING',
              mode: 'insensitive',
            },
          },
        }),
      ).toBe(true)
    })

    test('mode: insensitive (contains)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: {
              contains: 'TRI',
              mode: 'insensitive',
            },
          },
        }),
      ).toBe(true)
    })

    test('not (value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { not: 'other' },
          },
        }),
      ).toBe(true)
    })

    test('not (value negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { not: 'string' },
          },
        }),
      ).toBe(false)
    })

    test('not (nested filter)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: {
              not: { contains: 'tri' },
            },
          },
        }),
      ).toBe(false)
    })

    test('empty string equals (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              string: '',
            },
          },
          {
            created: {
              string: '',
            },
          },
        ),
      ).toBe(true)
    })

    test('contains empty string (edge case)', () => {
      expect(
        matches(baseEvent, {
          created: {
            string: { contains: '' },
          },
        }),
      ).toBe(true)
    })
  })

  describe('String[]', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['a', 'b', 'c'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date(),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date(),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('has (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { has: 'a' },
          },
        }),
      ).toBe(true)
    })

    test('has (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { has: 'z' },
          },
        }),
      ).toBe(false)
    })

    test('hasEvery (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { hasEvery: ['a', 'b'] },
          },
        }),
      ).toBe(true)
    })

    test('hasEvery (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { hasEvery: ['a', 'z'] },
          },
        }),
      ).toBe(false)
    })

    test('hasSome (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { hasSome: ['x', 'b'] },
          },
        }),
      ).toBe(true)
    })

    test('hasSome (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { hasSome: ['x', 'y'] },
          },
        }),
      ).toBe(false)
    })

    test('isEmpty (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { isEmpty: false },
          },
        }),
      ).toBe(true)
    })

    test('isEmpty (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { isEmpty: true },
          },
        }),
      ).toBe(false)
    })

    test('equals (exact match)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { equals: ['a', 'b', 'c'] },
          },
        }),
      ).toBe(true)
    })

    test('equals (order mismatch)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { equals: ['c', 'b', 'a'] },
          },
        }),
      ).toBe(false)
    })

    test('equals (subset)', () => {
      expect(
        matches(baseEvent, {
          created: {
            stringArray: { equals: ['a', 'b'] },
          },
        }),
      ).toBe(false)
    })

    test('empty array equals (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              stringArray: [],
            },
          },
          {
            created: {
              stringArray: { equals: [] },
            },
          },
        ),
      ).toBe(true)
    })

    test('empty array isEmpty true (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              stringArray: [],
            },
          },
          {
            created: {
              stringArray: { isEmpty: true },
            },
          },
        ),
      ).toBe(true)
    })

    test('has on empty array (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              stringArray: [],
            },
          },
          {
            created: {
              stringArray: { has: 'a' },
            },
          },
        ),
      ).toBe(false)
    })
  })

  describe('Int', () => {
    test('equals (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { equals: 1 },
          },
        }),
      ).toBe(true)
    })

    test('equals (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { equals: 2 },
          },
        }),
      ).toBe(false)
    })

    test('top-level equals shorthand', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: 1,
          },
        }),
      ).toBe(true)
    })

    test('in (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { in: [0, 1, 2] },
          },
        }),
      ).toBe(true)
    })

    test('in (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { in: [2, 3, 4] },
          },
        }),
      ).toBe(false)
    })

    test('notIn (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { notIn: [2, 3, 4] },
          },
        }),
      ).toBe(true)
    })

    test('notIn (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { notIn: [1] },
          },
        }),
      ).toBe(false)
    })

    test('lt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { lt: 2 },
          },
        }),
      ).toBe(true)
    })

    test('lt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { lt: 1 },
          },
        }),
      ).toBe(false)
    })

    test('lte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { lte: 1 },
          },
        }),
      ).toBe(true)
    })

    test('gt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { gt: 0 },
          },
        }),
      ).toBe(true)
    })

    test('gt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { gt: 1 },
          },
        }),
      ).toBe(false)
    })

    test('gte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { gte: 1 },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { not: 2 },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: { not: 1 },
          },
        }),
      ).toBe(false)
    })

    test('not (nested filter)', () => {
      expect(
        matches(baseEvent, {
          created: {
            int: {
              not: { gt: 0 },
            },
          },
        }),
      ).toBe(false)
    })

    test('zero value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              int: 0,
            },
          },
          {
            created: {
              int: { equals: 0 },
            },
          },
        ),
      ).toBe(true)
    })

    test('negative value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              int: -5,
            },
          },
          {
            created: {
              int: { lt: 0 },
            },
          },
        ),
      ).toBe(true)
    })
  })

  describe('Int[]', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date(),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1, 2, 3],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date(),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('has (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { has: 1 },
          },
        }),
      ).toBe(true)
    })

    test('has (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { has: 99 },
          },
        }),
      ).toBe(false)
    })

    test('hasEvery (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { hasEvery: [1, 3] },
          },
        }),
      ).toBe(true)
    })

    test('hasEvery (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { hasEvery: [1, 99] },
          },
        }),
      ).toBe(false)
    })

    test('hasSome (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { hasSome: [99, 2] },
          },
        }),
      ).toBe(true)
    })

    test('hasSome (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { hasSome: [99, 100] },
          },
        }),
      ).toBe(false)
    })

    test('isEmpty (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { isEmpty: false },
          },
        }),
      ).toBe(true)
    })

    test('isEmpty (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { isEmpty: true },
          },
        }),
      ).toBe(false)
    })

    test('equals (exact match)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { equals: [1, 2, 3] },
          },
        }),
      ).toBe(true)
    })

    test('equals (order mismatch)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { equals: [3, 2, 1] },
          },
        }),
      ).toBe(false)
    })

    test('equals (subset)', () => {
      expect(
        matches(baseEvent, {
          created: {
            intArray: { equals: [1, 2] },
          },
        }),
      ).toBe(false)
    })

    // test('not (nested positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         intArray: {
    //           not: { has: 99 },
    //         },
    //       },
    //     ),
    //   ).toBe(true)
    // })

    // test('not (nested negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         intArray: {
    //           not: { has: 1 },
    //         },
    //       },
    //     ),
    //   ).toBe(false)
    // })

    test('empty array equals (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              intArray: [],
            },
          },
          {
            created: {
              intArray: { equals: [] },
            },
          },
        ),
      ).toBe(true)
    })

    test('empty array isEmpty true (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              intArray: [],
            },
          },
          {
            created: {
              intArray: { isEmpty: true },
            },
          },
        ),
      ).toBe(true)
    })

    test('has on empty array (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              intArray: [],
            },
          },
          {
            created: {
              intArray: { has: 1 },
            },
          },
        ),
      ).toBe(false)
    })

    test('negative and zero values (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              intArray: [-1, 0, 1],
            },
          },
          {
            created: {
              intArray: { hasEvery: [-1, 0] },
            },
          },
        ),
      ).toBe(true)
    })
  })

  describe('Float', () => {
    test('equals (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { equals: 1 },
          },
        }),
      ).toBe(true)
    })

    test('equals (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { equals: 2 },
          },
        }),
      ).toBe(false)
    })

    test('top-level equals shorthand', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: 1,
          },
        }),
      ).toBe(true)
    })

    test('in (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { in: [0, 1, 2] },
          },
        }),
      ).toBe(true)
    })

    test('in (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { in: [2, 3] },
          },
        }),
      ).toBe(false)
    })

    test('notIn (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { notIn: [2, 3] },
          },
        }),
      ).toBe(true)
    })

    test('notIn (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { notIn: [1] },
          },
        }),
      ).toBe(false)
    })

    test('lt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { lt: 2 },
          },
        }),
      ).toBe(true)
    })

    test('lt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { lt: 1 },
          },
        }),
      ).toBe(false)
    })

    test('lte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { lte: 1 },
          },
        }),
      ).toBe(true)
    })

    test('gt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { gt: 0 },
          },
        }),
      ).toBe(true)
    })

    test('gt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { gt: 1 },
          },
        }),
      ).toBe(false)
    })

    test('gte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { gte: 1 },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { not: 2 },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: { not: 1 },
          },
        }),
      ).toBe(false)
    })

    test('not (nested filter)', () => {
      expect(
        matches(baseEvent, {
          created: {
            float: {
              not: { gt: 0 },
            },
          },
        }),
      ).toBe(false)
    })

    test('zero value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              float: 0,
            },
          },
          {
            created: {
              float: { equals: 0 },
            },
          },
        ),
      ).toBe(true)
    })

    test('negative value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              float: -10.5,
            },
          },
          {
            created: {
              float: { lt: 0 },
            },
          },
        ),
      ).toBe(true)
    })

    test('decimal precision (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              float: 0.000123,
            },
          },
          {
            created: {
              float: { equals: 0.000123 },
            },
          },
        ),
      ).toBe(true)
    })

    test('very large value (edge case)', () => {
      const huge = 1e18
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              float: huge,
            },
          },
          {
            created: {
              float: { gte: huge },
            },
          },
        ),
      ).toBe(true)
    })
  })

  describe('Float[]', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date('2024-01-01T00:00:00.000Z'),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1.1, 2.2, 3.3],
        json: {},
      },
      date: new Date('2024-01-01T00:00:00.000Z'),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('has (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { has: 2.2 },
          },
        }),
      ).toBe(true)
    })

    test('has (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { has: 9.9 },
          },
        }),
      ).toBe(false)
    })

    test('hasEvery (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { hasEvery: [1.1, 3.3] },
          },
        }),
      ).toBe(true)
    })

    test('hasEvery (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { hasEvery: [1.1, 9.9] },
          },
        }),
      ).toBe(false)
    })

    test('hasSome (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { hasSome: [0, 2.2] },
          },
        }),
      ).toBe(true)
    })

    test('hasSome (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { hasSome: [9.9, 10.1] },
          },
        }),
      ).toBe(false)
    })

    test('isEmpty (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { isEmpty: false },
          },
        }),
      ).toBe(true)
    })

    test('isEmpty (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { isEmpty: true },
          },
        }),
      ).toBe(false)
    })

    test('equals (exact match)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { equals: [1.1, 2.2, 3.3] },
          },
        }),
      ).toBe(true)
    })

    test('equals (order mismatch)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { equals: [3.3, 2.2, 1.1] },
          },
        }),
      ).toBe(false)
    })

    test('equals (subset)', () => {
      expect(
        matches(baseEvent, {
          created: {
            floatArray: { equals: [1.1, 2.2] },
          },
        }),
      ).toBe(false)
    })

    // test('not (nested positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         floatArray: {
    //           not: { has: 9.9 },
    //         },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('not (nested negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         floatArray: {
    //           not: { has: 1.1 },
    //         },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    test('empty array equals (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [],
            },
          },
          {
            created: {
              floatArray: { equals: [] },
            },
          },
        ),
      ).toBe(true)
    })

    test('empty array isEmpty true (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [],
            },
          },
          {
            created: {
              floatArray: { isEmpty: true },
            },
          },
        ),
      ).toBe(true)
    })

    test('has on empty array (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [],
            },
          },
          {
            created: {
              floatArray: { has: 1.1 },
            },
          },
        ),
      ).toBe(false)
    })

    test('negative and zero values (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [-1.5, 0, 1.5],
            },
          },
          {
            created: {
              floatArray: { hasEvery: [-1.5, 0] },
            },
          },
        ),
      ).toBe(true)
    })

    test('decimal precision (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [0.0001, 0.0002, 0.0003],
            },
          },
          {
            created: {
              floatArray: { hasSome: [0.0002] },
            },
          },
        ),
      ).toBe(true)
    })

    test('very large value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              floatArray: [1e18, 2e18, 3e18],
            },
          },
          {
            created: {
              floatArray: { hasSome: [2e18] },
            },
          },
        ),
      ).toBe(true)
    })
  })

  describe('Enum', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date('2024-01-01T00:00:00.000Z'),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date('2024-01-01T00:00:00.000Z'),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('top-level equals (matching value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: 'USER',
          },
        }),
      ).toBe(true)
    })

    test('top-level equals (non-matching value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: 'ADMIN',
          },
        }),
      ).toBe(false)
    })

    test('equals (matching value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { equals: 'USER' },
          },
        }),
      ).toBe(true)
    })

    test('equals (non-matching value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { equals: 'ADMIN' },
          },
        }),
      ).toBe(false)
    })

    test('in (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { in: ['USER', 'ADMIN'] },
          },
        }),
      ).toBe(true)
    })

    test('in (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { in: ['ADMIN'] },
          },
        }),
      ).toBe(false)
    })

    test('notIn (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { notIn: ['ADMIN'] },
          },
        }),
      ).toBe(true)
    })

    test('notIn (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enum: { notIn: ['USER', 'ADMIN'] },
          },
        }),
      ).toBe(false)
    })
  })

  describe('Enum[]', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date('2024-01-01T00:00:00.000Z'),
        enum: 'USER',
        enumArray: ['ADMIN', 'USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date('2024-01-01T00:00:00.000Z'),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('has (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { has: 'USER' },
          },
        }),
      ).toBe(true)
    })

    // test('has (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         enumArray: { has: 'GUEST' }, // non-existent enum
    //       },
    //     }),
    //   ).toBe(false)
    // })

    test('hasEvery (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { hasEvery: ['ADMIN', 'USER'] },
          },
        }),
      ).toBe(true)
    })

    // test('hasEvery (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         enumArray: { hasEvery: ['ADMIN', 'GUEST'] },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('hasSome (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         enumArray: { hasSome: ['GUEST', 'USER'] },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('hasSome (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         enumArray: { hasSome: ['GUEST', 'MODERATOR'] },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    test('isEmpty (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { isEmpty: false },
          },
        }),
      ).toBe(true)
    })

    test('isEmpty (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { isEmpty: true },
          },
        }),
      ).toBe(false)
    })

    test('equals (exact match)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { equals: ['ADMIN', 'USER'] },
          },
        }),
      ).toBe(true)
    })

    test('equals (order mismatch)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { equals: ['USER', 'ADMIN'] },
          },
        }),
      ).toBe(false)
    })

    test('equals (subset)', () => {
      expect(
        matches(baseEvent, {
          created: {
            enumArray: { equals: ['ADMIN'] },
          },
        }),
      ).toBe(false)
    })

    test('empty array equals and isEmpty edge case', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              enumArray: [],
            },
          },
          {
            created: {
              enumArray: { equals: [] },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              enumArray: [],
            },
          },
          {
            created: {
              enumArray: { isEmpty: true },
            },
          },
        ),
      ).toBe(true)
    })

    test('has on empty array (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              enumArray: [],
            },
          },
          {
            created: {
              enumArray: { has: 'ADMIN' },
            },
          },
        ),
      ).toBe(false)
    })
  })

  describe('BigInt', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date(),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date(),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    // test('equals (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { equals: BigInt(1) },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('equals (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { equals: BigInt(2) },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    test('top-level equals shorthand', () => {
      expect(
        matches(baseEvent, {
          created: {
            bigInt: BigInt(1),
          },
        }),
      ).toBe(true)
    })

    // test('in (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { in: [BigInt(0), BigInt(1), BigInt(2)] },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('in (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { in: [BigInt(2), BigInt(3)] },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('notIn (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { notIn: [BigInt(2), BigInt(3)] },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('notIn (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { notIn: [BigInt(1)] },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('lt (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { lt: BigInt(2) },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('lt (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { lt: BigInt(1) },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('lte (boundary)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { lte: BigInt(1) },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('gt (positive)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { gt: BigInt(0) },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    // test('gt (negative)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { gt: BigInt(1) },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('gte (boundary)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: { gte: BigInt(1) },
    //       },
    //     }),
    //   ).toBe(true)
    // })

    test('not (scalar positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            bigInt: { not: BigInt(2) },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            bigInt: { not: BigInt(1) },
          },
        }),
      ).toBe(false)
    })

    // test('not (nested filter)', () => {
    //   expect(
    //     matches(baseEvent, {
    //       created: {
    //         bigInt: {
    //           not: { gt: BigInt(0) },
    //         },
    //       },
    //     }),
    //   ).toBe(false)
    // })

    // test('zero value (edge case)', () => {
    //   expect(
    //     matches(
    //       {
    //         ...baseEvent,
    //         after: {
    //           ...baseEvent.after,
    //           bigInt: BigInt(0),
    //         },
    //       },
    //       {
    //         created: {
    //           bigInt: { equals: BigInt(0) },
    //         },
    //       },
    //     ),
    //   ).toBe(true)
    // })

    // test('negative value (edge case)', () => {
    //   expect(
    //     matches(
    //       {
    //         ...baseEvent,
    //         after: {
    //           ...baseEvent.after,
    //           bigInt: BigInt(-10),
    //         },
    //       },
    //       {
    //         created: {
    //           bigInt: { lt: BigInt(0) },
    //         },
    //       },
    //     ),
    //   ).toBe(true)
    // })

    // test('very large value (edge case)', () => {
    //   const huge = BigInt('900719925474099312345')

    //   expect(
    //     matches(
    //       {
    //         ...baseEvent,
    //         after: {
    //           ...baseEvent.after,
    //           bigInt: huge,
    //         },
    //       },
    //       {
    //         created: {
    //           bigInt: { gte: BigInt('900719925474099312345') },
    //         },
    //       },
    //     ),
    //   ).toBe(true)
    // })
  })

  describe('Boolean', () => {
    test('equals (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: { equals: true },
          },
        }),
      ).toBe(true)
    })

    test('equals (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: { equals: false },
          },
        }),
      ).toBe(false)
    })

    test('top-level equals shorthand (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: true,
          },
        }),
      ).toBe(true)
    })

    test('top-level equals shorthand (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: false,
          },
        }),
      ).toBe(false)
    })

    test('not (scalar positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: { not: false },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: { not: true },
          },
        }),
      ).toBe(false)
    })

    test('not (nested filter)', () => {
      expect(
        matches(baseEvent, {
          created: {
            boolean: {
              not: { equals: true },
            },
          },
        }),
      ).toBe(false)
    })

    test('explicit false value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              boolean: false,
            },
          },
          {
            created: {
              boolean: false,
            },
          },
        ),
      ).toBe(true)
    })

    test('not false with explicit false value (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              boolean: false,
            },
          },
          {
            created: {
              boolean: { not: true },
            },
          },
        ),
      ).toBe(true)
    })
  })

  describe('Boolean[]', () => {
    const baseEvent = {
      type: 'created',
      before: null,
      after: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true, false, true],
        dateTime: new Date('2024-01-01T00:00:00.000Z'),
        enum: 'USER',
        enumArray: ['USER'],
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
      date: new Date('2024-01-01T00:00:00.000Z'),
      id: '1',
    } as const satisfies ZenStackLiveEvent<SimplifiedPlainResult<typeof schema, 'User'>>

    test('has (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { has: true },
          },
        }),
      ).toBe(true)
    })

    test('has (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { has: false },
          },
        }),
      ).toBe(true)
    })

    test('has (non-existent value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { has: null as any },
          },
        }),
      ).toBe(false)
    })

    test('hasEvery (true + false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { hasEvery: [true, false] },
          },
        }),
      ).toBe(true)
    })

    test('hasEvery (missing value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { hasEvery: [true, null as any] },
          },
        }),
      ).toBe(false)
    })

    test('hasSome (true or false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { hasSome: [false, null as any] },
          },
        }),
      ).toBe(true)
    })

    test('hasSome (non-existent value)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { hasSome: [null as any] },
          },
        }),
      ).toBe(false)
    })

    test('isEmpty (false)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { isEmpty: false },
          },
        }),
      ).toBe(true)
    })

    test('isEmpty (true)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { isEmpty: true },
          },
        }),
      ).toBe(false)
    })

    test('equals (exact match)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { equals: [true, false, true] },
          },
        }),
      ).toBe(true)
    })

    test('equals (order mismatch)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { equals: [true, true, false] },
          },
        }),
      ).toBe(false)
    })

    test('equals (subset)', () => {
      expect(
        matches(baseEvent, {
          created: {
            booleanArray: { equals: [true, false] },
          },
        }),
      ).toBe(false)
    })

    test('empty array equals and isEmpty edge case', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              booleanArray: [],
            },
          },
          {
            created: {
              booleanArray: { equals: [] },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              booleanArray: [],
            },
          },
          {
            created: {
              booleanArray: { isEmpty: true },
            },
          },
        ),
      ).toBe(true)
    })

    test('has on empty array (edge case)', () => {
      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              booleanArray: [],
            },
          },
          {
            created: {
              booleanArray: { has: true },
            },
          },
        ),
      ).toBe(false)
    })
  })

  describe('DateTime', () => {
    test('equals (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { equals: baseDate },
          },
        }),
      ).toBe(true)
    })

    test('equals (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { equals: laterDate },
          },
        }),
      ).toBe(false)
    })

    test('top-level equals shorthand', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: baseDate,
          },
        }),
      ).toBe(true)
    })

    test('in (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { in: [earlierDate, baseDate, laterDate] },
          },
        }),
      ).toBe(true)
    })

    test('in (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { in: [earlierDate, laterDate] },
          },
        }),
      ).toBe(false)
    })

    test('notIn (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { notIn: [earlierDate, laterDate] },
          },
        }),
      ).toBe(true)
    })

    test('notIn (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { notIn: [baseDate] },
          },
        }),
      ).toBe(false)
    })

    test('lt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { lt: laterDate },
          },
        }),
      ).toBe(true)
    })

    test('lt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { lt: baseDate },
          },
        }),
      ).toBe(false)
    })

    test('lte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { lte: baseDate },
          },
        }),
      ).toBe(true)
    })

    test('gt (positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { gt: earlierDate },
          },
        }),
      ).toBe(true)
    })

    test('gt (negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { gt: baseDate },
          },
        }),
      ).toBe(false)
    })

    test('gte (boundary)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { gte: baseDate },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar positive)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { not: laterDate },
          },
        }),
      ).toBe(true)
    })

    test('not (scalar negative)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { not: baseDate },
          },
        }),
      ).toBe(false)
    })

    test('not (nested filter)', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: {
              not: { lt: laterDate },
            },
          },
        }),
      ).toBe(false)
    })

    test('millisecond precision boundary', () => {
      expect(
        matches(baseEvent, {
          created: {
            dateTime: { lt: laterDate },
          },
        }),
      ).toBe(true)
    })

    test('epoch date (edge case)', () => {
      const epoch = new Date(0)

      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              dateTime: epoch,
            },
          },
          {
            created: {
              dateTime: { equals: epoch },
            },
          },
        ),
      ).toBe(true)
    })

    test('timezone-equivalent dates (same instant)', () => {
      const utc = new Date('2024-01-01T00:00:00.000Z')
      const offset = new Date('2023-12-31T19:00:00.000-05:00')

      expect(
        matches(
          {
            ...baseEvent,
            after: {
              ...baseEvent.after,
              dateTime: utc,
            },
          },
          {
            created: {
              dateTime: { equals: offset },
            },
          },
        ),
      ).toBe(true)
    })
  })
})
