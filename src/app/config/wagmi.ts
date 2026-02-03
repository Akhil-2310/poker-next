'use client'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, polygon, optimism, arbitrum, base, sepolia } from 'wagmi/chains'

export const config = getDefaultConfig({
  appName: 'Poker Game',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID_HERE',
  chains: [sepolia, polygon, optimism, arbitrum, base],
  ssr: true,
})
