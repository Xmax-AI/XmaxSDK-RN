import type { MessageKey } from '../localization/messages';
import { useLocalization } from '../localization/LocalizationProvider';
import { useEffect, useRef, useState } from 'react';
import { launchImageLibrary } from 'react-native-image-picker';
import Blob from 'react-native-blob-util';
import {
  XmaxClient,
  XmaxLoggerOption,
  type XmaxEnvironment,
  type XmaxUploadedFile,
  type StorageProgress,
} from '@xmaxai/react-native-sdk';

/**
 * A selected media file copied into the storage screen's own cache.
 *
 * Dimensions may be unavailable. path is used for cleanup; fileURL is passed
 * to the SDK and local preview components.
 */
export interface SelectedFile {
  fileURL: string;
  path: string;
  contentType: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  byteCount: number;
}

/** Concrete errors retain their message; fallback copy follows language changes. */
type StorageErrorNotice =
  | { readonly message: string }
  | { readonly messageKey: MessageKey };

/** Matches iOS storage: show the error's explanation before page-specific fallback copy. */
function storageErrorNotice(
  error: unknown,
  fallback: MessageKey,
): StorageErrorNotice {
  const message =
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message.trim()
      : '';

  return message ? { message } : { messageKey: fallback };
}

/**
 * Owns one storage screen's selection, transfer progress and cache files.
 *
 * Copies picker assets into screen-owned cache files. Unmounting cancels
 * the active operation and cleans up those files after it settles.
 */
export function useStorage(apiKey: string, environment: XmaxEnvironment) {
  const { t } = useLocalization();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [busy, setBusy] = useState<'picking' | 'uploading' | null>(null);
  const [error, setError] = useState<StorageErrorNotice | null>(null);
  const [progress, setProgress] = useState<StorageProgress | null>(null);
  const [safe, setSafe] = useState(false);
  const [result, setResult] = useState<{
    file: XmaxUploadedFile;
    elapsed: number;
  } | null>(null);

  const mounted = useRef(true),
    locked = useRef(false);
  const selected = useRef<SelectedFile | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      controller.current?.abort();

      const cleanup = () => {
        if (selected.current)
          Blob.fs.unlink(selected.current.path).catch(() => {});
      };

      if (running.current) running.current.finally(cleanup).catch(() => {});
      else cleanup();
    };
  }, []);

  /**
   * Copies a picker asset into owned cache and replaces the previous selection.
   *
   * Cancellation preserves the old selection; late results clean up their copy.
   */
  async function pick() {
    if (locked.current) return;

    locked.current = true;
    setBusy('picking');
    setError(null);

    let copied: string | null = null;

    try {
      const response = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 1,
        includeBase64: false,
        assetRepresentationMode: 'current',
      });

      if (!mounted.current || response.didCancel) return;
      if (response.errorCode)
        throw new Error(response.errorMessage || t('storage.file.error'));

      const asset = response.assets?.[0];

      if (
        !asset?.uri ||
        (!asset.type?.startsWith('image/') && !asset.type?.startsWith('video/'))
      )
        throw new Error(t('storage.select.required'));

      const kind = asset.type.startsWith('video/') ? 'video' : 'image';
      const suffix = asset.fileName?.split('.').pop()?.toLowerCase();
      const ext =
        suffix && /^[a-z0-9]+$/.test(suffix)
          ? suffix
          : kind === 'video'
          ? 'mp4'
          : 'jpg';
      const path = `${
        Blob.fs.dirs.CacheDir
      }/xlab-storage-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      copied = path;
      await Blob.fs.cp(
        asset.uri.startsWith('file:')
          ? decodeURIComponent(
              asset.uri.replace(/^file:\/\/(?:localhost)?/i, ''),
            )
          : asset.uri,
        path,
      );

      const stat = await Blob.fs.stat(path);

      if (!mounted.current) return;

      const next: SelectedFile = {
        fileURL: `file://${path}`,
        path,
        contentType: asset.type,
        kind,
        width: asset.width ?? null,
        height: asset.height ?? null,
        byteCount: Number(stat.size),
      };
      const old = selected.current;

      selected.current = next;
      copied = null;
      setFile(next);
      setProgress(null);
      setResult(null);
      if (old) await Blob.fs.unlink(old.path).catch(() => {});
    } catch (failure) {
      if (mounted.current)
        setError(storageErrorNotice(failure, 'storage.file.error'));
    } finally {
      if (copied) await Blob.fs.unlink(copied).catch(() => {});

      locked.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  /**
   * Uploads the current selection with a per-operation cancellation signal.
   *
   * Image safety checking is explicit; videos use the ordinary upload route.
   */
  function upload(checksSafety: boolean) {
    if (locked.current || !selected.current) return;
    if (!apiKey.trim()) {
      setError({ messageKey: 'storage.api.required' });
      return;
    }

    locked.current = true;

    const current = selected.current;
    const abort = new AbortController();

    controller.current = abort;
    setBusy('uploading');
    setSafe(checksSafety);
    setError(null);
    setResult(null);
    setProgress({
      completedUnitCount: 0,
      totalUnitCount: current.byteCount,
      fractionCompleted: 0,
    });

    const startedAt = Date.now();
    const operation = (async () => {
      try {
        const storage = new XmaxClient({
          apiKey,
          environment,
          loggerOptions: XmaxLoggerOption.all,
        }).createStorageManager();
        const options = {
          fileURL: current.fileURL,
          contentType: current.contentType,
          signal: abort.signal,
          progress: (value: StorageProgress) => {
            if (mounted.current) setProgress(value);
          },
        };
        const uploaded =
          current.kind === 'video'
            ? await storage.uploadVideo(options)
            : checksSafety
            ? await storage.uploadImageWithSafetyCheck(options)
            : await storage.uploadImage(options);

        if (mounted.current && !abort.signal.aborted)
          setResult({ file: uploaded, elapsed: Date.now() - startedAt });
      } catch (e) {
        if (mounted.current && !abort.signal.aborted)
          setError(storageErrorNotice(e, 'storage.upload.error'));
      } finally {
        locked.current = false;
        if (controller.current === abort) controller.current = null;
        if (mounted.current) setBusy(null);
      }
    })();

    running.current = operation;
  }

  return { file, busy, error, progress, safe, result, pick, upload };
}

/**
 * Formats a byte count for the file metadata shown in XLab.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
