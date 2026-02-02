'use client'
import React, { useState, useEffect, useRef } from 'react'
import Table from './components/Table'
import Card from './components/Card'
import useWebSocketGame from './hooks/useWebSocketGame'
import './poker.css'
import ActionPanel from './components/ActionPanel'
import { soundEffects } from './utils/sounds'
import { injectAnimationStyles, createFloatingText, animateButton } from './utils/animations'

export default function PokerPage() {
  const { state, connectionState, gameId, error, actions } = useWebSocketGame()
  const [gameMode, setGameMode] = useState<'menu' | 'playing'>('menu')
  const [joinGameId, setJoinGameId] = useState('')
  const [playerName, setPlayerName] = useState('Player')
  const [isNextRoundHovered, setIsNextRoundHovered] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const callButtonRef = useRef<HTMLButtonElement>(null)
  const foldButtonRef = useRef<HTMLButtonElement>(null)
  const startButtonRef = useRef<HTMLButtonElement>(null)
  const nextRoundButtonRef = useRef<HTMLButtonElement>(null)

  // Initialize animations on mount
  useEffect(() => {
    injectAnimationStyles()
  }, [])

  // Wrapped action handlers with animations and sounds
  const handleCheck = () => {
    soundEffects.playCall()
    if (callButtonRef.current) animateButton(callButtonRef.current, 'action-call')
    const playerPos = state.players[state.activePlayerIndex]
    if (playerPos) {
      createFloatingText('✓ CHECK', window.innerWidth / 2, window.innerHeight / 2, '#00FFCC')
    }
    actions.check()
  }

  const handleFold = () => {
    soundEffects.playFold()
    if (foldButtonRef.current) animateButton(foldButtonRef.current, 'action-fold')
    const playerPos = state.players[state.activePlayerIndex]
    if (playerPos) {
      createFloatingText('🚫 FOLD', window.innerWidth / 2, window.innerHeight / 2, '#FF6B35')
    }
    actions.fold()
  }

  const handleBet = (amount: number) => {
    soundEffects.playBet()
    if (callButtonRef.current) animateButton(callButtonRef.current, 'action-bet')
    const playerPos = state.players[state.activePlayerIndex]
    if (playerPos) {
      createFloatingText(`💰 BET ${amount}`, window.innerWidth / 2, window.innerHeight / 2, '#00FF88')
    }
    actions.bet(amount)
  }

  const handleStartGame = () => {
    soundEffects.playCall()
    if (startButtonRef.current) animateButton(startButtonRef.current, 'action-call')
    createFloatingText('🎮 GAME START', window.innerWidth / 2, window.innerHeight / 2, '#00FFCC')
    actions.startGame()
  }

  const handleNextRound = () => {
    soundEffects.playWin()
    if (nextRoundButtonRef.current) animateButton(nextRoundButtonRef.current, 'win-pulse')
    actions.nextRound()
  }


  const canAct = state.phase !== 'idle' && state.phase !== 'showdown' && !state.actionInProgress
  const isPlayerTurn = state.players.length > 0 && state.players[state.activePlayerIndex]?.id === state.playerId

  if (gameMode === 'menu') {
    return (
      <div className="poker-table--wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: 'linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 50%, #16213e 100%)' }}>
        <div style={{ background: 'linear-gradient(135deg, #0a0a14 0%, #16213e 100%)', padding: 30, borderRadius: 16, color: 'white', textAlign: 'center', maxWidth: 480, border: '3px solid #FFD700', boxShadow: '0 0 50px rgba(255, 215, 0, 0.6), 0 0 30px rgba(255, 107, 107, 0.3)', maxHeight: '95vh', overflowY: 'auto' }}>
          <h1 style={{ marginBottom: 5, fontSize: 32, color: '#FFD700', textShadow: '0 0 20px rgba(255, 215, 0, 0.8)' }}>🎰 POKER</h1>
          <p style={{ fontSize: 12, color: '#FF69B4', marginBottom: 15, fontWeight: 'bold' }}>Texas Hold'em Card Game</p>
          
          <div style={{ marginBottom: 15, padding: 10, background: 'linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(22,33,62,0.8) 100%)', borderRadius: 8, border: '2px solid #00CED1' }}>
            <div style={{ fontSize: 12, marginBottom: 5 }}>
              <strong style={{ color: '#00CED1' }}>Connection Status:</strong> <span style={{ color: connectionState === 'connected' ? '#00FF00' : connectionState === 'connecting' ? '#FFD700' : '#FF6B6B', fontWeight: 'bold', textShadow: '0 0 10px currentColor' }}>
                ● {connectionState.toUpperCase()}
              </span>
            </div>
            {error && <div style={{ fontSize: 10, color: '#FF6B6B', marginTop: 5, textShadow: '0 0 5px rgba(255, 107, 107, 0.8)' }}>⚠️ {error}</div>}
          </div>

          <div style={{ marginBottom: 15 }}>
            <label style={{ display: 'block', textAlign: 'left', marginBottom: 5, fontSize: 11, color: '#FFD700', fontWeight: 'bold', textShadow: '0 0 10px rgba(255, 215, 0, 0.6)' }}>YOUR NAME</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '2px solid #FFD700', background: '#0a0a14', color: '#00FF00', boxSizing: 'border-box', fontSize: 12, textShadow: '0 0 5px rgba(0, 255, 0, 0.5)' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Host Mode */}
            <div style={{ padding: 12, background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.3) 0%, rgba(0, 255, 136, 0.2) 100%)', borderRadius: 8, border: '2px solid #00FF88' }}>
              <h3 style={{ margin: '0 0 6px 0', color: '#00FF88', fontSize: 13, textShadow: '0 0 10px rgba(0, 255, 136, 0.8)' }}>🏠 Host a Game</h3>
              <p style={{ fontSize: 10, color: '#00FFCC', margin: '0 0 8px 0' }}>Create a new game and share the ID with other players</p>
              <button
                onClick={() => {
                  actions.createOnlineGame(playerName)
                  setGameMode('playing')
                }}
                disabled={connectionState !== 'connected' || !playerName.trim()}
                style={{
                  width: '100%',
                  padding: 10,
                  background: connectionState === 'connected' && playerName.trim() ? 'linear-gradient(135deg, #00FF88 0%, #00FFCC 100%)' : '#555',
                  color: connectionState === 'connected' && playerName.trim() ? '#000' : '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: connectionState === 'connected' && playerName.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  fontSize: 12,
                  transition: 'all 0.3s ease',
                  boxShadow: connectionState === 'connected' && playerName.trim() ? '0 0 20px rgba(0, 255, 136, 0.8)' : 'none'
                }}
              >
                Create Online Game
              </button>
            </div>

            {/* Join Mode */}
            <div style={{ padding: 12, background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.3) 0%, rgba(0, 188, 212, 0.2) 100%)', borderRadius: 8, border: '2px solid #00BFFF' }}>
              <h3 style={{ margin: '0 0 6px 0', color: '#00BFFF', fontSize: 13, textShadow: '0 0 10px rgba(0, 191, 255, 0.8)' }}>👥 Join a Game</h3>
              <p style={{ fontSize: 10, color: '#00FFFF', margin: '0 0 8px 0' }}>Enter a game ID from another player</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={joinGameId}
                  onChange={(e) => setJoinGameId(e.target.value)}
                  placeholder="Game ID"
                  style={{ flex: 1, padding: 8, borderRadius: 6, border: '2px solid #00BFFF', background: '#0a0a14', color: '#00FFFF', boxSizing: 'border-box', fontSize: 10, textShadow: '0 0 5px rgba(0, 255, 255, 0.5)' }}
                />
                <button
                  onClick={() => {
                    actions.joinGame(joinGameId, playerName)
                    setGameMode('playing')
                  }}
                  disabled={!joinGameId.trim() || connectionState !== 'connected' || !playerName.trim()}
                  style={{
                    padding: '8px 20px',
                    background: connectionState === 'connected' && joinGameId.trim() && playerName.trim() ? 'linear-gradient(135deg, #00BFFF 0%, #00FFFF 100%)' : '#555',
                    color: connectionState === 'connected' && joinGameId.trim() && playerName.trim() ? '#000' : '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: connectionState === 'connected' && joinGameId.trim() && playerName.trim() ? 'pointer' : 'not-allowed',
                    fontWeight: 'bold',
                    fontSize: 11,
                    transition: 'all 0.3s ease',
                    boxShadow: connectionState === 'connected' && joinGameId.trim() && playerName.trim() ? '0 0 15px rgba(0, 191, 255, 0.8)' : 'none'
                  }}
                >
                  Join
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="poker-table--wrapper" style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: '100%', height: '100vh', paddingTop: '50px', paddingBottom: '70px' }}>
      {/* Top Info Navbar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, background: 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(22,33,62,0.9) 100%)', borderBottom: '2px solid #00BFFF', boxShadow: '0 4px 20px rgba(0, 191, 255, 0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', height: '50px' }}>
        {/* Game ID and Connection */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#FFD700', fontWeight: 'bold', fontSize: 12 }}>Game ID:</span>
            <span style={{ color: '#00FFCC', fontWeight: 'bold', fontSize: 11, minWidth: '150px' }}>{gameId || 'Waiting...'}</span>
            {gameId && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(gameId)
                }}
                title="Copy Game ID"
                style={{
                  padding: '4px 8px',
                  background: 'linear-gradient(135deg, #00FF88 0%, #00FFCC 100%)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 136, 0.8)')}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
              >
                📋
              </button>
            )}
          </div>
          
          <div style={{ borderLeft: '1px solid #00BFFF', paddingLeft: 20, display: 'flex', gap: 15, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#00BFFF', fontWeight: 'bold', fontSize: 11 }}>Connection:</span>
              <span style={{ color: connectionState === 'connected' ? '#00FF00' : connectionState === 'connecting' ? '#FFD700' : '#FF6B6B', fontWeight: 'bold', fontSize: 11, textShadow: '0 0 5px currentColor' }}>● {connectionState.toUpperCase()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#FF69B4', fontWeight: 'bold', fontSize: 11 }}>Phase:</span>
              <span style={{ color: '#FFED4E', fontWeight: 'bold', fontSize: 11 }}>{state.phase}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#00FF88', fontWeight: 'bold', fontSize: 11 }}>Pot:</span>
              <span style={{ color: '#00FFCC', fontWeight: 'bold', fontSize: 11 }}>{state.pot} 💰</span>
            </div>
          </div>
        </div>

        {/* Players Counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 20, borderLeft: '1px solid #00BFFF' }}>
          {state.players.map((p: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: i === state.activePlayerIndex ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.05)', borderRadius: 4, borderLeft: i === state.activePlayerIndex ? '2px solid #00FF88' : '2px solid #aaa' }}>
              <span style={{ color: i === state.activePlayerIndex ? '#00FFCC' : '#aaa', fontWeight: 'bold', fontSize: 10 }}>{p.name.slice(0, 8)}</span>
              <span style={{ color: i === state.activePlayerIndex ? '#00FFCC' : '#aaa', fontSize: 10 }}>({p.chips})</span>
            </div>
          ))}

          {/* Sound Mute Button */}
          <button
            onClick={() => {
              const muted = soundEffects.toggleMute()
              setIsMuted(muted)
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
            style={{
              marginLeft: 10,
              padding: '4px 8px',
              background: isMuted ? '#FF6B35' : '#00FF88',
              border: 'none',
              borderRadius: 4,
              color: '#000',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* Bet Slider - positioned at bottom left when active */}
      {canAct && isPlayerTurn && (
        <div style={{ position: 'absolute', bottom: 80, left: 20, zIndex: 300, width: 350 }}>
          <ActionPanel pot={state.pot} onBet={handleBet} />
        </div>
      )}

      {/* Main Table */}
      <Table state={state} actions={actions} />
      
      {/* Pot Display */}
      <div className='pot-container'>
        <img style={{height: 55, width: 55}} src={'/old-assets/pot.svg'} alt="Pot"/>
        <h4 style={{ margin: 0, color: 'white', fontSize: 18 }}>{state.pot}</h4>
      </div>

      {/* Community Cards */}
      <div className="community-card-container">
        {state.community.map((c: any, i: number) => (
          <Card key={i} cardData={{ ...c, animationDelay: i * 150 }} />
        ))}
      </div>

      {/* Winner Announcement Modal */}
      {state.phase === 'showdown' && state.winner && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 500,
          animation: 'fadeIn 0.5s ease-in-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            padding: 40,
            borderRadius: 16,
            textAlign: 'center',
            color: 'white',
            maxWidth: 500,
            border: '3px solid #FFD700',
            boxShadow: '0 0 30px rgba(255, 215, 0, 0.5)',
            animation: 'slideUp 0.6s ease-out'
          }}>
            <h1 style={{ fontSize: 48, margin: '0 0 20px 0', color: '#FFD700' }}>🏆 WINNER 🏆</h1>
            <h2 style={{ fontSize: 32, margin: '0 0 15px 0', color: '#fff' }}>{state.winner.name}</h2>
            <p style={{ fontSize: 18, margin: '15px 0', color: '#FFD700' }}>
              Won <strong>{state.winner.potWon}</strong> chips
            </p>
            <p style={{ fontSize: 16, margin: '10px 0', color: '#aaa' }}>
              {state.winner.reason}
            </p>
            <p style={{ fontSize: 18, margin: '10px 0 30px 0', color: '#FFD700', fontWeight: 'bold' }}>
              {state.winner.handType}
            </p>
            <p style={{ fontSize: 14, margin: '10px 0 0 0', color: '#4EB04E' }}>
              Total chips: <strong>{state.winner.chips}</strong>
            </p>
            <button
              onClick={() => actions.nextRound()}
              style={{
                marginTop: 30,
                padding: '12px 40px',
                background: isNextRoundHovered ? '#5CB85C' : '#4EB04E',
                color: 'white',
                border: 'none',
                borderRadius: 25,
                fontSize: 16,
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={() => setIsNextRoundHovered(true)}
              onMouseLeave={() => setIsNextRoundHovered(false)}
            >
              Next Round
            </button>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, background: 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(22,33,62,0.9) 100%)', borderTop: '2px solid #FFD700', boxShadow: '0 -4px 20px rgba(255, 215, 0, 0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', height: '70px' }}>
        {/* Back to Menu Button */}
        <button
          onClick={() => {
            actions.reset()
            setGameMode('menu')
          }}
          style={{ padding: '10px 25px', cursor: 'pointer', background: 'linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)', color: 'white', border: 'none', borderRadius: 25, fontSize: 14, fontWeight: 'bold', boxShadow: '0 0 15px rgba(255, 107, 53, 0.6)' }}
        >
          ← Back to Menu
        </button>

        {/* Action Buttons */}
        <div className='action-buttons' style={{ gap: 15, display: 'flex', justifyContent: 'center', flex: 1 }}>
          {state.phase === 'idle' && state.players.length === 2 && state.players[0]?.id === state.playerId ? (
            <button
              ref={startButtonRef}
              className='action-button'
              onClick={handleStartGame}
              style={{ background: 'linear-gradient(135deg, #00FF88 0%, #00FFCC 100%)', color: '#000', fontSize: 16, fontWeight: 'bold', padding: '12px 40px', borderRadius: 25, boxShadow: '0 0 20px rgba(0, 255, 136, 0.8)', border: 'none', cursor: 'pointer' }}
            >
              🎮 Start Game
            </button>
          ) : canAct && isPlayerTurn ? (
            <>
              <button ref={callButtonRef} className='action-button' onClick={handleCheck} style={{ borderRadius: 25, padding: '12px 40px', background: 'linear-gradient(135deg, #00BFFF 0%, #00FFFF 100%)', color: '#000', fontWeight: 'bold', boxShadow: '0 0 15px rgba(0, 191, 255, 0.8)', border: 'none', cursor: 'pointer', fontSize: 14 }}>✓ Call/Check</button>
              <button ref={foldButtonRef} className='fold-button' onClick={handleFold} style={{ borderRadius: 25, padding: '12px 40px', background: 'linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)', color: '#fff', fontWeight: 'bold', boxShadow: '0 0 15px rgba(255, 107, 53, 0.8)', border: 'none', cursor: 'pointer', fontSize: 14 }}>🚫 Fold</button>
            </>
          ) : state.phase === 'showdown' ? (
            <button ref={nextRoundButtonRef} className='action-button' onClick={handleNextRound} style={{ borderRadius: 25, padding: '12px 40px', fontSize: 16, fontWeight: 'bold', background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)', color: '#000', boxShadow: '0 0 20px rgba(255, 215, 0, 0.8)', border: 'none', cursor: 'pointer' }}>🎲 Next Round</button>
          ) : null}
        </div>

        {/* Wait Status */}
        <div style={{ color: '#FFD700', fontSize: 13, textAlign: 'right', fontWeight: 'bold', minWidth: '150px' }}>
          {state.phase === 'idle' && state.players.length < 2 ? '⏳ Waiting for players...' : state.phase === 'idle' ? '' : `${state.players[state.activePlayerIndex]?.name}'s Turn`}
        </div>
      </div>

    </div>
  )
}

