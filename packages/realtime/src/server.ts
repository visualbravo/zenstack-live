import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@/types'
import { Server } from 'socket.io'
import { env } from '@newproject/env/server'
import { instrument } from '@socket.io/admin-ui'

const url = new URL(env.NEXT_PUBLIC_REALTIME_URL)

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>({
  path: url.pathname,
  transports: ['websocket'],

  cors: {
    origin: ['https://admin.socket.io'],
    credentials: true,
  },
})

instrument(io, {
  auth: false,
  mode: env.NODE_ENV === 'test' ? 'development' : env.NODE_ENV,
})
