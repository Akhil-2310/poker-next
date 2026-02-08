/**
 * 2-Player Poker Game Script using Yellow Network
 * 
 * Features:
 * - Realistic Texas Hold'em simulation
 * - Multiple betting rounds (pre-flop, flop, turn, river)
 * - Off-chain state updates via Yellow Network
 * - Final settlement on-chain when session closes
 * 
 * Usage: npx tsx scripts/poker-game.ts
 */

import { config } from 'dotenv';
import { createWalletClient, http, Hex, Address, WalletClient } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import { Client } from 'yellow-ts';
import {
    createECDSAMessageSigner,
    createEIP712AuthMessageSigner,
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createAppSessionMessage,
    createCloseAppSessionMessage,
    createSubmitAppStateMessage,
    createGetLedgerBalancesMessage,
    RPCMethod,
    RPCResponse,
    RPCData,
    AuthChallengeResponse,
    RPCAppDefinition,
    RPCAppSessionAllocation,
    RPCProtocolVersion,
} from '@erc7824/nitrolite';

config();

const YELLOW_WS_URL = 'wss://clearnet.yellow.com/ws';
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

// Game Configuration
const BUY_IN = '0.01'; // 0.01 USDC each player
const SMALL_BLIND = 0.001;
const BIG_BLIND = 0.002;

// Card types
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

interface Card {
    suit: typeof SUITS[number];
    rank: typeof RANKS[number];
}

interface PlayerSession {
    name: string;
    wallet: ReturnType<typeof privateKeyToAccount>;
    walletClient: WalletClient;
    sessionKey: Hex;
    sessionAccount: ReturnType<typeof privateKeyToAccount>;
    sessionSigner: ReturnType<typeof createECDSAMessageSigner>;
    yellow: Client;
    authenticated: boolean;
    balance: string;
    chips: number;
    hand: Card[];
    folded: boolean;
    currentBet: number;
}

// Create a shuffled deck
function createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function cardToString(card: Card): string {
    return `${card.rank}${card.suit}`;
}

function handToString(hand: Card[]): string {
    return hand.map(cardToString).join(' ');
}

// Simple hand evaluator (returns score 0-9)
function evaluateHand(hand: Card[], community: Card[]): { score: number; name: string } {
    const allCards = [...hand, ...community];
    const ranks = allCards.map(c => RANKS.indexOf(c.rank));
    const suits = allCards.map(c => c.suit);

    // Count ranks
    const rankCounts: Record<number, number> = {};
    for (const r of ranks) {
        rankCounts[r] = (rankCounts[r] || 0) + 1;
    }

    const counts = Object.values(rankCounts).sort((a, b) => b - a);

    // Check for flush
    const suitCounts: Record<string, number> = {};
    for (const s of suits) {
        suitCounts[s] = (suitCounts[s] || 0) + 1;
    }
    const hasFlush = Object.values(suitCounts).some(c => c >= 5);

    // Check for straight
    const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
    let hasStraight = false;
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
        if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) {
            hasStraight = true;
            break;
        }
    }

    if (hasFlush && hasStraight) return { score: 8, name: 'Straight Flush' };
    if (counts[0] === 4) return { score: 7, name: 'Four of a Kind' };
    if (counts[0] === 3 && counts[1] === 2) return { score: 6, name: 'Full House' };
    if (hasFlush) return { score: 5, name: 'Flush' };
    if (hasStraight) return { score: 4, name: 'Straight' };
    if (counts[0] === 3) return { score: 3, name: 'Three of a Kind' };
    if (counts[0] === 2 && counts[1] === 2) return { score: 2, name: 'Two Pair' };
    if (counts[0] === 2) return { score: 1, name: 'Pair' };
    return { score: 0, name: 'High Card' };
}

async function createPlayerSession(name: string, privateKey: Hex): Promise<PlayerSession> {
    const wallet = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
        account: wallet,
        chain: base,
        transport: http(RPC_URL),
    });

    const sessionKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionKey);
    const sessionSigner = createECDSAMessageSigner(sessionKey);

    const yellow = new Client({ url: YELLOW_WS_URL });

    return {
        name,
        wallet,
        walletClient: walletClient as WalletClient,
        sessionKey,
        sessionAccount,
        sessionSigner,
        yellow,
        authenticated: false,
        balance: '0',
        chips: parseFloat(BUY_IN) * 1000, // Convert to chips (1 chip = 0.001 USDC)
        hand: [],
        folded: false,
        currentBet: 0,
    };
}

