'use client'
import React, { useState } from 'react'
import Table from './components/Table'
import Card from './components/Card'
import useWebSocketGame from './hooks/useWebSocketGame'
import './poker.css'
import ActionPanel from './components/ActionPanel'

export default function PokerPage() {
  const { state, connectionState, gameId, error, actions } = useWebSocketGame()
  const [gameMode, setGameMode] = useState<'menu' | 'playing'>('menu')
  const [joinGameId, setJoinGameId] = useState('')
  const [playerName, setPlayerName] = useState('Player')
  const [isNextRoundHovered, setIsNextRoundHovered] = useState(false)

  const canAct = state.phase !== 'idle' && state.phase !== 'showdown' && !state.actionInProgress
  const isPlayerTurn = state.players.length > 0 && state.players[state.activePlayerIndex]?.id === state.playerId

  if (gameMode === 'menu') {
    return (
      <div className="poker-table--wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
        <div style={{ background: 'rgba(0,0,0,0.8)', padding: 40, borderRadius: 12, color: 'white', textAlign: 'center', maxWidth: 400 }}>
          <h1 style={{ marginBottom: 20 }}>Poker Game</h1>
          
          <div style={{ marginBottom: 20, padding: 12, background: 'rgba(0,0,0,0.5)', borderRadius: 8 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>Connection:</strong> <span style={{ color: connectionState === 'connected' ? '#4EB04E' : connectionState === 'connecting' ? '#FFA500' : '#E74C3C' }}>
                {connectionState.toUpperCase()}
              </span>
            </div>
            {error && <div style={{ fontSize: 12, color: '#FF6B6B', marginTop: 8 }}>{error}</div>}
          </div>

          <div style={{ marginBottom: 20 }}>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              style={{ width: '100%', padding: 10, borderRadius: 4, border: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => {
                actions.createLocalGame()
                setGameMode('playing')
              }}
              disabled={connectionState !== 'connected'}
              style={{
                padding: 12,
                background: connectionState === 'connected' ? '#2adb2a' : '#555',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: connectionState === 'connected' ? 'pointer' : 'not-allowed',
                fontWeight: 'bold',
              }}
            >
              Start Local Game
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={joinGameId}
                onChange={(e) => setJoinGameId(e.target.value)}
                placeholder="Game ID"
                style={{ flex: 1, padding: 10, borderRadius: 4, border: 'none', boxSizing: 'border-box' }}
              />
              <button
                onClick={() => {
                  actions.joinGame(joinGameId, playerName)
                  setGameMode('playing')
                }}
                disabled={!joinGameId || connectionState !== 'connected'}
                style={{
                  padding: 12,
                  background: connectionState === 'connected' ? '#FF9800' : '#555',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: connectionState === 'connected' ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                }}
              >
                Join
              </button>
            </div>

            <button
              onClick={() => {
                actions.createOnlineGame(playerName)
                setGameMode('playing')
              }}
              disabled={connectionState !== 'connected'}
              style={{
                padding: 12,
                background: connectionState === 'connected' ? '#2196F3' : '#555',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: connectionState === 'connected' ? 'pointer' : 'not-allowed',
                fontWeight: 'bold',
              }}
            >
              Create Online Game
            </button>
          </div>

          {gameId && (
            <div style={{ marginTop: 20, padding: 12, background: 'rgba(33,150,243,0.2)', borderRadius: 4 }}>
              <div style={{ fontSize: 12, color: '#2196F3' }}>
                <strong>Game ID:</strong> {gameId}
              </div>
              <div style={{ fontSize: 10, marginTop: 6 }}>Share this ID with other players</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="poker-table--wrapper" style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: '100%', height: '100vh' }}>
      {/* Top Action Bar */}
      <div style={{ position: 'absolute', top: 20, left: 20, right: 20, zIndex: 300, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className='action-buttons' style={{ gap: 15 }}>
          {state.phase === 'idle' && state.players.length === 2 && state.players[0]?.id === state.playerId ? (
            <button 
              className='action-button' 
              onClick={() => actions.startGame()}
              style={{ background: '#4EB04E', fontSize: 16, fontWeight: 'bold', padding: '10px 30px', borderRadius: 25 }}
            >
              Start Game
            </button>
          ) : canAct && isPlayerTurn ? (
            <>
              <button className='action-button' onClick={() => actions.check()} style={{ borderRadius: 25, padding: '10px 25px' }}>Call/Check</button>
              <button className='fold-button' onClick={() => actions.fold()} style={{ borderRadius: 25, padding: '10px 25px' }}>Fold</button>
            </>
          ) : state.phase === 'showdown' ? (
            <button className='action-button' onClick={() => actions.nextRound()} style={{ borderRadius: 25, padding: '10px 30px', fontSize: 16, fontWeight: 'bold' }}>Next Round</button>
          ) : null}
        </div>
        
        <div style={{ color: '#ccc', fontSize: 14, textAlign: 'right' }}>
          {state.phase === 'idle' && state.players.length < 2 ? 'Waiting for players...' : state.phase === 'idle' ? '' : `Bet: ${state.players[state.activePlayerIndex]?.bet || 0} | Phase: ${state.phase}`}
        </div>
      </div>

      {/* Bet Slider - positioned at top right when active */}
      {canAct && isPlayerTurn && (
        <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 300, width: 400 }}>
          <ActionPanel pot={state.pot} onBet={(amt: number) => actions.bet(amt)} />
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
            <p style={{ fontSize: 16, margin: '10px 0 30px 0', color: '#aaa' }}>
              {state.winner.reason}
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

      {/* Back to Menu Button */}
      <div style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 200 }}>
        <button 
          onClick={() => {
            actions.reset()
            setGameMode('menu')
          }} 
          style={{ padding: '10px 20px', cursor: 'pointer', background: '#555', color: 'white', border: 'none', borderRadius: 6, fontSize: 14 }}
        >
          Back to Menu
        </button>
      </div>

      {/* Debug Info - Top Right */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 100, color: 'white', fontSize: 11, background: 'rgba(0,0,0,0.7)', padding: 12, borderRadius: 6, maxWidth: 200 }}>
        <div><strong>Game ID:</strong> {gameId ? gameId.slice(0, 8) + '...' : 'N/A'}</div>
        <div><strong>Connection:</strong> {connectionState}</div>
        <div><strong>Phase:</strong> {state.phase}</div>
        <div><strong>Pot:</strong> {state.pot}</div>
        <div><strong>Players:</strong> {state.players.length}</div>
        {state.players.map((p: any, i: number) => (
          <div key={i} style={{ fontSize: 10, marginTop: 4, color: i === state.activePlayerIndex ? '#4EB04E' : '#aaa' }}>
            {p.name}: {p.chips} (Bet: {p.bet})
          </div>
        ))}
        {error && <div style={{ fontSize: 10, marginTop: 8, color: '#FF6B6B' }}>Error: {error}</div>}
      </div>
    </div>
  )
}

