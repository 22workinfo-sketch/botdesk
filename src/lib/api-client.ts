/**
 * Safe client-side API request wrapper for BackStage.
 * - Handles empty/non-JSON responses (e.g. 204 No Content, HTML 403, 502/504 gateways).
 * - Avoids "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
 * - Automatically injects CSRF headers and sanitizes error messages.
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  validationErrors?: string[];
}

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, any> | any[] | null;
};

export async function safeFetchJson<T = any>(
  url: string,
  init?: ApiRequestInit
): Promise<ApiResponse<T>> {
  const headers = new Headers(init?.headers || {});
  
  if (!headers.has("X-Requested-With")) {
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  // If body is an object (and not FormData / Blob / URLSearchParams), serialize to JSON
  let body = init?.body;
  if (
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof URLSearchParams)
  ) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, {
      ...init,
      headers,
      body,
    });

    // 204 No Content has no body
    if (res.status === 204) {
      return { ok: true, status: 204, data: {} as T };
    }

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      try {
        const text = await res.text();
        if (!text || !text.trim()) {
          return {
            ok: res.ok,
            status: res.status,
            data: {} as T,
            error: res.ok ? undefined : `Request failed with HTTP ${res.status}`,
          };
        }
        const json = JSON.parse(text);
        if (!res.ok) {
          const errMsg =
            json.error ||
            json.message ||
            (Array.isArray(json.validationErrors) && json.validationErrors.join(", ")) ||
            `HTTP ${res.status}: Request failed`;
          return {
            ok: false,
            status: res.status,
            data: json,
            error: errMsg,
            validationErrors: Array.isArray(json.validationErrors)
              ? json.validationErrors
              : undefined,
          };
        }
        return {
          ok: true,
          status: res.status,
          data: json,
        };
      } catch (jsonErr: any) {
        return {
          ok: false,
          status: res.status,
          error: `Malformed JSON response from server (HTTP ${res.status}).`,
        };
      }
    } else {
      // Non-JSON response (e.g. text/html from a proxy or 403 Forbidden plain text)
      const rawText = await res.text().catch(() => "");
      let safeError = `HTTP ${res.status}: Unexpected response format.`;
      
      if (res.status === 403) {
        safeError = "Forbidden: Request was rejected by server origin or permission policy.";
      } else if (res.status === 401) {
        safeError = "Session expired or unauthorized. Please log in again.";
      } else if (res.status === 404) {
        safeError = "The requested resource was not found (HTTP 404).";
      } else if (res.status >= 500) {
        safeError = "Server encountered an internal error. Please try again shortly.";
      } else if (rawText && rawText.length < 200 && !rawText.includes("<!DOCTYPE")) {
        safeError = rawText.trim();
      }

      return {
        ok: res.ok,
        status: res.status,
        error: safeError,
      };
    }
  } catch (networkErr: any) {
    const isAbort = networkErr?.name === "AbortError";
    const msg = isAbort
      ? "Request timed out or was aborted."
      : "Network connection error. Check your internet or tunnel connection.";
    return {
      ok: false,
      status: 0,
      error: msg,
    };
  }
}
