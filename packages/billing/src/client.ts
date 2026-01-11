import { env } from '@newproject/env/client'
import { loadStripe, type StripeConstructorOptions, type Stripe } from '@stripe/stripe-js'

let cached: Promise<Stripe | null> | null = null

export function getStripe(options?: StripeConstructorOptions) {
  cached ??= loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, options)

  return cached
}

export type * from '@stripe/stripe-js'
