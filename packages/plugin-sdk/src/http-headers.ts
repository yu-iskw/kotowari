export function bearerTokenFromHeaders(
  headers: Record<string, string | undefined>,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization' && value !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
      return match?.[1];
    }
  }
  return undefined;
}
