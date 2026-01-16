# ZenStack LIVE 🔴

Supercharge your ZenStack app with realtime streaming capabilities. Instantly react to any insert, update, or delete, and declaratively choose which events you want with the Prisma API you've come to love.

## Features
* 🛟 **Type-safe:** You'll feel right at home working with ZenStack's Prisma API.
* 🛡️ **Durable:** Server went down? Your app picks up right where it left off, and even detects all the changes that happened while it was offline.
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
  id: 'invalidate-posts',
  created: {},
  updated: {},
  deleted: {},
})

for await (let event of postStream) {
  if (event.type === 'deleted') {
    await redis.del(`posts.${event.before.id}`)
    continue
  }

  await redis.set(`posts.${event.after.id}`, event.after)
}
```

## License

MIT