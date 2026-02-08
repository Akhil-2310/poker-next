/**
 * Close Yellow Network channel(s) on Base mainnet
 * Use this to clean up stuck channels or withdraw funds
 */

import { config } from 'dotenv';
import { createPublicClient, createWalletClient, http, Hex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import {
    NitroliteClient,
    WalletStateSigner,
    createECDSAMessageSigner,
    createEIP712AuthMessageSigner,
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createCloseChannelMessage,
    AuthChallengeResponse,
    RPCMethod,
    RPCResponse,
} from '@erc7824/nitrolite';
import { Client } from 'yellow-ts';

config();

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const BASE_CHAIN_ID = base.id;

async function main() {
    // Parse optional channel ID arg
    const args = process.argv.slice(2);
    const channelIdArg = args.find(a => a.startsWith('0x')) as Hex | undefined;

    // Setup wallet
    let wallet;
    if (process.env.PRIVATE_KEY) {
        wallet = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    } else if (process.env.SEED_PHRASE) {
        wallet = mnemonicToAccount(process.env.SEED_PHRASE);
    } else {
        throw new Error('Either PRIVATE_KEY or SEED_PHRASE must be set');
    }

    const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

    const publicClient = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    const walletClient = createWalletClient({
        account: wallet,
        chain: base,
        transport: http(RPC_URL),
    });

    const sessionPrivateKey = generatePrivateKey();
    const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);

    console.log(`\n📋 Close Yellow Network Channels`);
    console.log(`   Wallet: ${wallet.address}`);
    if (channelIdArg) {
        console.log(`   Target Channel: ${channelIdArg}`);
    } else {
        console.log(`   Mode: Close all open channels`);
    }
    console.log();

    // Initialize Nitrolite Client
    const nitroliteClient = new NitroliteClient({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        addresses: {
            custody: CUSTODY_ADDRESS,
            adjudicator: ADJUDICATOR_ADDRESS,
        },
        challengeDuration: 3600n,
        chainId: BASE_CHAIN_ID,
        stateSigner: new WalletStateSigner(walletClient),
    });

    // Connect to Yellow Network
    const yellow = new Client({
        url: 'wss://clearnet.yellow.com/ws',
    });

    await yellow.connect();
    console.log('🔌 Connected to Yellow clearnet');

    const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Authenticate
    const authMessage = await createAuthRequestMessage({
        address: wallet.address,
        session_key: sessionAccount.address,
        application: 'Poker App',
        allowances: [{
            asset: 'usdc',
            amount: '100',
        }],
        expires_at: sessionExpireTimestamp,
        scope: 'poker.app',
    });

    yellow.sendMessage(authMessage);

    let channelsToClose: Hex[] = [];
    let closedCount = 0;

    yellow.listen(async (message: RPCResponse) => {
        switch (message.method) {
            case RPCMethod.AuthChallenge:
                console.log('🔐 Received auth challenge');

                const authParams = {
                    scope: 'poker.app',
                    application: wallet.address,
                    participant: sessionAccount.address,
                    expire: sessionExpireTimestamp,
                    allowances: [{
                        asset: 'usdc',
                        amount: '100',
                    }],
                    session_key: sessionAccount.address,
                    expires_at: sessionExpireTimestamp,
                };

                const eip712Signer = createEIP712AuthMessageSigner(walletClient, authParams, { name: 'Poker App' });
                const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message as AuthChallengeResponse);

                yellow.sendMessage(authVerifyMessage);
                break;

            case RPCMethod.AuthVerify:
                if ((message.params as any).success) {
                    console.log('✅ Authentication successful');

                    // Get open channels from L1
                    console.log('📋 Fetching open channels from L1...');
                    try {
                        const openChannels = await nitroliteClient.getOpenChannels();
                        console.log(`   Found ${openChannels.length} open channels`);

                        if (openChannels.length === 0) {
                            console.log('\n✅ No open channels to close.');
                            await yellow.disconnect();
                            process.exit(0);
                        }

                        // Filter by specific channel if provided
                        if (channelIdArg) {
                            channelsToClose = openChannels.filter(id => id.toLowerCase() === channelIdArg.toLowerCase());
                            if (channelsToClose.length === 0) {
                                console.log(`\n❌ Channel ${channelIdArg} not found in open channels`);
                                console.log('   Open channels:', openChannels);
                                await yellow.disconnect();
                                process.exit(1);
                            }
                        } else {
                            channelsToClose = openChannels;
                        }

                        // Close each channel
                        for (const channelId of channelsToClose) {
                            console.log(`\n📤 Requesting close for ${channelId}...`);
                            const closeMsg = await createCloseChannelMessage(
                                sessionSigner,
                                channelId,
                                wallet.address
                            );
                            yellow.sendMessage(closeMsg);

                            // Small delay between requests
                            await new Promise(r => setTimeout(r, 500));
                        }
                    } catch (e: any) {
                        console.error('❌ Error fetching channels:', e.message);
                        await yellow.disconnect();
                        process.exit(1);
                    }
                } else {
                    console.error('❌ Authentication failed:', message.params);
                    await yellow.disconnect();
                    process.exit(1);
                }
                break;

            case RPCMethod.CloseChannel:
                const params = message.params as any;
                const channelId = params.channel_id || params.channelId;
                console.log(`✅ Server signed close for ${channelId}`);

                const finalState = {
                    intent: params.state.intent,
                    version: BigInt(params.state.version),
                    data: params.state.state_data || params.state.stateData,
                    allocations: params.state.allocations.map((a: any) => ({
                        destination: a.destination,
                        token: a.token,
                        amount: BigInt(a.amount),
                    })),
                    channelId: channelId,
                    serverSignature: params.server_signature || params.serverSignature,
                };

                try {
                    console.log(`   Submitting close to L1...`);
                    const txHash = await nitroliteClient.closeChannel({
                        finalState,
                        stateData: finalState.data,
                    });
                    console.log(`   ✅ Closed on-chain: ${txHash}`);
                    closedCount++;
                } catch (e: any) {
                    console.error(`   ❌ Failed to close on-chain:`, e.message);
                }

                // Check if done
                if (closedCount >= channelsToClose.length) {
                    console.log(`\n🎉 Closed ${closedCount} channel(s)`);
                    await yellow.disconnect();
                    process.exit(0);
                }
                break;

            case RPCMethod.Error:
                console.error('❌ Yellow Network Error:', message.params);
                // Continue trying other channels if any
                break;
        }
    });

    // Timeout after 60 seconds
    setTimeout(async () => {
        console.log('\n⏱️ Timeout reached');
        await yellow.disconnect();
        process.exit(closedCount > 0 ? 0 : 1);
    }, 60000);
}

main().catch((error) => {
    console.error('❌ Close channel failed:', error.message || error);
    process.exitCode = 1;
});
