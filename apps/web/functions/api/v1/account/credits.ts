/**
 * GET /api/v1/account/credits
 * Credits and ads are disabled across MUXARO; local browser tools are unlimited.
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async (context) => optionsResponse(context.request);

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'account/credits');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_crd_');
  return jsonResponse(
    {
      success: true,
      data: {
        creditsEnabled: false,
        tier: 'unlimited_local',
        accountTier: 'LOCAL_FREE',
        queuePriority: 1,
        maxConcurrentJobs: 2,
        baseLimit: 0,
        baseUsed: 0,
        baseRemaining: 0,
        extraCreditsEarned: 0,
        extraCreditsRemaining: 0,
        extraCreditsExpiresAt: null,
        totalAvailableIndividual: 0,
        maxIndividualWithRewards: 0,
        rewardedAdsUsedToday: 0,
        rewardedAdsDailyCap: 0,
        remainingRewardedAdsToday: 0,
        playlistJobsLimit: 0,
        playlistJobsUsed: 0,
        playlistJobsRemaining: 0,
        maxPlaylistItems: 50,
        rollingWindowHours: 24,
        resetCountdownSeconds: 0,
        nextResetIso: '',
        edgeRuntime: 'cloudflare-pages-functions',
      },
      requestId: reqId,
    },
    200,
    {},
    context.request
  );
};
