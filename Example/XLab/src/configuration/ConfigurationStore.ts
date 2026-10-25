import { RealtimeModel, XmaxEnvironment } from '@xmaxai/react-native-sdk';
import type { XLabLanguage, XLabLocale } from '../localization/Localization';

/** The API backends XLab can target; credentials persist independently per endpoint. */
export type XLabApiEndpoint = 'china' | 'global';

/** All SDK models available for selection, independently of the service environment. */
export const xlabModels: readonly RealtimeModel[] = Object.freeze(
  Object.values(RealtimeModel),
);

/** Selects the service environment from the resolved interface language. */
export function endpointForLocale(locale: XLabLocale): XLabApiEndpoint {
  return locale === 'zh-Hans' ? 'china' : 'global';
}

/** Maps an endpoint to the SDK environment used when creating clients. */
export function environmentForEndpoint(
  endpoint: XLabApiEndpoint,
): XmaxEnvironment {
  return endpoint === XmaxEnvironment.global
    ? XmaxEnvironment.global
    : XmaxEnvironment.china;
}

/** Separate secure-storage slots; credentials never fall back across regions. */
export type ConfigurationField = XLabApiEndpoint | 'language' | 'model';

/** Minimal persistence boundary, implemented by the host's secure storage. */
export interface ConfigurationStorage {
  read(field: ConfigurationField): Promise<string | null>;

  write(field: ConfigurationField, value: string): Promise<void>;
}

/** Stable snapshot consumed by XLab; never included in logs or error messages. */
export interface SavedConfiguration {
  readonly keys: Readonly<Record<XLabApiEndpoint, string>>;
  readonly language: XLabLanguage;
  readonly model: RealtimeModel;
  readonly loaded: boolean;
  readonly saving: boolean;
  /** Localized at render time so an existing failure follows language changes. */
  readonly error: 'configuration.readError' | 'configuration.saveError' | null;
}

/**
 * Owns endpoint-specific credentials and serializes persistence. Pending
 * edits to one slot coalesce without replacing edits to another endpoint.
 */
export class ConfigurationStore {
  private state: SavedConfiguration = {
    keys: { china: '', global: '' },
    language: 'system',
    model: RealtimeModel.x2_1_1_preview_cn,
    loaded: false,
    saving: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<ConfigurationField, string>();
  private loading: Promise<void> | null = null;
  private writing = false;

  constructor(private readonly storage: ConfigurationStorage) {}

  getSnapshot = (): SavedConfiguration => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(update: Partial<SavedConfiguration>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  /** Completes hydration before accepting edits so stale reads cannot overwrite input. */
  load(): Promise<void> {
    if (this.state.loaded) return Promise.resolve();
    if (this.loading) return this.loading;

    this.publish({ error: null });
    this.loading = (async () => {
      try {
        const [china, global, language, model] = await Promise.all([
          this.storage.read('china'),
          this.storage.read('global'),
          this.storage.read('language'),
          this.storage.read('model'),
        ]);
        const selectedModel =
          xlabModels.find(supported => supported === model) ??
          RealtimeModel.x2_1_1_preview_cn;
        this.publish({
          keys: { china: china ?? '', global: global ?? '' },
          model: selectedModel,
          language:
            language === 'zh-Hans' || language === 'en' ? language : 'system',
          loaded: true,
        });
      } catch {
        this.publish({ error: 'configuration.readError' });
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  setKey(endpoint: XLabApiEndpoint, value: string): void {
    if (!this.state.loaded) return;

    this.publish({ keys: { ...this.state.keys, [endpoint]: value } });
    this.enqueue(endpoint, value.trim());
  }

  /** Updates visible copy immediately and persists the choice independently of credentials. */
  selectLanguage(language: XLabLanguage): void {
    if (!this.state.loaded || language === this.state.language) return;

    this.publish({ language });
    this.enqueue('language', language);
  }

  /** Persists the model for future entries without modifying an active route. */
  selectModel(model: RealtimeModel): void {
    if (!this.state.loaded || !xlabModels.includes(model)) return;
    this.publish({ model });
    this.enqueue('model', model);
  }

  private enqueue(field: ConfigurationField, value: string): void {
    this.pending.set(field, value);
    void this.flush();
  }

  /** Retries unsaved values; a failed write never discards newer edits. */
  async flush(): Promise<void> {
    if (this.writing || !this.pending.size) return;

    this.writing = true;
    this.publish({ saving: true, error: null });
    let failed = false;

    try {
      while (this.pending.size) {
        const [field, value] = this.pending.entries().next().value!;

        this.pending.delete(field);
        try {
          await this.storage.write(field, value);
        } catch {
          if (!this.pending.has(field)) this.pending.set(field, value);
          failed = true;
          break;
        }
      }
    } finally {
      this.writing = false;
      this.publish({
        saving: false,
        error: failed ? 'configuration.saveError' : null,
      });
    }
  }
}
