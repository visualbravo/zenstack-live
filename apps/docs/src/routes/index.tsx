// oxlint-disable no-use-before-define react/jsx-no-literals
import { createFileRoute, Link } from '@tanstack/react-router'
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { Gauge, Radio, RotateCcw, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { baseOptions } from '@/lib/layout.shared'

export const Route = createFileRoute('/')({
  component: Home,
})

const features = [
  {
    icon: ShieldCheck,
    title: 'Type-safe',
    description: 'Queries have full intellisense based on your ZenStack models.',
  },
  {
    icon: RotateCcw,
    title: 'Durable',
    description:
      'Server went down? Your app picks up right where it left off, and even detects all the changes that happened while it was offline.',
  },
  {
    icon: Gauge,
    title: 'Scalable',
    description: 'Just add more instances.',
  },
  {
    icon: Sparkles,
    title: 'Simple',
    description: 'Build event-driven apps with fewer headaches.',
  },
]

const useCases = [
  {
    title: 'Welcome Emails',
    description: 'Send an email the moment a user signs up.',
    code: `import { ZenStackLive } from '@visualbravo/zenstack-live'

const live = new ZenStackLive({
  client: new ZenStackClient(...),

  redis: {
    url: process.env.REDIS_URL,
  },
})

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
    subject: \`Welcome, \${user.name}!\`,
  })
}`,
  },
  {
    title: 'Audit Logging',
    description: 'Leave out `when` to listen for every event, and record what changed.',
    code: `import { beforeAfter } from '@visualbravo/zenstack-live'

const stream = live.stream({
  model: 'Patient',
  slug: 'audit-log',
})

for await (const event of stream) {
  const { before, after } = beforeAfter(event)

  await client.auditLog.upsert({
    where: { eventId: event.id },
    update: {},

    create: {
      before,
      after,
      eventId: event.id,
      model: 'Patient',
      operation: event.type,
      occurredAt: event.date,
    },
  })
}`,
  },
  {
    title: 'Caching',
    description: 'Keep Redis in sync with your database without touching your write paths.',
    code: `const stream = live.stream({
  model: 'Post',
  slug: 'cache',
})

for await (const event of stream) {
  if (event.type === 'deleted') {
    await redis.del(\`posts:\${event.deleted.id}\`)
    continue
  }

  const { after } = beforeAfter(event)

  await redis.set(\`posts:\${after.id}\`, after)
}`,
  },
  {
    title: 'Moderation',
    description: 'Filter declaratively with the same type-safe API you use for queries.',
    code: `const stream = live.stream({
  model: 'Post',
  slug: 'sentiment-moderation',

  when: {
    created: {
      OR: [
        { title: { contains: 'ugly', mode: 'insensitive' } },
        { title: { contains: 'stupid', mode: 'insensitive' } },
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
}`,
  },
  {
    title: 'Shipping Notifications',
    description: 'Transition queries only fire when a record starts matching.',
    code: `const stream = live.stream({
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
    subject: \`Your package was delivered at \${toHumanReadable(event.date)}\`,
  })
}`,
  },
]

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-6 py-16 md:py-24'>
        <section className='flex flex-col items-center gap-6 text-center'>
          <span className='inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-fd-muted-foreground'>
            <Radio className='size-3.5 text-red-500' />
            Beta
          </span>

          <h1 className='text-4xl font-bold tracking-tight md:text-6xl flex items-center gap-6'>
            <span>
              ZenStack <span className='text-red-500'>LIVE</span>
            </span>
            <span
              aria-hidden
              className='relative flex size-12'
            >
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75' />
              <span className='relative inline-flex size-12 rounded-full bg-red-500' />
            </span>
          </h1>

          <p className='max-w-2xl text-lg text-fd-muted-foreground'>
            Give your ZenStack backend realtime streaming capabilities. Instantly react
            to any insert, update, or delete, and declaratively filter records using the same Prisma
            API you've come to love.
          </p>

          <div className='flex flex-wrap items-center justify-center gap-3'>
            <Link
              to='/docs/$'
              params={{ _splat: 'quick-start' }}
              className='inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90'
            >
              <Zap className='size-4' />
              Get started
            </Link>

            <a
              target='_blank'
              rel='noreferrer'
              href='https://github.com/visualbravo/zenstack-live'
              className='inline-flex items-center rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent'
            >
              GitHub
            </a>
          </div>

          <code className='rounded-lg border bg-fd-card px-4 py-2 text-sm text-fd-muted-foreground'>
            npm install @visualbravo/zenstack-live
          </code>
        </section>

        <section className='flex flex-col gap-6'>
          <Tabs items={useCases.map(useCase => useCase.title)}>
            {useCases.map(useCase => (
              <Tab
                key={useCase.title}
                value={useCase.title}
              >
                <p className='mb-4 text-sm text-fd-muted-foreground'>{useCase.description}</p>
                <DynamicCodeBlock
                  lang='typescript'
                  code={useCase.code}
                />
              </Tab>
            ))}
          </Tabs>
        </section>

        <section className='grid gap-4 sm:grid-cols-2'>
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className='rounded-xl border bg-fd-card p-6'
            >
              <Icon className='mb-3 size-5 text-fd-primary' />
              <h3 className='mb-1 font-semibold'>{title}</h3>
              <p className='text-sm text-fd-muted-foreground'>{description}</p>
            </div>
          ))}
        </section>

        <p className='text-center text-xs text-fd-muted-foreground'>
          This project is not affiliated with or endorsed by the ZenStack team.
        </p>
      </main>
    </HomeLayout>
  )
}
