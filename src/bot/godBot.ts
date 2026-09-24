import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type GodConfig = {
    stake: number;
    targetProfit: number;
    stopLoss: number;
    runs: number;
    scanWindow?: number;
    minimumSampleSize?: number;
    minimumConfidence?: number;
};

export type GodMarket = {
    symbol: string;
    name: string;
    score: number;
    confidence: number;
    evenRate: number;
    oddRate: number;
    sampleSize: number;
};

export type GodTradeResult = {
    symbol: string;
    contractType: 'DIGITEVEN' | 'DIGITODD';
    entryDigit: number;
    profit: number;
    result: 'profit' | 'loss';
};

type TradeEngine = any;

const DEFAULT_CONFIG: Required<GodConfig> = {
    stake: 1,
    targetProfit: 0,
    stopLoss: 0,
    runs: 2,
    scanWindow: 100,
    minimumSampleSize: 50,
    minimumConfidence: 0.7,
};

/**
 * GOD
 *
 * Strategy:
 * 1. Uses the existing Deriv connection.
 * 2. Scans synthetic markets.
 * 3. Calculates Even/Odd statistics.
 * 4. Selects the highest-scoring eligible market.
 * 5. Waits for 3 consecutive opposite-parity digits.
 * 6. Uses the existing TradeEngine for execution.
 *
 * This class deliberately does NOT create another WebSocket.
 */
export class GodBot {
    private tradeEngine: TradeEngine;

    private config: Required<GodConfig>;

    private running = false;

    private currentProfit = 0;

    private tradesExecuted = 0;

    private selectedMarket: GodMarket | null = null;

    private stopReason = '';

