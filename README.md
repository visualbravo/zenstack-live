<div align="center">
  <h1>
    ZenStack LIVE 🔴
    <small>(beta)</small>
  </h1>
</div>

Give your ZenStack backend realtime streaming capabilities. Instantly react to any insert, update, or delete, and declaratively filter records using the same Prisma API you've come to love.

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
- Postgres that supports [logical replication](https://www.postgresql.org/docs/current/logical-replication.html) (version >= `15`)
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

## Use Cases

### Welcome Emails

```typescript
const stream = live.stream({
  model: 'User',
  slug: 'send-welcome-email',

  when: {
    created: {},
  },
})

for await (const event of stream) {
  const user = event.created

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

const stream = live.stream({
  model: 'Patient',
  slug: 'audit-log',
})

for await (const event of stream) {
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
const stream = live.stream({
  model: 'Post',
  slug: 'cache',
})

for await (const event of stream) {
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
const stream = live.stream({
  model: 'Post',
  slug: 'sentiment-moderation',

  when: {
    created: {
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

for await (const event of stream) {
  const post = event.created
  const sentiment = await analyzeSentiment(post)

  if (sentiment === 'rude') {
    await suspendUser(post.authorId)
  }
}
```

### Shipping Notifications

```typescript
const stream = live.stream({
  model: 'Order',
  slug: 'send-delivered-email',

  when: {
    updated: {
      after: {
        status: 'DELIVERED',
      },
    },
  },
})

for await (const event of stream) {
  const order = event.updated.after

  await sendEmail({
    to: order.contactEmail,
    subject: `✅ Delivered at ${toHumanReadable(event.date)}`,
  })
}
```

## How it Works

1. LIVE adds the table of each stream to a publication, and Debezium connects to your database.
2. Debezium stores inserts, updates, and deletes in a Redis stream, _even those which are done outside of ZenStack._
3. LIVE connects to Redis and reads the events in the stream.
4. LIVE compares each event against your query, and if it matches, serves it to you.

## License

MIT
