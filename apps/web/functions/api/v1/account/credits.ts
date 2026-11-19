/**
 * GET /api/v1/account/credits
 * Cloudflare Edge Account Quota & Credits
 */

import type { PagesFunction } from '../_types';
import { generateRequestId, jsonResponse, optionsResponse, tryProxyUpstream } from '../_utils';

export const onRequestOptions: PagesFunction = async () => optionsResponse();

export const onRequestGet: PagesFunction = async (context) => {
  const upstream = await tryProxyUpstream(context.request, context.env, 'account/credits');
  if (upstream) return upstream;

  const reqId = generateRequestId('edge_crd_');
  return jsonResponse({
    success: true,
    data: {
      tier: 'guest',
      accountTier: 'GUEST',
      queuePriority: 1,
      maxConcurrentJobs: 1,
      baseLimit: 10,
      baseUsed: 0,
      baseRemaining: 10,
      extraCreditsEarned: 0,
      extraCreditsRemaining: 0,
      extraCreditsExpiresAt: null,
      totalAvailableIndividual: 10,
      maxIndividualWithRewards: 10,
      rewardedAdsUsedToday: 0,
      rewardedAdsDailyCap: 5,
      remainingRewardedAdsToday: 5,
      playlistJobsLimit: 1,
      playlistJobsUsed: 0,
      playlistJobsRemaining: 1,
      maxPlaylistItems: 5,
      rollingWindowHours: 24,
      resetCountdownSeconds: 86400,
      nextResetIso: new Date(Date.now() + 86400000).toISOString(),
      edgeRuntime: 'cloudflare-pages-functions',
    },
    requestId: reqId,
  });
};
