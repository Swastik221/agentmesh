import { HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from '@x402/hedera';

export const PAYMENT_CONFIG = {
  get NETWORK() {
    return process.env.HEDERA_NETWORK || HEDERA_TESTNET_CAIP2 || 'hedera:testnet';
  },
  get USDC_TOKEN_ID() {
    return process.env.HEDERA_USDC_TOKEN_ID || HEDERA_TESTNET_USDC || '0.0.429274';
  },
  USDC_DECIMALS: HEDERA_USDC_DECIMALS || 6,
  get RECEIVER_ADDRESS() {
    return process.env.HEDERA_PAYMENT_RECEIVER || '0.0.9185802';
  },
  DEFAULT_PRICE_USDC: '0.001',
  DEFAULT_ATOMIC_AMOUNT: '1000', // 0.001 USDC * 10^6
  get FACILITATOR_URL() {
    return process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
  },
  SCHEME: 'exact',
};
