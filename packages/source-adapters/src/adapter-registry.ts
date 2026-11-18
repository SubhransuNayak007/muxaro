/**
 * Project MUXARO - Source Adapter Registry and Factory
 * 
 * Central registry managing all registered source adapters:
 * - DirectMediaAdapter
 * - YouTubePermittedAdapter
 * - Custom / third-party source adapters
 * 
 * Provides unified URL inspection, rights verification, and source discovery.
 */

import type {
  SourceAdapter,
  MediaManifest,
  RightsCheckResult,
  RightsDeclaration,
  AdapterCapabilities,
  InspectOptions,
} from './types.ts';
import { UnsupportedSourceError } from './errors.ts';
import { DirectMediaAdapter } from './direct-adapter.ts';
import { YouTubePermittedAdapter } from './youtube-permitted-adapter.ts';
import { AbuseDetector } from './rights-validator.ts';

export interface RegisteredAdapterEntry {
  adapter: SourceAdapter;
  priority: number;
}

export class SourceAdapterRegistry {
  private readonly adapters: RegisteredAdapterEntry[] = [];

  constructor() {
    // Default registration order: specific third-party portal adapters first, direct media fallback second
    this.register(new YouTubePermittedAdapter(), 100);
    this.register(new DirectMediaAdapter(), 10);
  }

  /**
   * Register a new adapter with an execution priority (higher numbers evaluated first)
   */
  public register(adapter: SourceAdapter, priority: number = 50): void {
    // Remove existing with same name if any
    const existingIndex = this.adapters.findIndex((e) => e.adapter.name === adapter.name);
    if (existingIndex >= 0) {
      this.adapters.splice(existingIndex, 1);
    }

    this.adapters.push({ adapter, priority });
    this.adapters.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Find first matching adapter that can handle the URL
   */
  public findAdapter(url: string): SourceAdapter | undefined {
    for (const entry of this.adapters) {
      if (entry.adapter.canHandle(url)) {
        return entry.adapter;
      }
    }
    return undefined;
  }

  /**
   * Get matching adapter or throw UnsupportedSourceError
   */
  public getAdapter(url: string): SourceAdapter {
    const adapter = this.findAdapter(url);
    if (!adapter) {
      throw new UnsupportedSourceError(url, {
        availableAdapters: this.adapters.map((a) => a.adapter.name),
      });
    }
    return adapter;
  }

  /**
   * Unified entry point: inspect any media URL
   */
  public async inspectUrl(url: string, options?: InspectOptions): Promise<MediaManifest> {
    AbuseDetector.assertSafe(url);
    const adapter = this.getAdapter(url);
    return adapter.inspect(url, options);
  }

  /**
   * Unified entry point: evaluate rights for any media URL
   */
  public async checkRights(
    url: string,
    declaration?: RightsDeclaration
  ): Promise<RightsCheckResult> {
    AbuseDetector.assertSafe(url);
    const adapter = this.getAdapter(url);
    return adapter.checkRights(url, declaration);
  }

  /**
   * Return metadata for all registered adapters
   */
  public listSupportedSources(): Array<{
    name: string;
    protocols: readonly string[];
    capabilities: AdapterCapabilities;
  }> {
    return this.adapters.map((entry) => ({
      name: entry.adapter.name,
      protocols: entry.adapter.supportedProtocols,
      capabilities: entry.adapter.getCapabilities(),
    }));
  }
}

/**
 * Singleton default registry pre-configured with standard MUXARO adapters
 */
export const defaultAdapterRegistry = new SourceAdapterRegistry();

/**
 * Convenience function to inspect a media URL using the default registry
 */
export async function inspectMediaUrl(
  url: string,
  options?: InspectOptions
): Promise<MediaManifest> {
  return defaultAdapterRegistry.inspectUrl(url, options);
}

/**
 * Convenience function to check media rights using the default registry
 */
export async function checkMediaRights(
  url: string,
  declaration?: RightsDeclaration
): Promise<RightsCheckResult> {
  return defaultAdapterRegistry.checkRights(url, declaration);
}
