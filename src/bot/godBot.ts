/* GOD Even/Odd bot engine
 * Derived from GOD.xml:
 * - default runs: 2
 * - scans synthetic-index markets
 * - keeps 100 recent ticks
 * - waits for 3 consecutive opposite-parity digits
 * - selects the higher observed parity frequency
 * - stops at target profit or stop loss
 *
 * IMPORTANT: this is a heuristic. It does not guarantee 90% accuracy or profit.
 * Pass an authenticated Deriv WebSocket token at runtime; never hard-code it.
 */

export type GodConfig = {
  appId: string;
  token: string;
  stake: number;
  targetProfit: number;
  stopLoss: number;
  runs?: number;
  scanWindow?: number;
  minimumSampleSize?: number;
  minimumConfidence?: number;
  maxConfidence?: number;
  maxMarketsToScan?: number;
  currency?: string;
  duration?: number;
};

export type MarketScore = {
  symbol: string;
  name: string;
  sampleSize: number;
  evenRate: number;
  oddRate: number;
  confidence: number;
  score: number;
  lastDigits: number[];
};

export type GodTradeResult = {
  symbol: string;
  contractType: 'DIGITEVEN' | 'DIGITODD';
  entryDigit?: number;
  status: 'won' | 'lost' | 'error';
  profit: number;
  contractId?: string | number;
  message: string;
};

type DerivMessage = Record<string, any>;

const WS_BASE = 'wss://ws.derivws.com/websockets/v3';

export class GodBot {
  private ws: WebSocket | null = null;
  private stopped = false;
  private running = false;
  private cumulativeProfit = 0;

  constructor(
    private readonly config: GodConfig,
    private readonly events: {
      onStatus?: (message: string) => void;
      onMarket?: (market: MarketScore) => void;
      onTrade?: (result: GodTradeResult) => void;
      onProfit?: (profit: number) => void;
      onError?: (error: Error) => void;
    } = {},
  ) {}

  private emitStatus(message: string) {
    this.events.onStatus?.(message);
  }

  private emitError(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.events.onError?.(err);
    this.emitStatus(`Error: ${err.message}`);
  }

  private request<T extends DerivMessage>(payload: DerivMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Deriv WebSocket is not connected.'));
        return;
      }

      const reqId = Math.floor(Math.random() * 2_000_000_000);
      const timer = window.setTimeout(
        () =>
          reject(
            new Error(
              `Deriv request timed out: ${
                payload.proposal ? 'proposal' : 'request'
              }`,
            ),
          ),
        15_000,
      );

      const handler = (event: MessageEvent) => {
        let msg: DerivMessage;

        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.req_id !== reqId) return;

        window.clearTimeout(timer);
        this.ws?.removeEventListener('message', handler);

