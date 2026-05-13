/**
 * SSRF guard for IBKR gateway URLs.
 *
 * Accepted addresses:
 *   - localhost
 *   - 127.0.0.1 / ::1
 *   - RFC 1918 ranges:  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - Hostnames ending in .local (mDNS / LAN host aliases)
 *
 * Everything else is rejected so a user-controlled URL cannot probe
 * cloud metadata endpoints (169.254.x.x), internal services, or the
 * public internet.
 */

/** Private-IP regex patterns (covers all RFC-1918 + loopback addresses). */
const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
]

/**
 * Returns true when `rawUrl` points to a local or private-network host.
 * Throws on unparseable URLs.
 */
export function isPrivateGatewayUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid IBKR gateway URL (cannot parse): ${rawUrl}`)
  }

  const hostname = parsed.hostname

  // Hostnames ending in .local (e.g. ibkr-gw.local)
  if (hostname.endsWith('.local')) return true

  // Loopback + RFC-1918 ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true
  }

  return false
}
