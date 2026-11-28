/**
 * Reciprocal Rank Fusion (RRF) combiner: merges heterogeneous sparse (BM25)
 * and dense semantic rank lists without brittle raw score normalization.
 */
export function computeReciprocalRankFusion<T extends { id: string }>(
  rankedLists: Array<{ weight?: number; items: T[] }>,
  k = 60
): Array<{ item: T; rrfScore: number }> {
  const scores = new Map<string, { item: T; rrfScore: number }>();

  for (const list of rankedLists) {
    const weight = list.weight ?? 1.0;
    list.items.forEach((item, idx) => {
      const rank = idx + 1;
      const contrib = weight / (k + rank);
      const existing = scores.get(item.id);
      if (existing) {
        existing.rrfScore += contrib;
      } else {
        scores.set(item.id, { item, rrfScore: contrib });
      }
    });
  }

  return Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
