//
//  StorageValidation.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { record, nonEmpty } from '../Network/ApiResponse';
import { XmaxError, XmaxErrorCode } from '../../Foundation/Errors/XmaxError';
import type { StorageConfiguration } from '../../Foundation/Storage/StorageConfiguration';
import { storageEndpoint } from '../../Foundation/Storage/StorageValidation';

export {
  httpURL,
  filePath,
  uploadMetadata,
  storageEndpoint,
  objectURL,
} from '../../Foundation/Storage/StorageValidation';

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
