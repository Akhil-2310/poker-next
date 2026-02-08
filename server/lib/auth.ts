/**
 * Yellow Network authentication helpers for Base mainnet
 */

import { createPublicClient, createWalletClient, http, WalletClient, PublicClient } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { Client } from 'yellow-ts';
import {
    createAuthRequestMessage,
    createAuthVerifyMessage,
    createEIP712AuthMessageSigner,
    createECDSAMessageSigner,
    AuthChallengeResponse,
    RPCMethod,
    RPCResponse,
} from '@erc7824/nitrolite';
import { generateSessionKey } from './utils';
import 'dotenv/config';

// Use RPC_URL from env or default to Base mainnet
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

// Create public client for Base
export const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
});

/**
 * Create a wallet client from seed phrase or private key
 */
export function createWalletFromEnv(): WalletClient {
    const seedPhrase = process.env.SEED_PHRASE;
    const privateKey = process.env.PRIVATE_KEY;

    if (seedPhrase) {
        const account = mnemonicToAccount(seedPhrase);
        return createWalletClient({
            account,
            chain: base,
            transport: http(RPC_URL),
        });
    } else if (privateKey) {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        return createWalletClient({
            account,
            chain: base,
            transport: http(RPC_URL),
        });
    }

    throw new Error('Either SEED_PHRASE or PRIVATE_KEY must be set in environment');
}

// Default wallet client (created on import)
export const walletClient: WalletClient = createWalletFromEnv();

/**
 * Authenticate with Yellow Network using EIP-712 signatures
 * Returns the session key after successful authentication
 */
export async function authenticate(yellow: Client): Promise<ReturnType<typeof generateSessionKey>> {
    const sessionKey = generateSessionKey();
    const sessionSigner = createECDSAMessageSigner(sessionKey.privateKey);

    const walletAddress = walletClient.account?.address;
    if (!walletAddress) throw new Error('Wallet not connected');

    const sessionExpireTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    // Step 1: Request authentication
    const authMessage = await createAuthRequestMessage({
        address: walletAddress,
        session_key: sessionKey.address,
        application: 'Poker App',
        allowances: [{
            asset: 'usdc',
            amount: '100', // 100 USDC allowance for poker
        }],
        expires_at: sessionExpireTimestamp,
        scope: 'poker.app',
    });

    yellow.sendMessage(authMessage);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Authentication timeout'));
        }, 30000);

        yellow.listen(async (message: RPCResponse) => {
            switch (message.method) {
                case RPCMethod.AuthChallenge:
                    console.log('🔐 Received auth challenge');

                    const authParams = {
                        scope: 'poker.app',
                        application: walletAddress,
                        participant: sessionKey.address,
                        expire: sessionExpireTimestamp,
                        allowances: [{
                            asset: 'usdc',
                            amount: '100',
                        }],
                        session_key: sessionKey.address,
                        expires_at: sessionExpireTimestamp,
                    };

                    const eip712Signer = createEIP712AuthMessageSigner(
                        walletClient,
                        authParams,
                        { name: 'Poker App' }
                    );
                    const authVerifyMessage = await createAuthVerifyMessage(
                        eip712Signer,
                        message as AuthChallengeResponse
                    );

                    yellow.sendMessage(authVerifyMessage);
                    break;

                case RPCMethod.AuthVerify:
                    clearTimeout(timeout);
                    if ((message.params as any).success) {
                        console.log('✅ Authentication successful');
                        resolve(sessionKey);
                    } else {
                        reject(new Error('Authentication failed'));
                    }
                    break;

                case RPCMethod.Error:
                    clearTimeout(timeout);
                    reject(new Error(`Auth error: ${JSON.stringify(message.params)}`));
                    break;
            }
        });
    });
}