        if (msg.error) {
          reject(new Error(msg.error.message || 'Deriv API error'));
        } else {
          resolve(msg as T);
        }
      };

      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
    });
  }

  private async connect() {
    this.ws = new WebSocket(
      `${WS_BASE}?app_id=${encodeURIComponent(this.config.appId)}`,
    );

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        return reject(new Error('Unable to create WebSocket.'));
      }

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Unable to connect to Deriv.'));
      };

      const cleanup = () => {
        this.ws?.removeEventListener('open', onOpen);
        this.ws?.removeEventListener('error', onError);
      };

      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
    });

    await this.request({
      authorize: this.config.token,
    });

    this.emitStatus('Connected and authorized with Deriv.');
  }

  private async getSyntheticMarkets() {
    const response = await this.request<any>({
      active_symbols: 'brief',
      product_type: 'basic',
    });

    const symbols = Array.isArray(response.active_symbols)
      ? response.active_symbols
      : [];

    return symbols
      .filter((s: any) => {
        const market = String(s.market || '').toLowerCase();
        const symbol = String(s.symbol || '');

        return (
          market.includes('synthetic') ||
          /^1HZ|^R_/.test(symbol)
        );
      })
      .slice(0, this.config.maxMarketsToScan ?? 15);
  }

  private async getDigits(
    symbol: string,
    count: number,
  ): Promise<number[]> {
    const response = await this.request<any>({
      ticks_history: symbol,
      style: 'ticks',
      count,
      end: 'latest',
    });

    const prices = response.history?.prices;

    if (!Array.isArray(prices)) return [];

    return prices
      .map((price: string | number) => {
        const text = String(price);
        const last = text.replace(/\D/g, '').slice(-1);

        return Number(last);
      })
      .filter(Number.isInteger);
  }

  private score(
    symbol: any,
    digits: number[],
  ): MarketScore | null {
    if (
      digits.length <
      (this.config.minimumSampleSize ?? 50)
    ) {
      return null;
    }

    const evens = digits.filter(
      (d) => d % 2 === 0,
    ).length;

    const odds = digits.length - evens;

    const evenRate = evens / digits.length;
    const oddRate = odds / digits.length;

    // This is a descriptive confidence score,
    // not a guarantee of future accuracy.
    const parityEdge = Math.abs(
      evenRate - oddRate,
    );

    const recent = digits.slice(-20);

    const recentEvens = recent.filter(
      (d) => d % 2 === 0,
    ).length;

    const recentOdds =
      recent.length - recentEvens;

    const recentEdge = recent.length
      ? Math.abs(
          recentEvens / recent.length -
            recentOdds / recent.length,
        )
      : 0;

    const confidence = Math.min(
      this.config.maxConfidence ?? 0.90,
      0.50 +
        parityEdge * 0.35 +
        recentEdge * 0.15,
    );

    const score =
      parityEdge * 0.55 +
      recentEdge * 0.25 +
      Math.min(digits.length / 100, 1) * 0.20;

    return {
      symbol: symbol.symbol,
      name: symbol.display_name || symbol.symbol,
      sampleSize: digits.length,
      evenRate,
      oddRate,
      confidence,
      score,
      lastDigits: digits.slice(-20),
    };
  }

  private async scan(): Promise<MarketScore | null> {
    this.emitStatus(
      'Scanning synthetic-index markets...',
    );

    const markets =
      await this.getSyntheticMarkets();

    const scored: MarketScore[] = [];

    for (const market of markets) {
      if (this.stopped) return null;

      try {
        const digits = await this.getDigits(
          market.symbol,
          this.config.scanWindow ?? 100,
        );

        const result = this.score(
          market,
          digits,
        );

        if (result) {
          scored.push(result);
          this.events.onMarket?.(result);
        }
      } catch (error) {
        this.emitStatus(
          `Skipped ${market.symbol}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    scored.sort(
      (a, b) => b.score - a.score,
    );

    const best = scored[0];

    if (
      !best ||
      best.confidence <
        (this.config.minimumConfidence ?? 0.70)
    ) {
      this.emitStatus(
        'No market met the configured confidence threshold. No trade opened.',
      );

      return null;
    }

    this.emitStatus(
      `Selected ${best.symbol} — observed even ${(
        best.evenRate * 100
      ).toFixed(1)}%, odd ${(
        best.oddRate * 100
      ).toFixed(1)}%, confidence ${(
        best.confidence * 100
      ).toFixed(1)}%.`,
    );

    return best;
  }

  private async waitForTrigger(
    symbol: string,
  ): Promise<{
    type: 'DIGITEVEN' | 'DIGITODD';
    digit: number;
  }> {
    this.emitStatus(
      `Watching ${symbol} for 3 consecutive opposite-parity digits...`,
    );

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        return reject(
          new Error('WebSocket is not connected.'),
        );
      }

      const reqId = Math.floor(
        Math.random() * 2_000_000_000,
      );

      let subscriptionId: string | undefined;
      let oppositeRun = 0;

      let lastParity:
        | 'even'
        | 'odd'
        | null = null;

      const finish = (
        value?: {
          type: 'DIGITEVEN' | 'DIGITODD';
          digit: number;
        },
        error?: Error,
      ) => {
        if (subscriptionId) {
          try {
            this.ws?.send(
              JSON.stringify({
                forget: subscriptionId,
              }),
            );
          } catch {}
        }

        this.ws?.removeEventListener(
          'message',
          handler,
        );

        if (error) {
          reject(error);
        } else if (value) {
          resolve(value);
        }
      };

      const handler = (
        event: MessageEvent,
      ) => {
        let msg: DerivMessage;

        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (
          msg.req_id === reqId &&
          msg.error
        ) {
          finish(
            undefined,
            new Error(
              msg.error.message ||
                'Tick subscription failed',
            ),
          );

          return;
        }

        if (msg.subscription?.id) {
          subscriptionId =
            msg.subscription.id;
        }

        if (msg.msg_type !== 'tick') return;

        const quote = msg.tick?.quote;

        if (quote === undefined) return;

        const digit = Number(
          String(quote)
            .replace(/\D/g, '')
            .slice(-1),
        );

        if (!Number.isInteger(digit)) return;

        const parity:
          | 'even'
          | 'odd' =
          digit % 2 === 0
            ? 'even'
            : 'odd';

        if (lastParity === parity) {
          oppositeRun += 1;
        } else {
          lastParity = parity;
          oppositeRun = 1;
        }

        if (oppositeRun >= 3) {
          // Three odds -> EVEN.
          // Three evens -> ODD.
          finish({
            type:
              parity === 'odd'
                ? 'DIGITEVEN'
                : 'DIGITODD',
            digit,
          });
        }
      };

      this.ws.addEventListener(
        'message',
        handler,
      );

      this.ws.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1,
          req_id: reqId,
        }),
      );
    });
  }

  private async executeTrade(
    market: MarketScore,
    trigger: {
      type: 'DIGITEVEN' | 'DIGITODD';
      digit: number;
    },
  ): Promise<GodTradeResult> {
    const proposal =
      await this.request<any>({
        proposal: 1,
        amount: this.config.stake,
        basis: 'stake',
        contract_type: trigger.type,
        currency:
          this.config.currency ?? 'USD',
        duration:
          this.config.duration ?? 1,
        duration_unit: 't',
        symbol: market.symbol,
      });

    const proposalId =
      proposal.proposal?.id;

    if (!proposalId) {
      throw new Error(
        'Deriv did not return a proposal id.',
      );
    }

    const buy =
      await this.request<any>({
        buy: proposalId,
        price: this.config.stake,
      });

    const contractId =
      buy.buy?.contract_id;

    if (!contractId) {
      throw new Error(
        'Deriv did not return a contract id.',
      );
    }

    this.emitStatus(
      `Trade executed: ${trigger.type} on ${market.symbol}, entry digit ${trigger.digit}.`,
    );

    return await this.waitForContract(
      contractId,
      market.symbol,
      trigger,
    );
  }

  private async waitForContract(
    contractId: string | number,
    symbol: string,
    trigger: {
      type: 'DIGITEVEN' | 'DIGITODD';
      digit: number;
    },
  ): Promise<GodTradeResult> {
    return new Promise(
      (resolve, reject) => {
        if (!this.ws) {
          return reject(
            new Error(
              'WebSocket is not connected.',
            ),
          );
        }

        const reqId = Math.floor(
          Math.random() * 2_000_000_000,
        );

        const handler = (
          event: MessageEvent,
        ) => {
          let msg: DerivMessage;

          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }

          if (
            msg.req_id === reqId &&
            msg.error
          ) {
            this.ws?.removeEventListener(
              'message',
              handler,
            );

            reject(
              new Error(
                msg.error.message ||
                  'Contract stream failed',
              ),
            );

            return;
          }

          if (
            msg.msg_type !==
            'proposal_open_contract'
          ) {
            return;
          }

          const poc =
            msg.proposal_open_contract;

          if (
            String(poc?.contract_id) !==
            String(contractId)
          ) {
            return;
          }

          if (!poc?.is_sold) return;

          this.ws?.removeEventListener(
            'message',
            handler,
          );

          const profit = Number(
            poc.profit ?? 0,
          );

          const won = profit > 0;

          const result: GodTradeResult = {
            symbol,
            contractType:
              trigger.type,
            entryDigit:
              trigger.digit,
            status: won
              ? 'won'
              : 'lost',
            profit,
            contractId,
            message: won
              ? 'GOD ABOVE'
              : 'GOD NEVER FAILS',
          };

          resolve(result);
        };

        this.ws.addEventListener(
          'message',
          handler,
        );

        this.ws.send(
          JSON.stringify({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
            req_id: reqId,
          }),
        );
      },
    );
  }

  async start() {
    if (this.running) {
      throw new Error(
        'GOD bot is already running.',
      );
    }

    this.running = true;
    this.stopped = false;
    this.cumulativeProfit = 0;

    const maxRuns =
      this.config.runs ?? 2;

    try {
      await this.connect();

      for (
        let run = 1;
        run <= maxRuns;
        run += 1
      ) {
        if (this.stopped) break;

        if (
          this.cumulativeProfit >=
          this.config.targetProfit
        ) {
          this.emitStatus(
            'Target profit reached. Bot stopped.',
          );

          break;
        }

        if (
          this.cumulativeProfit <=
          -Math.abs(
            this.config.stopLoss,
          )
        ) {
          this.emitStatus(
            'Stop loss reached. Bot stopped.',
          );

          break;
        }

        this.emitStatus(
          `Run ${run}/${maxRuns}: scanning...`,
        );

        const market =
          await this.scan();

        if (!market) continue;

        const trigger =
          await this.waitForTrigger(
            market.symbol,
          );

        if (this.stopped) break;

        const result =
          await this.executeTrade(
            market,
            trigger,
          );

        this.cumulativeProfit +=
          result.profit;

        this.events.onTrade?.(
          result,
        );

        this.events.onProfit?.(
          this.cumulativeProfit,
        );

        if (
          result.status === 'won'
        ) {
          this.emitStatus(
            'GOD ABOVE',
          );
        } else {
          this.emitStatus(
            'GOD NEVER FAILS',
          );
        }
      }
    } catch (error) {
      this.emitError(error);
    } finally {
      this.running = false;

      this.ws?.close();
      this.ws = null;

      this.emitStatus(
        'GOD bot stopped.',
      );
    }
  }

  stop() {
    this.stopped = true;

    this.emitStatus(
      'Stopping GOD bot...',
    );
  }
}
