import catalog from '../assets/realtime/RealtimeReferenceCatalog.json';

/**
 * Category order and default prompts copied from the iOS Realtime UI.
 */
export const realtimeCategories = [
  {
    id: 'charx',
    name: '换形象',
    content: 'references',
    defaultPrompt: '视频中角色替换成参考图中角色',
  },
  {
    id: 'clothx',
    name: '换装',
    content: 'references',
    defaultPrompt: '视频中人物衣服替换成参考图中衣服',
  },
  {
    id: 'vibex',
    name: '换风格',
    content: 'references',
    defaultPrompt: '视频风格变为参考图指定的风格',
  },
  {
    id: 'dimx',
    name: '虚拟召唤',
    content: 'references',
    defaultPrompt: '指定角色在场景中互动',
  },
  {
    id: 'mox',
    name: '触控动图',
    content: 'instruction',
    defaultPrompt: '',
  },
  { id: 'free', name: '自由', content: 'prompt', defaultPrompt: '' },
] as const;

export type RealtimeCategory = (typeof realtimeCategories)[number];

/**
 * The upload state displayed over a custom reference thumbnail.
 */
export type RealtimeReferenceUploadState = 'uploading' | 'ready' | 'failed';

/**
 * Reference metadata shared by catalog items and local UI selections.
 *
 * Custom references receive a remote referencePath after COS upload succeeds.
 */
export interface RealtimeReference {
  readonly id: string;
  readonly categoryID: string;
  readonly title: string;
  readonly iconURL: string;
  readonly prompt: string;
  readonly referencePath: string | null;
  readonly uploadState: RealtimeReferenceUploadState;
}

// Presets already contain remote URLs and do not need a new upload.
export const realtimeReferences: readonly RealtimeReference[] =
  catalog.items.map(item => ({ ...item, uploadState: 'ready' }));
