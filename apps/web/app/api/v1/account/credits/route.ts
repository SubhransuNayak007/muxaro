import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await proxyToBackend(req, 'account/credits');
  if (upstream) return upstream;

  const nextReset = new Date(Date.now() + 86400000).toISOString();
  return NextResponse.json({
    success: true,
    backendConnected: false,
    data: {
      tier: 'guest',
      accountTier: 'GUEST',
      queuePriority: 1,
      maxConcurrentJobs: 2,
      baseLimit: 10,
      baseUsed: 0,
      baseRemaining: 10,
      extraCreditsEarned: 0,
      extraCreditsRemaining: 0,
      extraCreditsExpiresAt: null,
      totalAvailableIndividual: 10,
      maxIndividualWithRewards: 10,
      rewardedAdsUsedToday: 0,
      rewardedAdsDailyCap: 0,
      remainingRewardedAdsToday: 0,
      playlistJobsLimit: 1,
      playlistJobsUsed: 0,
      playlistJobsRemaining: 1,
      maxPlaylistItems: 50,
      rollingWindowHours: 24,
      resetCountdownSeconds: 86400,
      nextResetIso: nextReset,
      edgeRuntime: 'unbacked-guest',
    },
    requestId: `crd_${Date.now()}`,
  });
}
