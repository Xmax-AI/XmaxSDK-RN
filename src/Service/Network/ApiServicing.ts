//
//  ApiServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The internal JSON request interface shared by realtime and storage services.
 */
export interface ApiServicing {

  /**
   * Requests data from an API root and propagates cancellation to transport. A response that wins
   * cancellation remains available for resource reclamation.
   *
   * @param method The HTTP request method.
   * @param path The request path relative to the API root.
   * @param body The JSON-serializable request body; omitted for requests without a payload.
   * @param signal The operation's cancellation signal.
   * @returns The business data after transport and response validation.
   */
  request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
