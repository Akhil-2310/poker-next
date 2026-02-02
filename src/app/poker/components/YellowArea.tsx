'use client'
import React, { useState } from 'react'

type YellowAction = { type: string; amount?: number }

export default function YellowArea({ onPerform }: { onPerform: (a: YellowAction) => void }) {
  const [amount, setAmount] = useState<number>(0)

  return (
    <div style={{ border: '2px solid #FFD54F', padding: 12, borderRadius: 8, background: '#FFF8E1' }}>
      <div style={{ marginBottom: 8 }}><strong>Yellow (money) area</strong></div>
      <div style={{ marginBottom: 8 }}>This UI triggers money-related actions. Backend handles settlement.</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 120 }} />
        <button onClick={() => onPerform({ type: 'addFunds', amount })}>Add Funds</button>
        <button onClick={() => onPerform({ type: 'withdraw', amount })}>Withdraw</button>
      </div>
    </div>
  )
}
