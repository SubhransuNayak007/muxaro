'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileVideo,
  MonitorPlay,
  Headphones,
  Wrench,
  HelpCircle,
  ChevronRight,
  BookOpen,
  ShieldCheck,
  Film,
  FileText,
  Music,
  Search,
} from 'lucide-react';
import type { DocItem } from '@/content';

function getDocIcon(slug: string) {
  switch (slug) {
    case 'video-studio':
      return Film;
    case 'pdf-studio':
      return FileText;
    case 'audio-studio':
      return Music;
    case 'formats':
      return FileVideo;
    case 'resolutions':
      return MonitorPlay;
    case 'audio-quality':
      return Headphones;
    case 'troubleshooting':
      return Wrench;
    case 'faq':
      return HelpCircle;
    case 'security':
      return ShieldCheck;
    default:
      return BookOpen;
  }
}

export default function DocsCatalogClient({ docs }: { docs: DocItem[] }) {
  const [category, setCategory] = useState<string>('All');
  const [query, setQuery] = useState('');

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const d of docs) set.add(d.category);
    return Array.from(set);
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (category !== 'All' && doc.category !== category) return false;
      if (!q) return true;
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.description.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.slug.toLowerCase().includes(q)
      );
    });
  }, [docs, category, query]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter documentation by category"
          className="flex flex-wrap items-center gap-1.5"
        >
          {categories.map((cat) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                  active
                    ? 'bg-brand text-white border-brand font-semibold'
                    : 'bg-surface border-line text-content-secondary hover:text-content'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search
            className="w-3.5 h-3.5 text-content-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides…"
            aria-label="Search documentation guides"
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-line bg-surface text-xs text-content placeholder:text-content-secondary"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-10 rounded-2xl border border-line bg-surface text-center space-y-2">
          <p className="text-sm font-semibold text-content">No guides matched your search</p>
          <button
            type="button"
            onClick={() => {
              setCategory('All');
              setQuery('');
            }}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((doc) => {
            const Icon = getDocIcon(doc.slug);
            return (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className="rounded-2xl border border-line bg-surface hover:border-line-hover p-6 flex flex-col justify-between group transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-line flex items-center justify-center text-brand">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-mono text-content-tertiary">
                      {doc.readingTime}
                    </span>
                  </div>

                  <div className="text-xs font-medium text-brand mb-1.5">
                    {doc.category}
                  </div>
                  <h2 className="text-lg font-semibold text-content group-hover:text-brand transition-colors mb-2 leading-snug">
                    {doc.title}
                  </h2>
                  <p className="text-sm text-content-secondary leading-relaxed">
                    {doc.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-line-subtle flex items-center justify-between text-sm font-medium text-content group-hover:text-brand transition-colors">
                  <span>Read guide</span>
                  <ChevronRight className="w-4 h-4 text-content-muted group-hover:text-brand transition-colors" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
