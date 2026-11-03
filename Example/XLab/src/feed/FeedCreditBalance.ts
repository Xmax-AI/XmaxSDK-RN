import { XmaxClient, type XmaxEnvironment } from '@xmaxai/react-native-sdk';

/** A balance snapshot retained across refreshes for the current account. */
export interface FeedCreditBalanceState {
  readonly balance: number | null;
  readonly isLoading: boolean;
  readonly refreshFailed: boolean;
}

type Query = (signal: AbortSignal) => Promise<number>;
type QueryFactory = (apiKey: string, environment: XmaxEnvironment) => Query;

/** Polls the active homepage and discards results from replaced credentials or visibility. */
export class FeedCreditBalancePoller {
  private state: FeedCreditBalanceState = {
    balance: null,
    isLoading: false,
    refreshFailed: false,
  };
  private account: { key: string; environment: XmaxEnvironment } | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly makeQuery: QueryFactory = (apiKey, environment) => {
      const client = new XmaxClient({ apiKey, environment });
      return async signal =>
        (await client.getCreditBalance({ signal })).currentBalance;
    },
  ) {}

  getSnapshot = (): FeedCreditBalanceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Clears another account's balance and coalesces edits before starting a query. */
  update(
    apiKey: string,
    environment: XmaxEnvironment,
    isActive: boolean,
  ): void {
    const key = apiKey.trim();
    if (this.account?.key !== key || this.account.environment !== environment) {
      this.pause();
      this.account = { key, environment };
      this.publish({ balance: null, isLoading: false, refreshFailed: false });
    }
    if (!isActive || !key) {
      this.pause();
      return;
    }
    if (this.controller) return;

    const controller = new AbortController();
    this.controller = controller;
    let query: Query | null = null;
    const refresh = async () => {
      this.timer = null;
      if (this.controller !== controller || controller.signal.aborted) return;
      this.publish({ ...this.state, isLoading: true, refreshFailed: false });
      if (this.controller !== controller || controller.signal.aborted) return;

      try {
        query ??= this.makeQuery(key, environment);
        const balance = await query(controller.signal);
        if (this.controller !== controller || controller.signal.aborted) return;
        this.publish({ balance, isLoading: false, refreshFailed: false });
      } catch {
        if (this.controller !== controller || controller.signal.aborted) return;
        this.publish({ ...this.state, isLoading: false, refreshFailed: true });
      }
      if (this.controller === controller && !controller.signal.aborted)
        this.timer = setTimeout(() => {
          void refresh();
        }, 5000);
    };
    this.timer = setTimeout(() => {
      void refresh();
    }, 250);
  }

  /** Cancels timers and HTTP requests while preserving the last balance for this account. */
  pause(): void {
    const controller = this.controller;
    this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    controller?.abort();
    if (this.state.isLoading) this.publish({ ...this.state, isLoading: false });
  }

  private publish(state: FeedCreditBalanceState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** Formats fractional credits with grouping and up to six decimal places. */
export function formatFeedCreditBalance(balance: number | null): string {
  return balance === null
    ? '—'
    : balance.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
