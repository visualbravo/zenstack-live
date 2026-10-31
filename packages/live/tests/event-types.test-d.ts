import { describe, expectTypeOf, test } from 'vitest'
import {
  beforeAfter,
  type LiveStreamWhen,
  type ZenStackLive,
  type RecordCreatedEvent,
  type RecordDeletedEvent,
  type RecordEvent,
  type RecordUpdatedEvent,
} from '../src'
import type { schema } from './schemas/basic'

type Schema = typeof schema
type Created = RecordCreatedEvent<Schema, 'User'>
type Updated = RecordUpdatedEvent<Schema, 'User'>
type Deleted = RecordDeletedEvent<Schema, 'User'>

type OptionalWhen = Pick<LiveStreamWhen<Schema, 'User'>, 'created'>

declare const live: ZenStackLive<Schema>

declare function eventOf<Event>(stream: AsyncIterable<Event>): Event

describe('stream events', () => {
  test('are limited to one subscription', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: { created: {} } }))

    expectTypeOf(event).toEqualTypeOf<Created>()
  })

  test('are a union of multiple subscriptions', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, deleted: {} } }),
    )

    expectTypeOf(event).toEqualTypeOf<Created | Deleted>()
  })

  test('are a union of all subscriptions', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, updated: {}, deleted: {} } }),
    )

    expectTypeOf(event).toEqualTypeOf<RecordEvent<Schema, 'User'>>()
    expectTypeOf(event).toEqualTypeOf<Created | Updated | Deleted>()
  })

  test('are every event without a subscription', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test' }))

    expectTypeOf(event).toEqualTypeOf<RecordEvent<Schema, 'User'>>()
  })

  test('are every event with an empty when', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: {} }))

    expectTypeOf(event).toEqualTypeOf<RecordEvent<Schema, 'User'>>()
  })

  test('are every event when no subscription is guaranteed', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: {} as OptionalWhen }))

    expectTypeOf(event).toEqualTypeOf<RecordEvent<Schema, 'User'>>()
  })

  test('require subscriptions to be under when', () => {
    // @ts-expect-error
    live.stream({ model: 'User', id: 'test', created: {} })
  })

  test('require valid filters', () => {
    // @ts-expect-error
    live.stream({ model: 'User', id: 'test', when: { created: { doesNotExist: true } } })
  })

  test('reject unknown subscriptions', () => {
    // @ts-expect-error
    live.stream({ model: 'User', id: 'test', when: { creatd: {} } })
  })

  test('narrow on type', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, deleted: {} } }),
    )

    if (event.type === 'created') {
      expectTypeOf(event).toEqualTypeOf<Created>()
    } else {
      expectTypeOf(event).toEqualTypeOf<Deleted>()
    }
  })
})

describe('beforeAfter', () => {
  type Row = Created['created']

  test('has no before for a created event', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: { created: {} } }))

    expectTypeOf(beforeAfter(event)).toEqualTypeOf<{ before: null; after: Row }>()
  })

  test('has both sides for an updated event', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: { updated: {} } }))

    expectTypeOf(beforeAfter(event)).toEqualTypeOf<{ before: Row; after: Row }>()
  })

  test('has no after for a deleted event', () => {
    const event = eventOf(live.stream({ model: 'User', id: 'test', when: { deleted: {} } }))

    expectTypeOf(beforeAfter(event)).toEqualTypeOf<{ before: Row; after: null }>()
  })

  test('is a union for multiple subscriptions', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, deleted: {} } }),
    )

    expectTypeOf(beforeAfter(event)).toEqualTypeOf<
      { before: null; after: Row } | { before: Row; after: null }
    >()
  })

  test('narrows when destructured', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, deleted: {} } }),
    )

    const { before, after } = beforeAfter(event)

    if (before === null) {
      expectTypeOf(after).toEqualTypeOf<Row>()
    } else {
      expectTypeOf(after).toEqualTypeOf<null>()
    }
  })

  test('follows a narrowed event', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, deleted: {} } }),
    )

    if (event.type === 'created') {
      expectTypeOf(beforeAfter(event)).toEqualTypeOf<{ before: null; after: Row }>()
    }
  })

  test('has a row after once deleted events are excluded', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, updated: {}, deleted: {} } }),
    )

    if (event.type !== 'deleted') {
      expectTypeOf(beforeAfter(event).after).toEqualTypeOf<Row>()
    }
  })

  test('covers every event type', () => {
    const event = eventOf(
      live.stream({ model: 'User', id: 'test', when: { created: {}, updated: {}, deleted: {} } }),
    )

    expectTypeOf(beforeAfter(event)).toEqualTypeOf<
      { before: null; after: Row } | { before: Row; after: Row } | { before: Row; after: null }
    >()
  })
})
