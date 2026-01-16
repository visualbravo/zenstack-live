# ZenStack LIVE 🔴

Supercharge your ZenStack app with realtime streaming capabilities. Instantly react to any insert, update, or delete, and declaratively filter rows using the same Prisma API you've come to love.

## Features
* 🛟 **Type-safe:** You'll feel right at home working with ZenStack's Prisma API.
* 🛡️ **Durable:** Server went down? Your app picks up right where it left off, and even **detects all the changes that happened while it was offline.**
* 🧪 **Well-tested**: The suite compares its results against an actual database.
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

### Sending Emails

```typescript
const newUserStream = live.stream({
  model: 'User',
  id: 'send-welcome-email',
  created: {},
})

for await (let event of newUserStream) {
  if (event.type === 'created') {
    const user = event.created
      //  ^ properly typed as the `User` model

    await sendWelcomeEmail(user)
  }
}
```

### Caching

```typescript
const postStream = live.stream({
  model: 'Post',
  id: 'caching',
  created: {},
  updated: {},
  deleted: {},
})

for await (let event of postStream) {
  if (event.type === 'deleted') {
    await redis.del(`posts:${event.before.id}`)
    continue
  }

  await redis.set(`posts:${event.after.id}`, event.after)
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
  if (event.type === 'created') {
    const post = event.created
    const sentiment = await analyzeSentiment(post)

    if (sentiment === 'RUDE_DUDE') {
      await suspendUser(post.authorId)
    }
  }
}
```

### Shipping

```typescript
const orderStream = live.stream({
  model: 'Order',
  id: 'send-delivered-email',

  updated: {
    after: {
      // 👇 only orders that transitioned to delivered
      status: 'DELIVERED',
    },
  },
})

for await (let event of orderStream) {
  if (event.type === 'updated') {
    const order = event.after

    await sendEmail(order.customerId, {
      subject: `✅ Delivered at ${toHumanReadable(event.date)}`,
    })
  }
}
```

## How it Works

Hint: it doesn't use polling.

1. Debezium connects to your database.
2. Debezium stores inserts, updates, and deletes in a Redis stream, **even those which are done outside of ZenStack**.
3. ZenStack LIVE connects to Redis and reads the events in the stream.
4. ZenStack LIVE compares each event against your query, and if it matches, serves it to you.

## License

MIT