<div align="center">
  <h1>
    ZenStack LIVE 🔴
    <small>(beta)</small>
  </h1>
</div>

Supercharge your ZenStack backend with realtime streaming capabilities. Instantly react to any insert, update, or delete, and declaratively filter records using the same Prisma API you've come to love.

<div align="center">
    <a href="https://www.npmjs.com/package/@visualbravo/zenstack-live?activeTab=versions">
      <img alt="NPM Version" src="https://img.shields.io/npm/v/%40visualbravo%2Fzenstack-live/latest">
    </a>
    <a>
      <img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/visualbravo/zenstack-live/build-and-test.yaml">
    </a>
    <a href="https://discord.gg/Ykhr738dUe">
      <img alt="Join the ZenStack server" src="https://img.shields.io/discord/1035538056146595961">
    </a>
    <a href="https://github.com/visualbravo/zenstack-live/blob/main/LICENSE">
      <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green">
    </a>

  <p>
    ℹ️ This project is not affiliated with or endorsed by the ZenStack team.
  </p>
</div>

## Features

- 🛟 **Type-safe:** Queries have full intellisense based on your ZenStack models.
- 🛡️ **Durable:** Server went down? Your app picks up right where it left off, and even detects all the changes that happened while it was offline.
- 📈 **Scalable:** Just add more instances.
- 🗿 **Simple:** Build event-driven apps with fewer headaches.

## Requirements

