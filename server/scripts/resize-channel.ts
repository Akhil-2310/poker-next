/**
 * Resize a Yellow Network channel on Base mainnet
 * Move funds between custody and channel
 */

import { config } from 'dotenv';
import { Hex, formatUnits, parseUnits, createPublicClient, createWalletClient, http } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import {
    Allocation,
    NitroliteClient,
    RPCMethod,
    RPCResponse,
    State,
    StateIntent,
    WalletStateSigner,
    createECDSAMessageSigner,
    createGetConfigMessage,
    createResizeChannelMessage,
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createEIP712AuthMessageSigner,
    AuthChallengeResponse,
} from '@erc7824/nitrolite';
import { Client } from 'yellow-ts';
import { generateSessionKey } from '../lib/utils';

config();

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const BASE_CHAIN_ID = base.id;
const USDC_DECIMALS = 6;

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const getArg = (name: string, alias: string): string | undefined => {
        const idx = args.findIndex(a => a === `--${name}` || a === `-${alias}`);
        return idx !== -1 ? args[idx + 1] : undefined;
    };

    const channelId = getArg('channel-id', 'c') as Hex;
    const resizeStr = getArg('resize', 'r');
    const allocateStr = getArg('allocate', 'a');

    if (!channelId) {
        console.log('Usage: npx tsx scripts/resize-channel.ts --channel-id <id> [--resize <amount>] [--allocate <amount>]');
        console.log('Examples:');
        console.log('  npx tsx scripts/resize-channel.ts -c 0x123... -r 0.1    # Add 0.1 USDC from custody to channel');
        console.log('  npx tsx scripts/resize-channel.ts -c 0x123... -r -0.1   # Remove 0.1 USDC from channel to custody');
        console.log('  npx tsx scripts/resize-channel.ts -c 0x123... -a -0.1   # Allocate: move 0.1 USDC from channel to unified balance');
        console.log('  npx tsx scripts/resize-channel.ts -c 0x123... -a 0.1    # Deallocate: move 0.1 USDC from unified to channel');
        process.exit(1);
    }

    const resizeAmount = resizeStr ? parseFloat(resizeStr) : undefined;
    const allocateAmount = allocateStr ? parseFloat(allocateStr) : undefined;

    if (resizeAmount === undefined && allocateAmount === undefined) {
        console.error('At least one of --resize or --allocate must be provided');
        process.exit(1);
    }

    const resizeAmountInUnits = resizeAmount !== undefined
        ? parseUnits(resizeAmount.toString(), USDC_DECIMALS)
        : undefined;
    const allocateAmountInUnits = allocateAmount !== undefined
        ? parseUnits(allocateAmount.toString(), USDC_DECIMALS)
        : undefined;

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
    const walletAddress = wallet.address;

    console.log(`\n📋 Resize Channel`);
    console.log(`   Channel ID: ${channelId}`);
    console.log(`   Wallet: ${walletAddress}`);
    if (resizeAmount !== undefined) {
        console.log(`   Resize: ${resizeAmount > 0 ? '+' : ''}${resizeAmount} USDC`);
    }
    if (allocateAmount !== undefined) {
        console.log(`   Allocate: ${allocateAmount > 0 ? '+' : ''}${allocateAmount} USDC`);
    }
    console.log();

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

    // State tracking
    let brokerAddress: string;
    let baseNetwork: {
        chainId: number;
        custodyAddress: string;
        adjudicatorAddress: string;
    };

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

                    // Get config for broker address
                    const configMessage = await createGetConfigMessage(sessionSigner);
                    yellow.sendMessage(configMessage);
                } else {
                    console.error('❌ Authentication failed:', message.params);
                    await yellow.disconnect();
                    process.exit(1);
                }
                break;

            case RPCMethod.GetConfig:
                const params = message.params as any;
                brokerAddress = params.brokerAddress;
                baseNetwork = params.networks.find((n: any) => n.chainId === BASE_CHAIN_ID);

                if (!baseNetwork) {
                    console.error(`❌ Could not find Base network in config`);
                    await yellow.disconnect();
                    process.exit(1);
                }

                // Funds destination: broker for allocation, user for deallocation
                const isAllocating = allocateAmount !== undefined && allocateAmount > 0;
                const fundsDestination = (isAllocating ? brokerAddress : walletAddress) as `0x${string}`;

                console.log(`📤 Sending resize request...`);
                console.log(`   Funds destination: ${fundsDestination}`);

                const resizeMessage = await createResizeChannelMessage(sessionSigner, {
                    channel_id: channelId,
                    ...(resizeAmountInUnits !== undefined && { resize_amount: resizeAmountInUnits }),
                    ...(allocateAmountInUnits !== undefined && { allocate_amount: allocateAmountInUnits }),
                    funds_destination: fundsDestination,
                });

                yellow.sendMessage(resizeMessage);
                break;

            case RPCMethod.ResizeChannel:
                console.log(`✅ Resize approved by server, executing on-chain...`);

                const nitroliteClient = new NitroliteClient({
                    publicClient: publicClient as any,
                    walletClient: walletClient as any,
                    stateSigner: new WalletStateSigner(walletClient),
                    addresses: {
                        custody: baseNetwork.custodyAddress as `0x${string}`,
                        adjudicator: baseNetwork.adjudicatorAddress as `0x${string}`,
                    },
                    chainId: BASE_CHAIN_ID,
                    challengeDuration: 3600n,
                });

                const resizeParams = message.params as any;

                try {
                    // Fetch the previous state
                    const previousState = await nitroliteClient.getChannelData(resizeParams.channelId as Hex);

                    const { txHash } = await nitroliteClient.resizeChannel({
                        resizeState: {
                            channelId: resizeParams.channelId as Hex,
                            intent: resizeParams.state.intent as StateIntent,
                            version: BigInt(resizeParams.state.version),
                            data: resizeParams.state.stateData as Hex,
                            allocations: resizeParams.state.allocations as Allocation[],
                            serverSignature: resizeParams.serverSignature as Hex,
                        },
                        proofStates: [previousState.lastValidState as State],
                    });

                    console.log(`\n🎉 Resize successful!`);
                    console.log(`   Transaction: ${txHash}`);
                    if (resizeAmount !== undefined) {
                        console.log(`   Resized: ${resizeAmount > 0 ? '+' : ''}${resizeAmount} USDC`);
                    }
                    if (allocateAmount !== undefined) {
                        console.log(`   Allocated: ${allocateAmount > 0 ? '+' : ''}${allocateAmount} USDC`);
                    }
                } catch (txError: any) {
                    console.error('❌ Resize failed:', txError.message || txError);
                }

                await yellow.disconnect();
                process.exit(0);

            case RPCMethod.Error:
                console.error('❌ Yellow Network Error:', message.params);
                await yellow.disconnect();
                process.exit(1);
        }
    });
}

main().catch((error) => {
    console.error('❌ Resize channel failed:', error.message || error);
    process.exitCode = 1;
});
