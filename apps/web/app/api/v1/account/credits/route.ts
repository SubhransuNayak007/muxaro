import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      tier: 'unlimited',
      accountTier: 'PRO',
      queuePriority: 10,
      maxConcurrentJobs: 5,
      baseLimit: 100,
      baseUsed: 0,
      baseRemaining: 100,
      extraCreditsEarned: 0,
      extraCreditsRemaining: 0,
      extraCreditsExpiresAt: null,
      totalAvailableIndividual: 100,
      maxIndividualWithRewards: 100,
      rewardedAdsUsedToday: 0,
      rewardedAdsDailyCap: 10,
      remainingRewardedAdsToday: 10,
      playlistJobsLimit: 10,
      playlistJobsUsed: 0,
      playlistJobsRemaining: 10,
      maxPlaylistItems: 50,
      rollingWindowHours: 24,
      resetCountdownSeconds: 86400,
      nextResetIso: new Date(Date.now() + 86400000).toISOString(),
      edgeRuntime: 'vercel-serverless',
    },
    requestId: `crd_${Date.now()}`,
  });
}
