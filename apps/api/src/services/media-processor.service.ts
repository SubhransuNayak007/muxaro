/**
 * Project MUXARO - Media Processor Service
 *
 * Dedicated media processing and extraction coordinator:
 * - Hardened yt-dlp argument construction with anti-bot evasion
 * - Multi-stage player client fallback chains (ios -> android -> tv -> mweb -> web)
 * - Automatic detection of BotGuard and datacenter IP blocks
 * - Clean mapping to MUXARO Direct residential client guidance
 */

import {
  getYtDlpBaseArgs,
  isBotVerificationError,
  BotVerificationError,
  runWithYtDlpClientChain,
  mapHumanFriendlyError,
  selectTurboFlowStrategy,
  parseResolutionHeight,
  YTDLP_DEFAULT_PLAYER_CLIENTS,
  YTDLP_FALLBACK_CLIENT_CHAINS,
  resolveCookiesArg,
  materializeCookieContent,
  formatPoToken,
  buildYouTubeExtractorArg,
  resolveBgUtilBaseUrl,
  buildResilientYtDlpArgs,
  poTokenCookieService,
  type CookieResolutionResult,
  type PoTokenResolutionResult,
  type YtDlpResilientOptions,
  type YtDlpBaseArgsOptions,
  type ClientChainRunOptions,
  type TurboFlowDecision,
  type TurboFlowInput,
} from './turboflow.service.js';

export {
  getYtDlpBaseArgs,
  isBotVerificationError,
  BotVerificationError,
  runWithYtDlpClientChain,
  mapHumanFriendlyError,
  selectTurboFlowStrategy,
  parseResolutionHeight,
  YTDLP_DEFAULT_PLAYER_CLIENTS,
  YTDLP_FALLBACK_CLIENT_CHAINS,
  resolveCookiesArg,
  materializeCookieContent,
  formatPoToken,
  buildYouTubeExtractorArg,
  resolveBgUtilBaseUrl,
  buildResilientYtDlpArgs,
  poTokenCookieService,
  type CookieResolutionResult,
  type PoTokenResolutionResult,
  type YtDlpResilientOptions,
  type YtDlpBaseArgsOptions,
  type ClientChainRunOptions,
  type TurboFlowDecision,
  type TurboFlowInput,
};

export class MediaProcessorService {
  /**
   * Constructs resilient base arguments for yt-dlp with anti-bot extractor options.
   */
  public buildYtDlpArgs(options: YtDlpBaseArgsOptions = {}): string[] {
    return getYtDlpBaseArgs(options);
  }

  /**
   * Checks whether an error or stderr string is caused by YouTube bot verification.
   */
  public isBotBlocked(errOrMessage: unknown): boolean {
    return isBotVerificationError(errOrMessage);
  }

  /**
   * Executes a task using yt-dlp across a fallback chain of player_client emulations.
   */
  public async executeWithClientChain<T>(
    runFn: (clientChain: string, baseArgs: string[]) => Promise<T>,
    options?: ClientChainRunOptions
  ): Promise<T> {
    return runWithYtDlpClientChain(runFn, options);
  }

  /**
   * Translates error codes and stderr messages into user-friendly copy with MUXARO Direct guidance.
   */
  public mapError(code?: string, rawMessage?: string): string {
    return mapHumanFriendlyError(code, rawMessage);
  }
}

export const mediaProcessorService = new MediaProcessorService();
