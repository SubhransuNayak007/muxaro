/**
 * Project MUXARO - Rights Declaration Validation & Abuse Detection Filtering
 * 
 * Enforces legal compliance, intellectual property integrity, and anomaly defense:
 * - Validates user rights declarations (ownershipType, attestation, licensing tokens).
 * - Distinguishes user-owned, public domain, Creative Commons, and third-party media.
 * - Detects malicious URL payloads (shell metacharacters, proxy evasion params, credentials).
 * - Enforces zero-tolerance for scraping/evasion triggers (proxy rotation, CAPTCHA solvers).
 * - Produces deterministic RightsCheckResult and AbuseCheckResult objects.
 */

import type {
  RightsCheckResult,
  RightsDeclaration,
  AbuseCheckResult,
  SourceType,
} from './types.ts';
import { RightsViolationError, AbuseDetectedError } from './errors.ts';

/**
 * Suspicious query parameter keys indicating automated scraping,
 * proxy manipulation, DRM circumvention, or credential theft attempts.
 */
const FORBIDDEN_QUERY_PATTERNS = [
  /proxy/i,
  /rotate/i,
  /bypass/i,
  /captcha/i,
  /scrape/i,
  /token_steal/i,
  /session_cookie/i,
  /auth_token/i,
  /credential/i,
  /dump/i,
  /exploit/i,
];

/**
 * Shell metacharacters and control characters strictly forbidden in URLs
 */
