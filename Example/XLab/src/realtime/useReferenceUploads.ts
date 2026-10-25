import { useLocalization } from '../localization/LocalizationProvider';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import type { Asset } from 'react-native-image-picker';
import Blob from 'react-native-blob-util';
import {
  XmaxClient,
  XmaxLoggerOption,
  type XmaxEnvironment,
} from '@xmaxai/react-native-sdk';
import type { RealtimeReference } from './RealtimeReferenceCatalog';
import {
  ReferenceUploadTask,
  type ReferenceUploadFile,
  type ReferenceUploadUpdate,
} from './ReferenceUploadTask';

/**
 * Copies a picker image to an owned file before passing its URL to COS.
 * Partial copies are removed here; completed copies belong to the task.
 */
async function prepareReferenceFile(
  id: string,
  asset: Asset,
  t: ReturnType<typeof useLocalization>['t'],
): Promise<ReferenceUploadFile> {
  if (!asset.uri || !asset.type?.startsWith('image/'))
    throw new Error(t('realtime.reference.readable'));

  const suffix = asset.fileName?.split('.').pop()?.toLowerCase();
  const extension = suffix && /^[a-z0-9]+$/.test(suffix) ? suffix : 'image';
  const path = `${Blob.fs.dirs.CacheDir}/xlab-reference-${id}.${extension}`;
  const source = asset.uri.startsWith('file://')
    ? decodeURIComponent(asset.uri.replace(/^file:\/\/(?:localhost)?/i, ''))
    : asset.uri;

  try {
    await Blob.fs.cp(source, path);
    const stat = await Blob.fs.stat(path);
    if (stat.type !== 'file' || Number(stat.size) <= 0)
      throw new Error(t('realtime.reference.fileError'));

    return {
      fileURL: `file://${path}`,
      contentType: asset.type,
      dispose: () => Blob.fs.unlink(path).catch(() => {}),
    };
  } catch (error) {
    await Blob.fs.unlink(path).catch(() => {});
    throw error;
  }
}

/**
 * Keeps reference uploads independent from camera operations and selection.
 * All owned tasks are cancelled when the panel leaves the screen.
 */
export function useReferenceUploads(
  apiKey: string,
  environment: XmaxEnvironment,
  onUpdate: (id: string, update: ReferenceUploadUpdate) => void,
) {
  const { t } = useLocalization();
  // Uploads and retries may outlive the language active when their task was created.
  const translation = useRef(t);
  translation.current = t;
  const tasks = useRef(new Map<string, ReferenceUploadTask>());
  const mounted = useRef(true);
  const update = useRef(onUpdate);
  update.current = onUpdate;

  useEffect(() => {
    mounted.current = true;
    const ownedTasks = tasks.current;

    return () => {
      mounted.current = false;
      for (const task of ownedTasks.values()) void task.close().catch(() => {});
      ownedTasks.clear();
    };
  }, []);

  /**
   * Uses the same ordinary image-upload method as the iOS reference picker.
   */
  function start(reference: RealtimeReference, asset: Asset) {
    if (!mounted.current) return;

    const task = new ReferenceUploadTask(
      () => prepareReferenceFile(reference.id, asset, translation.current),
      (file, signal) => {
        if (!apiKey.trim())
          throw new Error(translation.current('storage.api.required'));

        const storage = new XmaxClient({
          apiKey,
          environment,
          loggerOptions: XmaxLoggerOption.all,
        }).createStorageManager();

        return storage.uploadImage({
          fileURL: file.fileURL,
          contentType: file.contentType,
          signal,
        });
      },
      value => {
        if (mounted.current) update.current(reference.id, value);
      },
      () => {
        if (mounted.current)
          Alert.alert(
            translation.current('realtime.reference.uploadError'),
            apiKey.trim()
              ? translation.current('realtime.reference.retry')
              : translation.current('storage.api.required'),
          );
      },
    );

    tasks.current.set(reference.id, task);
    void task.start().catch(() => {});
  }

  function retry(id: string) {
    void tasks.current
      .get(id)
      ?.start()
      .catch(() => {});
  }

  function remove(id: string) {
    const task = tasks.current.get(id);
    tasks.current.delete(id);
    void task?.close().catch(() => {});
  }

  return { start, retry, remove };
}
