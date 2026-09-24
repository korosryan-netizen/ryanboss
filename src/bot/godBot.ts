import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { doUntilDone } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

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

    async start(): Promise<void> {
        if (this.running) return;

        if (!api_base.api || !api_base.is_authorized) {
            throw new Error('Deriv account is not authorized.');
        }

        this.running = true;
        this.currentProfit = 0;
        this.tradesExecuted = 0;
        this.stopReason = '';

        try {
            for (let run = 0; run < this.config.runs; run += 1) {
                if (!this.running || this.shouldStop()) break;

                console.log(`[GOD] Starting run ${run + 1}/${this.config.runs}`);

                const market = await this.scanMarkets();

                if (!market) {
                    this.stopReason =
                        'No market reached the required confidence threshold.';
                    break;
                }

                this.selectedMarket = market;

                console.log('[GOD] Selected market:', market);

                const contractType = await this.waitForSignal(
                    market.symbol
                );

                if (!this.running || !contractType) break;

                const result = await this.executeUsingTradeEngine(
                    market.symbol,
                    contractType
                );

                if (!result) break;

                this.currentProfit += result.profit;
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
            this.stopReason = 'Execution error.';
        } finally {
            this.running = false;
        }
    }

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

    private async scanMarkets(): Promise<GodMarket | null> {
        const response = await this.request({
            active_symbols: 'brief',
            product_type: 'basic',
        });

        const symbols = Array.isArray(response?.active_symbols)
            ? response.active_symbols
            : [];

        const candidates = symbols.filter((market: any) => {
            const symbol = String(market.symbol || '');
            const name = String(market.display_name || '');

            return (
                market.is_trading &&
                this.isSynthetic(symbol, name)
            );
        });

        const scored: GodMarket[] = [];

        for (const market of candidates) {
            if (!this.running) break;

            try {
                const result = await this.analyseMarket(
                    market.symbol,
                    market.display_name || market.symbol
                );

                if (result) scored.push(result);
            } catch (error) {
                console.warn(
                    `[GOD] Failed to analyse ${market.symbol}`,
                    error
                );
            }
        }

        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];

        if (!best) return null;

        if (best.confidence < this.config.minimumConfidence) {
            return null;
        }

        return best;
    }

    private async analyseMarket(
        symbol: string,
        name: string
    ): Promise<GodMarket | null> {
        const response = await this.request({
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
            digit => digit % 2 === 0
        ).length;

        const oddCount = digits.length - evenCount;

        const evenRate = evenCount / digits.length;
        const oddRate = oddCount / digits.length;

        const parityFrequency = Math.max(
            evenRate,
            oddRate
        );

        const recentDigits = digits.slice(-20);

        const recentEven =
            recentDigits.filter(
                digit => digit % 2 === 0
            ).length / recentDigits.length;

        const recentOdd = 1 - recentEven;

        const recentFrequency = Math.max(
            recentEven,
            recentOdd
        );

        const streakScore =
            this.calculateStreakScore(digits);

        const stability =
            this.calculateStability(digits);

        /*
         * GOD XML weighting:
         *
         * Digit frequency: 35%
         * Parity frequency: 30%
         * Streak: 20%
         * Stability: 15%
         */
        const score =
            parityFrequency * 0.35 +
            recentFrequency * 0.30 +
            streakScore * 0.20 +
            stability * 0.15;

        return {
            symbol,
            name,
            score,
            confidence: Math.min(0.99, score),
            evenRate,
            oddRate,
            sampleSize: digits.length,
        };
    }

    private async waitForSignal(
        symbol: string
    ): Promise<'DIGITEVEN' | 'DIGITODD' | null> {
        let consecutiveOdd = 0;
        let consecutiveEven = 0;
        let lastProcessedQuote: number | null = null;

        console.log(
            `[GOD] Waiting for 3 consecutive same-parity digits on ${symbol}`
        );

        while (this.running) {
            try {
                const response = await this.request({
                    ticks_history: symbol,
                    count: 1,
                    end: 'latest',
                    style: 'ticks',
                });

                const prices = response?.history?.prices;

                if (!Array.isArray(prices) || !prices.length) {
                    await this.delay(1000);
                    continue;
                }

                const price = Number(prices[prices.length - 1]);

                /*
                 * Avoid counting the same tick repeatedly.
                 */
                if (lastProcessedQuote === price) {
                    await this.delay(1000);
                    continue;
                }

                lastProcessedQuote = price;

                const digit = this.extractLastDigit(
                    price,
                    symbol
                );

                console.log(
                    `[GOD] ${symbol} tick digit: ${digit}`
                );

                if (digit % 2 === 0) {
                    consecutiveEven += 1;
                    consecutiveOdd = 0;
                } else {
                    consecutiveOdd += 1;
                    consecutiveEven = 0;
                }

                if (consecutiveOdd >= 3) {
                    console.log(
                        '[GOD] Three ODD digits detected → EVEN'
                    );

                    return 'DIGITEVEN';
                }

                if (consecutiveEven >= 3) {
                    console.log(
                        '[GOD] Three EVEN digits detected → ODD'
                    );

                    return 'DIGITODD';
                }
            } catch (error) {
                console.warn(
                    '[GOD] Signal scanner error:',
                    error
                );
            }

            await this.delay(1000);
        }

        return null;
    }

    private async executeUsingTradeEngine(
        symbol: string,
        contractType: 'DIGITEVEN' | 'DIGITODD'
    ): Promise<GodTradeResult | null> {
        if (!this.running) return null;

        console.log(
            `[GOD] Executing ${contractType} on ${symbol}`
        );

        try {
            /*
             * Reuse the SAME TradeEngine already created
             * by the Deriv Bot application.
             */
            await this.tradeEngine.watchTicks(symbol);

            if (this.tradeEngine.options) {
                this.tradeEngine.options.symbol = symbol;
            }

            const existingCurrency =
                this.tradeEngine.tradeOptions?.currency ||
                this.tradeEngine.accountInfo?.currency ||
                api_base.account_info?.currency ||
                'USD';

            const tradeOptions = {
                amount: this.config.stake,
                basis: 'stake',
                currency: existingCurrency,
                duration: 1,
                duration_unit: 't',
                symbol,
                contract_type: contractType,
            };

            /*
             * Let the existing TradeEngine prepare the contract.
             */
            this.tradeEngine.start(tradeOptions);

            await this.waitForEngineReady();

            if (!this.running) return null;

            /*
             * Existing TradeEngine purchase.
             */
            await this.tradeEngine.purchase(contractType);

            /*
             * Existing OpenContract system supplies the result.
             */
            const contract = await this.waitForContractResult();

            if (!contract) return null;

            const profit = Number(
                contract.profit ?? 0
            );

            return {
                symbol,
                contractType,
                entryDigit: Number(
                    contract.entryDigit ?? 0
                ),
                profit,
                result:
                    profit > 0
                        ? 'profit'
                        : 'loss',
            };
        } catch (error) {
            console.error(
                '[GOD] Trade execution failed:',
                error
            );

            return null;
        }
    }

    private async waitForEngineReady(): Promise<void> {
        const timeout = 15000;
        const started = Date.now();

        while (this.running) {
            const state =
                this.tradeEngine.store?.getState?.();

            const scope = state?.scope;

            if (
                scope === 'BEFORE_PURCHASE' ||
                String(scope).includes(
                    'BEFORE_PURCHASE'
                )
            ) {
                return;
            }

            if (Date.now() - started > timeout) {
                throw new Error(
                    'TradeEngine did not become ready.'
                );
            }

            await this.delay(250);
        }
    }

    private async waitForContractResult(): Promise<any> {
        const timeout = 120000;
        const started = Date.now();

        while (this.running) {
            const contract =
                this.tradeEngine.data?.contract;

            if (contract?.is_sold) {
                const profit = Number(
                    contract.profit ??
                    (
                        Number(contract.sell_price || 0) -
                        Number(contract.buy_price || 0)
                    )
                );

                return {
                    entryDigit:
                        contract.entry_tick_display ??
                        contract.entry_tick ??
                        0,
                    profit,
                };
            }

            if (Date.now() - started > timeout) {
                throw new Error(
                    'Timed out waiting for contract result.'
                );
            }

            await this.delay(250);
        }

        return null;
    }

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
            symbol.startsWith('1HZ')
        );
    }

    private extractLastDigit(
        price: number,
        symbol: string
    ): number {
        const pipSize =
            api_base.pip_sizes?.[symbol] ??
            this.tradeEngine.$scope?.ticksService
                ?.pipSizes?.[symbol] ??
            2;

        const formatted =
            Number(price).toFixed(pipSize);

        return Number(
            formatted.charAt(formatted.length - 1)
        );
    }

    private calculateStreakScore(
        digits: number[]
    ): number {
        if (digits.length < 2) return 0;

        let sameParity = 0;

        for (let i = 1; i < digits.length; i += 1) {
            if (
                digits[i] % 2 ===
                digits[i - 1] % 2
            ) {
                sameParity += 1;
            }
        }

        return (
            sameParity /
            (digits.length - 1)
        );
    }

    private calculateStability(
        digits: number[]
    ): number {
        if (digits.length < 40) return 0;

        const first = digits.slice(0, 20);
        const last = digits.slice(-20);

        const firstEven =
            first.filter(
                digit => digit % 2 === 0
            ).length / first.length;

        const lastEven =
            last.filter(
                digit => digit % 2 === 0
            ).length / last.length;

        return Math.max(
            0,
            1 - Math.abs(
                firstEven - lastEven
            )
        );
    }

    private shouldStop(): boolean {
        if (
            this.config.targetProfit > 0 &&
            this.currentProfit >=
                this.config.targetProfit
        ) {
            this.stopReason =
                'Target profit reached.';

            return true;
        }

        if (
            this.config.stopLoss > 0 &&
            this.currentProfit <=
                -Math.abs(
                    this.config.stopLoss
                )
        ) {
            this.stopReason =
                'Stop loss reached.';

            return true;
        }

        return false;
    }

    /**
     * Uses the existing Deriv API connection.
     * No new WebSocket is created.
     */
    private async request(
        request: Record<string, any>
    ): Promise<any> {
        if (!api_base.api) {
            throw new Error(
                'Deriv API is not initialized.'
            );
        }

        return doUntilDone(
            () => api_base.api?.send(request),
            [],
            api_base
        );
    }

    private delay(
        milliseconds: number
    ): Promise<void> {
        return new Promise(resolve =>
            window.setTimeout(
                resolve,
                milliseconds
            )
        );
    }
}

export default GodBot;
