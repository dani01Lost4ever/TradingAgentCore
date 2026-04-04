import { useState } from 'react'

const SECTIONS = [
  { id: 'rsi',            label: 'RSI' },
  { id: 'macd',           label: 'MACD' },
  { id: 'bbands',         label: 'Bollinger Bands' },
  { id: 'ema',            label: 'EMA' },
  { id: 'atr',            label: 'ATR' },
  { id: 'kelly',          label: 'Kelly Criterion' },
  { id: 'sharpe',         label: 'Sharpe Ratio' },
  { id: 'sortino',        label: 'Sortino Ratio' },
  { id: 'sizing',         label: 'Position Sizing' },
  { id: 'stops',          label: 'Stop Loss / TP / Trailing' },
  { id: 'regime',         label: 'Market Regime' },
  { id: 'feargreed',      label: 'Fear & Greed' },
  { id: 'confidence',     label: 'Confidence Threshold' },
  { id: 'backtesting',    label: 'Backtesting' },
]

const s = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '24px 28px',
    marginBottom: 24,
  } as React.CSSProperties,
  heading: {
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '0.06em',
    marginBottom: 14,
  } as React.CSSProperties,
  body: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text)',
    lineHeight: 1.8,
  } as React.CSSProperties,
  muted: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--muted)',
    lineHeight: 1.7,
  } as React.CSSProperties,
  formula: {
    background: 'var(--bg3)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    padding: '10px 16px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--accent)',
    margin: '12px 0',
    display: 'block',
    letterSpacing: '0.04em',
    whiteSpace: 'pre-wrap',
  } as React.CSSProperties,
}

function Badge({ label, color }: { label: string; color: string }) {
  const bg = color === 'green' ? 'rgba(34,197,94,0.15)' : color === 'red' ? 'rgba(239,68,68,0.15)' : color === 'warn' ? 'rgba(245,158,11,0.15)' : 'rgba(var(--accent-rgb,0,212,170),0.12)'
  const fg = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--danger)' : color === 'warn' ? 'var(--warn)' : 'var(--accent)'
  const border = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--danger)' : color === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px', borderRadius: 4,
      background: bg, color: fg,
      border: `1px solid ${border}`,
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
      margin: '0 4px',
    }}>
      {label}
    </span>
  )
}