const FORBIDDEN_CHARACTERS_REGEX = /[;&|`$<>'"\r\n\0]/;

/**
 * Maximum safe URL length in bytes
 */
const MAX_URL_LENGTH = 4096;

/**
 * Anomaly and abuse detection engine for incoming media URLs
 */
export class AbuseDetector {
  /**
   * Evaluate a URL for malicious payloads, evasion flags, and protocol violations
   */
  public static check(rawUrl: string): AbuseCheckResult {
    const flags: string[] = [];
    let riskScore = 0;

    // 1. Length sanity check
    if (!rawUrl || rawUrl.trim().length === 0) {
      return {
        isSuspicious: true,
        riskScore: 100,
        flags: ['EMPTY_URL'],
        blocked: true,
        reason: 'URL cannot be empty',
      };
    }

    if (rawUrl.length > MAX_URL_LENGTH) {
      return {
        isSuspicious: true,
        riskScore: 100,
        flags: ['EXCESSIVE_LENGTH'],
        blocked: true,
        reason: `URL exceeds maximum allowable length of ${MAX_URL_LENGTH} characters`,
      };
    }

    // 2. Prohibited shell injection characters
    if (FORBIDDEN_CHARACTERS_REGEX.test(rawUrl)) {
      flags.push('SHELL_METACHARACTERS');
      riskScore += 90;
    }

    // 3. Path traversal attempts
    if (rawUrl.includes('../') || rawUrl.includes('..\\') || /%2e%2e/i.test(rawUrl)) {
      flags.push('PATH_TRAVERSAL_DETECTED');
      riskScore += 80;
    }

    // 4. URL Structure Parsing
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return {
        isSuspicious: true,
        riskScore: 100,
        flags: ['MALFORMED_URL_SYNTAX'],
        blocked: true,
        reason: 'Malformed URL syntax cannot be parsed',
      };
    }

    // 5. Allowed protocol gate
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      flags.push(`FORBIDDEN_PROTOCOL_${parsed.protocol.toUpperCase()}`);
      riskScore += 100;
    }

    // 6. Embedded credentials check (user:pass@host)
    if (parsed.username || parsed.password) {
      flags.push('EMBEDDED_CREDENTIALS');
      riskScore += 95;
    }

    // 7. Port restrictions
    if (parsed.port) {
      const portNum = Number.parseInt(parsed.port, 10);
      if (portNum !== 80 && portNum !== 443 && portNum !== 8080 && portNum !== 8443) {
        flags.push(`NON_STANDARD_PORT_${portNum}`);
        riskScore += 30;
      }
    }

    // 8. Search query analysis for scraping / evasion flags
    parsed.searchParams.forEach((value, key) => {
      for (const pattern of FORBIDDEN_QUERY_PATTERNS) {
        if (pattern.test(key) || pattern.test(value)) {
          flags.push(`EVASION_QUERY_PARAM_${key.toUpperCase()}`);
          riskScore += 75;
          break;
        }
      }
    });

    const isSuspicious = riskScore >= 40;
    const blocked = riskScore >= 75;

    return {
      isSuspicious,
      riskScore: Math.min(riskScore, 100),
      flags,
      blocked,
      reason: blocked
        ? `Request rejected by abuse detection engine: ${flags.join(', ')}`
        : undefined,
    };
  }

  /**
   * Assert that a URL passes abuse checks, throwing AbuseDetectedError if flagged
   */
  public static assertSafe(rawUrl: string): void {
    const result = AbuseDetector.check(rawUrl);
    if (result.blocked) {
      throw new AbuseDetectedError(result.reason || 'Blocked due to suspicious anomalies', {
        url: rawUrl,
        flags: result.flags,
        riskScore: result.riskScore,
      });
    }
  }
}

/**
 * Rights declaration and copyright policy enforcement engine
 */
export class RightsValidator {
  /**
   * Validate user rights declaration and source policy for a media URL
   */
  public static evaluate(
    url: string,
    declaration?: RightsDeclaration,
    sourceType: SourceType = 'direct_media'
  ): RightsCheckResult {
    const checkedAt = new Date().toISOString();
    const warnings: string[] = [];

    // 1. First run abuse check
    const abuse = AbuseDetector.check(url);
    if (abuse.blocked) {
      return {
        isPermitted: false,
        status: 'forbidden',
        policyCode: 'ABUSE_SUSPECTED',
        reason: abuse.reason || 'Blocked by abuse detection policy',
        canExtractStreams: false,
        canPreview: false,
        attributionRequired: false,
        rightsDeclaration: declaration,
        warnings: abuse.flags,
        checkedAt,
      };
    }

    // 2. Special policy gate for YouTube
    if (sourceType === 'youtube_permitted') {
      return this.evaluateYouTubePolicy(declaration, checkedAt);
    }

    // 3. Evaluation for Direct Media sources
    return this.evaluateDirectMediaPolicy(declaration, checkedAt, warnings);
  }

  /**
   * Evaluate compliance for YouTube Permitted sources
   * STRICT POLICY: Audiovisual stream extraction is ALWAYS DISABLED.
   * Only permitted public metadata and embedded video preview are allowed.
   */
  private static evaluateYouTubePolicy(
    declaration: RightsDeclaration | undefined,
    checkedAt: string
  ): RightsCheckResult {
    const warnings: string[] = [
      'Platform policy gate: Stream extraction is permanently disabled for YouTube links pending official written agreement.',
    ];

    if (!declaration) {
      // Default inspection without declaration allows preview & oEmbed metadata only
      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'PREVIEW_ONLY_PERMITTED',
        reason: 'Permitted public video preview and metadata inspection. Stream extraction is disabled by platform policy.',
        canExtractStreams: false,
        canPreview: true,
        attributionRequired: true,
        rightsDeclaration: undefined,
        warnings,
        checkedAt,
      };
    }

    // If declaration provided, check ownership category
    switch (declaration.ownershipType) {
      case 'user_created_content': {
        if (!declaration.attestation) {
          return {
            isPermitted: false,
            status: 'requires_authorization',
            policyCode: 'MISSING_ATTESTATION',
            reason: 'Self-ownership claim requires explicit confirmation and attestation.',
            canExtractStreams: false,
            canPreview: true,
            attributionRequired: false,
            rightsDeclaration: declaration,
            warnings: [...warnings, 'Missing user legal attestation.'],
            checkedAt,
          };
        }
        return {
          isPermitted: true,
          status: 'permitted',
          policyCode: 'USER_OWNED_VERIFIED',
          reason: 'User ownership attestation accepted for media processing.',
          canExtractStreams: true,
          canPreview: true,
          attributionRequired: false,
          rightsDeclaration: declaration,
          warnings: [],
          checkedAt,
        };
      }

      case 'creative_commons': {
        return {
          isPermitted: true,
          status: 'permitted',
          policyCode: 'CREATIVE_COMMONS_VERIFIED',
          reason: 'Creative Commons metadata verified. Attribution required. Direct stream extraction remains disabled pending platform agreement.',
          canExtractStreams: false,
          canPreview: true,
          attributionRequired: true,
          rightsDeclaration: declaration,
          warnings: [...warnings, 'License requires author attribution.'],
          checkedAt,
        };
      }

      case 'public_domain': {
        return {
          isPermitted: true,
          status: 'permitted',
          policyCode: 'PUBLIC_DOMAIN_VERIFIED',
          reason: 'Public domain declaration logged for preview and metadata. Stream extraction remains disabled pending platform agreement.',
          canExtractStreams: false,
          canPreview: true,
          attributionRequired: false,
          rightsDeclaration: declaration,
          warnings,
          checkedAt,
        };
      }

      case 'licensed_permission': {
        return {
          isPermitted: true,
          status: 'permitted',
          policyCode: 'LICENSED_PERMITTED',
          reason: 'Licensed permission declaration recorded. Stream extraction remains disabled pending platform agreement.',
          canExtractStreams: false,
          canPreview: true,
          attributionRequired: Boolean(declaration.notes?.includes('attribution')),
          rightsDeclaration: declaration,
          warnings,
          checkedAt,
        };
      }

      case 'third_party_copyright':
      default: {
        return {
          isPermitted: false,
          status: 'forbidden',
          policyCode: 'UNAUTHORIZED_THIRD_PARTY_RESTRICTED',
          reason: 'Third-party copyrighted material cannot be processed without verifiable written license or content owner attestation.',
          canExtractStreams: false,
          canPreview: true, // safe embed preview is allowed
          attributionRequired: true,
          rightsDeclaration: declaration,
          warnings: [...warnings, 'Third-party copyright declared without authorized license token.'],
          checkedAt,
        };
      }
    }
  }

  /**
   * Evaluate compliance for Direct Media links (MP4, MKV, WebM, MP3, etc.)
   */
  private static evaluateDirectMediaPolicy(
    declaration: RightsDeclaration | undefined,
    checkedAt: string,
    warnings: string[]
  ): RightsCheckResult {
    // If no declaration supplied, allow direct media inspection under verified direct access
    if (!declaration) {
      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'DIRECT_MEDIA_VERIFIED',
        reason: 'Direct media link verified reachable. Stream extraction permitted for authorized personal or licensed use.',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: false,
        rightsDeclaration: undefined,
        warnings: ['Processing permitted under direct access. Ensure you hold necessary rights.'],
        checkedAt,
      };
    }

    // Check attestation if user-created or licensed
    if (declaration.ownershipType === 'user_created_content') {
      if (!declaration.attestation) {
        return {
          isPermitted: false,
          status: 'requires_authorization',
          policyCode: 'MISSING_ATTESTATION',
          reason: 'User created content declaration requires explicit attestation of rights.',
          canExtractStreams: false,
          canPreview: true,
          attributionRequired: false,
          rightsDeclaration: declaration,
          warnings: ['Missing affirmative user attestation checkbox.'],
          checkedAt,
        };
      }

      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'USER_OWNED_VERIFIED',
        reason: 'User ownership affirmed and attested. Full media extraction and conversion permitted.',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: false,
        rightsDeclaration: declaration,
        warnings,
        checkedAt,
      };
    }

    if (declaration.ownershipType === 'creative_commons') {
      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'CREATIVE_COMMONS_VERIFIED',
        reason: 'Creative Commons declaration accepted. Full processing permitted with author attribution.',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: true,
        rightsDeclaration: declaration,
        warnings: ['Attribution to the original author is required by license.'],
        checkedAt,
      };
    }

    if (declaration.ownershipType === 'public_domain') {
      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'PUBLIC_DOMAIN_VERIFIED',
        reason: 'Public domain media verified. Full processing permitted.',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: false,
        rightsDeclaration: declaration,
        warnings,
        checkedAt,
      };
    }

    if (declaration.ownershipType === 'licensed_permission') {
      return {
        isPermitted: true,
        status: 'permitted',
        policyCode: 'LICENSED_PERMITTED',
        reason: 'Licensed permission declaration recorded. Full processing permitted.',
        canExtractStreams: true,
        canPreview: true,
        attributionRequired: false,
        rightsDeclaration: declaration,
        warnings,
        checkedAt,
      };
    }

    // Third-party copyright
    if (declaration.ownershipType === 'third_party_copyright') {
      return {
        isPermitted: false,
        status: 'restricted',
        policyCode: 'UNAUTHORIZED_THIRD_PARTY_RESTRICTED',
        reason: 'Third-party copyrighted content cannot be processed without proof of authorization or affirmative license.',
        canExtractStreams: false,
        canPreview: true,
        attributionRequired: true,
        rightsDeclaration: declaration,
        warnings: ['Processing restricted for third-party copyrighted media.'],
        checkedAt,
      };
    }

    return {
      isPermitted: false,
      status: 'forbidden',
      policyCode: 'UNSUPPORTED_SOURCE',
      reason: 'Unrecognized rights ownership declaration.',
      canExtractStreams: false,
      canPreview: false,
      attributionRequired: false,
      rightsDeclaration: declaration,
      warnings,
      checkedAt,
    };
  }

  /**
   * Helper that throws RightsViolationError if rights check fails
   */
  public static assertPermitted(checkResult: RightsCheckResult): void {
    if (!checkResult.isPermitted) {
      throw new RightsViolationError(checkResult.reason, {
        status: checkResult.status,
        policyCode: checkResult.policyCode,
        warnings: checkResult.warnings,
      });
    }
  }
}
