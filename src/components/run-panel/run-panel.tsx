// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';

import Journal from '@/components/journal';
import Button from '@/components/shared_ui/button';
import Drawer from '@/components/shared_ui/drawer';
import Modal from '@/components/shared_ui/modal';
import Money from '@/components/shared_ui/money';
import Tabs from '@/components/shared_ui/tabs';
import Text from '@/components/shared_ui/text';
import Summary from '@/components/summary';
import TradeAnimation from '@/components/trade-animation';
import Transactions from '@/components/transactions';

import { DBOT_TABS } from '@/constants/bot-contents';
import { popover_zindex } from '@/constants/z-indexes';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';

import ThemedScrollbars from '../shared_ui/themed-scrollbars';

/* ============================================================
   TYPES
============================================================ */

type TStatisticsTile = {
    content: React.ElementType | string | number;
    contentClassName?: string;
    title: string;
};

type TStatisticsSummary = {
    currency: string;
    is_mobile: boolean;
    lost_contracts: number;
    number_of_runs: number;
    total_stake: number;
    total_payout: number;
    toggleStatisticsInfoModal: () => void;
    total_profit: number;
    won_contracts: number;
};

type TDrawerHeader = {
    is_clear_stat_disabled: boolean;
    is_mobile: boolean;
    is_drawer_open: boolean;
    onClearStatClick: () => void;
};

type TDrawerContent = {
    active_index: number;
    is_drawer_open: boolean;
    active_tour: string;
    setActiveTabIndex: () => void;
};

type TDrawerFooter = {
    is_clear_stat_disabled: boolean;
    onClearStatClick: () => void;
};

type TStatisticsInfoModal = {
    is_mobile: boolean;
    is_statistics_info_modal_open: boolean;
    toggleStatisticsInfoModal: () => void;
};

/* ============================================================
   STATISTICS TILE
============================================================ */

const StatisticsTile = ({
    content,
    contentClassName,
    title,
}: TStatisticsTile) => (
    <div className='run-panel__tile'>
        <div className='run-panel__tile-title'>
            {title}
        </div>

        <div
            className={classNames(
                'run-panel__tile-content',
                contentClassName
            )}
        >
            {content}
        </div>
    </div>
);

/* ============================================================
   STATISTICS SUMMARY
============================================================ */

export const StatisticsSummary = ({
    currency,
    is_mobile,
    lost_contracts,
    number_of_runs,
    total_stake,
    total_payout,
    toggleStatisticsInfoModal,
    total_profit,
    won_contracts,
}: TStatisticsSummary) => (
    <div
        className={classNames('run-panel__stat', {
            'run-panel__stat--mobile': is_mobile,
        })}
    >
        <div
            className='run-panel__stat--info'
            onClick={toggleStatisticsInfoModal}
        >
            <div className='run-panel__stat--info-item'>
                <Localize i18n_default_text="What's this?" />
            </div>
        </div>

        <div className='run-panel__stat--tiles'>
            <StatisticsTile
                title={localize('Total stake')}
                content={
                    <Money
                        amount={total_stake}
                        currency={currency}
                        show_currency
                    />
                }
            />

            <StatisticsTile
                title={localize('Total payout')}
                content={
                    <Money
                        amount={total_payout}
                        currency={currency}
                        show_currency
                    />
                }
            />

            <StatisticsTile
                title={localize('No. of runs')}
                content={number_of_runs}
            />

            <StatisticsTile
                title={localize('Contracts lost')}
                content={lost_contracts}
            />

            <StatisticsTile
                title={localize('Contracts won')}
                content={won_contracts}
            />

            <StatisticsTile
                title={localize('Total profit/loss')}
                content={
                    <Money
                        amount={total_profit}
                        currency={currency}
                        has_sign
                        show_currency
                    />
                }
                contentClassName={classNames(
                    'run-panel__stat-amount',
                    {
                        'run-panel__stat-amount--positive':
                            total_profit > 0,
                        'run-panel__stat-amount--negative':
                            total_profit < 0,
                    }
                )}
            />
        </div>
    </div>
);

/* ============================================================
   DRAWER HEADER
============================================================ */

const DrawerHeader = ({
    is_clear_stat_disabled,
    is_mobile,
    is_drawer_open,
    onClearStatClick,
}: TDrawerHeader) =>
    is_mobile &&
    is_drawer_open && (
        <Button
            id='db-run-panel__clear-button'
            className='run-panel__clear-button'
            disabled={is_clear_stat_disabled}
            text={localize('Reset')}
            onClick={onClearStatClick}
            secondary
        />
    );

