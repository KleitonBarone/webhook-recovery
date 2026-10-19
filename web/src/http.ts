export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Validate every JSON response before the UI uses it.
export async function api<T>(
  path: string,
  schema: { assert(value: unknown): T },
  init: RequestInit = {},
) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
    ...init,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      value && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : "Request failed. Try again.";
    throw new HttpError(message, response.status);
  }
  try {
    return schema.assert(value);
  } catch {
    throw new HttpError("The server returned an unexpected response. Refresh and try again.", 502);
  }
}
export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
