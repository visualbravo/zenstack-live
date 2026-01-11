import { env } from '@newproject/env/client'
import { type Socket, io } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from './types'

const url = new URL(env.NEXT_PUBLIC_REALTIME_URL)

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  url.origin,

  {
    autoConnect: false,
    path: url.pathname,
    transports: ['websocket'],
  },
)