    constructor(tradeEngine: TradeEngine, config: GodConfig) {
        this.tradeEngine = tradeEngine;

        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            runs: Math.max(1, Number(config.runs || 2)),
            stake: Math.max(0, Number(config.stake || 0)),
        };
    }

    /**
     * Start GOD.
     */
    async start(): Promise<void> {
        if (this.running) return;

        this.running = true;
        this.currentProfit = 0;
        this.tradesExecuted = 0;
        this.stopReason = '';

        try {
            for (let run = 0; run < this.config.runs; run += 1) {
                if (!this.running) break;

                if (this.shouldStop()) break;

                const market = await this.scanMarkets();

                if (!market) {
                    this.stopReason = 'No valid market reached the confidence threshold.';
                    break;
                }

                this.selectedMarket = market;

                console.log(
                    '[GOD] Selected market:',
                    market.symbol,
                    'confidence:',
                    market.confidence
                );

                const contractType = await this.waitForSignal(market.symbol);

                if (!this.running || !contractType) break;

                const result = await this.executeUsingTradeEngine(
                    market.symbol,
                    contractType
                );

                if (!result) break;

                this.currentProfit += Number(result.profit || 0);
                this.tradesExecuted += 1;

                if (result.profit > 0) {
                    console.log('GOD ABOVE');
                } else {
                    console.log('GOD NEVER FAILS');
                }

                if (this.shouldStop()) break;
            }
        } catch (error) {
            console.error('[GOD] Error:', error);
            this.stopReason = 'Execution error';
        } finally {
            this.running = false;
        }
    }

    /**
     * Stop GOD.
     */
    stop(): void {
        this.running = false;
        this.stopReason = 'Stopped by user.';
    }

    isRunning(): boolean {
        return this.running;
    }

    getProfit(): number {
        return this.currentProfit;
    }

    getTradesExecuted(): number {
        return this.tradesExecuted;
    }

    getSelectedMarket(): GodMarket | null {
        return this.selectedMarket;
    }

    getStopReason(): string {
        return this.stopReason;
    }

    /**
     * Scan eligible synthetic markets using the existing Deriv API connection.
     */
    private async scanMarkets(): Promise<GodMarket | null> {
        const response = await this.sendRequest({
            active_symbols: 'brief',
            product_type: 'basic',
        });

        const symbols = Array.isArray(response?.active_symbols)
            ? response.active_symbols
            : [];

        const candidates = symbols.filter((market: any) => {
            const symbol = String(market.symbol || '');
            const marketName = String(market.display_name || '');

            return (
                market.is_trading &&
                this.isSynthetic(symbol, marketName)
            );
        });

        const scoredMarkets: GodMarket[] = [];

        for (const market of candidates) {
            if (!this.running) break;

            try {
                const result = await this.analyseMarket(
                    market.symbol,
                    market.display_name || market.symbol
                );

                if (result) {
                    scoredMarkets.push(result);
                }
            } catch (error) {
                console.warn(
                    '[GOD] Could not analyse',
                    market.symbol,
                    error
                );
            }
        }

        scoredMarkets.sort((a, b) => b.score - a.score);

        const best = scoredMarkets[0];

        if (!best) return null;

        if (best.confidence < this.config.minimumConfidence) {
            return null;
        }

        return best;
    }

    /**
     * Analyse one market.
     */
    private async analyseMarket(
        symbol: string,
        name: string
    ): Promise<GodMarket | null> {
        const response = await this.sendRequest({
            ticks_history: symbol,
            count: this.config.scanWindow,
            end: 'latest',
            style: 'ticks',
        });

        const prices = Array.isArray(response?.history?.prices)
            ? response.history.prices
            : [];

        if (prices.length < this.config.minimumSampleSize) {
            return null;
        }

        const digits = prices.map((price: number) =>
            this.extractLastDigit(price, symbol)
        );

        const evenCount = digits.filter(
            (digit: number) => digit % 2 === 0
        ).length;

        const oddCount = digits.length - evenCount;

        const evenRate = evenCount / digits.length;
        const oddRate = oddCount / digits.length;

        const parityEdge = Math.max(evenRate, oddRate);

        const recentDigits = digits.slice(-20);

        const recentEven =
            recentDigits.filter(
                (digit: number) => digit % 2 === 0
            ).length / recentDigits.length;

        const recentOdd = 1 - recentEven;

        const recentEdge = Math.max(recentEven, recentOdd);

        const streakScore = this.calculateStreakScore(digits);

        const stability = this.calculateStability(digits);

        /**
         * GOD scoring model from the XML:
         *
         * digit frequency  = 0.35
         * parity frequency = 0.30
         * streak           = 0.20
         * stability        = 0.15
         */
        const digitFrequencyScore = parityEdge;

        const parityFrequencyScore = recentEdge;

        const score =
            digitFrequencyScore * 0.35 +
            parityFrequencyScore * 0.30 +
            streakScore * 0.20 +
            stability * 0.15;

        return {
            symbol,
            name,
            score,
            confidence: Math.min(0.99, Math.max(0, score)),
            evenRate,
            oddRate,
            sampleSize: digits.length,
        };
    }

    /**
     * Wait until 3 consecutive digits of the same parity appear.
     *
     * 3 odd digits -> EVEN
     * 3 even digits -> ODD
     */
    private async waitForSignal(
        symbol: string
    ): Promise<'DIGITEVEN' | 'DIGITODD' | null> {
        let consecutiveOdd = 0;
        let consecutiveEven = 0;

        return new Promise(resolve => {
            let subscription: any = null;
            let resolved = false;

            const finish = (value: 'DIGITEVEN' | 'DIGITODD' | null) => {
                if (resolved) return;

                resolved = true;

                try {
                    if (subscription) {
                        subscription.unsubscribe?.();
                    }
                } catch {
                    // Ignore unsubscribe errors.
                }

                resolve(value);
            };

            const check = async () => {
                if (!this.running) {
                    finish(null);
                    return;
                }

                try {
                    const response = await this.sendRequest({
                        ticks_history: symbol,
                        count: 1,
                        end: 'latest',
                        style: 'ticks',
                    });

                    const prices = response?.history?.prices;

                    if (!Array.isArray(prices) || prices.length === 0) {
                        return;
                    }

                    const digit = this.extractLastDigit(
                        prices[prices.length - 1],
                        symbol
                    );

                    if (digit % 2 === 0) {
                        consecutiveEven += 1;
                        consecutiveOdd = 0;
                    } else {
                        consecutiveOdd += 1;
                        consecutiveEven = 0;
                    }

                    if (consecutiveOdd >= 3) {
                        finish('DIGITEVEN');
                    } else if (consecutiveEven >= 3) {
                        finish('DIGITODD');
                    }
                } catch (error) {
                    console.warn('[GOD] Signal error:', error);
                }
            };

            const interval = window.setInterval(check, 1000);

            subscription = {
                unsubscribe: () => {
                    window.clearInterval(interval);
                },
            };

            check();
        });
    }

    /**
     * Execute through the EXISTING Deriv TradeEngine.
     *
     * No new WebSocket is opened here.
     */
    private async executeUsingTradeEngine(
        symbol: string,
        contractType: 'DIGITEVEN' | 'DIGITODD'
    ): Promise<GodTradeResult | null> {
        if (!this.running) return null;

        try {
            console.log(
                '[GOD] Preparing trade:',
                symbol,
                contractType
            );

            /**
             * Change the existing engine's watched symbol.
             */
            await this.tradeEngine.watchTicks(symbol);

            /**
             * Set the selected symbol on the existing engine.
             */
            if (this.tradeEngine.options) {
                this.tradeEngine.options.symbol = symbol;
            }

            /**
             * Configure the stake for the existing engine.
             */
            const tradeOptions = {
                amount: this.config.stake,
                basis: 'stake',
                currency:
                    this.tradeEngine.tradeOptions?.currency ||
                    this.tradeEngine.accountInfo?.currency ||
                    'USD',
                duration: 1,
                duration_unit: 't',
                symbol,
                contract_type: contractType,
            };

            /**
             * Start the existing engine.
             */
            this.tradeEngine.start(tradeOptions);

            /**
             * Wait until the engine reaches the purchase stage.
             */
            await this.waitForEngineReady();

            if (!this.running) return null;

            /**
             * Use the existing purchase method.
             */
            await this.tradeEngine.purchase(contractType);

            /**
             * Wait for the existing OpenContract handler
             * to receive the result.
             */
            const result = await this.waitForContractResult();

            if (!result) return null;

            return {
                symbol,
                contractType,
                entryDigit: Number(result.entryDigit || 0),
                profit: Number(result.profit || 0),
                result:
                    Number(result.profit || 0) > 0
                        ? 'profit'
                        : 'loss',
            };
        } catch (error) {
            console.error('[GOD] Trade execution failed:', error);
            return null;
        }
    }

    /**
     * Wait for the existing engine to become ready.
     */
    private async waitForEngineReady(): Promise<void> {
        const maxWait = 15000;
        const started = Date.now();

        while (this.running) {
            const scope = this.tradeEngine.store?.getState?.()?.scope;

            if (
                scope === 'BEFORE_PURCHASE' ||
                String(scope).includes('BEFORE_PURCHASE')
            ) {
                return;
            }

            if (Date.now() - started >= maxWait) {
                throw new Error(
                    'Existing TradeEngine did not become ready.'
                );
            }

            await this.delay(250);
        }
    }

    /**
     * Wait for the existing contract state to close.
     */
    private async waitForContractResult(): Promise<any> {
        const maxWait = 120000;
        const started = Date.now();

        while (this.running) {
            const contract = this.tradeEngine.data?.contract;

            if (contract && contract.is_sold) {
                return {
                    entryDigit:
                        contract.entry_tick_display ??
                        contract.entry_tick ??
                        0,
                    profit: Number(
                        contract.profit ??
                        contract.sell_price -
                            contract.buy_price ??
                        0
                    ),
                };
            }

            if (Date.now() - started >= maxWait) {
                throw new Error(
                    'Timed out waiting for contract result.'
                );
            }

            await this.delay(250);
        }

        return null;
    }

    /**
     * Synthetic-index detection.
     */
    private isSynthetic(
        symbol: string,
        name: string
    ): boolean {
        const text =
            `${symbol} ${name}`.toLowerCase();

        return (
            text.includes('volatility') ||
            text.includes('boom') ||
            text.includes('crash') ||
            text.includes('step') ||
            text.includes('jump') ||
            text.includes('range') ||
            text.includes('drift') ||
            text.includes('bear') ||
            text.includes('bull') ||
            symbol.startsWith('1HZ')
        );
    }

    /**
     * Extract the final digit from a quote.
     */
    private extractLastDigit(
        price: number,
        symbol: string
    ): number {
        const pipSize =
            this.tradeEngine.$scope?.ticksService?.pipSizes?.[
                symbol
            ] ?? 2;

        const formatted = Number(price).toFixed(pipSize);

        return Number(formatted.slice(-1));
    }

    /**
     * Measure streak behaviour.
     */
    private calculateStreakScore(
        digits: number[]
    ): number {
        if (digits.length < 4) return 0;

        let total = 0;
        let matches = 0;

        for (let i = 1; i < digits.length; i += 1) {
            const previousParity = digits[i - 1] % 2;
            const currentParity = digits[i] % 2;

            total += 1;

            if (previousParity === currentParity) {
                matches += 1;
            }
        }

        return total ? matches / total : 0;
    }

    /**
     * Measure short-term stability.
     */
    private calculateStability(
        digits: number[]
    ): number {
        if (digits.length < 20) return 0;

        const first = digits.slice(0, 20);
        const last = digits.slice(-20);

        const firstEven =
            first.filter(digit => digit % 2 === 0).length /
            first.length;

        const lastEven =
            last.filter(digit => digit % 2 === 0).length /
            last.length;

        return Math.max(
            0,
            1 - Math.abs(firstEven - lastEven)
        );
    }

    private shouldStop(): boolean {
        if (
            this.config.targetProfit > 0 &&
            this.currentProfit >= this.config.targetProfit
        ) {
            this.stopReason = 'Target profit reached.';
            return true;
        }

        if (
            this.config.stopLoss > 0 &&
            this.currentProfit <= -Math.abs(this.config.stopLoss)
        ) {
            this.stopReason = 'Stop loss reached.';
            return true;
        }

        return false;
    }

    /**
     * Send requests through the EXISTING api_base connection.
     */
    private sendRequest(request: any): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const api = api_base.api;

                if (!api) {
                    reject(
                        new Error(
                            'Deriv API is not initialized.'
                        )
                    );
                    return;
                }

                let requestId: any;

                const timeout = window.setTimeout(() => {
                    try {
                        api.forget?.(requestId);
                    } catch {
                        // Ignore.
                    }

                    reject(
                        new Error(
                            'Deriv request timed out.'
                        )
                    );
                }, 15000);

                requestId = api.send(request);

                const subscription = api.onMessage(
                    (response: any) => {
                        if (
                            response?.msg_type === 'error'
                        ) {
                            window.clearTimeout(timeout);
                            subscription?.unsubscribe?.();
                            reject(
                                new Error(
                                    response.error?.message ||
                                        'Deriv API error'
                                )
                            );
                            return;
                        }

                        const matchesRequest =
                            response?.echo_req &&
                            Object.keys(request).some(
                                key =>
                                    response.echo_req[key] ===
                                    request[key]
                            );

                        if (!matchesRequest) return;

                        window.clearTimeout(timeout);
                        subscription?.unsubscribe?.();

                        resolve(response);
                    }
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve =>
            window.setTimeout(resolve, ms)
        );
    }
}

export default GodBot;
