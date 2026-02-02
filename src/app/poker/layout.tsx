import React from 'react'

export const metadata = {
  title: 'Poker',
}

export default function PokerLayout({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ width: '100%', height: '100vh', margin: 0, padding: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {children}
    </main>
  )
}