export function Wiki() {
  const [active, setActive] = useState('rsi')

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 52px)', background: 'var(--bg)' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220, flexShrink: 0, position: 'sticky', top: 52,
        height: 'calc(100vh - 52px)', overflowY: 'auto',
        background: 'var(--bg2)', borderRight: '1px solid var(--border)',
        padding: '20px 0',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.1em', padding: '0 20px 10px' }}>
          TRADING WIKI
        </div>
        {SECTIONS.map(sec => (
          <a
            key={sec.id}
            href={`#${sec.id}`}
            onClick={e => { e.preventDefault(); setActive(sec.id); document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth' }) }}
            style={{
              display: 'block', padding: '8px 20px',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: active === sec.id ? 'var(--accent)' : 'var(--muted)',
              background: active === sec.id ? 'rgba(var(--accent-rgb,0,212,170),0.07)' : 'transparent',
              borderLeft: active === sec.id ? '2px solid var(--accent)' : '2px solid transparent',
              textDecoration: 'none', transition: 'all 0.15s', cursor: 'pointer',
            }}
          >
            {sec.label}
          </a>
        ))}
      </aside>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', maxWidth: 860 }}>

        {/* RSI */}
        <div id="rsi" style={s.card}>
          <div style={s.heading}>RSI — Relative Strength Index</div>
          <p style={s.body}>
            RSI is a momentum oscillator that measures the speed and magnitude of recent price changes.
            It oscillates between 0 and 100 and is typically calculated over a 14-period window.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="RSI > 70 = Overbought" color="red" />
            <Badge label="RSI < 30 = Oversold" color="green" />
            <Badge label="RSI 40–60 = Neutral" color="accent" />
          </div>
          <p style={s.muted}>
            When RSI crosses above 70 the asset may be overextended and due for a pullback.
            When it falls below 30 it may be undervalued. The agent uses RSI 14 as one signal
            when deciding whether to buy, sell, or hold. High RSI alone does not guarantee a sell —
            it is combined with other indicators and the LLM reasoning step.
          </p>
          <code style={s.formula}>{'RSI = 100 - (100 / (1 + RS))\nRS  = Average Gain over N periods / Average Loss over N periods'}</code>
        </div>

        {/* MACD */}
        <div id="macd" style={s.card}>
          <div style={s.heading}>MACD — Moving Average Convergence Divergence</div>
          <p style={s.body}>
            MACD shows the relationship between two exponential moving averages (EMA 12 and EMA 26).
            The MACD line is the difference between them. The signal line is a 9-period EMA of the MACD line.
            The histogram shows the gap between MACD and its signal line.
          </p>
          <code style={s.formula}>{'MACD Line   = EMA(12) - EMA(26)\nSignal Line = EMA(9) of MACD Line\nHistogram   = MACD Line - Signal Line'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="MACD crosses above signal = Bullish" color="green" />
            <Badge label="MACD crosses below signal = Bearish" color="red" />
            <Badge label="Histogram expanding = Momentum building" color="warn" />
          </div>
          <p style={s.muted}>
            A bullish crossover (MACD line crossing above the signal line) is considered a buy signal.
            A bearish crossover suggests selling pressure. Divergence between price and MACD can signal
            trend reversals before they happen.
          </p>
        </div>

        {/* Bollinger Bands */}
        <div id="bbands" style={s.card}>
          <div style={s.heading}>Bollinger Bands</div>
          <p style={s.body}>
            Bollinger Bands consist of a middle band (SMA 20) and two outer bands placed two standard deviations
            above and below it. They expand during high volatility and contract during low volatility.
          </p>
          <code style={s.formula}>{'Upper Band = SMA(20) + 2 × StdDev\nMiddle     = SMA(20)\nLower Band = SMA(20) - 2 × StdDev\nBB%        = (Price - Lower) / (Upper - Lower)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="BB% near 1 = Near upper band (overbought)" color="red" />
            <Badge label="BB% near 0 = Near lower band (oversold)" color="green" />
            <Badge label="Squeeze = Volatility contraction" color="warn" />
          </div>
          <p style={s.muted}>
            A Bollinger squeeze (bands very tight) often precedes a large price move.
            BB% (percent bandwidth) normalises price within the bands: 0 = at lower band, 1 = at upper band.
            The agent uses BB% as part of the market snapshot fed to the LLM.
          </p>
        </div>

        {/* EMA */}
        <div id="ema" style={s.card}>
          <div style={s.heading}>EMA — Exponential Moving Average</div>
          <p style={s.body}>
            An EMA gives more weight to recent prices than a simple moving average, making it react faster
            to price changes. The agent tracks EMA 9 (short-term) and EMA 21 (medium-term).
          </p>
          <code style={s.formula}>{'EMA(t) = Price(t) × k + EMA(t-1) × (1 - k)\nwhere k = 2 / (N + 1)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="EMA9 > EMA21 = Uptrend" color="green" />
            <Badge label="EMA9 < EMA21 = Downtrend" color="red" />
            <Badge label="Crossover = Trend change signal" color="warn" />
          </div>
          <p style={s.muted}>
            When EMA 9 crosses above EMA 21 (golden cross) it signals an emerging uptrend.
            The opposite is a death cross. Price above both EMAs is generally bullish context.
            EMAs lag price, so they confirm trends rather than predict reversals.
          </p>
        </div>

        {/* ATR */}
        <div id="atr" style={s.card}>
          <div style={s.heading}>ATR — Average True Range</div>
          <p style={s.body}>
            ATR measures market volatility by decomposing the entire range of an asset price for a given period.
            It is the moving average (typically 14 periods) of the True Range.
          </p>
          <code style={s.formula}>{'True Range = max(High-Low, |High-PrevClose|, |Low-PrevClose|)\nATR(14)    = EMA(14) of True Range'}</code>
          <p style={s.muted}>
            The agent uses ATR for position sizing: higher volatility assets get a smaller position
            to normalise risk. For example, a position size proportional to Account Risk / ATR
            keeps dollar risk per trade roughly constant regardless of asset volatility.
            ATR can also be used to set dynamic stop-loss distances (e.g. 2× ATR from entry).
          </p>
        </div>

        {/* Kelly Criterion */}
        <div id="kelly" style={s.card}>
          <div style={s.heading}>Kelly Criterion</div>
          <p style={s.body}>
            The Kelly Criterion is a formula for bet sizing that maximises the expected logarithm of wealth.
            In trading, it tells you what fraction of capital to risk on a trade.
          </p>
          <code style={s.formula}>{'f* = (b × p - q) / b\n\nf* = optimal fraction of capital\nb  = net odds (profit per $1 risked, e.g. win_avg / loss_avg)\np  = probability of winning\nq  = 1 - p (probability of losing)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Full Kelly = aggressive, high variance" color="red" />
            <Badge label="Half Kelly = safer, recommended default" color="green" />
          </div>
          <p style={s.muted}>
            The agent uses half-Kelly by default to reduce volatility: it scales down the full Kelly
            fraction by 50%. Kelly sizing helps avoid the two failure modes: betting too little
            (leaving money on the table) and betting too much (risking ruin). When win rate is
            unreliable (few trades), Kelly can overfits to noise — use with caution early on.
          </p>
        </div>

        {/* Sharpe Ratio */}
        <div id="sharpe" style={s.card}>
          <div style={s.heading}>Sharpe Ratio</div>
          <p style={s.body}>
            The Sharpe Ratio measures risk-adjusted return: how much excess return you receive per unit
            of total volatility (standard deviation of returns).
          </p>
          <code style={s.formula}>{'Sharpe = (R_p - R_f) / σ_p\n\nR_p = portfolio return\nR_f = risk-free rate (often 0 for crypto)\nσ_p = standard deviation of returns (annualized)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Sharpe < 1 = Below average" color="red" />
            <Badge label="Sharpe 1–2 = Good" color="warn" />
            <Badge label="Sharpe > 2 = Excellent" color="green" />
          </div>
          <p style={s.muted}>
            A higher Sharpe means better return per unit of risk. Values above 1 are generally
            considered acceptable; above 2 is excellent. Be wary of very high Sharpe ratios in
            backtests — they may indicate overfitting. Sharpe penalises upside and downside
            volatility equally, which is why Sortino is often preferred for asymmetric strategies.
          </p>
        </div>

        {/* Sortino Ratio */}
        <div id="sortino" style={s.card}>
          <div style={s.heading}>Sortino Ratio</div>
          <p style={s.body}>
            The Sortino Ratio is similar to Sharpe but only penalises downside deviation
            (negative returns), not upside volatility. This makes it more appropriate for
            strategies with skewed return distributions.
          </p>
          <code style={s.formula}>{'Sortino = (R_p - R_f) / σ_d\n\nσ_d = downside deviation (std dev of negative returns only)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Sortino > Sharpe = Good upside skew" color="green" />
            <Badge label="Sortino ≈ Sharpe = Symmetric returns" color="warn" />
          </div>
          <p style={s.muted}>
            When your strategy has large upside outliers (e.g. catching strong breakouts),
            Sortino will score it better than Sharpe. Use Sortino when you care more about
            downside risk than total volatility. A Sortino ratio above 2 indicates excellent
            risk-adjusted performance on the downside.
          </p>
        </div>

        {/* Position Sizing */}
        <div id="sizing" style={s.card}>
          <div style={s.heading}>Position Sizing</div>
          <p style={s.body}>
            Position sizing determines how much capital to allocate to each trade.
            It is one of the most important risk management decisions.
          </p>
          <code style={s.formula}>{'ATR-based:  Size = (Account × Risk%) / ATR\nKelly-based: Size = Kelly fraction × Available capital\nMax cap:    Size = min(Size, MaxPositionPct × Account)'}</code>
          <p style={s.muted}>
            The agent supports two sizing modes, configured in Settings:
          </p>
          <ul style={{ ...s.muted, paddingLeft: 20, margin: '8px 0' }}>
            <li><strong style={{ color: 'var(--text)' }}>Fixed %:</strong> Each trade uses a fixed percentage of available capital.</li>
            <li><strong style={{ color: 'var(--text)' }}>ATR-scaled:</strong> Volatile assets get smaller positions to normalise dollar risk.</li>
            <li><strong style={{ color: 'var(--text)' }}>Kelly (optional):</strong> Scales the base size by the Kelly fraction derived from recent win rate and P&L ratio.</li>
          </ul>
          <p style={s.muted}>
            The max open positions limit acts as a hard cap regardless of sizing formula.
            Over-diversification can reduce returns; under-diversification increases single-position risk.
          </p>
        </div>

        {/* Stop Loss / Take Profit / Trailing Stop */}
        <div id="stops" style={s.card}>
          <div style={s.heading}>Stop Loss / Take Profit / Trailing Stop</div>
          <p style={s.body}>
            These are automatic exit orders that protect profits and limit losses.
          </p>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>Stop Loss</div>
            <p style={s.muted}>
              Closes the position when price falls X% below entry. Limits the maximum loss on a single trade.
              Set too tight and you get stopped out by normal noise. Set too wide and losses become large.
              Typical range: 2–8% depending on asset volatility.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', marginBottom: 6 }}>Take Profit</div>
            <p style={s.muted}>
              Closes the position when price rises X% above entry. Locks in gains before a reversal.
              Should generally be larger than stop loss (reward:risk ratio &gt; 1). Typical: 5–20%.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)', marginBottom: 6 }}>Trailing Stop</div>
            <p style={s.muted}>
              A dynamic stop loss that moves up with price. It triggers when price drops X% from its
              highest point since entry. Allows you to ride a trend while protecting gains.
              For example, a 5% trailing stop on a position that has risen 20% will trigger at 15% gain
              (20% - 5%), rather than at the original stop price.
            </p>
          </div>
          <code style={s.formula}>{'Trailing stop trigger = Peak price since entry × (1 - trailingStopPct / 100)'}</code>
        </div>

        {/* Market Regime */}
        <div id="regime" style={s.card}>
          <div style={s.heading}>Market Regime</div>
          <p style={s.body}>
            Market regime describes the overall state of the market: bull (uptrend), bear (downtrend),
            or sideways (ranging). The agent attempts to detect regime to adjust its behaviour.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="BTC > SMA50 = Bull regime" color="green" />
            <Badge label="BTC < SMA50 = Bear regime" color="red" />
            <Badge label="Low volatility, tight range = Sideways" color="warn" />
          </div>
          <p style={s.muted}>
            Bitcoin is used as the primary regime indicator because it has the highest correlation with
            the broader crypto market. When BTC is above its 50-period SMA, the agent is more likely to
            take long positions. In a bear regime it may reduce position sizes or shift to more
            conservative thresholds.
          </p>
        </div>

        {/* Fear & Greed */}
        <div id="feargreed" style={s.card}>
          <div style={s.heading}>Fear & Greed Index</div>
          <p style={s.body}>
            The Crypto Fear & Greed Index aggregates multiple data sources (volatility, market momentum,
            social media, dominance, trends) into a single 0–100 sentiment score.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="0–24 = Extreme Fear" color="green" />
            <Badge label="25–49 = Fear" color="warn" />
            <Badge label="50–74 = Greed" color="warn" />
            <Badge label="75–100 = Extreme Greed" color="red" />
          </div>
          <p style={s.muted}>
            Contrarian signal: extreme fear often precedes reversals to the upside; extreme greed
            often precedes corrections. The classic adage: "Be fearful when others are greedy, and
            greedy when others are fearful." The agent includes the Fear & Greed value in its market
            context snapshot when making trade decisions.
          </p>
        </div>

        {/* Confidence Threshold */}
        <div id="confidence" style={s.card}>
          <div style={s.heading}>Confidence Threshold</div>
          <p style={s.body}>
            The confidence threshold filters out low-conviction trade signals. When the LLM returns a
            trade decision, it also returns a confidence value between 0 and 1. If the confidence is
            below the threshold, the trade is skipped.
          </p>
          <code style={s.formula}>{'0    = No filter (all trades pass)\n0.5  = Only take trades with ≥50% confidence\n0.75 = Only high-conviction signals\n1.0  = Nothing passes (effectively disables trading)'}</code>
          <p style={s.muted}>
            A higher threshold reduces trade frequency but may improve win rate by only trading when
            the agent is confident. A threshold of 0 allows all signals through. Tuning this value
            is a trade-off between selectivity and opportunity capture. Start at 0, observe the win
            rate on low-confidence trades, then raise the threshold if those trades underperform.
          </p>
        </div>

        {/* Backtesting */}
        <div id="backtesting" style={s.card}>
          <div style={s.heading}>Backtesting</div>
          <p style={s.body}>
            Backtesting simulates a strategy on historical data to estimate how it would have performed.
            The agent supports two backtest modes:
          </p>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>Rules Mode</div>
            <p style={s.muted}>
              Fast, deterministic backtesting using pure technical indicator rules (RSI, MACD, EMA crossovers).
              No LLM calls, so it runs in seconds. Good for testing indicator combinations.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>LLM Mode</div>
            <p style={s.muted}>
              Replays each time period with the LLM making decisions as if it were live. Much slower and
              costs API credits, but tests the actual model you will run in production.
            </p>
          </div>
          <div style={{ margin: '14px 0', background: 'rgba(239,68,68,0.07)', border: '1px solid var(--danger)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.06em', marginBottom: 4 }}>OVERFITTING WARNING</div>
            <p style={{ ...s.muted, margin: 0 }}>
              Backtests are always optimistic. The model "sees" history it was never meant to see.
              Do not optimise parameters on the same data you evaluate on. Use walk-forward testing:
              optimise on train set, evaluate on unseen forward period. High Sharpe on backtest +
              poor live performance = overfitting.
            </p>
          </div>
          <p style={s.muted}>
            Key metrics to evaluate: Total Return, Max Drawdown, Win Rate, Sharpe Ratio, Sortino Ratio.
            A good backtest result is not sufficient — live market conditions include slippage,
            latency, liquidity constraints, and regime shifts that historical data may not capture.
          </p>
        </div>

      </div>
    </div>
  )
}
