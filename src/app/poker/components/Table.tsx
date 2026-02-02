'use client'
import React from 'react'
import PlayerSeat from './PlayerSeat'

export default function Table({ state, actions }: any) {
  const players = state.players || []

  return (
    <section className="poker-app--background">
      <div className="poker-table--container">
        <img className="poker-table--table-image" src={'/old-assets/table-nobg-svg-01.svg'} alt="Poker Table" />

        {/* Render up to 2 players in legacy positions p0, p1 */}
        {players[0] ? <PlayerSeat key={0} player={players[0]} position={0} /> : null}
        {players[1] ? <PlayerSeat key={1} player={players[1]} position={1} /> : null}
      </div>
    </section>
  )
}
