# ZenStack LIVE 🔴

Supercharge your ZenStack app with realtime streaming capabilities. Instantly react to any insert, update, or delete, and declaratively filter rows using the same Prisma API you've come to love.

## Features
* 🛟 **Type-safe:** You'll feel right at home working with ZenStack's Prisma API.
* 🛡️ **Durable:** Server went down? Your app picks up right where it left off, and even **detects all the changes that happened while it was offline.**
* 🧪 **Well-tested:** The suite compares its results against an actual database.
* 📈 **Scalable:** Just add more instances.

## Setup

```typescript
// No ZenStackClient needed -- just the schema!
const live = new ZenStackLive({
  schema,

  redis: {
    url: process.env['REDIS_URL'],
  },
})
```

## Use Cases

### Welcome Emails

```typescript
const newUserStream = live.stream({
  model: 'User',
  id: 'send-welcome-email',
  created: {},
})

for await (let event of newUserStream) {
  const user = event.created
    //  ^ properly typed as the `User` model

  await sendWelcomeEmail(user)
}
```

### Audit Logging

```typescript
import { beforeAfter } from '@visualbravo/zenstack-live'

const patientStream = live.stream({
  model: 'Patient',
  id: 'audit-log',
  created: {},
  updated: {},
  deleted: {},
})

for await (let event of patientStream) {
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
  id: 'cache',
  created: {},
  updated: {},
  deleted: {},
})

for await (let event of postStream) {
  if (event.type === 'deleted') {
    await redis.del(`posts:${event.deleted.id}`)
    continue
  }

  const { after } = beforeAfter(event)

  await redis.set(`posts:${after.id}`, after)
}
```

You've seen the simple stuff, now let's get jiggy with it.

### Moderation

```typescript
const potentiallyHarmfulPostsStream = live.stream({
  model: 'Post',
  id: 'sentiment-moderation',

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

      {
        title: {
          contains: 'doodoohead',
          mode: 'insensitive',
        },
      },
    ],
  },
})

for await (let event of potentiallyHarmfulPostsStream) {
  const post = event.created
  const sentiment = await analyzeSentiment(post)

  if (sentiment === 'RUDE_DUDE') {
    await suspendUser(post.authorId)
  }
}
```

### Shipping Notifications

```typescript
const deliveredOrdersStream = live.stream({
  model: 'Order',
  id: 'send-delivered-email',

  updated: {
    // This is a "transition" query. You are only notified if the record transitions
    // from *not* matching before, to matching afterwards.
    after: {
      status: 'DELIVERED',
    },
  },
})

for await (let event of deliveredOrdersStream) {
  const order = event.updated.after

  await sendEmail(order.customerId, {
    subject: `✅ Delivered at ${toHumanReadable(event.date)}`,
  })
}
```

## How it Works

Hint: it doesn't use polling.

1. Debezium connects to your database.
2. Debezium stores inserts, updates, and deletes in a Redis stream, **even those which are done outside of ZenStack**.
3. LIVE connects to Redis and reads the events in the stream.
4. LIVE compares each event against your query, and if it matches, serves it to you.

## Limitations

1. Postgres only. Actually, that might not be totally accurate. Debezium has MySQL support, but this project has not been tested with it.
2. Events are not bound by the transaction they were in. This is a good thing for performance, but it's important to keep in mind. If you're listening to `created` events, the record might not exist in the database anymore if it was deleted before your handler processed it. **Events represent snapshots in time**, and actually come with the time they were generated via `event.date`.
3. You can't query via relations on the `created`, `updated`, and `deleted` clauses. Although that would be very cool, this is not possible because of limitation #2.

## License

MIT