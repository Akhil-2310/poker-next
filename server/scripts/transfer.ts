/**
 * Transfer USDC to another address via Yellow Network
 * Usage: npx tsx scripts/transfer.ts --to <address> --amount 0.01
 */

import { config } from 'dotenv';
import { createWalletClient, http } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { generateSessionKey } from '../lib/utils';
import { Client } from 'yellow-ts';
import {
    createAuthRequestMessage,
    RPCMethod,
    RPCResponse,
    createEIP712AuthMessageSigner,
    createAuthVerifyMessage,
    AuthChallengeResponse,
    createECDSAMessageSigner,
    createTransferMessage,
} from '@erc7824/nitrolite';

config();

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const getArg = (name: string, alias: string): string | undefined => {
        const idx = args.findIndex(a => a === `--${name}` || a === `-${alias}`);
        return idx !== -1 ? args[idx + 1] : undefined;
    };

    const toAddress = getArg('to', 't') as `0x${string}`;
    const amountStr = getArg('amount', 'a') || '0.01';

    if (!toAddress) {
        console.log('Usage: npx tsx scripts/transfer.ts --to <address> --amount <usdc>');
        console.log('Example: npx tsx scripts/transfer.ts --to 0x123... --amount 0.01');
        process.exit(1);
    }

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

    const sessionKey = generateSessionKey();

    console.log(`\n📋 Transfer USDC via Yellow Network`);
    console.log(`   From: ${wallet.address}`);
    console.log(`   To: ${toAddress}`);
    console.log(`   Amount: ${amountStr} USDC\n`);

    const yellow = new Client({
        url: 'wss://clearnet.yellow.com/ws',
    });

    await yellow.connect();
    console.log('🔌 Connected to Yellow clearnet');

    const sessionExpireTimestamp = String(Math.floor(Date.now() / 1000) + 3600);

    const authMessage = await createAuthRequestMessage({
        address: wallet.address,
        session_key: sessionKey.address,
        application: 'Poker App',
        allowances: [{
            asset: 'usdc',
            amount: amountStr,
        }],
        expires_at: BigInt(sessionExpireTimestamp),
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
                        amount: amountStr,
                    }],
                    session_key: sessionKey.address,
                    expires_at: BigInt(sessionExpireTimestamp),
                };

                const eip712Signer = createEIP712AuthMessageSigner(walletClient, authParams, { name: 'Poker App' });
                const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message as AuthChallengeResponse);

                yellow.sendMessage(authVerifyMessage);
                break;

            case RPCMethod.AuthVerify:
                console.log('✅ Authentication successful');

                const sessionSigner = createECDSAMessageSigner(sessionKey.privateKey);

                const transferMsg = await createTransferMessage(sessionSigner, {
                    destination: toAddress,
                    allocations: [{
                        asset: 'usdc',
                        amount: amountStr,
                    }],
                });

                console.log(`📤 Sending ${amountStr} USDC to ${toAddress}...`);
                yellow.sendMessage(transferMsg);
                break;

            case RPCMethod.Transfer:
                console.log(`\n🎉 Transfer successful!`);
                console.log(`   Sent: ${amountStr} USDC`);
                console.log(`   To: ${toAddress}`);
                await yellow.disconnect();
                process.exit(0);

            case RPCMethod.BalanceUpdate:
                console.log('💰 Balance update:', (message.params as any).balanceUpdates);
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
    console.error('❌ Transfer failed:', error.message || error);
    process.exitCode = 1;
});