- ZenStack (version >= `3.10.0`)
- Node.js (version >= `22.0.0`)
- Postgres that supports [logical replication](https://www.postgresql.org/docs/current/logical-replication.html) (version >= `12`)
- Redis (version >= `7.2.0`)
- A non-serverless server that will process events. You can forward events to serverless if you so desire.

## Installation

```bash
npm install @visualbravo/zenstack-live
pnpm add @visualbravo/zenstack-live
bun add @visualbravo/zenstack-live
```

## Setup

Just copy our [`docker-compose.yaml`](.devcontainer/docker-compose.yaml), make any necessary changes, and proceed as follows

```typescript
import { schema } from './zenstack/schema'
import { ZenStackClient } from '@zenstackhq/orm'
import { ZenStackLive } from '@visualbravo/zenstack-live'

const client = new ZenStackClient(schema, {
  ...
})

const live = new ZenStackLive({
  client,

  redis: {
    url: process.env.REDIS_URL,
  },
})
```

### Database Schemas

Models are read from wherever ZenStack puts them, so `@@schema`, `defaultSchema`, and `@@map` all work without any configuration.

### Captured Tables

Only tables with a stream are captured. When a stream is created, LIVE adds its table to the `zenstack_live` publication, which Debezium reads from, so you don't need to list your tables anywhere. That has a few consequences:

- The database user needs to own your tables, and be able to create and own the publication.
- Leave `table.include.list` and `schema.include.list` unset in Debezium. Anything they exclude never reaches your streams, and nothing reports it.
- A publication that's `FOR ALL TABLES` keeps working, and every table stays captured. This includes `dbz_publication` if you set up Debezium before this existed.

## Use Cases

### Welcome Emails

```typescript
const newUserStream = live.stream({
  model: 'User',
  slug: 'send-welcome-email',

  when: {
    created: {},
  },
})

for await (const event of newUserStream) {
  const user = event.created
  //  ^ properly typed as the `User` model

  await sendEmail({
    to: user.email,
    subject: `Welcome, ${user.name}!`,
  })
}
```

### Audit Logging

Leaving out `when`, or leaving it empty, listens for all events.

```typescript
import { beforeAfter } from '@visualbravo/zenstack-live'

const patientStream = live.stream({
  model: 'Patient',
  slug: 'audit-log',
})

for await (const event of patientStream) {
  const { before, after } = beforeAfter(event)

  await client.auditLog.create({
    data: {
      before,
      after,
      model: 'Patient',
      operation: event.type,
    },
  })
}
```

### Caching

```typescript
const postStream = live.stream({
  model: 'Post',
  slug: 'cache',
})

for await (const event of postStream) {
  if (event.type === 'deleted') {
    await redis.del(`posts:${event.deleted.id}`)
    continue
  }

  const { after } = beforeAfter(event)

  await redis.set(`posts:${after.id}`, after)
}
```

You've seen the simple stuff, now let's look at more complex examples.

### Moderation

```typescript
const potentiallyHarmfulPostsStream = live.stream({
  model: 'Post',
  slug: 'sentiment-moderation',

  when: {
    created: {
      // All of this is type-safe, with autocomplete based on your model.
      OR: [
        {
          title: {
            contains: 'ugly',
            mode: 'insensitive',
          },
        },

        {
          title: {
            contains: 'stupid',
            mode: 'insensitive',
          },
        },
      ],
    },
  },
})

for await (const event of potentiallyHarmfulPostsStream) {
  const post = event.created
  const sentiment = await analyzeSentiment(post)

  if (sentiment === 'rude') {
    await suspendUser(post.authorId)
  }
}
```

### Shipping Notifications

```typescript
const deliveredOrdersStream = live.stream({
  model: 'Order',
  slug: 'send-delivered-email',

  when: {
    updated: {
      // This is a "transition" query. You are only notified if the record transitions
      // from *not* matching before, to *matching* afterwards.
      after: {
        status: 'DELIVERED',
      },
    },
  },
})

for await (const event of deliveredOrdersStream) {
  const order = event.updated.after

  await sendEmail({
    to: order.contactEmail,
    subject: `✅ Delivered at ${toHumanReadable(event.date)}`,
  })
}
```

## Handling Errors

An event is acknowledged when your loop moves on to the next one. If your process dies before that, or if the event takes longer than `timeout` (30 seconds by default), it's delivered again. That means your handlers need to follow two rules:

1. **They need to be idempotent.** An event can be delivered more than once, and `event.id` stays the same when it is, so you can use it to detect duplicates.
2. **They need to catch their own errors.** An uncaught error ends the `for await` loop, which stops that instance from consuming the stream.

Retrying is up to you, so that you can decide how many attempts make sense and what happens after the last one. For example, with [Bottleneck](https://github.com/SGrondin/bottleneck):

```typescript
const limiter = new Bottleneck({ maxConcurrent: 1 })

limiter.on('failed', (error, job) => {
  if (job.retryCount < 3) {
    return 1000
  }
})

for await (const event of stream) {
  try {
    await limiter.schedule(() => handle(event))
  } catch (error) {
    await saveFailedEvent(event, error)
  }
}
```

Keep your attempts within `timeout`, otherwise another instance will pick up the event while you're still retrying it. Set `consume` to `new` if you'd rather lose events than process them twice.

## Removing Streams

Deleting a stream from your code doesn't remove it from Redis, or its table from the publication, because a stream that's been deleted looks exactly like one that's offline, and offline streams are expected to catch up. Instead, you remove what's left behind with `prune`:

```typescript
const DAY = 24 * 60 * 60 * 1000

const report = await live.prune({
  olderThan: 7 * DAY,
  dryRun: true,
})
```

Anything that's been gone for `olderThan` is removed, and the report lists what was. With `dryRun`, it lists what would be, without changing anything. Editing a stream's `when` makes it a new stream, so the old one shows up here with the same slug.

- **Streams:** Their consumer groups are destroyed, along with any events waiting to be retried. A stream that comes back later starts from new events.
- **Consumers:** Those that have been gone for `olderThan` with nothing pending are removed from streams that are still in use, which keeps things tidy if your `id` changes between deployments.
- **Tables:** A table with no streams left is dropped from the publication, and its events are deleted. This stops Debezium from capturing it.
- **`FOR ALL TABLES`:** Individual tables can't be dropped, so they're listed under `allTables` instead.
- **`REPLICA IDENTITY FULL`:** This is reported on each table, but left as it is, because LIVE doesn't know what it was before.
- **Unknown streams:** Nothing shows when a stream was last used if it's never been read and was created before LIVE recorded its streams, so it's kept and listed under `unknownStreams`.

`olderThan` can't be shorter than `retention`, and a stream that has a longer `retention` of its own keeps it, so a stream is never removed while Redis is still holding events for it.

You don't need to do this right away. While a `ZenStackLive` instance is running, it trims every published table once a minute, keeping events for the longest `retention` of the table's streams, or its own `retention` if there are none. So what a deleted stream leaves behind can't outgrow `retention`. If you're removing LIVE from an app altogether nothing's left to trim, so run `prune` first.

## How it Works

1. LIVE adds the table of each stream to a publication, and Debezium connects to your database.
2. Debezium stores inserts, updates, and deletes in a Redis stream, _even those which are done outside of ZenStack._
3. LIVE connects to Redis and reads the events in the stream.
4. LIVE compares each event against your query, and if it matches, serves it to you.

## Limitations

1. **This project is in beta.** There are still some things missing or broken.
2. **Postgres only.** Actually, that might not be totally true. Debezium has MySQL support, but this project has not been tested with it. Want to help? Give it a try and tell us how it goes.
3. **Events represent snapshots in time of a single record.** If you're listening to `created` events, the record might not exist in the database anymore if it was deleted before your handler processed it. You can determine when an event occurred via `event.date`
4. **You can't query by relations.** Although that would be very cool, this is not possible because of limitation #3.
5. **Events are kept in Redis for 24 hours.** Every stream on a model reads the same events, so they're removed by age, not when they're consumed. A stream that's offline for longer misses what it didn't read, and events waiting to be retried are dropped. Set `retention` on `ZenStackLive` to change this.
6. **Live stream handlers can't be hosted on a serverless platform.** They need to be constantly waiting for new events to come in. Your main backend can still be serverless, and you just communicate between the two like any other service.
7. **Changes made before a table's first stream aren't captured.** Once a table has a stream it stays captured, even while nothing is running, until you [remove it](#removing-streams).
8. **Filters match ZenStack, with a few exceptions.** Filters are validated by ZenStack and follow the same semantics as a query, including how nulls behave, but they're evaluated in JavaScript, not by Postgres. So `$expr`, `fuzzy`, `fts`, computed fields, and `Json` paths with filter expressions or `.**` aren't supported, strings are ordered by code unit and not by your database's collation, and timestamps are compared to the millisecond.

## License

MIT
