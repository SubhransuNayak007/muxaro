/**
 * MUXARO Media Processing Engine - Argument & Path Sanitizer
 * Defense-in-depth against command injection, path traversal, and malicious filenames.
 */

import path from 'node:path';

export class ProcessSanitizer {
  // Disallowed characters in command line argument values
  private static readonly DANGEROUS_CHARS_REGEX = /[;&|`$><\r\n\0]/;

  /**
   * Validates that an argument string does not contain shell control characters.
   */
  public static validateArgument(arg: string): string {
    if (this.DANGEROUS_CHARS_REGEX.test(arg)) {
      throw new Error(`Security Exception: Argument contains prohibited shell characters: "${arg}"`);
    }
    return arg;
  }

  /**
   * Validates an array of arguments passed to child_process.spawn.
   */
  public static validateArguments(args: string[]): string[] {
    for (const arg of args) {
      this.validateArgument(arg);
    }
    return args;
  }

  /**
   * Validates that a file path is safe and optionally contained within an allowed directory root.
   */
  public static validatePath(filePath: string, allowedRoot?: string): string {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Path must be a non-empty string');
    }

    if (this.DANGEROUS_CHARS_REGEX.test(filePath)) {
      throw new Error(`Security Exception: File path contains prohibited characters: "${filePath}"`);
    }

    const resolved = path.resolve(filePath);

    if (allowedRoot) {
      const resolvedRoot = path.resolve(allowedRoot);
      const relative = path.relative(resolvedRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Security Exception: Path traversal attempt outside allowed root: "${filePath}"`);
      }
    }

    return resolved;
  }

  /**
   * Sanitizes a filename for safe inclusion in zip archives or local downloads.
   * Strips path separators, control characters, and keeps human-readable characters.
   */
  public static sanitizeFilename(filename: string, fallback = 'media_item'): string {
    if (!filename || typeof filename !== 'string') {
      return fallback;
    }

    // Strip directory traversal or absolute path fragments
    const base = path.basename(filename);

    // Remove control characters, null bytes, quotes, slashes, wildcards
    let sanitized = base.replace(/[/\\?%*:|"<>#~`\0\r\n]/g, '_').trim();

    // Remove leading/trailing dots to prevent hidden or special files (. or ..)
    sanitized = sanitized.replace(/^\.+/, '').replace(/\.+$/, '');

    // Limit length to 200 characters
    if (sanitized.length > 200) {
      const ext = path.extname(sanitized);
      const name = path.basename(sanitized, ext);
      sanitized = `${name.slice(0, 190)}${ext}`;
    }

    return sanitized.length > 0 ? sanitized : fallback;
  }
}
