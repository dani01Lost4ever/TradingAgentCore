import { AlpacaAdapter } from './alpaca'
import { BinanceAdapter } from './binance'
import { CoinbaseAdapter } from './coinbase'
import { IBKRAdapter } from './ibkr'
import { BitpandaAdapter } from './bitpanda'
import type { ExchangeAdapter } from './adapter'
import type { WalletDoc } from '../schema'

export { ExchangeAdapter } from './adapter'
export type { Portfolio, PositionDetail, OrderResult, Decision } from './adapter'

export function createAdapter(wallet: WalletDoc): ExchangeAdapter {
  const mode = (wallet as any).mode ?? 'paper'
  switch ((wallet as any).exchange ?? 'alpaca') {
    case 'binance':
      return new BinanceAdapter((wallet as any).binance_api_key || '', (wallet as any).binance_api_secret || '', mode)
    case 'coinbase':
      return new CoinbaseAdapter((wallet as any).coinbase_api_key || '', (wallet as any).coinbase_api_secret || '', mode)
    case 'ibkr':
      return new IBKRAdapter(
        (wallet as any).ibkr_gateway_url || 'http://localhost:5000',
        (wallet as any).ibkr_session_token || '',
        mode,
      )
    case 'bitpanda':
      return new BitpandaAdapter(
        (wallet as any).bitpanda_api_key || '',
        (wallet as any).bitpanda_api_secret || '',
        mode,
      )
    case 'alpaca':
    default:
      return new AlpacaAdapter(wallet.alpaca_api_key, wallet.alpaca_api_secret, mode, wallet.alpaca_base_url)
  }
}
