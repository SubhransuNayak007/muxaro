import { NextResponse } from 'next/server';

export async function GET() {
  const nextReset = new Date(Date.now() + 86400000).toISOString();
  return NextResponse.json({
    success: true,
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
      edgeRuntime: 'edge-unified',
      features: {
        maxResolution: '8k',
        audioBitrateKbps: 320,
        unlimitedDownloads: false,
        highPriorityQueue: false,
      },
    },
    requestId: `ent_${Date.now()}`,
  });
}
