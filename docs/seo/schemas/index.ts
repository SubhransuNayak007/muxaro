/**
 * MUXARO — Schema.org Structured Data Hub
 * Standardized JSON-LD schemas for rich snippet SERP dominance.
 */

import softwareApplicationSchema from './software-application.json';
import howToExtractAudioSchema from './how-to-extract-audio.json';
import howToMergeVideoAudioSchema from './how-to-merge-video-audio.json';
import faqSchema from './faq-schema.json';
import breadcrumbsSchema from './breadcrumbs.json';

export {
  softwareApplicationSchema,
  howToExtractAudioSchema,
  howToMergeVideoAudioSchema,
  faqSchema,
  breadcrumbsSchema,
};

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Generate dynamic BreadcrumbList Schema
 */
export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `https://Muxaro.media${item.url}`,
    })),
  };
}

/**
 * Generate dynamic TechArticle Schema for documentation pages
 */
export function generateTechArticleSchema(doc: {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  updatedAt: string;
  authorName?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': doc.url,
    },
    headline: doc.title,
    description: doc.description,
    image: `https://Muxaro.media/og/article-banner.png`,
    author: {
      '@type': 'Organization',
      name: doc.authorName || 'MUXARO Media Engineering Team',
      url: 'https://Muxaro.media',
    },
    publisher: {
      '@type': 'Organization',
      name: 'MUXARO',
      url: 'https://Muxaro.media',
      logo: {
        '@type': 'ImageObject',
        url: 'https://Muxaro.media/logo.png',
      },
    },
    datePublished: doc.publishedAt,
    dateModified: doc.updatedAt,
    inLanguage: 'en-US',
  };
}
