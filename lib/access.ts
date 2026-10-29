export const ACCESS_COOKIE = "va_access";

/** Hash des Zugangscodes – im Cookie steht nie der Code selbst. */
export async function accessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`veritas-assistant:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
