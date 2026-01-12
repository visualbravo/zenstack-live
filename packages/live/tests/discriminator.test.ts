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

    expect(
      matches(
        {
          type: 'deleted',

          before: {
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
          after: null,
          
          date: new Date(),
          id: '1',
        },
        {
          deleted: {},
        },
      ),
    ).toBe(true)
  })
})
