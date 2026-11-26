export const TLS_PORT = 9440;
export const PLAIN_PORT = 9000;

export function defaultPort(secure: boolean): number {
  return secure ? TLS_PORT : PLAIN_PORT;
}

export function portAfterTlsToggle(port: number, secure: boolean): number {
  return port === defaultPort(!secure) ? defaultPort(secure) : port;
}

export function isLoopbackHost(raw: string): boolean {
  const host = normalizeHost(raw).toLowerCase();
  return (
    ["localhost", "::1", "[::1]"].includes(host) ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** Drops the port because an HTTP port isn't the native port ch-gui uses. */
export function normalizeHost(raw: string): string {
  let host = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  host = host.replace(/[/?#].*$/, "");
  host = host.replace(/^[^@]*@/, "");
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colons = host.split(":").length - 1;
  return colons === 1 ? host.slice(0, host.indexOf(":")) : host;
}
