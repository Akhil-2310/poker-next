

// TODO: Uncomment when Yellow SDK is installed
import { YellowClient, AppSession } from '@yellow-network/sdk'
import { Client } from "yellow-ts";

interface YellowConfig {
  networkUrl: string
  apiKey: string
  chainId: number
}

// Yellow Network Configuration
export const yellowConfig: YellowConfig = {
  networkUrl: process.env.NEXT_PUBLIC_YELLOW_NETWORK_URL || 'wss://yellow-network-url',
  apiKey: process.env.NEXT_PUBLIC_YELLOW_API_KEY || '',
  chainId: parseInt(process.env.NEXT_PUBLIC_YELLOW_CHAIN_ID || '1'),
}

// TODO: Initialize Yellow Client after SDK installation
export const yellowClient = new Client({
    url: 'wss://clearnet.yellow.com/ws'
});

// ====== YELLOW NETWORK INTEGRATION STEPS ======
//
// 1. CREATE APP SESSION (When game starts)
//    - Called after both players join
//    - Requires both player wallet addresses
//    - Returns session ID
//
// Example:
export async function createGameSession(
  player1Address: string,
  player2Address: string,
  initialDeposit: number
) {
  const session = await yellowClient.createAppSession({
    participants: [player1Address, player2Address],
    initialBalance: {
      [player1Address]: initialDeposit,
      [player2Address]: initialDeposit,
    },
    metadata: {
      gameType: 'poker',
      version: '1.0',
    },
  })
  
  return session
}

// 2. SIGN GAME ACTIONS (Every poker action)
//    - bet, call, fold, check, raise
//    - Creates cryptographic proof
//    - Stored in state channel
//
// Example:
export async function signAction(
  sessionId: string,
  walletAddress: string,
  action: string,
  amount?: number,
  nonce?: number
) {
  const signature = await yellowClient.signStateUpdate({
    sessionId,
    action,
    amount: amount || 0,
    nonce: nonce || Date.now(),
    timestamp: Date.now(),
  })
  
  return signature
}

// 3. VERIFY SIGNATURES (Server-side)
//    - Validate each action was signed by correct player
//    - Prevent cheating/tampering
//
// Example (server.js):
const isValid = await YellowVerifier.verifySignature({
  signature: playerSignature,
  sessionId: game.yellowSessionId,
  action: message.payload.action,
  walletAddress: player.walletAddress,
})

// 4. SETTLE SESSION (Game ends)
//    - Distribute winnings
//    - Close state channel
//    - Submit final state on-chain (optional)
//
// Example:
export async function settleGameSession(
  sessionId: string,
  winnerAddress: string,
  pot: number
) {
  const settlement = await yellowClient.settleSession({
    sessionId,
    finalBalances: {
      [winnerAddress]: pot,
    },
    closeChannel: true,
  })
  
  return settlement
}

// 5. HANDLE DISCONNECTION (Player drops)
//    - Store current state
//    - Allow reconnection
//    - Dispute resolution if needed
//
// Example:
export async function handleDisconnection(
  sessionId: string,
  disconnectedPlayer: string
) {
  await yellowClient.pauseSession({
    sessionId,
    reason: 'Player disconnected',
    timeout: 300000, // 5 minutes to reconnect
  })
}

// ====== YELLOW NETWORK FLOW ======
//
// Game Start:
//  1. Both players connect wallets
//  2. Create game → Send wallet addresses to server
//  3. Server stores wallet addresses
//  4. Frontend calls createGameSession()
//  5. Store sessionId in game state
//
// During Game:
//  1. Player makes action (bet/fold/etc)
//  2. Frontend calls signAction()
//  3. Send action + signature to server
//  4. Server verifies signature
//  5. Server processes game logic
//  6. Broadcast updated state
//
// Game End:
//  1. Determine winner
//  2. Call settleGameSession()
//  3. Yellow Network distributes funds
//  4. Display winner & payout
//
// ====== INTEGRATION WITH EXISTING CODE ======
//
// In page.tsx:
//  - After game starts, create Yellow session
//  - Before each action, sign with Yellow
//  - On game end, settle Yellow session
//
// In useWebSocketGame.ts:
//  - Add yellowSessionId to state
//  - Modify action handlers to sign before sending
//  - Add settlement on winner determined
//
// In server.js:
//  - Add signature verification middleware
//  - Store signatures for dispute resolution
//  - Validate all actions have valid signatures

export default yellowConfig
