/**
 * Create a Yellow Network channel for USDC on Base mainnet
 * Based on working yellow-sdk-tutorials pattern
 */

import { config } from 'dotenv';
import { createPublicClient, createWalletClient, http } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { Client } from 'yellow-ts';
import {
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createCreateChannelMessage,
    createEIP712AuthMessageSigner,
    createECDSAMessageSigner,
    AuthChallengeResponse,
    RPCMethod,
    RPCResponse,
    NitroliteClient,
    WalletStateSigner,
    Channel,
    StateIntent,
    Allocation,
    ContractAddresses,
} from '@erc7824/nitrolite';
import { generateSessionKey } from '../lib/utils';

config();

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const USDC_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const BASE_CHAIN_ID = base.id;

function getBaseContractAddresses(): ContractAddresses {
    return {
        custody: CUSTODY_ADDRESS,
        adjudicator: ADJUDICATOR_ADDRESS,
    };
}

export async function main() {
    // Load wallet from environment
    let wallet;
    if (process.env.PRIVATE_KEY) {
        wallet = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    } else if (process.env.SEED_PHRASE) {
        wallet = mnemonicToAccount(process.env.SEED_PHRASE);
    } else {
        throw new Error('Either PRIVATE_KEY or SEED_PHRASE must be set');
    }

    const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

    const walletClient = createWalletClient({
        account: wallet,
        chain: base,
        transport: http(RPC_URL),
    });

    const publicClient = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    const sessionKey = generateSessionKey();
    const sessionSigner = createECDSAMessageSigner(sessionKey.privateKey);

    console.log(`\n📋 Create Yellow Network Channel`);
    console.log(`   Wallet: ${wallet.address}`);
    console.log(`   Token: USDC (${USDC_TOKEN})`);
    console.log(`   Chain: Base (${BASE_CHAIN_ID})\n`);

    const yellow = new Client({
        url: 'wss://clearnet.yellow.com/ws',
    });

    await yellow.connect();
    console.log('🔌 Connected to Yellow clearnet');

    const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Step 1: Request authentication
    const authMessage = await createAuthRequestMessage({
        address: wallet.address,
        session_key: sessionKey.address,
        application: 'Poker App',
        allowances: [{
            asset: 'usdc',
            amount: '100',
        }],
        expires_at: sessionExpireTimestamp,
        scope: 'poker.app',
    });

    yellow.sendMessage(authMessage);

    yellow.listen(async (message: RPCResponse) => {
        switch (message.method) {
            case RPCMethod.AuthChallenge:
                console.log('🔐 Received auth challenge');

                const authParams = {
                    scope: 'poker.app',
                    application: wallet.address,
                    participant: sessionKey.address,
                    expire: sessionExpireTimestamp,
                    allowances: [{
                        asset: 'usdc',
                        amount: '100',
                    }],
                    session_key: sessionKey.address,
                    expires_at: sessionExpireTimestamp,
                };

                const eip712Signer = createEIP712AuthMessageSigner(walletClient, authParams, { name: 'Poker App' });
                const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message as AuthChallengeResponse);

                yellow.sendMessage(authVerifyMessage);
                break;

            case RPCMethod.AuthVerify:
                if ((message.params as any).success) {
                    console.log('✅ Authentication successful');

                    // Step 2: Create channel for USDC on Base
                    const createChannelMessage = await createCreateChannelMessage(sessionSigner, {
                        chain_id: BASE_CHAIN_ID,
                        token: USDC_TOKEN as `0x${string}`,
                    });

                    console.log('📤 Creating channel for USDC on Base...');
                    yellow.sendMessage(createChannelMessage);
                } else {
                    console.error('❌ Authentication failed:', message.params);
                    await yellow.disconnect();
                    process.exit(1);
                }
                break;

            case RPCMethod.CreateChannel:
                console.log('🧬 Channel created successfully!');
                console.log('\n📋 Channel Details:');
                console.log('   Channel ID:', (message.params as any).channelId);
                console.log('   Participants:', (message.params as any).channel.participants);

                const nitroliteClient = new NitroliteClient({
                    walletClient,
                    publicClient: publicClient as any,
                    stateSigner: new WalletStateSigner(walletClient),
                    addresses: getBaseContractAddresses(),
                    chainId: BASE_CHAIN_ID,
                    challengeDuration: 3600n,
                });

                try {
                    const { channelId, txHash } = await nitroliteClient.createChannel({
                        channel: (message.params as any).channel as unknown as Channel,
                        unsignedInitialState: {
                            intent: (message.params as any).state.intent as StateIntent,
                            version: BigInt((message.params as any).state.version),
                            data: (message.params as any).state.stateData as `0x${string}`,
                            allocations: (message.params as any).state.allocations as Allocation[],
                        },
                        serverSignature: (message.params as any).serverSignature as `0x${string}`,
                    });

                    console.log(`\n🎉 Channel ${channelId} created on-chain!`);
                    console.log(`   Transaction: ${txHash}`);
                } catch (error: any) {
                    console.error('❌ On-chain creation failed:', error.message);
                    console.log('   (Channel exists off-chain, may need deposit first)');
                }

                await yellow.disconnect();
                process.exit(0);

            case RPCMethod.Error:
                console.error('❌ Error:', message.params);
                await yellow.disconnect();
                process.exit(1);
        }
    });
}

if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Create channel failed:', error.message || error);
        process.exitCode = 1;
    });
}
