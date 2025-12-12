import type { AstroIntegrationLogger } from 'astro';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, unlink, writeFileSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { UsedFormatConfig } from './types';
import chalk from 'chalk';

export interface CacheEntry {
  sourceHash: string;     // Hash of original uncompressed file
  compressedPath: string; // Path to cached compressed version
  timestamp: number;      // Cache creation time
  settings: UsedFormatConfig;      // Compression settings used (to invalidate if settings change)
  size: {
    original: number;
    compressed: number;
  }
}

export interface CompressionCache {
  version: string;
  /** Map<filepath, CacheEntry> */
  entries: Record<string, CacheEntry>;
}

export interface CompressionCacheManager {
  initialize(): Promise<void>;
  getCachedFile(originalPath: string, originalHash: string, settings: UsedFormatConfig): Promise<CacheEntry | null>;
  saveToCache(originalPath: string, originalHash: string, originalLength: number, compressedContent: Buffer, settings: UsedFormatConfig): Promise<void>;
  invalidateCache(pattern?: string): Promise<void>;
}

export class CompressionCacheManagerImpl implements CompressionCacheManager {
  private cacheDir: string;
  private manifest: CompressionCache;
  private logger?: AstroIntegrationLogger;

  constructor(astroDir: string, logger?: AstroIntegrationLogger) {
    this.cacheDir = astroDir;
    this.manifest = { version: '1', entries: {} };
    this.logger = logger;
  }


  async loadManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, 'manifest.json');
    const content = readFileSync(manifestPath, 'utf-8');
    this.manifest = JSON.parse(content);
    this.logger?.debug('Loaded existing manifest.');
  }

  async initialize(): Promise<void> {
    this.logger?.debug('Initializing compression cache...');
    mkdirSync(this.cacheDir, { recursive: true });

    try {
      await this.loadManifest();
    } catch {
      this.logger?.debug('No existing cache manifest found, using default empty one.');
      this.saveManifest();
    }
  }

  public saveManifest() {
    const manifestPath = path.join(this.cacheDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));
    this.logger?.debug('Manifest saved.');
  }

  async getCachedFile(originalPath: string, originalHash: string, settings: UsedFormatConfig): Promise<CacheEntry | null> {

    this.logger?.debug(`Retrieving cached file for: ${originalPath}`);
    const entry = this.manifest.entries[originalPath];
    if (!entry) {
      this.logger?.debug('No cache entry found.');
      return null;
    }

    if (entry.sourceHash !== originalHash) {
      this.logger?.warn('Source hash mismatch.');
      this.invalidateCache(originalPath);
      return null;
    }
    if (JSON.stringify(entry.settings) !== JSON.stringify(settings)) {
      this.logger?.warn('Settings mismatch.');
      this.invalidateCache(originalPath);
      return null;
    }

    try {
      await stat(entry.compressedPath);
      this.logger?.debug('Cache hit, file exists.');
      return entry;
    } catch {
      this.logger?.debug('Cached file does not exist, removing entry.');
      delete this.manifest.entries[originalPath];
      return null;
    }
  }

  async saveToCache(originalPath: string, originalHash: string, originalLength: number, compressedContent: Buffer, settings: UsedFormatConfig): Promise<void> {
    this.logger?.debug(`Saving to cache: ${originalPath}`);
    const ext = originalPath.split('.').pop() || '';
    const cachedFileName = `${originalHash}.${ext}`;
    const cachedFilePath = path.join(this.cacheDir, cachedFileName);

    // Save compressed content
    writeFileSync(cachedFilePath, compressedContent);
    this.logger?.debug(`Compressed file saved: ${cachedFilePath}`);

    // Update manifest
    const entry: CacheEntry = {
      sourceHash: originalHash,
      compressedPath: cachedFilePath,
      timestamp: Date.now(),
      settings,
      size: {
        original: originalLength,
        compressed: compressedContent.length
      }
    };

    this.manifest.entries[originalPath] = entry;
    this.logger?.debug('Cache entry updated.');
  }

  async invalidateCache(originalPath: string): Promise<void> {
    this.logger?.warn(`Invalidating cache for: ${originalPath}`);
    unlink(this.manifest.entries[originalPath].compressedPath, (err) => {
      if (err) this.logger?.error(`Failed to remove invalid cached file: ${err}`);
    })
    delete this.manifest.entries[originalPath];
    this.logger?.debug('Cache invalidation complete.');
  }
} 