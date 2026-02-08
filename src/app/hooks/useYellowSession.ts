'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import {
    createYellowClient,
    createSessionSigner,
    createPokerSessionMessage,
    signGameAction,
    YELLOW_WS_URL,
    CHIP_TOKEN,
    type SettlementProof,
} from '../config/yellow'

export type YellowSessionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'authenticating'
    | 'authenticated'
    | 'creating_session'
    | 'session_active'
    | 'settling'
    | 'settled'
    | 'error'

export interface YellowSessionData {
    sessionId: string | null
    partnerAddress: string | null
    myBalance: string
    partnerBalance: string
}

export default function useYellowSession() {
    const { address, isConnected } = useAccount()
    const { data: walletClient } = useWalletClient()

    const [state, setState] = useState<YellowSessionState>('disconnected')
    const [sessionData, setSessionData] = useState<YellowSessionData>({
        sessionId: null,
        partnerAddress: null,
        myBalance: '0',
        partnerBalance: '0',
    })
    const [error, setError] = useState<string | null>(null)

    const wsRef = useRef<WebSocket | null>(null)
    const sessionSignerRef = useRef<any>(null)

    // Connect to Yellow Network
    const connect = useCallback(async () => {
        if (!isConnected || !address) {
            setError('Wallet not connected')
            return
        }

        setState('connecting')
        setError(null)

        try {
            // Create WebSocket connection
            const ws = new WebSocket(YELLOW_WS_URL)
            wsRef.current = ws

            ws.onopen = async () => {
                console.log('✅ Connected to Yellow Network')
                setState('connected')

                // Create session signer
                const signer = await createSessionSigner()
                sessionSignerRef.current = signer

                // TODO: Implement full auth flow
                setState('authenticated')
            }

            ws.onerror = (err) => {
                console.error('❌ Yellow WebSocket error:', err)
                setState('error')
                setError('Failed to connect to Yellow Network')
            }

            ws.onclose = () => {
                console.log('❌ Yellow WebSocket closed')
                setState('disconnected')
            }

            ws.onmessage = (event) => {
                handleMessage(event.data)
            }
        } catch (err: any) {
            setState('error')
            setError(err.message)
        }
    }, [isConnected, address])

    // Create poker session with partner
    const createSession = useCallback(async (partnerAddress: string, buyIn: string) => {
        if (!wsRef.current || !sessionSignerRef.current || !address) {
            setError('Not connected or authenticated')
            return
        }

        setState('creating_session')

        try {
            const sessionMessage = await createPokerSessionMessage(
                sessionSignerRef.current.signer,
                address,
                partnerAddress,
                buyIn
            )

            wsRef.current.send(sessionMessage)

            setSessionData(prev => ({
                ...prev,
                partnerAddress,
                myBalance: buyIn,
                partnerBalance: buyIn,
            }))

            console.log('♠️ Poker session request sent')
        } catch (err: any) {
            setState('error')
            setError(err.message)
        }
    }, [address])

    // Send a game action (bet, fold, check, etc.)
    const sendAction = useCallback(async (
        action: 'FOLD' | 'CHECK' | 'BET' | 'RAISE' | 'CALL',
        amount?: string
    ) => {
        if (!wsRef.current || !sessionSignerRef.current || !sessionData.sessionId) {
            setError('No active session')
            return null
        }

        try {
            const signedAction = await signGameAction(
                sessionSignerRef.current.signer,
                sessionData.sessionId,
                action,
                amount
            )

            wsRef.current.send(JSON.stringify(signedAction))
            console.log(`🎮 Action sent: ${action}${amount ? ` (${amount})` : ''}`)

            return signedAction
        } catch (err: any) {
            setError(err.message)
            return null
        }
    }, [sessionData.sessionId])

    // Handle incoming messages from Yellow Network
    const handleMessage = useCallback((data: string) => {
        try {
            const message = JSON.parse(data)
            console.log('📨 Yellow message:', message)

            if (message.type === 'session_created') {
                setSessionData(prev => ({
                    ...prev,
                    sessionId: message.sessionId,
                }))
                setState('session_active')
                console.log('✅ Poker Session Ready:', message.sessionId)
            } else if (message.type === 'balance_update') {
                setSessionData(prev => ({
                    ...prev,
                    myBalance: message.balances[address as string] || prev.myBalance,
                    partnerBalance: message.balances[prev.partnerAddress as string] || prev.partnerBalance,
                }))
            } else if (message.type === 'session_closed') {
                setState('settled')
            } else if (message.error) {
                setError(message.error)
                setState('error')
            }
        } catch (err) {
            console.error('Failed to parse Yellow message:', err)
        }
    }, [address])

    // Close session and get settlement proof
    const closeSession = useCallback(async (): Promise<SettlementProof | null> => {
        if (!wsRef.current || !sessionData.sessionId) {
            setError('No active session')
            return null
        }

        setState('settling')

        // TODO: Implement proper close channel message
        // For now, return a mock settlement proof
        const mockProof: SettlementProof = {
            sessionId: sessionData.sessionId,
            finalBalances: {
                [address as string]: sessionData.myBalance,
                [sessionData.partnerAddress as string]: sessionData.partnerBalance,
            },
            signatures: ['0x...', '0x...'], // Would be real signatures
            timestamp: Date.now(),
        }

        return mockProof
    }, [sessionData, address])

    // Disconnect
    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        setState('disconnected')
        setSessionData({
            sessionId: null,
            partnerAddress: null,
            myBalance: '0',
            partnerBalance: '0',
        })
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close()
            }
        }
    }, [])

    return {
        state,
        sessionData,
        error,
        isConnected: state === 'session_active' || state === 'authenticated',
        actions: {
            connect,
            createSession,
            sendAction,
            closeSession,
            disconnect,
        },
    }
}