/* ============================================================
   DRAWER CONTENT
============================================================ */

const DrawerContent = ({
    active_index,
    is_drawer_open,
    active_tour,
    setActiveTabIndex,
    ...props
}: TDrawerContent) => {
    const { isDesktop } = useDevice();

    React.useEffect(() => {
        if (!isDesktop && is_drawer_open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [is_drawer_open, isDesktop]);

    return (
        <>
            <Tabs
                active_index={active_index}
                onTabItemClick={setActiveTabIndex}
                top
            >
                <div
                    id='db-run-panel-tab__summary'
                    label={
                        <Localize i18n_default_text='Summary' />
                    }
                >
                    <Summary
                        is_drawer_open={is_drawer_open}
                    />
                </div>

                <div
                    id='db-run-panel-tab__transactions'
                    label={
                        <Localize i18n_default_text='Transactions' />
                    }
                >
                    <Transactions
                        is_drawer_open={is_drawer_open}
                    />
                </div>

                <div
                    id='db-run-panel-tab__journal'
                    label={
                        <Localize i18n_default_text='Journal' />
                    }
                >
                    <Journal />
                </div>
            </Tabs>

            {((is_drawer_open &&
                active_index !== 2) ||
                active_tour) && (
                <StatisticsSummary
                    {...props}
                />
            )}
        </>
    );
};

/* ============================================================
   DRAWER FOOTER
============================================================ */

const DrawerFooter = ({
    is_clear_stat_disabled,
    onClearStatClick,
}: TDrawerFooter) => (
    <div className='run-panel__footer'>
        <Button
            id='db-run-panel__clear-button'
            className='run-panel__footer-button'
            disabled={is_clear_stat_disabled}
            onClick={onClearStatClick}
            has_effect
            secondary
        >
            <span>
                <Localize i18n_default_text='Reset' />
            </span>
        </Button>
    </div>
);

/* ============================================================
   MOBILE FOOTER
============================================================ */

const MobileDrawerFooter = () => (
    <div className='controls__section'>
        <div className='controls__buttons'>
            <TradeAnimation
                className='controls__animation'
                should_show_overlay
            />
        </div>
    </div>
);

/* ============================================================
   STATISTICS MODAL
============================================================ */

const StatisticsInfoModal = ({
    is_mobile,
    is_statistics_info_modal_open,
    toggleStatisticsInfoModal,
}: TStatisticsInfoModal) => (
    <Modal
        className={classNames(
            'statistics__modal',
            {
                'statistics__modal--mobile':
                    is_mobile,
            }
        )}
        title={localize("What's this?")}
        is_open={is_statistics_info_modal_open}
        toggleModal={toggleStatisticsInfoModal}
        width={'440px'}
    >
        <Modal.Body>
            <div
                className={classNames(
                    'statistics__modal-body',
                    {
                        'statistics__modal-body--mobile':
                            is_mobile,
                    }
                )}
            >
                <ThemedScrollbars className='statistics__modal-scrollbar'>
                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content no-margin'
                    >
                        <Localize i18n_default_text='Total stake' />
                    </Text>

                    <Text as='p'>
                        <Localize i18n_default_text='Total stake since you last cleared your stats.' />
                    </Text>

                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content'
                    >
                        <Localize i18n_default_text='Total payout' />
                    </Text>

                    <Text as='p'>
                        {localize(
                            'Total payout since you last cleared your stats.'
                        )}
                    </Text>

                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content'
                    >
                        <Localize i18n_default_text='No. of runs' />
                    </Text>

                    <Text as='p'>
                        <Localize i18n_default_text='The number of times your bot has run since you last cleared your stats. Each run includes the execution of all the root blocks.' />
                    </Text>

                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content'
                    >
                        <Localize i18n_default_text='Contracts lost' />
                    </Text>

                    <Text as='p'>
                        <Localize i18n_default_text='The number of contracts you have lost since you last cleared your stats.' />
                    </Text>

                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content'
                    >
                        <Localize i18n_default_text='Contracts won' />
                    </Text>

                    <Text as='p'>
                        <Localize i18n_default_text='The number of contracts you have won since you last cleared your stats.' />
                    </Text>

                    <Text
                        as='p'
                        weight='bold'
                        className='statistics__modal-body--content'
                    >
                        <Localize i18n_default_text='Total profit/loss' />
                    </Text>

                    <Text as='p'>
                        <Localize i18n_default_text='Your total profit/loss since you last cleared your stats. It is the difference between your total payout and your total stake.' />
                    </Text>
                </ThemedScrollbars>
            </div>
        </Modal.Body>
    </Modal>
);

/* ============================================================
   GOD BOT PANEL
============================================================ */

const GodBotPanel = observer(() => {
    const { run_panel } = useStore();

    const [stake, setStake] =
        React.useState('1');

    const [targetProfit, setTargetProfit] =
        React.useState('0');

    const [stopLoss, setStopLoss] =
        React.useState('0');

    const [runs, setRuns] =
        React.useState('2');

    const [isRunning, setIsRunning] =
        React.useState(false);

    const [profit, setProfit] =
        React.useState(0);

    const [trades, setTrades] =
        React.useState(0);

    const [market, setMarket] =
        React.useState('Waiting for scan');

    const [status, setStatus] =
        React.useState('GOD is ready');

    /*
     * Access the DBot instance.
     *
     * The modified dbot.js exposes runGodBot()
     * and stopGodBot().
     */
    const getDbot = () => {
        return run_panel?.dbot;
    };

    React.useEffect(() => {
        const timer =
            window.setInterval(() => {
                const dbot =
                    getDbot();

                const godBot =
                    dbot?.godBot;

                if (!godBot) {
                    setIsRunning(false);
                    return;
                }

                setIsRunning(
                    godBot.isRunning()
                );

                setProfit(
                    Number(
                        godBot.getProfit() || 0
                    )
                );

                setTrades(
                    Number(
                        godBot.getTradesExecuted() || 0
                    )
                );

                const selected =
                    godBot.getSelectedMarket();

                if (selected) {
                    setMarket(
                        `${selected.name} (${selected.symbol})`
                    );
                }

                if (!godBot.isRunning()) {
                    const reason =
                        godBot.getStopReason();

                    if (reason) {
                        setStatus(reason);
                    }
                }
            }, 500);

        return () =>
            window.clearInterval(
                timer
            );
    }, [run_panel]);

    const startGod = async () => {
        const dbot =
            getDbot();

        if (!dbot?.runGodBot) {
            setStatus(
                'GOD is not connected to DBot.'
            );
            return;
        }

        try {
            setStatus(
                'GOD is scanning markets...'
            );

            setMarket(
                'Scanning synthetic markets...'
            );

            setProfit(0);
            setTrades(0);
            setIsRunning(true);

            await dbot.runGodBot({
                stake:
                    Number(stake) || 1,

                targetProfit:
                    Number(
                        targetProfit
                    ) || 0,

                stopLoss:
                    Number(stopLoss) || 0,

                runs:
                    Math.max(
                        1,
                        Number(runs) || 2
                    ),

                scanWindow: 100,

                minimumSampleSize: 50,

                minimumConfidence: 0.70,
            });

            setIsRunning(false);

            const bot =
                dbot.godBot;

            if (bot) {
                setProfit(
                    Number(
                        bot.getProfit() || 0
                    )
                );

                setTrades(
                    Number(
                        bot.getTradesExecuted() || 0
                    )
                );

                const selected =
                    bot.getSelectedMarket();

                if (selected) {
                    setMarket(
                        `${selected.name} (${selected.symbol})`
                    );
                }

                setStatus(
                    bot.getStopReason() ||
                        'GOD finished.'
                );
            }
        } catch (error) {
            console.error(
                '[GOD UI] Start error:',
                error
            );

            setIsRunning(false);

            setStatus(
                error?.message ||
                    'Unable to start GOD.'
            );
        }
    };

    const stopGod = async () => {
        const dbot =
            getDbot();

        try {
            if (dbot?.stopGodBot) {
                await dbot.stopGodBot();
            }

            setIsRunning(false);

            setStatus(
                'GOD stopped by user.'
            );
        } catch (error) {
            console.error(
                '[GOD UI] Stop error:',
                error
            );

            setStatus(
                'Unable to stop GOD.'
            );
        }
    };

    const inputStyle = {
        width: '100%',
        boxSizing: 'border-box' as const,
        padding: '9px 10px',
        borderRadius: 7,
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(255,255,255,0.06)',
        color: 'inherit',
        outline: 'none',
    };

    return (
        <div
            style={{
                marginBottom: 16,
                padding: 16,
                borderRadius: 12,
                border:
                    '1px solid rgba(0, 255, 120, 0.35)',
                background:
                    'linear-gradient(135deg, rgba(0, 35, 18, 0.98), rgba(8, 18, 12, 0.98))',
            }}
        >
            {/* HEADER */}

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                        'space-between',
                    marginBottom: 14,
                }}
            >
                <div>
                    <div
                        style={{
                            fontSize: 20,
                            fontWeight: 800,
                            letterSpacing: 1,
                        }}
                    >
                        GOD
                    </div>

                    <div
                        style={{
                            fontSize: 11,
                            opacity: 0.7,
                            marginTop: 2,
                        }}
                    >
                        EVEN / ODD AUTO BOT
                    </div>
                </div>

                <div
                    style={{
                        padding:
                            '5px 9px',
                        borderRadius: 20,
                        fontSize: 10,
                        fontWeight: 700,
                        background:
                            isRunning
                                ? 'rgba(0,255,100,0.18)'
                                : 'rgba(255,255,255,0.08)',
                    }}
                >
                    {isRunning
                        ? '● RUNNING'
                        : '● READY'}
                </div>
            </div>

            {/* INPUTS */}

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        '1fr 1fr',
                    gap: 10,
                }}
            >
                <div>
                    <div
                        style={{
                            fontSize: 11,
                            marginBottom: 5,
                            opacity: 0.75,
                        }}
                    >
                        Stake
                    </div>

                    <input
                        type='number'
                        min='0.01'
                        step='0.01'
                        value={stake}
                        disabled={isRunning}
                        onChange={event =>
                            setStake(
                                event.target
                                    .value
                            )
                        }
                        style={inputStyle}
                    />
                </div>

                <div>
                    <div
                        style={{
                            fontSize: 11,
                            marginBottom: 5,
                            opacity: 0.75,
                        }}
                    >
                        Runs
                    </div>

                    <input
                        type='number'
                        min='1'
                        step='1'
                        value={runs}
                        disabled={isRunning}
                        onChange={event =>
                            setRuns(
                                event.target
                                    .value
                            )
                        }
                        style={inputStyle}
                    />
                </div>

                <div>
                    <div
                        style={{
                            fontSize: 11,
                            marginBottom: 5,
                            opacity: 0.75,
                        }}
                    >
                        Target profit
                    </div>

                    <input
                        type='number'
                        min='0'
                        step='0.01'
                        value={
                            targetProfit
                        }
                        disabled={isRunning}
                        onChange={event =>
                            setTargetProfit(
                                event.target
                                    .value
                            )
                        }
                        style={inputStyle}
                    />
                </div>

                <div>
                    <div
                        style={{
                            fontSize: 11,
                            marginBottom: 5,
                            opacity: 0.75,
                        }}
                    >
                        Stop loss
                    </div>

                    <input
                        type='number'
                        min='0'
                        step='0.01'
                        value={stopLoss}
                        disabled={isRunning}
                        onChange={event =>
                            setStopLoss(
                                event.target
                                    .value
                            )
                        }
                        style={inputStyle}
                    />
                </div>
            </div>

            {/* MARKET */}

            <div
                style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 8,
                    background:
                        'rgba(255,255,255,0.05)',
                }}
            >
                <div
                    style={{
                        fontSize: 10,
                        opacity: 0.6,
                        marginBottom: 3,
                    }}
                >
                    SELECTED MARKET
                </div>

                <div
                    style={{
                        fontSize: 12,
                        fontWeight: 600,
                    }}
                >
                    {market}
                </div>
            </div>

            {/* STATS */}

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        '1fr 1fr',
                    gap: 8,
                    marginTop: 10,
                }}
            >
                <div
                    style={{
                        padding: 10,
                        borderRadius: 8,
                        background:
                            'rgba(255,255,255,0.05)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            opacity: 0.6,
                        }}
                    >
                        TRADES
                    </div>

                    <div
                        style={{
                            fontSize: 16,
                            fontWeight: 700,
                            marginTop: 2,
                        }}
                    >
                        {trades}
                    </div>
                </div>

                <div
                    style={{
                        padding: 10,
                        borderRadius: 8,
                        background:
                            'rgba(255,255,255,0.05)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            opacity: 0.6,
                        }}
                    >
                        PROFIT / LOSS
                    </div>

                    <div
                        style={{
                            fontSize: 16,
                            fontWeight: 700,
                            marginTop: 2,
                        }}
                    >
                        {profit >= 0
                            ? '+'
                            : ''}
                        {profit.toFixed(2)}
                    </div>
                </div>
            </div>

            {/* STATUS */}

            <div
                style={{
                    marginTop: 10,
                    minHeight: 18,
                    fontSize: 11,
                    opacity: 0.75,
                }}
            >
                {status}
            </div>

            {/* BUTTONS */}

            <div
                style={{
                    marginTop: 10,
                    display: 'flex',
                    gap: 8,
                }}
            >
                {!isRunning ? (
                    <Button
                        onClick={
                            startGod
                        }
                        has_effect
                    >
                        <span>
                            START GOD
                        </span>
                    </Button>
                ) : (
                    <Button
                        onClick={
                            stopGod
                        }
                        secondary
                        has_effect
                    >
                        <span>
                            STOP GOD
                        </span>
                    </Button>
                )}
            </div>

            {/* INFORMATION */}

            <div
                style={{
                    marginTop: 10,
                    fontSize: 10,
                    lineHeight: 1.4,
                    opacity: 0.55,
                }}
            >
                GOD scans eligible synthetic
                markets, waits for its configured
                Even/Odd signal and executes through
                the existing Deriv trading engine.
            </div>
        </div>
    );
});

