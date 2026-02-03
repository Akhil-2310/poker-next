// WebSocket client for multiplayer poker

type MessageHandler = (data: any) => void
type EventListeners = Record<string, MessageHandler[]>

export class PokerWebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private listeners: EventListeners = {}
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 3000
  private messageQueue: any[] = []

  constructor(url: string) {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          console.log('WebSocket connected')
          this.reconnectAttempts = 0
          // Flush message queue
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()
            this.ws?.send(JSON.stringify(msg))
          }
          this.emit('connected', {})
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            this.emit(data.type, data)
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e)
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          this.emit('error', { message: 'WebSocket error' })
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('WebSocket disconnected')
          this.emit('disconnected', {})
          this.reconnect()
        }
      } catch (e) {
        reject(e)
      }
    })
  }

  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`)
      setTimeout(() => {
        this.connect().catch((e) => {
          console.error('Reconnect failed:', e)
        })
      }, this.reconnectDelay)
    } else {
      console.error('Max reconnection attempts reached')
      this.emit('connection-failed', {})
    }
  }

  send(type: string, payload: any = {}) {
    const message = { type, payload }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      // Queue message if not connected
      this.messageQueue.push(message)
    }
  }

  on(event: string, handler: MessageHandler) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(handler)
  }

  off(event: string, handler: MessageHandler) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((handler) => handler(data))
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}

// Singleton instance
let client: PokerWebSocketClient | null = null

export function getWebSocketClient(url?: string): PokerWebSocketClient {
  if (!client) {
    const wsUrl = url || process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:3001'
    client = new PokerWebSocketClient(wsUrl)
  }
  return client
}
