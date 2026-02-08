/**
 * Deposit USDC to the Yellow Network custody contract on Base mainnet
 * Uses max approval for convenience
 */

import { config } from 'dotenv';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { NitroliteClient, WalletStateSigner, ContractAddresses } from '@erc7824/nitrolite';

config();

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const USDC_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_DECIMALS = 6;

const USDC_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' }
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
] as const;

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const amountIndex = args.findIndex(arg => arg === '--amount' || arg === '-a');
    if (amountIndex === -1 || !args[amountIndex + 1]) {
        console.log('Usage: npx tsx scripts/deposit.ts --amount <amount>');
        console.log('Example: npx tsx scripts/deposit.ts --amount 0.1');
        process.exit(1);
    }
    const amountStr = args[amountIndex + 1];
    const depositAmount = parseUnits(amountStr, USDC_DECIMALS);

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

    console.log(`\n📋 Deposit ${amountStr} USDC to Custody`);
    console.log(`   Wallet: ${wallet.address}`);
    console.log(`   Custody: ${CUSTODY_ADDRESS}\n`);

    // Check USDC balance
    const balance = await publicClient.readContract({
        address: USDC_TOKEN,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [wallet.address],
    });
    console.log(`💰 USDC balance: ${formatUnits(balance, USDC_DECIMALS)}`);

    if (depositAmount > balance) {
        throw new Error(`Insufficient balance. Have ${formatUnits(balance, USDC_DECIMALS)}, need ${amountStr}`);
    }

    // Check and set approval (use max approval to avoid repeated approvals)
    const allowance = await publicClient.readContract({
        address: USDC_TOKEN,
        abi: USDC_ABI,
        functionName: 'allowance',
        args: [wallet.address, CUSTODY_ADDRESS],
    });
    console.log(`✅ Current allowance: ${formatUnits(allowance, USDC_DECIMALS)}`);

    if (allowance < depositAmount) {
        const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        console.log(`📝 Approving max USDC for custody...`);
        const approveHash = await walletClient.writeContract({
            address: USDC_TOKEN,
            abi: USDC_ABI,
            functionName: 'approve',
            args: [CUSTODY_ADDRESS, maxApproval],
        });
        console.log(`   Approve tx: ${approveHash}`);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        console.log(`   Approved!`);
    }

    // Create NitroliteClient for deposit
    const nitroliteClient = new NitroliteClient({
        walletClient,
        publicClient: publicClient as any,
        stateSigner: new WalletStateSigner(walletClient),
        addresses: {
            custody: CUSTODY_ADDRESS,
            adjudicator: ADJUDICATOR_ADDRESS,
        } as ContractAddresses,
        chainId: base.id,
        challengeDuration: 3600n,
    });

    console.log(`\n📤 Depositing ${amountStr} USDC to custody...`);
    const depositHash = await nitroliteClient.deposit(USDC_TOKEN, depositAmount);
    console.log(`   Deposit tx: ${depositHash}`);

    console.log('⏳ Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`✅ Deposit confirmed in block ${receipt.blockNumber}`);
    console.log(`\n🎉 Successfully deposited ${amountStr} USDC to custody!`);
}

main().catch((error) => {
    console.error('❌ Deposit failed:', error.message || error);
    process.exitCode = 1;
});
