/**
 * Yellow Network Session Manager for Poker on Base Mainnet
 * Handles channel creation, deposits, resizing, and game actions
 */

import {
    NitroliteClient,
    WalletStateSigner,
    createECDSAMessageSigner,
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createEIP712AuthMessageSigner,
    createCreateChannelMessage,
    createResizeChannelMessage,
    createGetConfigMessage,
    createCloseChannelMessage,
    createTransferMessage,
    createGetLedgerBalancesMessage,
    createAppSessionMessage,
    createCloseAppSessionMessage,
    parseAnyRPCResponse as parseRPCResponse,
    Channel,
    StateIntent,
    Allocation,
    State,
    ContractAddresses,
    RPCMethod,
    RPCResponse,
    AuthChallengeResponse,
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http, Hex, parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey, mnemonicToAccount } from 'viem/accounts';
import { Client } from 'yellow-ts';
import 'dotenv/config';

// Base mainnet configuration
const BASE_CHAIN_ID = base.id;
const USDC_TOKEN_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_DECIMALS = 6;
const YELLOW_WS_URL = 'wss://clearnet.yellow.com/ws';

const BASE_CONTRACT_ADDRESSES = {
    custody: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6',
    adjudicator: '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C',
};

export interface SettlementProof {
    sessionId: string;
    player: string;
    amount: string;
    partnerAddress: string;
    partnerAmount: string;
    playerSignature: string;
    partnerSignature: string;
    timestamp: number;
}

export class YellowSession {
    private yellow: Client | null = null;
    private nitroliteClient: NitroliteClient | null = null;
    private walletClient: any;
    private publicClient: any;
    private account: any;
    private sessionKey: { privateKey: Hex; address: Hex } | null = null;
    private sessionSigner: any = null;
    private channelId: string | null = null;
    private brokerAddress: string | null = null;
    private appSessionId: Hex | null = null;
    private isAuthenticated = false;

