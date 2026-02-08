'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAccount, useWalletClient, usePublicClient } from 'wagmi'
import {
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createEIP712AuthMessageSigner,
    createECDSAMessageSigner,
    createGetConfigMessage,
    createGetLedgerBalancesMessage,
    createCreateChannelMessage,
    createResizeChannelMessage,
    createGetChannelsMessage,
    parseAuthChallengeResponse,
    parseCreateChannelResponse,
    AuthChallengeResponse,
    RPCMethod,
    RPCResponse,
    NitroliteClient,
    WalletStateSigner,
    Channel,
    StateIntent,
    Allocation,
    createCloseChannelMessage,
    // createWithdrawMessage,
    // createWithdrawMessage,
} from '@erc7824/nitrolite'
import { parseUnits, formatUnits, type Hex, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

// Constants
const YELLOW_WS_URL = 'wss://clearnet.yellow.com/ws'
const BASE_CHAIN_ID = base.id
const USDC_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const USDC_DECIMALS = 6
const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6' as Address
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C' as Address

// Types
export type YellowWalletStatus =
    | 'disconnected'
    | 'connecting'
    | 'authenticating'
    | 'authenticated'
    | 'error'

export interface YellowBalances {
    walletUSDC: string      // On-chain USDC
    custody: string         // Deposited to custody
    channel: string         // In channel
    unified: string         // Available for games
}

export interface YellowWalletState {
    status: YellowWalletStatus
    balances: YellowBalances
    channelId: string | null
    brokerAddress: string | null
    error: string | null
    isReady: boolean
}

// Add stateRef to track latest state for async operations
const useLatestState = (value: any) => {
    const ref = useRef(value)
    useEffect(() => { ref.current = value }, [value])
    return ref
}

// Generate a session key
function generateSessionKey() {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    return {
        privateKey,
        address: account.address,
    }
}

// Parse raw Yellow Network message format
// Raw format: { res: [requestId, method, params, timestamp], sig: [...] }
// Parsed format: { method: string, params: any, ... }
function parseRPCMessage(rawMessage: any): RPCResponse | null {
    // Handle already-parsed messages (fallback)
    if (rawMessage.method) {
        return rawMessage as RPCResponse
    }

    // Parse res[] array format
    if (rawMessage.res && Array.isArray(rawMessage.res)) {
        const [requestId, method, params, timestamp] = rawMessage.res
        return {
            method: method as string,
            params: params || {},
            res: rawMessage.res,
            sig: rawMessage.sig,
        } as RPCResponse
    }

    console.warn('Unknown message format:', rawMessage)
    return null
}

export default function useYellowWallet() {
    const { address, isConnected } = useAccount()
    const { data: walletClient } = useWalletClient()
    const publicClient = usePublicClient()

    const [state, setState] = useState<YellowWalletState>({
        status: 'disconnected',
        balances: { walletUSDC: '0', custody: '0', channel: '0', unified: '0' },
        channelId: null,
        brokerAddress: null,
        error: null,
        isReady: false,
    })

    // Track latest state for async flows
    const stateRef = useLatestState(state)
    const wsRef = useRef<WebSocket | null>(null)
    const sessionKeyRef = useRef<{ privateKey: Hex; address: Address } | null>(null)
    const sessionSignerRef = useRef<any>(null)
    const nitroliteClientRef = useRef<NitroliteClient | null>(null)
    const pendingActionsRef = useRef<Map<string, (data: any) => void>>(new Map())
    const walletClientRef = useRef<typeof walletClient>(walletClient)
    const addressRef = useRef<typeof address>(address)
    const authParamsRef = useRef<any>(null) // Store auth params to reuse in handleAuthChallenge

    // Keep refs updated with latest values
    useEffect(() => {
        walletClientRef.current = walletClient
        addressRef.current = address
    }, [walletClient, address])

    // Fetch on-chain USDC balance
    const fetchWalletBalance = useCallback(async () => {
        if (!publicClient || !address) return

        try {
            const balance = await publicClient.readContract({
                address: USDC_TOKEN,
                abi: [{
                    name: 'balanceOf',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: 'account', type: 'address' }],
                    outputs: [{ name: '', type: 'uint256' }],
                }],
                functionName: 'balanceOf',
                args: [address],
            })

            setState(s => ({
                ...s,
                balances: {
                    ...s.balances,
                    walletUSDC: formatUnits(balance as bigint, USDC_DECIMALS),
                },
            }))
        } catch (err: any) {
            console.error('Failed to fetch wallet balance:', err)
        }
    }, [publicClient, address])

    // Handle WebSocket messages
    const handleMessage = useCallback((message: RPCResponse) => {
        console.log('📨 Yellow message:', message.method, message)

        switch (message.method) {
            case RPCMethod.AuthChallenge:
                handleAuthChallenge(message)
                break

            case RPCMethod.AuthVerify:
                if ((message.params as any).success) {
                    console.log('✅ Yellow Network authenticated')
                    setState(s => ({ ...s, status: 'authenticated' }))
                    // Start sequential initialization (Channels -> Balances -> Config)
                    fetchChannels()

                    // Start ping interval (every 30s)
                    const pingInterval = setInterval(() => {
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ method: 'ping', params: {} }))
                        }
                    }, 30000)

                    // Clear interval on cleanup
                    const ws = wsRef.current
                    if (ws) {
                        ws.addEventListener('close', () => clearInterval(pingInterval))
                    }
                } else {
                    setState(s => ({ ...s, status: 'error', error: 'Authentication failed' }))
                }
                break

            case RPCMethod.GetConfig:
                const configParams = message.params as any
                setState(s => ({
                    ...s,
                    brokerAddress: configParams.brokerAddress,
                }))
                break

            case RPCMethod.GetChannels:
                const channels = (message.params as any).channels || []
                console.log('📥 Received channels:', channels)

                // If we have an open channel with funds, restore it
                if (channels.length > 0) {
                    // Find the channel that belongs to the current user and is open
                    // We reverse to find the LATEST channel (assuming chronological order)
                    const activeChannel = [...channels].reverse().find((c: any) =>
                        c.status === 'open' &&
                        c.wallet?.toLowerCase() === addressRef.current?.toLowerCase()
                    )

                    if (activeChannel) {
                        const channelId = activeChannel.id || activeChannel.channel_id
                        console.log('♻️ Restored channel:', channelId)
                        if (stateRef.current.channelId !== channelId) {
                            setState(s => ({ ...s, channelId }))
                        }
                    } else {
                        console.log('⚠️ No active channel found for user')
                    }
                }
                // Now that we have channels (and potentially restored channelId), fetch balances
                fetchBalances()
                break

            case RPCMethod.GetLedgerBalances:
                handleBalancesUpdate(message.params as any)
                break

            case RPCMethod.CreateChannel:
                handleChannelCreated(message)
                break

            case RPCMethod.ResizeChannel:
                handleChannelResized(message)
                break

            case RPCMethod.Error:
                console.error('❌ Yellow error:', message.params)
                setState(s => ({ ...s, error: (message.params as any).message || 'Unknown error' }))
                break
        }
    }, [])

    // Handle auth challenge
    const handleAuthChallenge = useCallback(async (message: RPCResponse) => {
        // Use refs to get current values (avoid stale closure)
        const currentWalletClient = walletClientRef.current
        const currentAddress = addressRef.current

        console.log('🔐 handleAuthChallenge called')
        console.log('   walletClient:', !!currentWalletClient)
        console.log('   sessionKeyRef:', !!sessionKeyRef.current)
        console.log('   address:', currentAddress)

        if (!currentWalletClient || !sessionKeyRef.current || !currentAddress) {
            console.error('🔐 Missing required refs for auth challenge')
            return
        }

        console.log('🔐 Building auth params...')

        // Reuse the same auth params that were sent in the initial request
        const authParams = authParamsRef.current
        if (!authParams) {
            console.error('🔐 No auth params stored from initial request')
            setState(s => ({ ...s, status: 'error', error: 'Auth params not found' }))
            return
        }

        console.log('🔐 Auth params (reusing from request):', authParams)

        try {
            console.log('🔐 Creating EIP712 signer...')
            const eip712Signer = createEIP712AuthMessageSigner(
                currentWalletClient as any,
                authParams,
                { name: 'Poker App' }
            )

            console.log('🔐 Creating auth verify message...')
            const authVerifyMessage = await createAuthVerifyMessage(
                eip712Signer,
                message as AuthChallengeResponse
            )

            console.log('🔐 Sending auth verify message...')
            wsRef.current?.send(authVerifyMessage)
            console.log('🔐 Auth verify message sent!')
        } catch (err: any) {
            console.error('🔐 Auth verification failed:', err)
            setState(s => ({ ...s, status: 'error', error: err.message }))
        }
    }, []) // No dependencies needed - we use refs

    // Fetch network config
    const fetchConfig = useCallback(async () => {
        if (!sessionSignerRef.current || !wsRef.current) return

        const configMessage = await createGetConfigMessage(sessionSignerRef.current)
        wsRef.current.send(configMessage)
    }, [])

    // Fetch balances
    const fetchBalances = useCallback(async () => {
        if (!sessionSignerRef.current || !wsRef.current || !address) return

        try {
            console.log('🔄 Fetching balances (v2.2 - Seq Init)...')
            // Explicitly request balances for the session (which maps to wallet via Auth)
            const balanceMessage = await createGetLedgerBalancesMessage(sessionSignerRef.current)
            wsRef.current.send(balanceMessage)

            // Also fetch config
            console.log('🔄 Fetching config...')
            fetchConfig()
        } catch (error) {
            console.error('❌ Error fetching balances/config:', error)
        }
    }, [address, fetchConfig])

    // Fetch existing channels (restore state on reconnect)
    const fetchChannels = useCallback(async () => {
        if (!sessionSignerRef.current || !wsRef.current || !address) return

        console.log('📥 Fetching existing channels...')
        // Fetch only open channels for the connected wallet address
        const channelsMessage = await createGetChannelsMessage(sessionSignerRef.current, address as Address, 'open' as any)
        wsRef.current.send(channelsMessage)
    }, [address])

    // Handle balance update
    const handleBalancesUpdate = useCallback((params: any) => {
        console.log('💰 Raw Params:', JSON.stringify(params))
        // Backend returns 'ledgerBalances' (Node) or 'ledger_balances' (Browser/API)
        const balances = params.ledgerBalances || params.ledger_balances || params.balances || []

        console.log('💰 Processing balances:', balances)

        // Find USDC balance
        const usdcBalance = balances.find(
            (b: any) => b.asset?.toLowerCase() === 'usdc'
        )

        if (usdcBalance) {
            // 'amount' is used in ledgerBalances, 'available' might be used elsewhere
            const amount = usdcBalance.amount || usdcBalance.available || '0'
            console.log('💰 Found USDC balance:', amount)

            setState(s => ({
                ...s,
                balances: {
                    ...s.balances,
                    unified: amount,
                },
            }))
        } else {
            console.log('⚠️ No USDC balance found in update')
        }
    }, [])

    // Handle channel creation response
    const handleChannelCreated = useCallback(async (message: RPCResponse) => {
        const params = message.params as any
        console.log('🧬 Channel creation response:', params)
        console.log('🧬 state object:', params.state)

        if (!nitroliteClientRef.current) {
            console.error('NitroliteClient not initialized')
            return
        }

        try {
            // Handle both snake_case (from raw API) and camelCase property names
            const serverSignature = params.server_signature || params.serverSignature
            const stateData = params.state?.stateData || params.state?.state_data || params.state?.data || '0x'

            console.log('🧬 Using serverSignature:', serverSignature)
            console.log('🧬 Using stateData:', stateData)

            const { channelId, txHash } = await nitroliteClientRef.current.createChannel({
                channel: params.channel as unknown as Channel,
                unsignedInitialState: {
                    intent: params.state.intent as StateIntent,
                    version: BigInt(params.state.version),
                    data: stateData as Hex,
                    allocations: params.state.allocations as Allocation[],
                },
                serverSignature: serverSignature as Hex,
            })

            console.log(`✅ Channel created: ${channelId}`)
            setState(s => ({ ...s, channelId }))

            // Refresh balances
            fetchBalances()
        } catch (err: any) {
            console.error('Channel creation failed:', err)
            setState(s => ({ ...s, error: err.message }))
        }
    }, [fetchBalances])

    // Handle channel resize response
    const handleChannelResized = useCallback(async (message: RPCResponse) => {
        const params = message.params as any
        console.log('📐 Channel resize response:', params)

        if (!nitroliteClientRef.current) return

        try {
            // Use the SDK's resize function with the response from Yellow Network
            await nitroliteClientRef.current.resizeChannel({
                channel_id: params.channelId as Hex,
                unsignedState: {
                    intent: params.state.intent as StateIntent,
                    version: BigInt(params.state.version),
                    data: params.state.stateData as Hex,
                    allocations: params.state.allocations as Allocation[],
                },
                serverSignature: params.serverSignature as Hex,
            } as any)

            console.log('✅ Channel resized')
            fetchBalances()
        } catch (err: any) {
            console.error('Channel resize failed:', err)
            setState(s => ({ ...s, error: err.message }))
        }
    }, [fetchBalances])

    // Connect to Yellow Network
    const connect = useCallback(async () => {
        if (!isConnected || !address || !walletClient || !publicClient) {
            setState(s => ({ ...s, error: 'Wallet not connected' }))
            return
        }

        setState(s => ({ ...s, status: 'connecting', error: null }))

        try {
            // Generate session key
            const sessionKey = generateSessionKey()
            sessionKeyRef.current = sessionKey
            sessionSignerRef.current = createECDSAMessageSigner(sessionKey.privateKey)

            // Initialize NitroliteClient
            nitroliteClientRef.current = new NitroliteClient({
                walletClient: walletClient as any,
                publicClient: publicClient as any,
                stateSigner: new WalletStateSigner(walletClient as any),
                addresses: {
                    custody: CUSTODY_ADDRESS,
                    adjudicator: ADJUDICATOR_ADDRESS,
                },
                chainId: BASE_CHAIN_ID,
                challengeDuration: 3600n,
            })

            // Connect WebSocket
            const ws = new WebSocket(YELLOW_WS_URL)
            wsRef.current = ws

            ws.onopen = async () => {
                console.log('🔌 Connected to Yellow Network')
                setState(s => ({ ...s, status: 'authenticating' }))

                // Store auth params for reuse in handleAuthChallenge
                const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600)
                authParamsRef.current = {
                    scope: 'poker.app',
                    application: address,
                    participant: sessionKey.address,
                    expire: sessionExpireTimestamp,
                    allowances: [{
                        asset: 'usdc',
                        amount: '100',
                    }],
                    session_key: sessionKey.address,
                    expires_at: sessionExpireTimestamp,
                }

                // Send auth request
                const authMessage = await createAuthRequestMessage({
                    address: address,
                    session_key: sessionKey.address,
                    application: 'Poker App',
                    allowances: [{
                        asset: 'usdc',
                        amount: '100',
                    }],
                    expires_at: sessionExpireTimestamp,
                    scope: 'poker.app',
                })

                ws.send(authMessage)
            }

            ws.onmessage = (event) => {
                try {
                    const rawData = event.data as string
                    const rawMessage = JSON.parse(rawData)
                    const message = parseRPCMessage(rawMessage)

                    if (message) {
                        // Use SDK's parsers for proper message format
                        if (message.method === RPCMethod.AuthChallenge) {
                            const parsedChallenge = parseAuthChallengeResponse(rawData)
                            handleMessage(parsedChallenge)
                        } else if (message.method === RPCMethod.CreateChannel) {
                            const parsedChannel = parseCreateChannelResponse(rawData)
                            handleMessage(parsedChannel)
                        } else {
                            handleMessage(message)
                        }
                    }
                } catch (err) {
                    console.error('Failed to parse message:', err)
                }
            }

            ws.onerror = (err) => {
                console.error('WebSocket error:', err)
                setState(s => ({ ...s, status: 'error', error: 'WebSocket connection failed' }))
            }

            ws.onclose = () => {
                console.log('WebSocket closed')
                setState(s => ({ ...s, status: 'disconnected' }))
            }

            // Fetch wallet balance
            await fetchWalletBalance()
        } catch (err: any) {
            console.error('Connect failed:', err)
            setState(s => ({ ...s, status: 'error', error: err.message }))
            return false
        }
    }, [isConnected, address, walletClient, publicClient, handleMessage, fetchWalletBalance])

    // Deposit USDC to custody
    const deposit = useCallback(async (amount: string): Promise<boolean> => {
        if (!nitroliteClientRef.current || !publicClient || !walletClient || !address) {
            setState(s => ({ ...s, error: 'Not connected' }))
            return false
        }

        try {
            const amountInUnits = parseUnits(amount, USDC_DECIMALS)

            // Check allowance
            const allowance = await publicClient.readContract({
                address: USDC_TOKEN,
                abi: [{
                    name: 'allowance',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'spender', type: 'address' }
                    ],
                    outputs: [{ name: '', type: 'uint256' }],
                }],
                functionName: 'allowance',
                args: [address, CUSTODY_ADDRESS],
            })

            // Approve if needed
            if ((allowance as bigint) < amountInUnits) {
                console.log('📝 Approving USDC...')
                const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
                const approveHash = await walletClient.writeContract({
                    address: USDC_TOKEN,
                    abi: [{
                        name: 'approve',
                        type: 'function',
                        stateMutability: 'nonpayable',
                        inputs: [
                            { name: 'spender', type: 'address' },
                            { name: 'amount', type: 'uint256' }
                        ],
                        outputs: [{ name: '', type: 'bool' }],
                    }],
                    functionName: 'approve',
                    args: [CUSTODY_ADDRESS, maxApproval],
                })
                await publicClient.waitForTransactionReceipt({ hash: approveHash })
                console.log('✅ Approved')
            }

            // Deposit
            console.log(`💰 Depositing ${amount} USDC...`)
            const depositHash = await nitroliteClientRef.current.deposit(USDC_TOKEN, amountInUnits)
            await publicClient.waitForTransactionReceipt({ hash: depositHash })
            console.log('✅ Deposited')

            // Refresh balances
            await fetchWalletBalance()
            fetchBalances()

            return true
        } catch (err: any) {
            console.error('Deposit failed:', err)
            setState(s => ({ ...s, error: err.message }))
            return false
        }
    }, [publicClient, walletClient, address, fetchWalletBalance, fetchBalances])

    // Create a channel
    const createChannel = useCallback(async (): Promise<boolean> => {
        if (!sessionSignerRef.current || !wsRef.current) {
            setState(s => ({ ...s, error: 'Not connected' }))
            return false
        }

        try {
            console.log('📤 Creating channel...')
            const createChannelMessage = await createCreateChannelMessage(sessionSignerRef.current, {
                chain_id: BASE_CHAIN_ID,
                token: USDC_TOKEN,
            })

            wsRef.current.send(createChannelMessage)
            return true
        } catch (err: any) {
            console.error('Create channel failed:', err)
            setState(s => ({ ...s, error: err.message }))
            return false
        }
    }, [])

    // Resize channel (move funds between custody/channel and unified balance)
    const resize = useCallback(async (amount: string, toUnified = true, channelIdOverride?: string): Promise<boolean> => {
        const currentChannelId = channelIdOverride || state.channelId
        if (!sessionSignerRef.current || !wsRef.current || !currentChannelId || !state.brokerAddress || !address) {
            setState(s => ({ ...s, error: 'No channel or not connected' }))
            return false
        }

        try {
            console.log(`📐 Resizing channel ${currentChannelId}...`)
            const amountInUnits = parseUnits(amount, USDC_DECIMALS)
            let resizeAmount = 0n
            let fundsDestination = address // Default to wallet? Or custody?

            // If moving to unified (Allocation), we need funds in the channel first.
            // Check if we have enough mapped in channel balance.
            // Note: state.balances might be stale in quickSetup flow, but we can't easily fix that without fetching.
            // For quickSetup, we assume funds are in Custody (from deposit) and we need to pull them.

            // If channelIdOverride is provided (new channel), balance is 0.
            const channelBalance = currentChannelId === state.channelId ? parseUnits(state.balances.channel, USDC_DECIMALS) : 0n

            if (toUnified) {
                if (amountInUnits > channelBalance) {
                    // Need to pull difference from custody
                    resizeAmount = amountInUnits - channelBalance
                    console.log(`📐 Pulling ${formatUnits(resizeAmount, USDC_DECIMALS)} USDC from custody to channel first`)
                }
            }

            const resizeMessage = await createResizeChannelMessage(sessionSignerRef.current, {
                channel_id: currentChannelId as Hex,
                allocate_amount: toUnified ? amountInUnits : -amountInUnits,
                // If we need to pull from custody, add resize_amount
                ...(resizeAmount > 0n && { resize_amount: resizeAmount }),
                funds_destination: fundsDestination as Address,
            })

            wsRef.current.send(resizeMessage)
            return true
        } catch (err: any) {
            console.error('Resize failed:', err)
            setState(s => ({ ...s, error: err.message }))
            return false
        }
    }, [state.channelId, state.brokerAddress, address, state.balances.channel])

    // WaitForChannel helper
    const waitForChannelId = useCallback(async (timeoutMs = 60000): Promise<string | null> => {
        const startTime = Date.now()
        while (Date.now() - startTime < timeoutMs) {
            if (stateRef.current.channelId) return stateRef.current.channelId
            await new Promise(r => setTimeout(r, 1000))
        }
        return null
    }, [stateRef])

    // One-click setup: deposit → create channel (if needed) → resize
    const quickSetup = useCallback(async (amount: string): Promise<boolean> => {
        console.log('🚀 Quick setup starting...')

        // Step 1: Deposit to custody
        const deposited = await deposit(amount)
        if (!deposited) return false

        let targetChannelId = state.channelId

        // Step 2: Create channel (only if we don't have one)
        if (!targetChannelId) {
            console.log('Creating new channel...')
            const channelCreated = await createChannel()
            if (!channelCreated) return false

            console.log('Waiting for channel creation...')
            targetChannelId = await waitForChannelId()
            if (!targetChannelId) {
                console.error('Channel creation timed out')
                setState(s => ({ ...s, error: 'Channel creation timed out' }))
                return false
            }
        } else {
            console.log('Channel already exists, skipping creation')
        }

        // Step 3: Resize (Move funds to unified)
        console.log(`Channel ready: ${targetChannelId}. Resizing...`)
        // We pass targetChannelId because closure might be stale
        return await resize(amount, true, targetChannelId)
    }, [deposit, createChannel, state.channelId, waitForChannelId, resize])

    // Close current channel
    const closeChannel = useCallback(async (): Promise<boolean> => {
        if (!sessionSignerRef.current || !wsRef.current || !state.channelId || !state.brokerAddress || !address) {
            setState(s => ({ ...s, error: 'No channel or not connected' }))
            return false
        }

        try {
            console.log('🛑 Closing channel...')
            const closeMessage = await createCloseChannelMessage(
                sessionSignerRef.current,
                state.channelId as Hex,
                address // Send funds to user wallet
            )
            wsRef.current.send(closeMessage)

            // Clear local state
            setState(s => ({ ...s, channelId: null }))
            return true
        } catch (err: any) {
            console.error('Close channel failed (forcing reset):', err)
            // Force reset local state anyway so user can try again with a new channel
            setState(s => ({ ...s, channelId: null, error: null }))
            return true
        }
    }, [state.channelId, state.brokerAddress, address])

    // Withdraw from custody to wallet (Disabled for now)
    const withdraw = useCallback(async (amount: string): Promise<boolean> => {
        /*
        if (!sessionSignerRef.current || !wsRef.current || !address) return false

        try {
            console.log(`💸 Withdrawing ${amount} USDC from custody...`)
            const amountInUnits = parseUnits(amount, USDC_DECIMALS)
            
            // createWithdrawMessage don't exist in SDK?
            const withdrawMessage = await createWithdrawMessage(
                sessionSignerRef.current,
                USDC_TOKEN,
                amountInUnits,
                address // Destination
            )
            wsRef.current.send(withdrawMessage)
            return true
        } catch (err: any) {
            console.error('Withdraw failed:', err)
            setState(s => ({ ...s, error: err.message }))
            return false
        }
        */
        return false
    }, [address])

    // Disconnect
    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        sessionKeyRef.current = null
        sessionSignerRef.current = null
        nitroliteClientRef.current = null

        setState({
            status: 'disconnected',
            balances: {
                walletUSDC: '0',
                custody: '0',
                channel: '0',
                unified: '0',
            },
            channelId: null,
            brokerAddress: null,
            error: null,
            isReady: false,
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
        ...state,
        isReady: state.status === 'authenticated' && parseFloat(state.balances.unified) > 0,
        actions: {
            connect,
            disconnect,
            deposit,
            createChannel,
            resize,
            closeChannel,
            // withdraw, // Disabled for now
            quickSetup,
            refreshBalances: fetchBalances,
        },
    }
}
