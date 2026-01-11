import { io } from '@newproject/realtime/server'
import { Server as Engine } from '@socket.io/bun-engine'

const engine = new Engine({
  path: '/',
})

io.bind(engine)

io.on('connection', socket => {
  console.log(socket.id)
})

export default {
  port: 3001,
  ...engine.handler(),
}
