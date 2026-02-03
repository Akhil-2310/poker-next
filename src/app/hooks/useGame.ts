'use client'
import { useState, useCallback, useEffect } from 'react'
import { makeAIAction, getAIBetAmount } from '../utils/ai'

type Card = { cardFace: string; suit: string; animationDelay?: number }
type Player = {
    id: string
    name: string
    stack: number
    chips: number
    hand?: Card[]
    cards?: Card[]
    bet: number
    folded?: boolean
    isActive?: boolean
    hasDealerChip?: boolean
    robot?: boolean
    avatarURL?: string
    roundStartChips?: number
    roundEndChips?: number
}

type GamePhase = 'idle' | 'initialDeal' | 'betting1' | 'flop' | 'betting2' | 'turn' | 'betting3' | 'river' | 'betting4' | 'showdown'

const DECK: Card[] = [
    ...['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'].flatMap(face =>
        ['Spade', 'Heart', 'Diamond', 'Club'].map(suit => ({ cardFace: face, suit }))
    )
]

function shuffleDeck(): Card[] {
    const deck = [...DECK]
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]]
    }
    return deck
}

export default function useGame() {
    const [state, setState] = useState({
        players: [] as Player[],
        community: [] as Card[],
        pot: 0,
        highBet: 0,
        turn: '',
        phase: 'idle' as GamePhase,
        deck: [] as Card[],
        activePlayerIndex: 0,
        dealerIndex: 0,
        minBet: 20,
        actionInProgress: false,
    })

    // Auto-execute CPU actions
    useEffect(() => {
        if (state.phase === 'idle' || state.phase === 'showdown' || state.actionInProgress) return

        const activePlayer = state.players[state.activePlayerIndex]
        if (!activePlayer || !activePlayer.robot) return

        const timer = setTimeout(() => {
            const action = makeAIAction(state)

            if (action === 'fold') {
                setState((s) => {
                    const newPlayers = s.players.map((p) => {
                        if (p.id === s.players[s.activePlayerIndex].id) {
                            return { ...p, folded: true, isActive: false }
                        }
                        return p
                    })
                    const nextIndex = (s.activePlayerIndex + 1) % s.players.length
                    return {
                        ...s,
                        players: newPlayers,
                        turn: s.players[nextIndex].id,
                        activePlayerIndex: nextIndex,
                        actionInProgress: true,
                    }
                })
            } else if (action === 'check') {
                setState((s) => {
                    const nextIndex = (s.activePlayerIndex + 1) % s.players.length
                    return {
                        ...s,
                        turn: s.players[nextIndex].id,
                        activePlayerIndex: nextIndex,
                        actionInProgress: true,
                    }
                })
            } else if (action === 'bet') {
                const betAmount = getAIBetAmount(state, 0)
                setState((s) => {
                    const newPlayers = s.players.map((p) => {
                        if (p.id === s.players[s.activePlayerIndex].id) {
                            const newChips = Math.max(0, p.chips - betAmount)
                            return {
                                ...p,
                                bet: (p.bet || 0) + betAmount,
                                chips: newChips,
                                isActive: false,
                            }
                        }
                        return p
                    })
                    const nextIndex = (s.activePlayerIndex + 1) % s.players.length
                    return {
                        ...s,
                        pot: s.pot + betAmount,
                        highBet: Math.max(s.highBet, (newPlayers[s.activePlayerIndex].bet || 0)),
                        players: newPlayers,
                        turn: s.players[nextIndex].id,
                        activePlayerIndex: nextIndex,
                        actionInProgress: true,
                    }
                })
            }

            setTimeout(() => {
                setState((s) => {
                    const newState = { ...s, actionInProgress: false }

                    // Check if round should advance
                    if (s.activePlayerIndex === s.dealerIndex || (s.phase === 'betting1' && s.activePlayerIndex === 1)) {
                        return advancePhase(newState)
                    }
                    return newState
                })
            }, 1000)
        }, 120)

        return () => clearTimeout(timer)
    }, [state])

    const reset = useCallback(() => {
        setState({
            players: [],
            community: [],
            pot: 0,
            highBet: 0,
            turn: '',
            phase: 'idle',
            deck: [],
            activePlayerIndex: 0,
            dealerIndex: 0,
            minBet: 20,
            actionInProgress: false,
        })
    }, [])

    const createLocalGame = useCallback(() => {
        const deck = shuffleDeck()
        const p1: Player = {
            id: 'p1',
            name: 'You',
            stack: 1000,
            chips: 1000,
            hand: [deck[0], deck[1]],
            cards: [deck[0], deck[1]],
            bet: 0,
            folded: false,
            isActive: true,
            hasDealerChip: true,
            robot: false,
            avatarURL: '/old-assets/boy.svg',
            roundStartChips: 1000,
            roundEndChips: 1000,
        }
        const p2: Player = {
            id: 'p2',
            name: 'CPU',
            stack: 1000,
            chips: 1000,
            hand: [deck[2], deck[3]],
            cards: [deck[2], deck[3]],
            bet: 0,
            folded: false,
            isActive: false,
            hasDealerChip: false,
            robot: true,
            avatarURL: '/old-assets/boy.svg',
            roundStartChips: 1000,
            roundEndChips: 1000,
        }

        setState({
            players: [p1, p2],
            community: [],
            pot: 0,
            highBet: 20,
            turn: 'p1',
            phase: 'betting1',
            deck: deck.slice(4),
            activePlayerIndex: 0,
            dealerIndex: 0,
            minBet: 20,
            actionInProgress: false,
        })
    }, [])

    const fold = useCallback(() => {
        setState((s) => {
            if (s.actionInProgress || s.phase === 'idle' || s.phase === 'showdown') return s

            const newPlayers = s.players.map((p) => {
                if (p.id === s.turn) {
                    return { ...p, folded: true, isActive: false }
                } else {
                    return { ...p, isActive: true }
                }
            })

            const nextActiveIndex = (s.activePlayerIndex + 1) % s.players.length
            const nextPlayer = s.players[nextActiveIndex]

            return {
                ...s,
                players: newPlayers,
                turn: nextPlayer.id,
                activePlayerIndex: nextActiveIndex,
                actionInProgress: true,
            }
        })
    }, [])

    const check = useCallback(() => {
        setState((s) => {
            if (s.actionInProgress || s.phase === 'idle' || s.phase === 'showdown') return s

            const nextActiveIndex = (s.activePlayerIndex + 1) % s.players.length
            const nextPlayer = s.players[nextActiveIndex]

            return {
                ...s,
                turn: nextPlayer.id,
                activePlayerIndex: nextActiveIndex,
                actionInProgress: true,
            }
        })
    }, [])

    const bet = useCallback((amount: number) => {
        setState((s) => {
            if (s.actionInProgress || s.phase === 'idle' || s.phase === 'showdown') return s

            const newPlayers = s.players.map((p) => {
                if (p.id === s.turn) {
                    const newChips = Math.max(0, p.chips - amount)
                    return {
                        ...p,
                        bet: (p.bet || 0) + amount,
                        chips: newChips,
                        isActive: false,
                    }
                }
                return p
            })

            const nextActiveIndex = (s.activePlayerIndex + 1) % s.players.length
            const nextPlayer = s.players[nextActiveIndex]

            return {
                ...s,
                pot: s.pot + amount,
                highBet: Math.max(s.highBet, (newPlayers[s.activePlayerIndex].bet || 0)),
                players: newPlayers,
                turn: nextPlayer.id,
                activePlayerIndex: nextActiveIndex,
                actionInProgress: true,
            }
        })
    }, [])

    function advancePhase(s: typeof state): typeof state {
        const phaseMap: Record<GamePhase, GamePhase> = {
            idle: 'initialDeal',
            initialDeal: 'betting1',
            betting1: 'flop',
            flop: 'betting2',
            betting2: 'turn',
            turn: 'betting3',
            betting3: 'river',
            river: 'betting4',
            betting4: 'showdown',
            showdown: 'idle',
        }

        const nextPhase = phaseMap[s.phase]
        let newCommunity = [...s.community]

        if (nextPhase === 'flop' && s.community.length === 0) {
            newCommunity = [s.deck[0], s.deck[1], s.deck[2]]
        } else if (nextPhase === 'turn' && s.community.length === 3) {
            newCommunity = [...s.community, s.deck[3]]
        } else if (nextPhase === 'river' && s.community.length === 4) {
            newCommunity = [...s.community, s.deck[4]]
        }

        const newPlayers = s.players.map((p) => ({
            ...p,
            bet: 0,
            isActive: p.id === s.players[s.dealerIndex].id,
        }))

        return {
            ...s,
            phase: nextPhase,
            community: newCommunity,
            players: newPlayers,
            highBet: 0,
            activePlayerIndex: s.dealerIndex,
            turn: s.players[s.dealerIndex].id,
        }
    }

    const nextRound = useCallback(() => {
        setState((s) => {
            if (s.phase !== 'showdown') return s
            return advancePhase(s)
        })
    }, [])

    const advanceRound = useCallback(() => {
        setState((s) => {
            if (s.phase === 'idle') return s
            return advancePhase(s)
        })
    }, [])

    const performYellow = (action: { type: string; amount?: number }) => {
        // eslint-disable-next-line no-console
        console.log('yellow action (frontend placeholder):', action)
    }

    return {
        state,
        actions: {
            reset,
            createLocalGame,
            fold,
            check,
            bet,
            nextRound,
            advanceRound,
            performYellow,
        },
    }
}
