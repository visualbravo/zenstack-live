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

    test('not', () => {
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
                not: 'test2@test.com'
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
              }
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
                  equals: new Date(now.getTime() - 1000)
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
})