async function authenticatePlayer(player: PlayerSession): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${player.name} auth timeout`)), 30000);

        await player.yellow.connect();
        console.log(`🔌 ${player.name} connected to Yellow`);

        const expireTime = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sessionExpireTimestamp = String(expireTime);

        const authParams = {
            scope: 'poker.app',
            application: player.wallet.address,
            participant: player.sessionAccount.address,
            expire: sessionExpireTimestamp,
            allowances: [{ asset: 'usdc', amount: '1.0' }],
            session_key: player.sessionAccount.address,
            expires_at: expireTime,
        };

        const authReq = await createAuthRequestMessage({
            address: player.wallet.address,
            session_key: player.sessionAccount.address,
            application: 'Poker Game',
            scope: 'poker.app',
            expires_at: expireTime,
            allowances: [{ asset: 'usdc', amount: '1.0' }],
        });
        player.yellow.sendMessage(authReq);

        player.yellow.listen(async (msg: RPCResponse) => {
            if (msg.method === RPCMethod.AuthChallenge) {
                console.log(`🔐 ${player.name} received auth challenge`);
                const eip712Signer = createEIP712AuthMessageSigner(
                    player.walletClient,
                    authParams,
                    { name: 'Poker Game' }
                );
                const authVerifyMessage = await createAuthVerifyMessage(
                    eip712Signer,
                    msg as AuthChallengeResponse
                );
                player.yellow.sendMessage(authVerifyMessage);
            } else if (msg.method === RPCMethod.AuthVerify) {
                clearTimeout(timeout);
                player.authenticated = true;
                console.log(`✅ ${player.name} authenticated!`);
                resolve();
            } else if (msg.method === RPCMethod.Error) {
                clearTimeout(timeout);
                reject(new Error(`${player.name} auth error: ${JSON.stringify(msg.params)}`));
            }
        });
    });
}

async function getPlayerBalance(player: PlayerSession): Promise<string> {
    return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${player.name} balance timeout`)), 10000);

        player.yellow.listen(async (msg: RPCResponse) => {
            if (msg.method === RPCMethod.GetLedgerBalances) {
                clearTimeout(timeout);
                const params = msg.params as any;
                const balances = params.ledger_balances || params.ledgerBalances || params.balances || [];
                const usdc = balances.find((b: any) => b.asset?.toLowerCase() === 'usdc');
                const amount = usdc?.amount || usdc?.available || '0';
                player.balance = amount;
                console.log(`💰 ${player.name} balance: ${amount} USDC`);
                resolve(amount);
            }
        });

        const balanceMsg = await createGetLedgerBalancesMessage(player.sessionSigner);
        player.yellow.sendMessage(balanceMsg);
    });
}

async function createPokerAppSession(
    player1: PlayerSession,
    player2: PlayerSession
): Promise<Hex> {
    return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('App session creation timeout')), 30000);

        const appDefinition: RPCAppDefinition = {
            protocol: RPCProtocolVersion.NitroRPC_0_4,
            participants: [player1.wallet.address, player2.wallet.address],
            weights: [50, 50],
            quorum: 100,
            challenge: 0,
            nonce: Date.now(),
            application: 'Poker Game',
        };

        const allocations: RPCAppSessionAllocation[] = [
            { participant: player1.wallet.address, asset: 'usdc', amount: BUY_IN },
            { participant: player2.wallet.address, asset: 'usdc', amount: BUY_IN },
        ];

        const sessionMessage = await createAppSessionMessage(
            player1.sessionSigner,
            { definition: appDefinition, allocations }
        );

        const sessionMessageJson = JSON.parse(sessionMessage);
        const player2Signature = await player2.sessionSigner(sessionMessageJson.req as RPCData);
        sessionMessageJson.sig.push(player2Signature);

        player1.yellow.listen(async (msg: RPCResponse) => {
            if (msg.method === RPCMethod.CreateAppSession) {
                clearTimeout(timeout);
                const result = msg.params as any;
                const sessionId = result.app_session_id || result.appSessionId;
                console.log(`🎲 App Session created: ${sessionId}`);
                resolve(sessionId);
            } else if (msg.method === RPCMethod.Error) {
                clearTimeout(timeout);
                reject(new Error(`App session error: ${JSON.stringify(msg.params)}`));
            }
        });

        console.log(`📤 Sending session message with both signatures...`);
        player1.yellow.sendMessage(JSON.stringify(sessionMessageJson));
    });
}

async function submitOffChainState(
    player1: PlayerSession,
    player2: PlayerSession,
    appSessionId: Hex,
    player1Amount: string,
    player2Amount: string
): Promise<void> {
    // This represents an off-chain state update (e.g., after a betting round)
    const allocations: RPCAppSessionAllocation[] = [
        { participant: player1.wallet.address, asset: 'usdc', amount: player1Amount },
        { participant: player2.wallet.address, asset: 'usdc', amount: player2Amount },
    ];

    const stateMsg = await createSubmitAppStateMessage(
        player1.sessionSigner,
        { app_session_id: appSessionId, allocations }
    );

    const stateMsgJson = JSON.parse(stateMsg);
    const player2Signature = await player2.sessionSigner(stateMsgJson.req as RPCData);
    stateMsgJson.sig.push(player2Signature);

    player1.yellow.sendMessage(JSON.stringify(stateMsgJson));
    console.log(`   📊 State update: ${player1.name}=${player1Amount}, ${player2.name}=${player2Amount}`);
}

