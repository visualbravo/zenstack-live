// oxlint-disable max-statements
// oxlint-disable max-lines
import { describe, test, expect } from 'bun:test'
import { schema } from './schemas/basic'
import { EventDiscriminator, type EventDiscriminatorOptions } from '../src/discriminator'
import type { SimplifiedPlainResult } from '@zenstackhq/orm'
import type { ZenStackLiveEvent } from '../'

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

describe('EventDiscriminator', () => {
  describe('created', () => {
    test('empty', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {},
          },
        ),
      ).toBe(true)
    })

    test('top-level equals', () => {
      // Boolean
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: true,
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: false,
            },
          },
        ),
      ).toBe(false)

      // String
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: 'test@test.com',
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: 'test@test2.com',
            },
          },
        ),
      ).toBe(false)

      // Int
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: 18,
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: 17,
            },
          },
        ),
      ).toBe(false)

      // DateTime
      const now = new Date()

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: now,
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: new Date(now.getTime() - 1000),
            },
          },
        ),
      ).toBe(false)

      // multiple, both equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: 'sanny',
              age: 18,
            },
          },
        ),
      ).toBe(true)

      // multiple, one not equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: 'sanny',
              age: 17,
            },
          },
        ),
      ).toBe(false)
    })

    test('nested equals', () => {
      // Boolean
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                equals: true,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                equals: false,
              },
            },
          },
        ),
      ).toBe(false)

      // String
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                equals: 'test@test.com',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                equals: 'test@test2.com',
              },
            },
          },
        ),
      ).toBe(false)

      // Int
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                equals: 18,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                equals: 17,
              },
            },
          },
        ),
      ).toBe(false)

      // DateTime
      const now = new Date()

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                equals: now,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                equals: new Date(now.getTime() - 1000),
              },
            },
          },
        ),
      ).toBe(false)

      // multiple, both equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                equals: 'sanny',
              },

              age: {
                equals: 18,
              },
            },
          },
        ),
      ).toBe(true)

      // multiple, one not equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                equals: 'sanny',
              },
              age: {
                equals: 17,
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('nested not', () => {
      // Boolean
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                not: false,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                not: true,
              },
            },
          },
        ),
      ).toBe(false)

      // String
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                not: 'test2@test.com',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                not: 'test@test.com',
              },
            },
          },
        ),
      ).toBe(false)

      // Int
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                not: 17,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                not: 18,
              },
            },
          },
        ),
      ).toBe(false)

      // DateTime
      const now = new Date()

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                not: new Date(now.getTime() - 1000),
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                not: now,
              },
            },
          },
        ),
      ).toBe(false)

      // multiple, both equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                not: 'ymc',
              },

              age: {
                not: 17,
              },
            },
          },
        ),
      ).toBe(true)

      // multiple, one not equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                not: 'ymc',
              },
              age: {
                not: 18,
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('nested not equals', () => {
      // Boolean
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                not: {
                  equals: false,
                },
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              verified: {
                not: {
                  equals: true,
                },
              },
            },
          },
        ),
      ).toBe(false)

      // String
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                not: {
                  equals: 'test2@test.com',
                },
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                not: {
                  equals: 'test@test.com',
                },
              },
            },
          },
        ),
      ).toBe(false)

      // Int
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                not: {
                  equals: 17,
                },
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                not: {
                  equals: 18,
                },
              },
            },
          },
        ),
      ).toBe(false)

      // DateTime
      const now = new Date()

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                not: {
                  equals: new Date(now.getTime() - 1000),
                },
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              createdAt: {
                not: now,
              },
            },
          },
        ),
      ).toBe(false)

      // multiple, both equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                not: 'ymc',
              },

              age: {
                not: 17,
              },
            },
          },
        ),
      ).toBe(true)

      // multiple, one not equal
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              name: {
                not: 'ymc',
              },
              age: {
                not: 18,
              },
            },
          },
        ),
      ).toBe(false)
    })
  })

  describe('String', () => {
    test('startsWith', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                startsWith: 'test@',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                startsWith: 'Test@',
                mode: 'insensitive',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                startsWith: 'Test@',
              },
            },
          },
        ),
      ).toBe(false)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                startsWith: 'test2@',
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('endsWith', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                endsWith: '.com',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                endsWith: '.Com',
                mode: 'insensitive',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                endsWith: '.Com',
              },
            },
          },
        ),
      ).toBe(false)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                endsWith: '.com2',
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('contains', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                contains: '.com',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                contains: '.Com',
                mode: 'insensitive',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                contains: '.Com',
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('gt', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                gt: '1',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                gt: 'test@test.com',
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('gte', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                gte: '1',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                gte: 'test@test.com',
              },
            },
          },
        ),
      ).toBe(true)
    })

    test('lt', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                lt: '1',
              },
            },
          },
        ),
      ).toBe(false)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                lt: 'z',
              },
            },
          },
        ),
      ).toBe(true)
    })

    test('lte', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                lte: 'test@test.com',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                lte: 'z',
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                lte: 'a',
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('in', () => {
      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                in: ['test@test.com'],
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                in: ['1', 'test@test.com'],
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                in: [],
              },
            },
          },
        ),
      ).toBe(false)

      expect(
        matches(
          {
            type: 'created',

            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },

            date: new Date(),
            id: '1',
          },
          {
            created: {
              email: {
                in: ['1', '2'],
              },
            },
          },
        ),
      ).toBe(false)
    })
  })

  test('notIn', () => {
    expect(
      matches(
        {
          type: 'created',
          before: null,
          after: {
            id: '1',
            email: 'test@test.com',
            age: 18,
            verified: true,
            name: 'sanny',
            meta: null,
            role: 'ADMIN',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          date: new Date(),
          id: '1',
        },
        {
          created: {
            email: {
              notIn: ['other@test.com'],
            },
          },
        },
      ),
    ).toBe(true)

    expect(
      matches(
        {
          type: 'created',
          before: null,
          after: {
            id: '1',
            email: 'test@test.com',
            age: 18,
            verified: true,
            name: 'sanny',
            meta: null,
            role: 'ADMIN',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          date: new Date(),
          id: '1',
        },
        {
          created: {
            email: {
              notIn: ['1', 'test@test.com'],
            },
          },
        },
      ),
    ).toBe(false)

    expect(
      matches(
        {
          type: 'created',
          before: null,
          after: {
            id: '1',
            email: 'test@test.com',
            age: 18,
            verified: true,
            name: 'sanny',
            meta: null,
            role: 'ADMIN',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          date: new Date(),
          id: '1',
        },
        {
          created: {
            email: {
              notIn: [],
            },
          },
        },
      ),
    ).toBe(true)

    expect(
      matches(
        {
          type: 'created',
          before: null,
          after: {
            id: '1',
            email: 'test@test.com',
            age: 18,
            verified: true,
            name: 'sanny',
            meta: null,
            role: 'ADMIN',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          date: new Date(),
          id: '1',
        },
        {
          created: {
            email: {
              notIn: ['1', '2'],
            },
          },
        },
      ),
    ).toBe(true)
  })

  describe('Int', () => {
    test('gt', () => {
      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                gt: 17,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                gt: 18,
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('gte', () => {
      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                gte: 18,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                gte: 19,
              },
            },
          },
        ),
      ).toBe(false)
    })

    test('lt', () => {
      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                lt: 18,
              },
            },
          },
        ),
      ).toBe(false)

      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                lt: 19,
              },
            },
          },
        ),
      ).toBe(true)
    })

    test('lte', () => {
      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                lte: 18,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                lte: 19,
              },
            },
          },
        ),
      ).toBe(true)

      expect(
        matches(
          {
            type: 'created',
            before: null,
            after: {
              id: '1',
              email: 'test@test.com',
              age: 18,
              verified: true,
              name: 'sanny',
              meta: null,
              role: 'ADMIN',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            date: new Date(),
            id: '1',
          },
          {
            created: {
              age: {
                lte: 17,
              },
            },
          },
        ),
      ).toBe(false)
    })
  })
})
