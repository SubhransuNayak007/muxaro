import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PDF_TOOLS_CATALOG } from '@/lib/tools-catalog';
import {
  buildBreadcrumbsJsonLd,
  buildToolSoftwareAppJsonLd,
  constructMetadata,
} from '@/lib/seo';
import PdfToolRenderer from '@/components/pdf/PdfToolRenderer';

function getSlugFromHref(href: string): string {
  return href.replace(/^\/tools\/pdf\//, '');
}

export function generateStaticParams() {
  return PDF_TOOLS_CATALOG.map((tool) => ({
    tool: getSlugFromHref(tool.href),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool } = await params;
  const meta = PDF_TOOLS_CATALOG.find(
    (t) => getSlugFromHref(t.href) === tool
  );
  if (!meta) {
    return constructMetadata({
      title: 'PDF Tool | MUXARO',
      description: 'Browser-local PDF workspace with zero server uploads.',
      path: `/tools/pdf/${tool}`,
    });
  }
  return constructMetadata({
    title: `${meta.title} — Private Browser PDF Tool | MUXARO`,
    description: meta.description,
    path: meta.href,
    keywords: meta.keywords,
  });
}

export default async function PdfToolPage({
  params,
}: {
  params: Promise<{ tool: string }>;
}) {
  const { tool } = await params;
  const meta = PDF_TOOLS_CATALOG.find(
    (t) => getSlugFromHref(t.href) === tool
  );
  if (!meta) {
    notFound();
  }

  const breadcrumbJsonLd = buildBreadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Tools', path: '/tools' },
    { name: 'PDF Studio', path: '/tools/pdf' },
    { name: meta.title, path: meta.href },
  ]);

  const softwareJsonLd = buildToolSoftwareAppJsonLd({
    name: `${meta.title} — MUXARO PDF Studio`,
    description: meta.description,
    path: meta.href,
    features: [meta.tag, meta.modeBadge, '100% Client-Side Processing'],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <PdfToolRenderer slug={tool} />
    </>
  );
}
