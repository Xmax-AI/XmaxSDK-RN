//
//  DataFileManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { DataFileManaging } from './DataFileManaging';
import { copyEncodedData } from './EncodedData';
import { invalid } from '../Errors/XmaxError';

/**
 * The native file operations used to stage encoded media.
 */
export interface DataFileTransport {

  /**
   * The application-private cache directories.
   */
  readonly dirs: {

    /**
     * The absolute app cache directory.
     */
    readonly CacheDir: string;
  };

  /**
   * Writes unsigned byte values without text conversion.
   *
   * @param path The absolute temporary file path.
   * @param data The encoded file byte values.
   * @param encoding The native bridge's byte-array mode.
   */
  writeFile(
    path: string,
    data: number[],
    encoding: 'ascii'
  ): Promise<void>;

  /**
   * Removes an owned temporary file.
   *
   * @param path The absolute temporary file path.
   */
  unlink(
    path: string
  ): Promise<void>;
}

/**
 * Stages encoded media in private files independently of realtime engine ownership.
 * Each consumer must remove its temporary file after native reads finish.
 */
export class DataFileManager implements DataFileManaging {

  /**
   * The file URLs owned by this instance.
   */
  private readonly owned = new Set<string>();

  /**
   * Creates an encoded-data file manager without accessing native storage.
   */
  constructor(
    /**
     * The native file transport resolved when first needed.
     */
    private readonly transport: () => DataFileTransport = () =>
      require('react-native-blob-util').default.fs,

    /**
     * The unique temporary filename source.
     */
    private readonly uuid: () => string = () =>
      require('../Native/NativeXmaxRuntime').default.randomUUID(),
  ) {}

  /**
   * Writes an independent snapshot and removes partial files on failure.
   *
   * @param data The nonempty encoded file bytes.
   * @returns The private temporary file URL owned by this instance.
   */
  async create(
    data: Uint8Array
  ): Promise<string> {
    const snapshot = copyEncodedData(data);
    const files = this.transport();
    const id = this.uuid();
    if (!/^[A-Za-z0-9_-]+$/.test(id))
      throw invalid('Invalid temporary file identifier');
    const directory = files.dirs.CacheDir.replace(
      /\/$/,
      ''
    );
    if (!directory.startsWith('/') || directory.includes('\0'))
      throw invalid('Invalid application cache directory');
    const path = `${directory}/xmax-data-${id}.tmp`;
    const fileURL = `file://${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    try {
      await files.writeFile(
        path,
        Array.from(snapshot),
        'ascii'
      );
      this.owned.add(fileURL);
      return fileURL;
    } catch (error) {
      await files.unlink(path).catch(() => {});
      throw error;
    }
  }

  /**
   * Deletes an owned temporary file while preserving caller-owned files.
   *
   * @param fileURL The private file URL returned by create().
   */
  async remove(
    fileURL: string
  ): Promise<void> {
    if (!this.owned.has(fileURL)) return;
    await this.transport().unlink(
      decodeURIComponent(fileURL.slice('file://'.length)),
    );
    this.owned.delete(fileURL);
  }
}
