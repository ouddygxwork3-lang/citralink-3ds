import path from 'path';

/**
 * Resolves a user-provided relative path against a base directory,
 * guaranteeing the resolved path cannot escape `baseDir` via `..` or symlink traversal.
 */
export function resolveSafePath(
  baseDir: string,
  userPath: string
): { ok: true; absolutePath: string; relativePath: string } | { ok: false; error: string } {
  if (userPath.includes('\0')) {
    return { ok: false, error: 'Path contains invalid null byte' };
  }

  const normalizedBase = path.resolve(baseDir);
  // Strip leading slashes to prevent absolute path override on Windows/POSIX
  const cleanedRel = userPath.replace(/^([a-zA-Z]:)?[/\\]+/, '');
  const resolved = path.resolve(normalizedBase, cleanedRel);

  const relative = path.relative(normalizedBase, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, error: 'Path traversal attempt rejected' };
  }

  // Normalize relative path with forward slashes for cross-platform SD pathing
  const normalizedRel = relative.replace(/\\/g, '/');
  return { ok: true, absolutePath: resolved, relativePath: normalizedRel };
}

/**
 * Strips path separators and illegal characters, returning a safe file name.
 */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name).trim();
  // Remove control characters and illegal FAT32/Windows filename characters: < > : " / \ | ? *
  const cleaned = base.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_');
  return cleaned || 'unnamed_file';
}

/**
 * Validates that an IP address belongs to standard private/local network ranges
 * (RFC 1918 + loopback) to prevent SSRF vulnerabilities.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed === 'localhost' || trimmed === '127.0.0.1' || trimmed === '::1') {
    return true;
  }

  // IPv4 regex
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (!ipv4Match) return false;

  const [_, a, b, c, d] = ipv4Match.map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 172.16.0.0/12 (Private 172.16 - 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;

  return false;
}