/* ============================================================
   MAIN RUN PANEL
============================================================ */

const RunPanel = observer(() => {
    const {
        run_panel,
        dashboard,
        transactions,
    } = useStore();

    const { client } = useStore();

    const { isDesktop } =
        useDevice();

    const { currency } =
        client;

    const {
        active_index,
        is_drawer_open,
        is_statistics_info_modal_open,
        is_clear_stat_disabled,
        onClearStatClick,
        onMount,
        onRunButtonClick,
        onUnmount,
        setActiveTabIndex,
        toggleDrawer,
        toggleStatisticsInfoModal,
    } = run_panel;

    const {
        statistics,
    } = transactions;

    const {
        active_tour,
        active_tab,
    } = dashboard;

    const {
        total_payout,
        total_profit,
        total_stake,
        won_contracts,
        lost_contracts,
        number_of_runs,
    } = statistics;

    const {
        BOT_BUILDER,
        CHART,
    } = DBOT_TABS;

    React.useEffect(() => {
        onMount();

        return () =>
            onUnmount();
    }, [
        onMount,
        onUnmount,
    ]);

    React.useEffect(() => {
        if (!isDesktop) {
            toggleDrawer(false);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const content = (
        <DrawerContent
            active_index={
                active_index
            }
            currency={currency}
            is_drawer_open={
                is_drawer_open
            }
            is_mobile={!isDesktop}
            lost_contracts={
                lost_contracts
            }
            number_of_runs={
                number_of_runs
            }
            setActiveTabIndex={
                setActiveTabIndex
            }
            toggleStatisticsInfoModal={
                toggleStatisticsInfoModal
            }
            total_payout={
                total_payout
            }
            total_profit={
                total_profit
            }
            total_stake={
                total_stake
            }
            won_contracts={
                won_contracts
            }
            active_tour={
                active_tour
            }
        />
    );

    const footer = (
        <DrawerFooter
            is_clear_stat_disabled={
                is_clear_stat_disabled
            }
            onClearStatClick={
                onClearStatClick
            }
        />
    );

    const header = (
        <DrawerHeader
            is_clear_stat_disabled={
                is_clear_stat_disabled
            }
            is_mobile={!isDesktop}
            is_drawer_open={
                is_drawer_open
            }
            onClearStatClick={
                onClearStatClick
            }
        />
    );

    const show_run_panel =
        [
            BOT_BUILDER,
            CHART,
        ].includes(active_tab) ||
        active_tour;

    if (
        (!show_run_panel &&
            isDesktop) ||
        active_tour ===
            'bot_builder'
    ) {
        return null;
    }

    return (
        <>
            <div
                className={
                    !isDesktop &&
                    is_drawer_open
                        ? 'run-panel__container--mobile'
                        : 'run-panel'
                }
            >
                <Drawer
                    anchor='right'
                    className={classNames(
                        'run-panel',
                        {
                            'run-panel__container':
                                isDesktop,

                            'run-panel__container--tour-active':
                                isDesktop &&
                                active_tour,
                        }
                    )}
                    contentClassName='run-panel__content'
                    header={header}
                    footer={
                        isDesktop &&
                        footer
                    }
                    is_open={
                        is_drawer_open
                    }
                    toggleDrawer={
                        toggleDrawer
                    }
                    width={366}
                    zIndex={
                        popover_zindex.RUN_PANEL
                    }
                >
                    {/* ==================================================
                        GOD BOT
                    ================================================== */}

                    <GodBotPanel />

                    {/* ==================================================
                        EXISTING DERIV PANEL
                    ================================================== */}

                    {content}
                </Drawer>

                {!isDesktop && (
                    <MobileDrawerFooter />
                )}
            </div>

            <StatisticsInfoModal
                is_mobile={!isDesktop}
                is_statistics_info_modal_open={
                    is_statistics_info_modal_open
                }
                toggleStatisticsInfoModal={
                    toggleStatisticsInfoModal
                }
            />
        </>
    );
});

export default RunPanel;
