import { Stripe } from 'stripe'
import { env } from '@newproject/env/server'

export const stripe = new Stripe(env.STRIPE_SECRET_KEY)