    constructor(privateKeyOrSeed?: string) {
        // Create wallet from environment or provided key
        if (privateKeyOrSeed?.startsWith('0x')) {
            this.account = privateKeyToAccount(privateKeyOrSeed as `0x${string}`);
        } else if (privateKeyOrSeed) {
            this.account = mnemonicToAccount(privateKeyOrSeed);
        } else if (process.env.SEED_PHRASE) {
            this.account = mnemonicToAccount(process.env.SEED_PHRASE);
        } else if (process.env.PRIVATE_KEY) {
            this.account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
        } else {
            throw new Error('No wallet credentials provided');
        }

        // Use RPC_URL from env or default to Base mainnet
        const rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org';

        this.publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl),
        });

        this.walletClient = createWalletClient({
            chain: base,
            transport: http(rpcUrl),
            account: this.account,
        });

        // Generate session key
        const sessionPrivateKey = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(sessionPrivateKey);
        this.sessionKey = {
            privateKey: sessionPrivateKey,
            address: sessionAccount.address,
        };
        this.sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

        // Initialize Nitrolite client
        this.nitroliteClient = new NitroliteClient({
            walletClient: this.walletClient,
            publicClient: this.publicClient,
            stateSigner: new WalletStateSigner(this.walletClient),
            addresses: BASE_CONTRACT_ADDRESSES as ContractAddresses,
            chainId: BASE_CHAIN_ID,
            challengeDuration: 3600n,
        });
    }

    /**
     * Connect to Yellow Network and authenticate
     */
    async connect(): Promise<void> {
        this.yellow = new Client({ url: YELLOW_WS_URL });
        await this.yellow.connect();
        console.log('🔌 Connected to Yellow clearnet');
        await this.authenticate();
    }

    /**
     * Authenticate with Yellow Network using EIP-712
     */
    private async authenticate(): Promise<void> {
        if (!this.yellow || !this.sessionKey) throw new Error('Not connected');

        const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600);

        const authMessage = await createAuthRequestMessage({
            address: this.account.address,
            session_key: this.sessionKey.address,
            application: 'Poker App',
            allowances: [{ asset: 'usdc', amount: '100' }],
            expires_at: sessionExpireTimestamp,
            scope: 'poker.app',
        });

        this.yellow.sendMessage(authMessage);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Auth timeout')), 30000);

            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.AuthChallenge) {
                    console.log('🔐 Received auth challenge');

                    const authParams = {
                        scope: 'poker.app',
                        application: this.account.address,
                        participant: this.sessionKey!.address,
                        expire: sessionExpireTimestamp,
                        allowances: [{ asset: 'usdc', amount: '100' }],
                        session_key: this.sessionKey!.address,
                        expires_at: sessionExpireTimestamp,
                    };

                    const eip712Signer = createEIP712AuthMessageSigner(
                        this.walletClient,
                        authParams,
                        { name: 'Poker App' }
                    );
                    const authVerifyMessage = await createAuthVerifyMessage(
                        eip712Signer,
                        message as AuthChallengeResponse
                    );
                    this.yellow!.sendMessage(authVerifyMessage);
                } else if (message.method === RPCMethod.AuthVerify) {
                    clearTimeout(timeout);
                    if ((message.params as any).success) {
                        this.isAuthenticated = true;
                        console.log('✅ Authenticated with Yellow Network');
                        resolve();
                    } else {
                        reject(new Error('Auth failed'));
                    }
                } else if (message.method === RPCMethod.Error) {
                    clearTimeout(timeout);
                    reject(new Error(JSON.stringify(message.params)));
                }
            });
        });
    }

    /**
     * Create a channel for USDC on Base
     */
    async createChannel(): Promise<string> {
        if (!this.yellow || !this.isAuthenticated) throw new Error('Not authenticated');

        const createChannelMessage = await createCreateChannelMessage(this.sessionSigner, {
            chain_id: BASE_CHAIN_ID,
            token: USDC_TOKEN_BASE as `0x${string}`,
        });

        console.log('📤 Creating channel for USDC on Base...');
        this.yellow.sendMessage(createChannelMessage);

        return new Promise((resolve, reject) => {
            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.CreateChannel) {
                    console.log('🧬 Channel approved by server');

                    const params = message.params as any;
                    const { channelId, txHash } = await this.nitroliteClient!.createChannel({
                        channel: params.channel as unknown as Channel,
                        unsignedInitialState: {
                            intent: params.state.intent as StateIntent,
                            version: BigInt(params.state.version),
                            data: params.state.stateData as `0x${string}`,
                            allocations: params.state.allocations as Allocation[],
                        },
                        serverSignature: params.serverSignature as `0x${string}`,
                    });

                    this.channelId = channelId;
                    console.log(`🎉 Channel ${channelId} created (tx: ${txHash})`);
                    resolve(channelId);
                } else if (message.method === RPCMethod.Error) {
                    reject(new Error(JSON.stringify(message.params)));
                }
            });
        });
    }

    /**
     * Deposit USDC to custody contract
     */
    async deposit(amountUsdc: string): Promise<string> {
        if (!this.nitroliteClient) throw new Error('Not initialized');

        const depositAmount = parseUnits(amountUsdc, USDC_DECIMALS);
        console.log(`📤 Depositing ${amountUsdc} USDC to custody...`);

        const depositHash = await this.nitroliteClient.deposit(USDC_TOKEN_BASE, depositAmount);
        console.log(`   Transaction: ${depositHash}`);

        await this.publicClient.waitForTransactionReceipt({ hash: depositHash });
        console.log('✅ Deposit confirmed');

        return depositHash;
    }

    /**
     * Resize channel - add or remove funds
     */
    async resizeChannel(options: { resizeAmount?: number; allocateAmount?: number }): Promise<string> {
        if (!this.yellow || !this.channelId) throw new Error('No active channel');

        const { resizeAmount, allocateAmount } = options;
        const resizeAmountInUnits = resizeAmount !== undefined
            ? parseUnits(resizeAmount.toString(), USDC_DECIMALS)
            : undefined;
        const allocateAmountInUnits = allocateAmount !== undefined
            ? parseUnits(allocateAmount.toString(), USDC_DECIMALS)
            : undefined;

        // Get config for broker address
        const configMessage = await createGetConfigMessage(this.sessionSigner);
        this.yellow.sendMessage(configMessage);

        return new Promise((resolve, reject) => {
            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.GetConfig) {
                    const params = message.params as any;
                    this.brokerAddress = params.brokerAddress;

                    const isAllocating = allocateAmount !== undefined && allocateAmount > 0;
                    const fundsDestination = isAllocating
                        ? this.brokerAddress!
                        : this.account.address;

                    const resizeMessage = await createResizeChannelMessage(this.sessionSigner, {
                        channel_id: this.channelId! as Hex,
                        ...(resizeAmountInUnits !== undefined && { resize_amount: resizeAmountInUnits }),
                        ...(allocateAmountInUnits !== undefined && { allocate_amount: allocateAmountInUnits }),
                        funds_destination: fundsDestination as `0x${string}`,
                    });
                    this.yellow!.sendMessage(resizeMessage);
                } else if (message.method === RPCMethod.ResizeChannel) {
                    console.log('✅ Resize approved, executing on-chain...');

                    const params = message.params as any;
                    const previousState = await this.nitroliteClient!.getChannelData(params.channelId as Hex);

                    const { txHash } = await this.nitroliteClient!.resizeChannel({
                        resizeState: {
                            channelId: params.channelId as Hex,
                            intent: params.state.intent as StateIntent,
                            version: BigInt(params.state.version),
                            data: params.state.stateData as Hex,
                            allocations: params.state.allocations as Allocation[],
                            serverSignature: params.serverSignature as Hex,
                        },
                        proofStates: [previousState.lastValidState as State],
                    });

                    console.log(`🎉 Resize complete (tx: ${txHash})`);
                    resolve(txHash);
                } else if (message.method === RPCMethod.Error) {
                    reject(new Error(JSON.stringify(message.params)));
                }
            });
        });
    }

    /**
     * Send a signed game action over the channel
     */
    async sendGameAction(action: 'FOLD' | 'CHECK' | 'RAISE' | 'CALL', amount?: string): Promise<void> {
        if (!this.yellow || !this.channelId) throw new Error('No active channel');

        const actionData = {
            type: 'game_action',
            sessionId: this.channelId,
            action,
            amount: amount || '0',
            timestamp: Date.now(),
        };

        const signature = await this.sessionSigner.signMessage({
            message: JSON.stringify(actionData),
        });

        this.yellow.sendMessage(JSON.stringify({ ...actionData, signature }));
        console.log(`🎮 Action sent: ${action}${amount ? ` (${amount} USDC)` : ''}`);
    }

    /**
     * Transfer USDC to another address via Yellow Network unified balance
     * Used for pot settlements after showdown
     */
    async transfer(toAddress: string, amountUsdc: string): Promise<void> {
        if (!this.yellow || !this.isAuthenticated) {
            throw new Error('Not connected to Yellow Network');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Transfer timeout'));
            }, 30000);

            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.Transfer) {
                    clearTimeout(timeout);
                    console.log(`✅ Transfer complete: ${amountUsdc} USDC to ${toAddress}`);
                    resolve();
                } else if (message.method === RPCMethod.Error) {
                    clearTimeout(timeout);
                    reject(new Error(JSON.stringify(message.params)));
                }
            });

            createTransferMessage(this.sessionSigner, {
                destination: toAddress as `0x${string}`,
                allocations: [{
                    asset: 'usdc',
                    amount: amountUsdc,
                }],
            }).then(transferMsg => {
                console.log(`📤 Sending ${amountUsdc} USDC to ${toAddress}...`);
                this.yellow!.sendMessage(transferMsg);
            }).catch(reject);
        });
    }

    /**
     * Get unified balance (available for transfers/game)
     */
    async getUnifiedBalance(): Promise<{ asset: string; amount: string }[]> {
        if (!this.yellow || !this.isAuthenticated) {
            throw new Error('Not connected to Yellow Network');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Get balance timeout'));
            }, 10000);

            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.GetLedgerBalances) {
                    clearTimeout(timeout);
                    const balances = (message.params as any).balances || [];
                    resolve(balances);
                } else if (message.method === RPCMethod.Error) {
                    clearTimeout(timeout);
                    reject(new Error(JSON.stringify(message.params)));
                }
            });

            createGetLedgerBalancesMessage(this.sessionSigner).then(balanceMsg => {
                this.yellow!.sendMessage(balanceMsg);
            }).catch(reject);
        });
    }

    /**
     * Generate settlement proof for Uniswap V4 hook
     */
    async getSettlementProof(
        partnerAddress: string,
        myFinalBalance: string,
        partnerFinalBalance: string
    ): Promise<SettlementProof> {
        if (!this.channelId) throw new Error('No active channel');

        const proofData = {
            sessionId: this.channelId,
            player: this.account.address,
            amount: myFinalBalance,
            partnerAddress,
            partnerAmount: partnerFinalBalance,
            timestamp: Date.now(),
        };

        const proofHash = JSON.stringify(proofData);
        const playerSignature = await this.sessionSigner.signMessage({ message: proofHash });

        return {
            ...proofData,
            playerSignature,
            partnerSignature: '', // Would be completed by partner
        };
    }

    /**
     * Close session and disconnect
     */
    async disconnect(): Promise<void> {
        if (this.yellow) {
            await this.yellow.disconnect();
            this.yellow = null;
        }
        this.isAuthenticated = false;
        this.channelId = null;
    }

    // Getters
    getChannelId(): string | null {
        return this.channelId;
    }

    getAccountAddress(): string {
        return this.account.address;
    }

    isConnected(): boolean {
        return this.isAuthenticated;
    }

    getBrokerAddress(): string | null {
        return this.brokerAddress;
    }

    getAppSessionId(): string | null {
        return this.appSessionId;
    }

    /**
     * Create a poker game App Session with specified players and allocations
     * @param participants Array of player wallet addresses
     * @param allocations Array of { participant, asset, amount } for each player
     * @returns Promise with the app session ID
     */
    async createPokerSession(
        participants: string[],
        allocations: Array<{ participant: string; asset: string; amount: string }>
    ): Promise<string> {
        if (!this.yellow || !this.isAuthenticated) {
            throw new Error('Not connected to Yellow Network');
        }

        // For App Sessions, we need at least 2 participants
        // If we have 2+ actual players, use them directly
        // If only 1 player (testing), add broker as second participant
        const allParticipants = participants.length >= 2
            ? participants
            : [...participants, this.brokerAddress!];

        // Add zero allocation for broker only if broker was added as participant
        const allAllocations = participants.length >= 2
            ? allocations
            : [...allocations, { participant: this.brokerAddress!, asset: 'usdc', amount: '0' }];

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create app session timeout'));
            }, 15000);

            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.CreateAppSession) {
                    clearTimeout(timeout);
                    const result = message.params as any;
                    this.appSessionId = result.appSessionId;
                    resolve(this.appSessionId!);
                } else if (message.method === RPCMethod.Error) {
                    clearTimeout(timeout);
                    reject(new Error(JSON.stringify(message.params)));
                }
            });

            createAppSessionMessage(this.sessionSigner, {
                definition: {
                    application: 'Poker App',
                    protocol: 'NitroRPC/0.2' as any,
                    participants: allParticipants as Hex[],
                    weights: allParticipants.map(() => 1),
                    quorum: 1, // Single-party close allowed
                    challenge: 3600,
                    nonce: Date.now(),
                },
                allocations: allAllocations.map(a => ({
                    asset: a.asset,
                    amount: a.amount,
                    participant: a.participant as Hex,
                })),
            }).then(sessionMsg => {
                this.yellow!.sendMessage(sessionMsg);
            }).catch(reject);
        });
    }

    /**
     * Close an active poker session with final allocations (who won what)
     * @param finalAllocations Array of { participant, asset, amount } for final distribution
     * @returns Promise that resolves when session is closed
     */
    async closePokerSession(
        finalAllocations: Array<{ participant: string; asset: string; amount: string }>
    ): Promise<void> {
        if (!this.yellow || !this.isAuthenticated) {
            throw new Error('Not connected to Yellow Network');
        }

        if (!this.appSessionId) {
            throw new Error('No active app session');
        }

        // Only add broker allocation if session was created with broker (i.e., single-player test)
        // For real 2-player games, just use the player allocations directly
        const allAllocations = finalAllocations.length >= 2
            ? finalAllocations
            : [...finalAllocations, { participant: this.brokerAddress!, asset: 'usdc', amount: '0' }];

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Close app session timeout'));
            }, 15000);

            this.yellow!.listen(async (message: RPCResponse) => {
                if (message.method === RPCMethod.CloseAppSession) {
                    clearTimeout(timeout);
                    this.appSessionId = null;
                    resolve();
                } else if (message.method === RPCMethod.Error) {
                    clearTimeout(timeout);
                    reject(new Error(JSON.stringify(message.params)));
                }
            });

            createCloseAppSessionMessage(this.sessionSigner, {
                app_session_id: this.appSessionId!,
                allocations: allAllocations.map(a => ({
                    asset: a.asset,
                    amount: a.amount,
                    participant: a.participant as Hex,
                })),
            }).then(closeMsg => {
                this.yellow!.sendMessage(closeMsg);
            }).catch(reject);
        });
    }
}
