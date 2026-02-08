
import { config } from 'dotenv';
import { createWalletClient, http } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { Client } from 'yellow-ts';
import {
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createGetLedgerBalancesMessage,
    createGetConfigMessage,
    createEIP712AuthMessageSigner,
    createECDSAMessageSigner,
    AuthChallengeResponse,
    RPCMethod,
    RPCResponse,
} from '@erc7824/nitrolite';
import { generateSessionKey } from '../lib/utils';

config();

async function main() {
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

    const sessionKey = generateSessionKey();
    const sessionSigner = createECDSAMessageSigner(sessionKey.privateKey);

    console.log(`\n📋 Debug Balance Fetch`);
    console.log(`   Wallet: ${wallet.address}`);
    console.log(`   Session: ${sessionKey.address}\n`);

    const yellow = new Client({
        url: 'wss://clearnet.yellow.com/ws',
    });

    await yellow.connect();
    console.log('🔌 Connected to Yellow clearnet');

    const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Auth
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

                    // TEST 1: No Address
                    console.log('\n🧪 Test 1: get_ledger_balances(signer)');
                    const msg1 = await createGetLedgerBalancesMessage(sessionSigner);
                    yellow.sendMessage(msg1);

                    // We need to wait for response.
                } else {
                    console.error('❌ Authentication failed');
                    process.exit(1);
                }
                break;

            case RPCMethod.GetLedgerBalances:
                console.log('✅ Received Balances:', JSON.stringify(message.params, null, 2));

                // If we haven't run Test 2 yet
                if (!triedWithAddress) {
                    triedWithAddress = true;
                    // TEST 2: With Address
                    console.log('\n🧪 Test 2: get_ledger_balances(signer, walletAddress)');
                    const msg2 = await createGetLedgerBalancesMessage(sessionSigner, wallet.address);
                    yellow.sendMessage(msg2);
                } else if (!triedConfig) {
                    console.log('✅ Test 2 Complete');
                    triedConfig = true;
                    // TEST 3: Get Config
                    console.log('\n🧪 Test 3: get_config(signer)');
                    const msg3 = await createGetConfigMessage(sessionSigner);
                    yellow.sendMessage(msg3);
                } else {
                    console.log('✅ Test 3 Complete');
                    process.exit(0);
                }
                break;

            case RPCMethod.GetConfig:
                console.log('✅ Received Config');
                console.log('✅ Test 3 Complete');
                process.exit(0);
                break;

            case RPCMethod.Error:
                console.error('❌ Error Received:', JSON.stringify(message.params, null, 2));

                if (!triedWithAddress && !triedConfig) {
                    console.log('❌ Test 1 Failed.');
                    // Try Test 2
                    triedWithAddress = true;
                    const msg2 = await createGetLedgerBalancesMessage(sessionSigner, wallet.address);
                    yellow.sendMessage(msg2);
                } else if (triedWithAddress && !triedConfig) {
                    console.log('❌ Test 2 Failed.');
                    // Try Test 3
                    triedConfig = true;
                    console.log('\n🧪 Test 3: get_config(signer)');
                    const msg3 = await createGetConfigMessage(sessionSigner);
                    yellow.sendMessage(msg3);
                } else {
                    console.log('❌ Test 3 Failed (Get Config).');
                    process.exit(1);
                }
                break;
        }
    });
}

let triedWithAddress = false;
let triedConfig = false;

main().catch(console.error);
