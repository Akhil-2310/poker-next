/**
 * Yellow Network Configuration using @erc7824/nitrolite SDK
 * This module provides the client for off-chain poker sessions
 */

import {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createAppSessionMessage,
  parseAnyRPCResponse as parseRPCResponse,
  createCloseChannelMessage
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// Yellow Network Contract Addresses (Sepolia Testnet)
export const YELLOW_CONTRACTS = {
  custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
  adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
} as const;

// WebSocket endpoint for Yellow Network Sandbox
export const YELLOW_WS_URL = 'wss://clearnet-sandbox.yellow.com/ws';

// Token used for chips in Yellow Network (Sandbox uses ytest.usd)
export const CHIP_TOKEN = 'ytest.usd';

export interface YellowConfig {
  wsUrl: string;
  chainId: number;
  contracts: typeof YELLOW_CONTRACTS;
}

export const yellowConfig: YellowConfig = {
  wsUrl: YELLOW_WS_URL,
  chainId: sepolia.id,
  contracts: YELLOW_CONTRACTS,
};

/**
 * Creates a Yellow Network session client
 * This is used by the frontend to interact with the Yellow Network
 */
export function createYellowClient(privateKey: `0x${string}`, rpcUrl?: string) {
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl || process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
  });

  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(),
    account,
  });

  const nitroliteClient = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: YELLOW_CONTRACTS,
    chainId: sepolia.id,
    challengeDuration: 3600n,
  });

  return {
    account,
    publicClient,
    walletClient,
    nitroliteClient,
  };
}

/**
 * Session signer for signing game actions
 */
export async function createSessionSigner() {
  const sessionPrivateKey = generatePrivateKey();
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  return {
    signer: sessionSigner,
    address: sessionAccount.address,
    privateKey: sessionPrivateKey,
  };
}

/**
 * Creates a poker app session message
 */
export async function createPokerSessionMessage(
  sessionSigner: any,
  player1Address: string,
  player2Address: string,
  buyIn: string
) {
  const appDefinition = {
    application: 'poker-app-v1',
    protocol: 'poker-app-v1',
    participants: [player1Address, player2Address],
    weights: [50, 50],
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
  };

  const allocations = [
    { participant: player1Address, asset: CHIP_TOKEN, amount: buyIn },
    { participant: player2Address, asset: CHIP_TOKEN, amount: buyIn },
  ];

  const sessionPayload = { definition: appDefinition, allocations };
  const sessionMessage = await createAppSessionMessage(
    sessionSigner,
    sessionPayload as any
  );

  return sessionMessage;
}

/**
 * Signs a game action for the Yellow Network
 * This creates a cryptographic proof of the action
 */
export async function signGameAction(
  sessionSigner: any,
  sessionId: string,
  action: 'FOLD' | 'CHECK' | 'BET' | 'RAISE' | 'CALL',
  amount?: string
) {
  const actionData = {
    type: 'game_action',
    sessionId,
    action,
    amount: amount || '0',
    timestamp: Date.now(),
  };

  const signature = await sessionSigner.signMessage({
    message: JSON.stringify(actionData),
  });

  return {
    ...actionData,
    signature,
  };
}

/**
 * Creates a settlement proof for closing the game session
 * This proof is verified by the Uniswap V4 hook before releasing funds
 */
export interface SettlementProof {
  sessionId: string;
  finalBalances: { [address: string]: string };
  signatures: string[];
  timestamp: number;
}

export async function createSettlementProof(
  sessionId: string,
  player1Address: string,
  player1Balance: string,
  player1Signature: string,
  player2Address: string,
  player2Balance: string,
  player2Signature: string
): Promise<SettlementProof> {
  return {
    sessionId,
    finalBalances: {
      [player1Address]: player1Balance,
      [player2Address]: player2Balance,
    },
    signatures: [player1Signature, player2Signature],
    timestamp: Date.now(),
  };
}

export default yellowConfig;
