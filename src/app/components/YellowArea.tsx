'use client'
import React, { useState, useEffect } from 'react'
import useYellowWallet from '../hooks/useYellowWallet'

interface YellowAreaProps {
  onBalanceChange?: (unifiedBalance: string) => void
  compact?: boolean
}

export default function YellowArea({ onBalanceChange, compact = false }: YellowAreaProps) {
  const {
    status,
    balances,
    channelId,
    error,
    isReady,
    actions,
  } = useYellowWallet()

  const [depositAmount, setDepositAmount] = useState('0.10')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')

  // Notify parent of balance changes
  useEffect(() => {
    if (onBalanceChange) {
      onBalanceChange(balances.unified)
    }
  }, [balances.unified, onBalanceChange])

  const handleConnect = async () => {
    setIsLoading(true)
    setLoadingMessage('Connecting to Yellow Network...')
    await actions.connect()
    setIsLoading(false)
    setLoadingMessage('')
  }

  const handleQuickSetup = async () => {
    setIsLoading(true)
    setLoadingMessage('Setting up Yellow Network wallet...')
    const success = await actions.quickSetup(depositAmount)
    if (success) {
      setLoadingMessage('Waiting for channel creation...')
      // Channel creation is async, handled by WebSocket
    }
    setIsLoading(false)
    setLoadingMessage('')
  }

  const handleDeposit = async () => {
    setIsLoading(true)
    setLoadingMessage('Depositing USDC...')
    await actions.deposit(depositAmount)
    setIsLoading(false)
    setLoadingMessage('')
  }

  const handleCreateChannel = async () => {
    setIsLoading(true)
    setLoadingMessage('Creating channel...')
    await actions.createChannel()
    setIsLoading(false)
    setLoadingMessage('')
  }

  const handleResize = async () => {
    setIsLoading(true)
    setLoadingMessage('Moving funds to unified balance...')
    await actions.resize(depositAmount, true)
    setIsLoading(false)
    setLoadingMessage('')
  }

  // Compact view for in-game display
  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: status === 'authenticated' ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 215, 0, 0.1)',
        border: `1px solid ${status === 'authenticated' ? '#00FF88' : '#FFD700'}`,
        borderRadius: 8,
      }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Yellow Balance:</span>
        <span style={{
          fontWeight: 'bold',
          color: parseFloat(balances.unified) > 0 ? '#00FF88' : '#FFD700',
          fontSize: 13,
        }}>
          {balances.unified} USDC
        </span>
        {status !== 'authenticated' && (
          <button
            onClick={handleConnect}
            disabled={isLoading}
            style={{
              padding: '4px 10px',
              background: '#00FF88',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Connect
          </button>
        )}
      </div>
    )
  }

  // Full view for setup flow
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.1) 0%, rgba(0, 255, 136, 0.05) 100%)',
      border: '2px solid #FFD700',
      borderRadius: 16,
      padding: 20,
      color: 'white',
      maxWidth: 400,
    }}>
      <h3 style={{
        margin: '0 0 15px 0',
        color: '#FFD700',
        fontSize: 16,
        textShadow: '0 0 10px rgba(255, 215, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        💰 Yellow Network Wallet
        {status === 'authenticated' && (
          <span style={{
            fontSize: 10,
            background: '#00FF88',
            color: '#000',
            padding: '2px 8px',
            borderRadius: 10,
          }}>
            Connected
          </span>
        )}
      </h3>

      {/* Error display */}
      {error && (
        <div style={{
          background: 'rgba(255, 107, 53, 0.2)',
          border: '1px solid #FF6B35',
          padding: 10,
          borderRadius: 8,
          marginBottom: 15,
          fontSize: 12,
          color: '#FF6B35',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div style={{
          background: 'rgba(0, 191, 255, 0.2)',
          border: '1px solid #00BFFF',
          padding: 10,
          borderRadius: 8,
          marginBottom: 15,
          fontSize: 12,
          color: '#00BFFF',
          textAlign: 'center',
        }}>
          ⏳ {loadingMessage}
        </div>
      )}

      {/* Balance Display */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        marginBottom: 15,
      }}>
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          padding: 12,
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>Wallet USDC</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#00BFFF' }}>
            {balances.walletUSDC}
          </div>
        </div>
        <div style={{
          background: 'rgba(0, 255, 136, 0.1)',
          padding: 12,
          borderRadius: 8,
          textAlign: 'center',
          border: '1px solid #00FF88',
        }}>
          <div style={{ fontSize: 10, color: '#00FF88', marginBottom: 4 }}>Game Balance</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#00FF88' }}>
            {balances.unified} USDC
          </div>
        </div>
      </div>

      {/* Status-based UI */}
      {status === 'disconnected' && (
        <button
          onClick={handleConnect}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: 12,
            background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            fontWeight: 'bold',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: 14,
          }}
        >
          🔌 Connect to Yellow Network
        </button>
      )}

      {(status === 'connecting' || status === 'authenticating') && (
        <div style={{
          textAlign: 'center',
          padding: 15,
          color: '#FFD700',
        }}>
          ⏳ {status === 'connecting' ? 'Connecting...' : 'Authenticating...'}
        </div>
      )}

      {status === 'authenticated' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Amount input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: '#aaa' }}>Amount:</label>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              step="0.01"
              min="0.01"
              style={{
                flex: 1,
                padding: 8,
                background: '#0a0a14',
                border: '1px solid #00BFFF',
                borderRadius: 6,
                color: '#00BFFF',
                fontSize: 14,
              }}
            />
            <span style={{ fontSize: 11, color: '#aaa' }}>USDC</span>
          </div>

          {/* Quick setup button (for new users) */}
          {!channelId && (
            <button
              onClick={handleQuickSetup}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: 12,
                background: 'linear-gradient(135deg, #00FF88 0%, #00FFCC 100%)',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                fontWeight: 'bold',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              🚀 Quick Setup (Deposit + Channel)
            </button>
          )}

          {/* Individual action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDeposit}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: 10,
                background: 'rgba(0, 191, 255, 0.2)',
                color: '#00BFFF',
                border: '1px solid #00BFFF',
                borderRadius: 6,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              💵 Deposit
            </button>

            {channelId && (
              <button
                onClick={handleResize}
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: 10,
                  background: 'rgba(255, 215, 0, 0.2)',
                  color: '#FFD700',
                  border: '1px solid #FFD700',
                  borderRadius: 6,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                }}
              >
                📐 Fund Game
              </button>
            )}
          </div>

          {/* Close Channel (Reset) */}
          {channelId && (
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <button
                onClick={async () => {
                  if (confirm('Are you sure you want to close the channel? This will settle funds back to your wallet/custody.')) {
                    setIsLoading(true)
                    setLoadingMessage('Closing channel...')
                    await actions.closeChannel()
                    setIsLoading(false)
                    setLoadingMessage('')
                  }
                }}
                disabled={isLoading}
                style={{
                  background: 'transparent',
                  border: '1px solid #FF6B35',
                  color: '#FF6B35',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 11,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                }}
              >
                🛑 Close Channel (Reset)
              </button>
            </div>
          )}

          {/* Channel info */}
          {channelId && (
            <div style={{
              fontSize: 10,
              color: '#666',
              marginTop: 5,
              wordBreak: 'break-all',
            }}>
              Channel: {channelId.slice(0, 10)}...{channelId.slice(-8)}
            </div>
          )}

          {/* Ready indicator */}
          {isReady && (
            <div style={{
              textAlign: 'center',
              padding: 10,
              background: 'rgba(0, 255, 136, 0.2)',
              border: '1px solid #00FF88',
              borderRadius: 8,
              color: '#00FF88',
              fontSize: 12,
              fontWeight: 'bold',
            }}>
              ✅ Ready to play! You have {balances.unified} USDC available.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
