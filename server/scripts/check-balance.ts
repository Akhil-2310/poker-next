/**
 * Check custody balance for your wallet
 * 
 * Usage: npx tsx scripts/check-balance.ts
 */

import { config } from 'dotenv';
import { createPublicClient, http, formatUnits } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

config();

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const USDC_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const custodyAbi = [
    {
        name: 'getAccountsBalances',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'accounts', type: 'address[]' },
            { name: 'tokens', type: 'address[]' }
        ],
        outputs: [{ name: '', type: 'uint256[][]' }]
    }
] as const;

async function main() {
    let wallet;
    if (process.env.SEED_PHRASE) {
        wallet = mnemonicToAccount(process.env.SEED_PHRASE);
    } else if (process.env.PRIVATE_KEY) {
        wallet = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    } else {
        throw new Error('Either SEED_PHRASE or PRIVATE_KEY must be set');
    }

    const publicClient = createPublicClient({
        chain: base,
        transport: http(),
    });

    console.log(`\n📋 Checking balances for: ${wallet.address}\n`);

    // Check USDC balance in wallet
    const usdcBalance = await publicClient.readContract({
        address: USDC_TOKEN,
        abi: [{
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }]
        }],
        functionName: 'balanceOf',
        args: [wallet.address],
    });
    console.log(`💰 USDC in wallet: ${formatUnits(usdcBalance, 6)} USDC`);

    // Check custody balance
    try {
        const custodyBalances = await publicClient.readContract({
            address: CUSTODY_ADDRESS,
            abi: custodyAbi,
            functionName: 'getAccountsBalances',
            args: [[wallet.address], [USDC_TOKEN]],
        });
        console.log(`🏦 USDC in custody: ${formatUnits(custodyBalances[0][0], 6)} USDC`);
    } catch (e: any) {
        console.log(`🏦 Custody balance check failed: ${e.message}`);
    }

    // Check if any open channels exist
    try {
        const openChannels = await publicClient.readContract({
            address: CUSTODY_ADDRESS,
            abi: [{
                name: 'getOpenChannels',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: '', type: 'bytes32[]' }]
            }],
            functionName: 'getOpenChannels',
            args: [wallet.address],
        });
        console.log(`📺 Open channels: ${openChannels.length}`);
        if (openChannels.length > 0) {
            console.log('   IDs:', openChannels);
        }
    } catch (e: any) {
        console.log(`📺 Open channels check failed: ${e.message}`);
    }
}

main().catch(console.error);
