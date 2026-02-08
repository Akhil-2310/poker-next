/**
 * WebSocket Poker Server with Yellow Network Integration
 * Converted to TypeScript with proper types and App Session support
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
    initializeGame,
    startPokerSession,
    settlePokerSession,
    cleanupGame
} from './game/poker-yellow-service';

// ====== TYPE DEFINITIONS ======

interface Card {
    suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
    rank: 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
}

interface Player {
    id: string;
    name: string;
    walletAddress: string | null;
    chips: number;
    bet: number;
    roundBet: number;
    hand: Card[];
    folded: boolean;
    isActive: boolean;
    hasDealerChip: boolean;
    actedThisRound?: boolean;
    handType?: string;
}

interface WinnerInfo {
    id: string;
    name: string;
    chips: number;
    potWon: number;
    reason: string;
    hand: Card[];
    handType: string;
    allHands?: Array<{ id: string; name: string; hand: Card[]; score: number; handType: string }>;
}

interface FoldWinnerInfo {
    id: string;
    name: string;
    chips: number;
    potWon: number;
    foldedPlayerId: string;
    foldedPlayerName: string;
}

interface Game {
    gameId: string;
    gameType: string;
    yellowSessionId: string | null;
    players: Player[];
    community: Card[];
    pot: number;
    highBet: number;
    phase: 'idle' | 'betting1' | 'flop' | 'betting2' | 'turn' | 'betting3' | 'river' | 'betting4' | 'showdown';
    activePlayerIndex: number;
    minBet: number;
    deck: Card[] | null;
    winner?: WinnerInfo | null;
    foldWinner?: FoldWinnerInfo | null;
}

interface PlayerConnection {
    ws: WebSocket;
    gameId: string;
}

interface WSMessage {
    type: string;
    payload: {
        gameId?: string;
        playerId?: string;
        playerName?: string;
        gameType?: string;
        walletAddress?: string;
        action?: string;
        amount?: number;
    };
}

// ====== SERVER SETUP ======

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store games: gameId → Game
const games = new Map<string, Game>();

// Store player connections: playerId → PlayerConnection
const playerConnections = new Map<string, PlayerConnection>();

console.log('🚀 Starting WebSocket Poker Server (TypeScript)...\n');

// ====== CARD UTILITIES ======

function createDeck(): Card[] {
    const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const deck: Card[] = [];

    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank });
        }
    }

    return deck.sort(() => Math.random() - 0.5); // Shuffle
}

function dealCards(game: Game): void {
    if (!game.deck) {
        game.deck = createDeck();
    }

    game.players.forEach((player) => {
        player.hand = [game.deck!.pop()!, game.deck!.pop()!];
    });

    console.log(`   💳 Cards dealt to ${game.players.length} players`);
}

function dealCommunityCards(game: Game, count: number): void {
    if (!game.deck) {
        game.deck = createDeck();
    }

    for (let i = 0; i < count; i++) {
        game.community.push(game.deck!.pop()!);
    }

    console.log(`   💳 ${count} community card(s) dealt. Total: ${game.community.length}`);
}

function getCardValue(rank: Card['rank']): number {
    const values: Record<Card['rank'], number> = {
        'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10,
        '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
    };
    return values[rank];
}

function evaluateHand(hand: Card[], community: Card[]): { score: number; handType: string } {
    const allCards = [...hand, ...community];

    // Count occurrences of each rank
    const rankCounts: Record<string, number> = {};
    allCards.forEach(card => {
        rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    });

    // Count occurrences of each suit
    const suitCounts: Record<string, number> = {};
    allCards.forEach(card => {
        suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    });

    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const values = allCards.map(card => getCardValue(card.rank)).sort((a, b) => b - a);

    // Check for flush
    const isFlush = Object.values(suitCounts).some(count => count >= 5);

    // Check for straight
    const uniqueValues = [...new Set(values)];
    let isStraight = false;
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
        if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
            isStraight = true;
            break;
        }
    }
    // Check for A-2-3-4-5 (wheel)
    if (!isStraight && uniqueValues.includes(14) && uniqueValues.includes(2) &&
        uniqueValues.includes(3) && uniqueValues.includes(4) && uniqueValues.includes(5)) {
        isStraight = true;
    }

    let handType = 'High Card';
    let score = values[0];

    if (counts[0] === 4) {
        handType = 'Four of a Kind';
        score = 800000 + values[0];
    } else if (counts[0] === 3 && counts[1] === 2) {
        handType = 'Full House';
        score = 700000 + values[0];
    } else if (isFlush) {
        handType = 'Flush';
        score = 600000 + values[0];
    } else if (isStraight) {
        handType = 'Straight';
        score = 500000 + values[0];
    } else if (counts[0] === 3) {
        handType = 'Three of a Kind';
        score = 400000 + values[0];
    } else if (counts[0] === 2 && counts[1] === 2) {
        handType = 'Two Pair';
        score = 300000 + values[0];
    } else if (counts[0] === 2) {
        handType = 'Pair';
        score = 200000 + values[0];
    } else {
        handType = 'High Card';
        score = 100000 + values[0];
    }

    return { score, handType };
}

function determineWinner(players: Player[], community: Card[]): Player {
    const activePlayers = players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
        return activePlayers[0];
    }

    let winner = activePlayers[0];
    let bestEval = evaluateHand(winner.hand, community);

    for (let i = 1; i < activePlayers.length; i++) {
        const handEval = evaluateHand(activePlayers[i].hand, community);
        if (handEval.score > bestEval.score) {
            bestEval = handEval;
            winner = activePlayers[i];
        }
    }

    winner.handType = bestEval.handType;
    return winner;
}

function allBetsMatched(game: Game): boolean {
    const activePlayers = game.players.filter(p => !p.folded && p.isActive);

    if (activePlayers.length <= 1) return true;

    const playersWithChips = activePlayers.filter(p => p.chips > 0);
    const allAllIn = playersWithChips.length === 0;

    if (allAllIn) return true;

    const playersWithChipsActed = playersWithChips.every(p => p.actedThisRound);
    const betsMatch = playersWithChips.every(p => p.roundBet === playersWithChips[0].roundBet);

    return playersWithChipsActed && betsMatch;
}

function advanceActivePlayer(game: Game): void {
    const activePlayers = game.players.filter(p => !p.folded);
    if (activePlayers.length <= 1) return;

    const currentPlayerIndex = game.activePlayerIndex;
    const currentPlayerName = game.players[currentPlayerIndex]?.name || 'Unknown';
    let nextIndex = (currentPlayerIndex + 1) % game.players.length;

    let skipCount = 0;
    while ((game.players[nextIndex].folded || game.players[nextIndex].chips === 0) && skipCount < game.players.length) {
        nextIndex = (nextIndex + 1) % game.players.length;
        skipCount++;
    }

    if (skipCount >= game.players.length) {
        console.log(`   ⏭️  All players all-in or folded, not advancing`);
        return;
    }

    const nextPlayerName = game.players[nextIndex]?.name || 'Unknown';
    game.activePlayerIndex = nextIndex;
    console.log(`   👉 Active player: ${currentPlayerName} (${currentPlayerIndex}) → ${nextPlayerName} (${nextIndex})`);
}

// ====== YELLOW NETWORK SETTLEMENT ======

async function handleShowdownSettlement(game: Game): Promise<void> {
    if (!game.yellowSessionId) return;

    try {
        const winner = game.winner;
        if (!winner) return;

        // Calculate final allocations based on who won the pot
        const finalAllocations = game.players
            .filter(p => p.walletAddress)
            .map(p => ({
                walletAddress: p.walletAddress!,
                // Winner gets their original chips plus pot won, losers get 0 (simplified)
                amount: p.id === winner.id ? String(winner.potWon / 1000000) : '0'
            }));

        await settlePokerSession(game.gameId, finalAllocations);
        console.log(`   💸 Yellow Network settlement complete`);
    } catch (error) {
        console.error(`   ❌ Yellow settlement failed:`, error);
    }
}

// ====== PHASE ADVANCEMENT ======

async function advancePhase(game: Game): Promise<void> {
    const phases: Game['phase'][] = ['betting1', 'flop', 'betting2', 'turn', 'betting3', 'river', 'betting4', 'showdown'];
    const currentIndex = phases.indexOf(game.phase);

    console.log(`   🔄 Advancing from phase: ${game.phase} (index ${currentIndex})`);

    if (currentIndex === -1) return;

    const activePlayers = game.players.filter(p => !p.folded && p.isActive);
    const allAllIn = activePlayers.every(p => p.chips === 0);

    let nextIndex = currentIndex + 1;

    if (allAllIn) {
        if (game.community.length < 5) {
            dealCommunityCards(game, 5 - game.community.length);
        }
        game.phase = 'showdown';

        const activePlayersForWinner = game.players.filter(p => !p.folded);
        let winner: Player;
        let winReason = '';

        if (activePlayersForWinner.length === 1) {
            winner = activePlayersForWinner[0];
            winReason = 'Everyone else folded';
        } else {
            winner = determineWinner(game.players, game.community);
            winReason = 'Best hand';
        }

        if (winner) {
            winner.chips += game.pot;
            console.log(`   🏆 Winner: ${winner.name} wins ${game.pot} chips! (${winReason})`);

            const playerHandEvals = game.players
                .filter(p => !p.folded)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    hand: p.hand,
                    ...evaluateHand(p.hand, game.community)
                }));

            game.winner = {
                id: winner.id,
                name: winner.name,
                chips: winner.chips,
                potWon: game.pot,
                reason: winReason,
                hand: winner.hand,
                handType: winner.handType || 'High Card',
                allHands: playerHandEvals
            };

            // Settle Yellow Network
            await handleShowdownSettlement(game);
        }
        return;
    }

    if (nextIndex >= phases.length) {
        game.phase = 'showdown';
        return;
    }

    game.phase = phases[nextIndex];
    console.log(`   ➡️  Advanced to phase: ${game.phase} (index ${nextIndex})`);

    if (game.phase.startsWith('betting')) {
        console.log(`   🔄 Resetting betting state for ${game.phase}`);
        game.players.forEach(p => {
            p.roundBet = 0;
            p.actedThisRound = false;
        });
        game.highBet = 0;
        const bettingPhases = ['betting1', 'betting2', 'betting3', 'betting4'];
        const bettingIndex = bettingPhases.indexOf(game.phase);
        game.activePlayerIndex = Math.floor(bettingIndex / 2) % 2;
        console.log(`   👤 Active player set to: ${game.players[game.activePlayerIndex]?.name} (index ${game.activePlayerIndex})`);
    }

    if (game.phase === 'flop') {
        dealCommunityCards(game, 3);
        game.phase = 'betting2';
        game.players.forEach(p => {
            p.roundBet = 0;
            p.actedThisRound = false;
        });
        game.highBet = 0;
        game.activePlayerIndex = 0;
        console.log(`   ➡️  Auto-advanced to betting2 after flop`);
    } else if (game.phase === 'turn') {
        dealCommunityCards(game, 1);
        game.phase = 'betting3';
        game.players.forEach(p => {
            p.roundBet = 0;
            p.actedThisRound = false;
        });
        game.highBet = 0;
        game.activePlayerIndex = 0;
        console.log(`   ➡️  Auto-advanced to betting3 after turn`);
    } else if (game.phase === 'river') {
        dealCommunityCards(game, 1);
        game.phase = 'betting4';
        game.players.forEach(p => {
            p.roundBet = 0;
            p.actedThisRound = false;
        });
        game.highBet = 0;
        game.activePlayerIndex = 0;
        console.log(`   ➡️  Auto-advanced to betting4 after river`);
    } else if (game.phase === 'showdown') {
        const activePlayersForWinner = game.players.filter(p => !p.folded);
        let winner: Player;
        let winReason = '';

        if (activePlayersForWinner.length === 1) {
            winner = activePlayersForWinner[0];
            winReason = 'Everyone else folded';
        } else {
            winner = determineWinner(game.players, game.community);
            winReason = 'Best hand';
        }

        winner.chips += game.pot;

        const playerHandEvals = game.players
            .filter(p => !p.folded)
            .map(p => ({
                id: p.id,
                name: p.name,
                hand: p.hand,
                ...evaluateHand(p.hand, game.community)
            }));

        game.winner = {
            id: winner.id,
            name: winner.name,
            chips: winner.chips,
            potWon: game.pot,
            reason: winReason,
            hand: winner.hand,
            handType: winner.handType || 'High Card',
            allHands: playerHandEvals
        };

        console.log(`   🏆 Winner: ${winner.name} wins ${game.pot} chips! (${winReason})`);

        // Settle Yellow Network
        await handleShowdownSettlement(game);
    }
}

function broadcastGameState(gameId: string): void {
    const game = games.get(gameId);
    if (!game) return;

    const payload = {
        gameId: game.gameId,
        yellowSessionId: game.yellowSessionId || null,
        players: game.players,
        community: game.community,
        pot: game.pot,
        highBet: game.highBet,
        phase: game.phase,
        activePlayerIndex: game.activePlayerIndex,
        minBet: game.minBet,
        winner: game.winner || null,
        foldWinner: game.foldWinner || null,
    };

    const message = JSON.stringify({
        type: 'gameState',
        payload,
    });

    console.log(`   Sending to ${game.players.length} players:`);

    game.players.forEach((player) => {
        const conn = playerConnections.get(player.id);
        if (conn && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(message);
            console.log(`     ✓ ${player.name}`);
        } else {
            console.log(`     ✗ ${player.name} (not connected)`);
        }
    });
}

// ====== WEBSOCKET HANDLERS ======

wss.on('connection', (ws) => {
    console.log('✅ New client connected\n');

    ws.on('message', async (data) => {
        try {
            console.log('\n🔍 Raw data received:', data.toString());
            const message: WSMessage = JSON.parse(data.toString());
            console.log('📨 Message received:', message.type);
            console.log('   Payload:', message.payload ? JSON.stringify(message.payload) : 'UNDEFINED ❌');

            if (!message.payload) {
                console.error('❌ Error: Payload is undefined for message type:', message.type);
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: { message: 'Missing payload in request' }
                }));
                return;
            }

            if (message.type === 'createGame') {
                const { playerName, gameType, walletAddress } = message.payload;
                const gameId = uuidv4();
                const playerId = uuidv4();

                const newGame: Game = {
                    gameId,
                    gameType: gameType || 'standard',
                    yellowSessionId: null,
                    players: [
                        {
                            id: playerId,
                            name: playerName || 'Player 1',
                            walletAddress: walletAddress || null,
                            chips: 1000,
                            bet: 0,
                            roundBet: 0,
                            hand: [],
                            folded: false,
                            isActive: true,
                            hasDealerChip: true,
                        },
                    ],
                    community: [],
                    pot: 0,
                    highBet: 0,
                    phase: 'idle',
                    activePlayerIndex: 0,
                    minBet: 20,
                    deck: null,
                };

                games.set(gameId, newGame);
                playerConnections.set(playerId, { ws, gameId });

                // Initialize Yellow Network session for this game
                try {
                    await initializeGame(gameId);
                    console.log(`   ✅ Yellow Network session initialized`);
                } catch (error) {
                    console.log(`   ⚠️ Yellow Network not initialized (optional):`, error);
                }

                console.log(`   ✅ Game created: ${gameId}`);
                console.log(`   ✅ Player added: ${playerName} (${playerId})`);
                console.log(`   ✅ Players in game: 1\n`);

                ws.send(JSON.stringify({
                    type: 'gameCreated',
                    payload: { gameId, playerId },
                }));
            }
            else if (message.type === 'joinGame') {
                const { gameId, playerName, walletAddress } = message.payload;
                const game = games.get(gameId!);

                if (!game) {
                    console.log(`   ❌ Game not found: ${gameId}\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Game not found' },
                    }));
                    return;
                }

                if (game.players.length >= 2) {
                    console.log(`   ❌ Game is full: ${gameId}\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Game is full' },
                    }));
                    return;
                }

                const playerId = uuidv4();
                game.players.push({
                    id: playerId,
                    name: playerName || 'Player 2',
                    walletAddress: walletAddress || null,
                    chips: 1000,
                    bet: 0,
                    roundBet: 0,
                    hand: [],
                    folded: false,
                    isActive: true,
                    hasDealerChip: false,
                    actedThisRound: false,
                });

                playerConnections.set(playerId, { ws, gameId: gameId! });

                console.log(`   ✅ Player joined: ${playerName} (${playerId})`);
                console.log(`   ✅ Players in game: ${game.players.length}\n`);

                ws.send(JSON.stringify({
                    type: 'gameCreated',
                    payload: { gameId, playerId },
                }));

                broadcastGameState(gameId!);
            }
            else if (message.type === 'startGame') {
                const { gameId, playerId } = message.payload;
                const game = games.get(gameId!);

                if (!game) {
                    console.log(`   ❌ Game not found: ${gameId}\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Game not found' },
                    }));
                    return;
                }

                const isHost = game.players[0]?.id === playerId;
                if (!isHost) {
                    console.log(`   ❌ Only host can start the game\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Only host can start the game' },
                    }));
                    return;
                }

                console.log(`   🎮 Game started by host!`);
                game.phase = 'betting1';
                game.activePlayerIndex = 0;
                game.pot = 0;
                game.highBet = 0;

                game.players.forEach(p => {
                    p.bet = 0;
                    p.roundBet = 0;
                    p.folded = false;
                    p.hand = [];
                    p.actedThisRound = false;
                });

                game.community = [];
                game.deck = createDeck();

                dealCards(game);

                // Start Yellow Network App Session for real-money game
                const playersWithWallets = game.players.filter(p => p.walletAddress);
                // Allow 1 player for testing (YellowSession handles broker padding)
                if (playersWithWallets.length >= 1) {
                    try {
                        const sessionId = await startPokerSession(
                            gameId!,
                            playersWithWallets.map(p => ({
                                walletAddress: p.walletAddress!,
                                buyIn: '0.10' // 0.10 USDC buy-in
                            }))
                        );
                        game.yellowSessionId = sessionId;
                        console.log(`   💰 Yellow App Session started: ${sessionId}`);
                    } catch (error) {
                        console.log(`   ⚠️ Yellow session not started (optional):`, error);
                    }
                }

                console.log(`   📢 Broadcasting gameState to all players...\n`);
                broadcastGameState(gameId!);
            }
            else if (message.type === 'action') {
                const { gameId, action, amount, playerId } = message.payload;
                const game = games.get(gameId!);

                if (!game) {
                    console.log(`   ❌ Game not found: ${gameId}\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Game not found' },
                    }));
                    return;
                }

                if (action === 'nextRound') {
                    console.log(`   ↻ Starting new round`);
                    game.phase = 'idle';
                    game.pot = 0;
                    game.highBet = 0;
                    game.players.forEach(p => {
                        p.bet = 0;
                        p.folded = false;
                        p.hand = [];
                        p.roundBet = 0;
                        p.actedThisRound = false;

                        if (p.chips === 0) {
                            p.chips = 1000;
                            console.log(`   💰 ${p.name} rebuys for 1000 chips`);
                        }
                    });
                    game.community = [];
                    game.winner = null;
                    console.log(`   📢 Broadcasting updated gameState\n`);
                    broadcastGameState(gameId!);
                    return;
                }

                const playerIndex = game.players.findIndex(p => p.id === playerId);
                if (playerIndex === -1) {
                    console.log(`   ❌ Player not found\n`);
                    return;
                }

                console.log(`   🎯 Turn check: phase=${game.phase}, playerIndex=${playerIndex}, activePlayerIndex=${game.activePlayerIndex}`);
                if (game.phase.startsWith('betting') && playerIndex !== game.activePlayerIndex) {
                    console.log(`   ❌ Not ${game.players[playerIndex].name}'s turn (current: ${game.players[game.activePlayerIndex].name})\n`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Not your turn' }
                    }));
                    return;
                }

                const player = game.players[playerIndex];

                console.log(`   ⚡ Action: ${action}${amount ? ` (${amount})` : ''} by ${player.name}`);

                if (action === 'fold') {
                    player.folded = true;
                    console.log(`   🚫 ${player.name} folded`);

                    const activePlayers = game.players.filter(p => !p.folded);
                    if (activePlayers.length === 1) {
                        const winner = activePlayers[0];
                        winner.chips += game.pot;
                        console.log(`   🏆 ${winner.name} wins ${game.pot} chips (others folded)!`);
                        game.phase = 'idle';
                        game.pot = 0;
                        game.foldWinner = {
                            id: winner.id,
                            name: winner.name,
                            chips: winner.chips,
                            potWon: game.pot,
                            foldedPlayerId: player.id,
                            foldedPlayerName: player.name
                        };
                        game.players.forEach(p => {
                            p.bet = 0;
                            p.folded = false;
                            p.hand = [];
                        });
                        game.community = [];
                    } else {
                        advanceActivePlayer(game);
                    }
                }
                else if (action === 'check') {
                    const canCheck = game.highBet === 0 || player.roundBet >= game.highBet;
                    if (!canCheck) {
                        console.log(`   ❌ Cannot check - must match or exceed bet of ${game.highBet}, player round bet: ${player.roundBet}`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: `Must match bet of ${game.highBet}` }
                        }));
                        return;
                    }
                    player.actedThisRound = true;
                    console.log(`   ✓ ${player.name} checked`);
                    advanceActivePlayer(game);

                    if (allBetsMatched(game)) {
                        console.log(`   ✓ All bets matched - advancing phase`);
                        await advancePhase(game);
                    }
                }
                else if (action === 'bet') {
                    if (!amount || amount <= 0 || amount > player.chips) {
                        console.log(`   ❌ Invalid bet amount: ${amount} (available: ${player.chips})`);
                        return;
                    }

                    const betAmount = amount;
                    player.chips -= betAmount;
                    player.roundBet += betAmount;
                    game.pot += betAmount;
                    player.actedThisRound = true;

                    const maxRoundBet = Math.max(...game.players.filter(p => !p.folded && p.isActive).map(p => p.roundBet));
                    const wasARaise = maxRoundBet > game.highBet;

                    game.highBet = maxRoundBet;

                    console.log(`   💰 ${player.name} bet ${betAmount} (round total: ${player.roundBet}, pot: ${game.pot})`);

                    if (wasARaise) {
                        console.log(`   🔼 Raise detected! Other players must respond`);
                        game.players.forEach(p => {
                            if (p.id !== player.id && !p.folded) {
                                p.actedThisRound = false;
                            }
                        });
                    }

                    advanceActivePlayer(game);

                    if (allBetsMatched(game)) {
                        console.log(`   ✓ All bets matched - advancing phase`);
                        await advancePhase(game);
                    }
                }

                console.log(`   📢 Broadcasting updated gameState\n`);
                broadcastGameState(gameId!);
            }
        } catch (error: any) {
            console.error('❌ Error processing message:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                payload: { message: error.message },
            }));
        }
    });

    ws.on('close', () => {
        console.log('❌ Client disconnected\n');
        for (const [playerId, conn] of playerConnections.entries()) {
            if (conn.ws === ws) {
                playerConnections.delete(playerId);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
});

// ====== SERVER START ======

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log('🎮 ═══════════════════════════════════════════════════════');
    console.log(`✅  WebSocket Poker Server (TypeScript) listening on port ${PORT}`);
    console.log('🎮 ═══════════════════════════════════════════════════════\n');
});
