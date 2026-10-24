//
//  HttpTransport.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A cancellable HTTP interface with response status and cancellable body reading.
 *
 * @param url An absolute HTTP or HTTPS URL.
 * @param options The HTTP method, headers, payload, and cancellation signal.
 */
export type HttpTransport = (
  url: string,
  options: {

    /**
     * The HTTP request method.
     */
    method: string;

    /**
     * The transport request headers; never log their credentials.
     */
    headers: Readonly<Record<string, string>>;

    /**
     * The serialized payload, omitted when the request has no body.
     */
    body?: string;

    /**
     * The operation's cancellation signal.
     */
    signal: AbortSignal;
  },
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/**
 * Performs a cancellable text request while preserving transport errors. ApiService owns
 * cancellation and timeout policy.
 *
 * @param url An absolute HTTP or HTTPS URL.
 * @param options The HTTP method, headers, payload, and cancellation signal.
 */
export const requestHTTP: HttpTransport = (
  url,
  options
) => {
  if (typeof XMLHttpRequest === 'undefined') return fetch(
    url,
    options
  );

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const { signal } = options;
    let finished = false;
    const cleanup = () => {
      finished = true;
      signal.removeEventListener(
        'abort',
        cancel
      );
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
    };
    const fail = (error: unknown) => {
      if (finished) return;

      cleanup();
      reject(error);
    };
    const aborted = () => {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      fail(error);
    };
    const cancel = () => {
      if (finished) return;

      // XHR may emit no event when cancelled before send(); settle the request explicitly.
      aborted();
      xhr.abort();
    };

    if (signal.aborted) {
      aborted();
      return;
    }

    try {
      xhr.open(
        options.method,
        url,
        true
      );
      xhr.responseType = 'text';
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(options.headers))
        xhr.setRequestHeader(
          name,
          value
        );

      xhr.onload = () => {
        if (finished) return;

        const status = xhr.status;
        const body = xhr.responseText;
        cleanup();
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => body,
        });
      };
      // Expose response content only on success; native failure bodies may contain sensitive request data.
      xhr.onerror = () =>
        fail(new Error(xhr.responseText.trim() || 'Network request failed'));
      xhr.ontimeout = () =>
        fail(new Error(xhr.responseText.trim() || 'Network request timed out'));
      xhr.onabort = aborted;
      signal.addEventListener(
        'abort',
        cancel,
        { once: true }
      );
      if (signal.aborted) cancel();
      else xhr.send(options.body ?? null);
    } catch (error) {
      fail(error);
    }
  });
};
