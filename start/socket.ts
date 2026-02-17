import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { Server } from 'socket.io'
import app from '@adonisjs/core/services/app'

let io: Server

// Create HTTPS server with mkcert certs
const httpsServer = createServer({
  key: readFileSync(new URL('../192.168.0.186+2-key.pem', import.meta.url)),
  cert: readFileSync(new URL('../192.168.0.186+2.pem', import.meta.url)),
})

let isLive = false
let broadcasterId: string | null = null
let viewers = new Set<string>()
let streamSessionId: string | null = null

interface BroadcasterInfo {
  id: string
  title: string
  startTime: Date
  viewersCount: number
}

let broadcasterInfo: BroadcasterInfo | null = null

app.ready(() => {
  // ✅ Attach Socket.io to HTTPS server (not AdonisJS internal server)
  io = new Server(httpsServer, {
    cors: {
      origin: 'https://192.168.0.186:5173',  // ✅ exact frontend URL
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 5e7,
  })

  // ✅ Start HTTPS server on separate port for Socket.io
  httpsServer.listen(3334, '0.0.0.0', () => {
    console.log('🔒 Socket.io running on wss://192.168.0.186:3334')
  })

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    socket.on('start-live', (data) => {
      if (!isLive) {
        isLive = true
        broadcasterId = socket.id
        streamSessionId = data.sessionId

        broadcasterInfo = {
          id: socket.id,
          title: data.title,
          startTime: new Date(),
          viewersCount: 0,
        }

        console.log('LIVE STARTED by:', socket.id, 'Title:', data.title)

        io.emit('live-started', {
          broadcasterId: socket.id,
          sessionId: streamSessionId,
          title: data.title,
          startTime: broadcasterInfo.startTime,
        })
      }
    })

    socket.on('join-live', () => {
      if (isLive && socket.id !== broadcasterId) {
        viewers.add(socket.id)
        if (broadcasterInfo) {
          broadcasterInfo.viewersCount = viewers.size
        }

        console.log(`Viewer joined! Total viewers: ${viewers.size}`)

        io.emit('viewer-count', viewers.size)

        if (broadcasterId) {
          io.to(broadcasterId).emit('new-viewer-joined', {
            viewerId: socket.id,
            totalViewers: viewers.size,
          })
        }
      }
    })

    socket.on('video-chunk', (data) => {
      if (socket.id === broadcasterId) {
        socket.broadcast.emit('video-chunk', {
          chunk: data.chunk,
          timestamp: Date.now(),
        })
        console.log('Video chunk broadcasted to', viewers.size, 'viewers')
      }
    })

    socket.on('audio-chunk', (data) => {
      if (socket.id === broadcasterId) {
        socket.broadcast.emit('audio-chunk', {
          chunk: data.chunk,
          timestamp: Date.now(),
        })
      }
    })

    socket.on('stop-live', () => {
      if (socket.id === broadcasterId) {
        isLive = false
        broadcasterId = null
        streamSessionId = null
        broadcasterInfo = null
        viewers.clear()

        console.log('LIVE STOPPED')

        io.emit('live-stopped', { endTime: new Date() })
        io.emit('viewer-count', 0)
      }
    })

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)

      if (socket.id === broadcasterId) {
        isLive = false
        broadcasterId = null
        streamSessionId = null
        broadcasterInfo = null
        viewers.clear()

        io.emit('live-stopped', {
          reason: 'broadcaster-disconnected',
          endTime: new Date(),
        })
        io.emit('viewer-count', 0)
        console.log('Broadcaster disconnected - Stream ended')
      } else if (viewers.delete(socket.id)) {
        if (broadcasterInfo) {
          broadcasterInfo.viewersCount = viewers.size
        }
        if (isLive) {
          io.emit('viewer-count', viewers.size)
          if (broadcasterId) {
            io.to(broadcasterId).emit('viewer-left', {
              viewerId: socket.id,
              totalViewers: viewers.size,
            })
          }
        }
      }
    })

    socket.on('get-live-status', (callback) => {
      callback({
        isLive,
        broadcasterId,
        sessionId: streamSessionId,
        viewersCount: viewers.size,
        broadcasterInfo,
      })
    })

    socket.on('offer', ({ target, offer }) => {
      io.to(target).emit('offer', { from: socket.id, offer })
    })

    socket.on('answer', ({ target, answer }) => {
      io.to(target).emit('answer', { from: socket.id, answer })
    })

    socket.on('ice-candidate', ({ target, candidate }) => {
      io.to(target).emit('ice-candidate', { from: socket.id, candidate })
    })

    socket.on('get-available-streams', (callback) => {
      if (isLive && broadcasterInfo) {
        callback([
          {
            broadcasterId,
            sessionId: streamSessionId,
            title: broadcasterInfo.title,
            startTime: broadcasterInfo.startTime,
            viewersCount: viewers.size,
          },
        ])
      } else {
        callback([])
      }
    })
  })
})