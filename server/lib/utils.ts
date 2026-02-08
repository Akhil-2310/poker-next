/**
 * Yellow Network utility functions for Base mainnet
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// Base mainnet contract addresses
export const BASE_CONTRACT_ADDRESSES = {
    custody: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6',
    adjudicator: '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C',
} as const;

// USDC token on Base mainnet
export const USDC_TOKEN_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const USDC_DECIMALS = 6;

// Yellow Network WebSocket URL (mainnet)
export const YELLOW_WS_URL = 'wss://clearnet.yellow.com/ws';

// Base chain ID
export const BASE_CHAIN_ID = base.id;

/**
 * Generate a new session key for Yellow Network authentication
 */
export function generateSessionKey() {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    return {
        privateKey,
        address: account.address,
        account,
    };
}

/**
 * Get contract addresses for a specific chain
 */
export function getContractAddresses(chainId: number) {
    if (chainId === BASE_CHAIN_ID) {
        return BASE_CONTRACT_ADDRESSES;
    }
    throw new Error(`Unsupported chain ID: ${chainId}`);
}