async function closePokerAppSession(
    player1: PlayerSession,
    player2: PlayerSession,
    appSessionId: Hex,
    finalAllocations: RPCAppSessionAllocation[]
): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Close session timeout')), 15000);

        player1.yellow.listen(async (msg: RPCResponse) => {
            if (msg.method === RPCMethod.CloseAppSession) {
                clearTimeout(timeout);
                console.log(`✅ App Session closed successfully`);
                resolve();
            } else if (msg.method === RPCMethod.Error) {
                clearTimeout(timeout);
                reject(new Error(`Close session error: ${JSON.stringify(msg.params)}`));
            }
        });

        const closeMsg = await createCloseAppSessionMessage(player1.sessionSigner, {
            app_session_id: appSessionId,
            allocations: finalAllocations,
        });

        const closeMsgJson = JSON.parse(closeMsg);
        const player2Signature = await player2.sessionSigner(closeMsgJson.req as RPCData);
        closeMsgJson.sig.push(player2Signature);

        console.log(`📤 Closing App Session (on-chain settlement)...`);
        player1.yellow.sendMessage(JSON.stringify(closeMsgJson));
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('\n🎰 ═══════════════════════════════════════════════════');
    console.log('     TEXAS HOLD\'EM POKER (Yellow Network)');
    console.log('🎰 ═══════════════════════════════════════════════════\n');

    const key1 = process.env.PRIVATE_KEY as Hex;
    const key2 = process.env.PRIV_KEY as Hex;

    if (!key1 || !key2) {
        throw new Error('Both PRIVATE_KEY and PRIV_KEY must be set in .env');
    }

    // Setup players
    console.log('📍 Setting up players...');
    const player1 = await createPlayerSession('Alice', key1);
    const player2 = await createPlayerSession('Bob', key2);
    console.log(`   ${player1.name}: ${player1.wallet.address}`);
    console.log(`   ${player2.name}: ${player2.wallet.address}\n`);

    // Authenticate
    console.log('🔐 Authenticating...');
    await authenticatePlayer(player1);
    await authenticatePlayer(player2);
    console.log('');

    // Get balances
    console.log('💰 Checking balances...');
    await getPlayerBalance(player1);
    await getPlayerBalance(player2);
    console.log('');

    // Create App Session
    console.log('🎲 Creating Poker App Session...');
    console.log(`   Buy-in: ${BUY_IN} USDC each (${parseFloat(BUY_IN) * 1000} chips)`);
    const appSessionId = await createPokerAppSession(player1, player2);
    console.log('');

    // Initialize game
    const deck = createDeck();
    let pot = 0;
    const buyInChips = parseFloat(BUY_IN) * 1000;
    player1.chips = buyInChips;
    player2.chips = buyInChips;

    console.log('🃏 ════════════════════════════════════════════════════');
    console.log('                   HAND #1 BEGINS');
    console.log('🃏 ════════════════════════════════════════════════════\n');

    // Deal hole cards
    player1.hand = [deck.pop()!, deck.pop()!];
    player2.hand = [deck.pop()!, deck.pop()!];

    console.log(`🃏 DEALING HOLE CARDS...`);
    await sleep(500);
    console.log(`   ${player1.name}: ${handToString(player1.hand)}`);
    console.log(`   ${player2.name}: ${handToString(player2.hand)}\n`);

    // Blinds
    console.log(`💵 BLINDS`);
    const sbAmount = SMALL_BLIND * 1000;
    const bbAmount = BIG_BLIND * 1000;
    player1.chips -= sbAmount;
    player1.currentBet = sbAmount;
    player2.chips -= bbAmount;
    player2.currentBet = bbAmount;
    pot = sbAmount + bbAmount;
    console.log(`   ${player1.name} posts small blind: ${sbAmount} chips`);
    console.log(`   ${player2.name} posts big blind: ${bbAmount} chips`);
    console.log(`   Pot: ${pot} chips\n`);

    // PRE-FLOP betting
    console.log(`📢 PRE-FLOP BETTING (off-chain)`);
    await sleep(500);

    // Alice calls
    const callAmount = bbAmount - player1.currentBet;
    player1.chips -= callAmount;
    player1.currentBet += callAmount;
    pot += callAmount;
    console.log(`   ${player1.name} calls ${callAmount} chips`);

    // Bob checks
    console.log(`   ${player2.name} checks`);
    console.log(`   Pot: ${pot} chips\n`);

    // Update off-chain state
    const p1Usdc = (player1.chips / 1000).toFixed(3);
    const p2Usdc = (player2.chips / 1000).toFixed(3);
    await submitOffChainState(player1, player2, appSessionId, p1Usdc, p2Usdc);
    await sleep(500);

    // FLOP
    const community: Card[] = [];
    deck.pop(); // burn
    community.push(deck.pop()!, deck.pop()!, deck.pop()!);

    console.log(`\n🃏 THE FLOP`);
    await sleep(500);
    console.log(`   Community: ${handToString(community)}\n`);

    // Flop betting
    console.log(`📢 FLOP BETTING (off-chain)`);
    await sleep(500);

    // Both check
    console.log(`   ${player1.name} checks`);
    console.log(`   ${player2.name} checks`);
    console.log(`   Pot: ${pot} chips\n`);

    // TURN
    deck.pop(); // burn
    community.push(deck.pop()!);

    console.log(`🃏 THE TURN`);
    await sleep(500);
    console.log(`   Community: ${handToString(community)}\n`);

    // Turn betting - Alice bets
    console.log(`📢 TURN BETTING (off-chain)`);
    await sleep(500);

    const betAmount = 2; // 2 chips
    player1.chips -= betAmount;
    pot += betAmount;
    console.log(`   ${player1.name} bets ${betAmount} chips`);

    // Bob calls
    player2.chips -= betAmount;
    pot += betAmount;
    console.log(`   ${player2.name} calls ${betAmount} chips`);
    console.log(`   Pot: ${pot} chips\n`);

    // Update off-chain state
    const p1Usdc2 = (player1.chips / 1000).toFixed(3);
    const p2Usdc2 = (player2.chips / 1000).toFixed(3);
    await submitOffChainState(player1, player2, appSessionId, p1Usdc2, p2Usdc2);
    await sleep(500);

    // RIVER
    deck.pop(); // burn
    community.push(deck.pop()!);

    console.log(`\n🃏 THE RIVER`);
    await sleep(500);
    console.log(`   Community: ${handToString(community)}\n`);

    // River betting
    console.log(`📢 RIVER BETTING (off-chain)`);
    await sleep(500);
    console.log(`   ${player1.name} checks`);
    console.log(`   ${player2.name} checks`);
    console.log(`   Pot: ${pot} chips\n`);

    // SHOWDOWN
    console.log('🏆 ════════════════════════════════════════════════════');
    console.log('                     SHOWDOWN!');
    console.log('🏆 ════════════════════════════════════════════════════\n');
    await sleep(500);

    const eval1 = evaluateHand(player1.hand, community);
    const eval2 = evaluateHand(player2.hand, community);

    console.log(`   ${player1.name}: ${handToString(player1.hand)} → ${eval1.name}`);
    console.log(`   ${player2.name}: ${handToString(player2.hand)} → ${eval2.name}\n`);

    let winner: PlayerSession;
    let loser: PlayerSession;

    if (eval1.score > eval2.score) {
        winner = player1;
        loser = player2;
    } else if (eval2.score > eval1.score) {
        winner = player2;
        loser = player1;
    } else {
        // Tie - split pot
        winner = Math.random() > 0.5 ? player1 : player2;
        loser = winner === player1 ? player2 : player1;
        console.log(`   🤝 TIE! (Random winner for demo)`);
    }

    winner.chips += pot;
    console.log(`   🎉 ${winner.name} WINS ${pot} chips with ${winner === player1 ? eval1.name : eval2.name}!\n`);

    // Final chip counts
    console.log(`📊 FINAL CHIP COUNTS`);
    console.log(`   ${player1.name}: ${player1.chips} chips (${(player1.chips / 1000).toFixed(3)} USDC)`);
    console.log(`   ${player2.name}: ${player2.chips} chips (${(player2.chips / 1000).toFixed(3)} USDC)\n`);

    // Close App Session (ON-CHAIN settlement)
    console.log('💸 FINAL SETTLEMENT (on-chain)');
    const finalAllocations: RPCAppSessionAllocation[] = [
        { participant: player1.wallet.address, asset: 'usdc', amount: (player1.chips / 1000).toFixed(3) },
        { participant: player2.wallet.address, asset: 'usdc', amount: (player2.chips / 1000).toFixed(3) },
    ];
    await closePokerAppSession(player1, player2, appSessionId, finalAllocations);
    console.log('');

    // Final balances
    console.log('💰 Updated Unified Balances...');
    await sleep(2000);
    await getPlayerBalance(player1);
    await getPlayerBalance(player2);

    // Cleanup
    await player1.yellow.disconnect();
    await player2.yellow.disconnect();

    console.log('\n✅ Game complete! All actions were off-chain except final settlement.\n');
}

main().catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
