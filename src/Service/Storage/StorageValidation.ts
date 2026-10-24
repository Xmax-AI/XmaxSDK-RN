//
//  StorageValidation.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  invalid,
  XmaxError,
  XmaxErrorCode,
} from '../../Foundation/Errors/XmaxError';
import { record, nonEmpty } from '../Network/ApiResponse';
import type { StorageConfiguration } from './StorageTypes';

/**
 * Requires an absolute HTTP(S) URL without embedded user credentials.
 *
 * @param value An absolute HTTP(S) URL without user credentials.
 */
export function httpURL(
  value: string
): URL {
  try {
    const url = new URL(value);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();

    return url;
  } catch {
    throw invalid('Invalid HTTP URL');
  }
}

/**
 * Decodes an absolute file URL and rejects malformed or null-containing paths.
 *
 * @param value An absolute file URL without query, fragment, or null characters.
 * @returns The decoded absolute local path.
 */
export function filePath(
  value: string
): string {
  // Decode and validate the complete file URL before accessing native storage.
  const match = /^file:\/\/(?:localhost)?(\/[^?#]*)$/i.exec(value);

  try {
    if (!match?.[1]) throw new Error();

    const path = decodeURIComponent(match[1]);

    if (path.includes('\0')) throw new Error();

    return path;
  } catch {
    throw invalid('Expected an absolute file URL');
  }
}

/**
 * The supported image extensions and MIME subtypes.
 */
const imageTypes: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  heic: 'heic',
  heif: 'heif',
  bmp: 'bmp',
  svg: 'svg+xml',
  tif: 'tiff',
  tiff: 'tiff',
  avif: 'avif',
};

/**
 * The supported video extensions and MIME subtypes.
 */
const videoTypes: Record<string, string> = {
  mp4: 'mp4',
  mov: 'quicktime',
  m4v: 'x-m4v',
  webm: 'webm',
  avi: 'x-msvideo',
  mkv: 'x-matroska',
  '3gp': '3gpp',
  '3g2': '3gpp2',
  ts: 'mp2t',
};

/**
 * Validates a media category and derives a safe object name and MIME type.
 *
 * @param fileURL The readable local file URL; your app retains ownership of the original.
 * @param media The image or video category used for file validation and MIME inference.
 * @param contentType The MIME type; inferred from the extension when omitted or null.
 */
export function uploadMetadata(
  fileURL: string,
  media: 'image' | 'video',
  contentType?: string | null,
) {
  const name = filePath(fileURL).split('/').pop() ?? '';
  const fileName = name
    .trim()
    .replace(
    /[^\p{L}\p{N}._-]/gu,
    '_'
  )
    .replace(
    /_+/g,
    '_'
  )
    .replace(
    /^[._-]+|[._-]+$/g,
    ''
  );

  if (!fileName) throw invalid('File name cannot be empty');

  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const inferred = (media === 'image' ? imageTypes : videoTypes)[extension];
  const type =
    contentType?.trim().toLowerCase() ??
    (inferred ? `${media}/${inferred}` : '');

  if (
    !type.startsWith(`${media}/`) ||
    type === `${media}/` ||
    /[\r\n]/.test(type)
  )
    throw invalid(`Invalid ${media} content type`);

  return { fileName, contentType: type };
}

/**
 * Validates upload endpoints, directories, and temporary credentials before transfer.
 *
 * @param value The raw credential response to validate.
 * @returns The validated bucket, endpoint, directory, and temporary credentials.
 */
export function parseStorageConfiguration(
  value: unknown,
): StorageConfiguration {
  const data = record(value),
    credentials = record(data?.credentials);
  const bucket = nonEmpty(data?.bucket),
    region = nonEmpty(data?.region);
  const accessKeyID = nonEmpty(credentials?.accessKeyId),
    secretAccessKey = nonEmpty(credentials?.secretAccessKey),
    sessionToken = nonEmpty(credentials?.sessionToken);

  if (
    !bucket ||
    !region ||
    !/^[a-zA-Z0-9.-]+$/.test(bucket) ||
    !/^[a-zA-Z0-9.-]+$/.test(region) ||
    typeof data?.endpoint !== 'string' ||
    typeof data.prefix !== 'string' ||
    !accessKeyID ||
    !secretAccessKey ||
    !sessionToken
  )
    throw new XmaxError({
      code: XmaxErrorCode.apiError,
      message: 'Invalid storage credential payload',
    });

  const configuration = {
    bucket,
    region,
    endpoint: data.endpoint.trim(),
    prefix: data.prefix.trim(),
    credential: { accessKeyID, secretAccessKey, sessionToken },
  };

  storageEndpoint(configuration);

  return configuration;
}

/**
 * Resolves the authorized bucket endpoint, adding its bucket prefix to regional endpoints.
 *
 * @param config The validated client configuration.
 */
export function storageEndpoint(
  config: StorageConfiguration
): URL {
  const endpoint =
    config.endpoint ||
    `https://${config.bucket}.cos.${config.region}.myqcloud.com`;
  const url = httpURL(
    endpoint.includes('://') ? endpoint : `https://${endpoint}`,
  );

  if (url.hostname.toLowerCase().startsWith('cos.'))
    return new URL(
      `${url.protocol}//${config.bucket}.${url.host}${url.pathname}${url.search}${url.hash}`,
    );

  return url;
}

/**
 * Resolves a valid upload URL or constructs an encoded URL from the authorized endpoint and object
 * key.
 *
 * @param config The validated client configuration.
 * @param key The authorized object key, encoded separately by path segment.
 * @param candidate The service-returned URL; invalid or missing values use the configured object
 *   URL.
 */
export function objectURL(
  config: StorageConfiguration,
  key: string,
  candidate?: string,
): string {
  if (candidate) {
    try {
      return httpURL(
        candidate.startsWith('//') ? `https:${candidate}` : candidate,
      ).href;
    } catch {
      /**
       * Fall back to the configured object URL.
       */
    }
  }

  const url = storageEndpoint(config);

  return `${`${url.origin}${url.pathname}`.replace(/\/+$/, '')}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
