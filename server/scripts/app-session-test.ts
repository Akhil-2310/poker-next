/**
 * Test App Session for Poker Game
 * Creates an app session between user and broker, then closes with new allocations
 * 
 * Usage: npx tsx scripts/app-session-test.ts
 */

import { config } from 'dotenv';
import { createWalletClient, http, Hex, Address } from 'viem';
import { mnemonicToAccount, privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import { Client } from 'yellow-ts';
import {
    createECDSAMessageSigner,
    createEIP712AuthMessageSigner,
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createAppSessionMessage,
    createCloseAppSessionMessage,
    createGetConfigMessage,
    RPCMethod,
    RPCResponse,
    AuthChallengeResponse,
} from '@erc7824/nitrolite';

config();

async function main() {
    // Setup wallet
    let wallet;
    if (process.env.SEED_PHRASE) {
        wallet = mnemonicToAccount(process.env.SEED_PHRASE);
    } else if (process.env.PRIVATE_KEY) {
        wallet = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    } else {
        throw new Error('Either SEED_PHRASE or PRIVATE_KEY must be set');
    }

    const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

    const walletClient = createWalletClient({
        account: wallet,
        chain: base,
        transport: http(RPC_URL),
    });

    // Generate session key
    const sessionPrivateKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);
    const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

    console.log(`\n🎮 App Session Test for Poker`);
    console.log(`   Wallet: ${wallet.address}`);
    console.log(`   Session Key: ${sessionAccount.address}\n`);

    const yellow = new Client({
        url: 'wss://clearnet.yellow.com/ws',
    });

    await yellow.connect();
    console.log('🔌 Connected to Yellow clearnet');

    const sessionExpireTimestamp = String(Math.floor(Date.now() / 1000) + 3600);

    // Authenticate
    const authMessage = await createAuthRequestMessage({
        address: wallet.address,
        session_key: sessionAccount.address,
        application: 'Poker App',
        allowances: [{
            asset: 'usdc',
            amount: '1.0',
        }],
        expires_at: BigInt(sessionExpireTimestamp),
        scope: 'poker.app',
    });

    yellow.sendMessage(authMessage);

    let appSessionId: Hex | null = null;
    let brokerAddress: Address | null = null;

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
                        amount: '1.0',
                    }],
                    session_key: sessionAccount.address,
                    expires_at: BigInt(sessionExpireTimestamp),
                };

                const eip712Signer = createEIP712AuthMessageSigner(walletClient, authParams, { name: 'Poker App' });
                const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message as AuthChallengeResponse);

                yellow.sendMessage(authVerifyMessage);
                break;

            case RPCMethod.AuthVerify:
                console.log('✅ Authentication successful');

                // First get config to get broker address
                console.log('📤 Fetching broker config...');
                const configMsg = await createGetConfigMessage(sessionSigner);
                yellow.sendMessage(configMsg);
                break;

            case RPCMethod.GetConfig:
                const configParams = message.params as any;
                brokerAddress = configParams.brokerAddress as Address;
                console.log(`   Broker: ${brokerAddress}`);

                // Create App Session with broker as second participant
                console.log('\n📤 Creating App Session...');

                const createSessionMsg = await createAppSessionMessage(sessionSigner, {
                    definition: {
                        application: 'Poker App',
                        protocol: 'NitroRPC/0.2' as any,
                        participants: [wallet.address, brokerAddress],
                        weights: [1, 1],
                        quorum: 1,  // Allow single-party close
                        challenge: 3600,
                        nonce: Date.now(),
                    },
                    allocations: [
                        {
                            asset: 'usdc',
                            amount: '0.02',
                            participant: wallet.address,
                        },
                        {
                            asset: 'usdc',
                            amount: '0',
                            participant: brokerAddress,
                        },
                    ],
                });

                yellow.sendMessage(createSessionMsg);
                break;

            case RPCMethod.CreateAppSession:
                const createResult = message.params as any;
                console.log('   Raw response:', JSON.stringify(createResult));
                appSessionId = createResult.appSessionId || createResult.app_session_id;
                console.log(`✅ App Session created: ${appSessionId}`);
                console.log(`   Allocation: 0.05 USDC locked from user`);

                // Simulate game (wait 2 seconds)
                console.log('\n🎲 Simulating poker game...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Close session - return funds to user
                console.log('\n📤 Closing App Session...');

                const closeSessionMsg = await createCloseAppSessionMessage(sessionSigner, {
                    app_session_id: appSessionId!,
                    allocations: [
                        {
                            asset: 'usdc',
                            amount: '0.02',
                            participant: wallet.address,
                        },
                        {
                            asset: 'usdc',
                            amount: '0',
                            participant: brokerAddress!,
                        },
                    ],
                });

                yellow.sendMessage(closeSessionMsg);
                break;

            case RPCMethod.CloseAppSession:
                console.log(`\n🎉 App Session closed successfully!`);
                console.log(`   Funds returned to unified balance`);
                await yellow.disconnect();
                process.exit(0);

            case RPCMethod.BalanceUpdate:
                const balances = (message.params as any).balanceUpdates || [];
                if (balances.length > 0) {
                    console.log('💰 Balance update:', balances.map((b: any) => `${b.asset}: ${b.amount}`).join(', '));
                }
                break;

            case RPCMethod.Error:
                console.error('❌ Yellow Network Error:', message.params);
                await yellow.disconnect();
                process.exit(1);
        }
    });

    // Timeout after 30 seconds
    setTimeout(async () => {
        console.log('\n⏱️ Timeout reached');
        await yellow.disconnect();
        process.exit(1);
    }, 30000);
}

main().catch((error) => {
    console.error('❌ App Session test failed:', error.message || error);
    process.exitCode = 1;
});
