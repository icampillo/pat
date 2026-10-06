// Hosting/proxy errors can be plain text or HTML, not our JSON envelope.
export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const unavailable =
    response.status === 401
      ? 'Votre session a expiré. Reconnectez-vous pour continuer.'
      : `${fallback} (HTTP ${response.status})`;
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(unavailable);
  }
  if (!result || typeof result !== 'object') throw new Error(unavailable);
  if (!response.ok) {
    const error = 'error' in result ? result.error : undefined;
    throw new Error(
      error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        error.message
        ? error.message
        : unavailable,
    );
  }
  if (!('data' in result) || result.data === undefined || result.data === null)
    throw new Error(unavailable);
  return result.data as T;
}
