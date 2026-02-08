/**
 * Poker Yellow Network Service
 * Wraps YellowSession for poker game integration with server.js
 * 
 * This module manages:
 * - Creating App Sessions when game starts
 * - Closing App Sessions with final allocations on showdown
 */

import { YellowSession } from './YellowSession';

interface PlayerAllocation {
    walletAddress: string;
    amount: string;  // USDC amount as string (e.g., "0.10")
}

interface PokerGameSession {
    gameId: string;
    session: YellowSession;
    appSessionId: string | null;
    players: PlayerAllocation[];
}

// Store active poker sessions: gameId → PokerGameSession
const activeGames = new Map<string, PokerGameSession>();

/**
 * Initialize a Yellow Network session for a poker game
 * Call this when the game is created
 */
export async function initializeGame(gameId: string): Promise<void> {
    const session = new YellowSession();
    await session.connect();

    activeGames.set(gameId, {
        gameId,
        session,
        appSessionId: null,
        players: [],
    });

    console.log(`[Yellow] Initialized session for game ${gameId}`);
}

/**
 * Start a poker App Session when all players are ready
 * Call this when game phase transitions from 'idle' to 'betting1'
 */
export async function startPokerSession(
    gameId: string,
    players: Array<{ walletAddress: string; buyIn: string }>
): Promise<string> {
    const game = activeGames.get(gameId);
    if (!game) {
        throw new Error(`No Yellow session for game ${gameId}`);
    }

    const participants = players.map(p => p.walletAddress);
    const allocations = players.map(p => ({
        participant: p.walletAddress,
        asset: 'usdc',
        amount: p.buyIn,
    }));

    game.players = players.map(p => ({
        walletAddress: p.walletAddress,
        amount: p.buyIn,
    }));

    const appSessionId = await game.session.createPokerSession(participants, allocations);
    game.appSessionId = appSessionId;

    console.log(`[Yellow] App Session started for game ${gameId}: ${appSessionId}`);
    return appSessionId;
}

/**
 * Close the poker App Session with final allocations
 * Call this on showdown with winner information
 */
export async function settlePokerSession(
    gameId: string,
    finalAllocations: Array<{ walletAddress: string; amount: string }>
): Promise<void> {
    const game = activeGames.get(gameId);
    if (!game || !game.appSessionId) {
        throw new Error(`No active App Session for game ${gameId}`);
    }

    const allocations = finalAllocations.map(a => ({
        participant: a.walletAddress,
        asset: 'usdc',
        amount: a.amount,
    }));

    await game.session.closePokerSession(allocations);
    game.appSessionId = null;

    console.log(`[Yellow] App Session settled for game ${gameId}`);
}

/**
 * Cleanup Yellow session when game ends
 */
export async function cleanupGame(gameId: string): Promise<void> {
    const game = activeGames.get(gameId);
    if (game) {
        await game.session.disconnect();
        activeGames.delete(gameId);
        console.log(`[Yellow] Cleaned up session for game ${gameId}`);
    }
}

/**
 * Get the YellowSession for a game (for direct access if needed)
 */
export function getSession(gameId: string): YellowSession | null {
    return activeGames.get(gameId)?.session || null;
}
