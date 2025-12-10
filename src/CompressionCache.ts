import type { AstroIntegrationLogger } from 'astro';
import fs, { stat } from 'fs/promises';
import path from 'path';
import { UsedFormatConfig } from './types';

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
  getCachedFile(originalPath: string, sourceHash: string, settings: UsedFormatConfig): Promise<CacheEntry | null>;
  saveToCache(originalPath: string, sourceHash: string, originalLength: number, compressedContent: Buffer, settings: UsedFormatConfig): Promise<void>;
  invalidateCache(pattern?: string): Promise<void>;
} 

export class CompressionCacheManagerImpl implements CompressionCacheManager {
  private cacheDir: string;
  private manifest: CompressionCache;
  private logger: AstroIntegrationLogger;

  constructor(astroDir: string, logger: AstroIntegrationLogger) {
    this.cacheDir = astroDir;
    this.manifest = { version: '1', entries: {} };
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    this.logger.debug('Initializing compression cache...');
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    try {
      const manifestPath = path.join(this.cacheDir, 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      this.manifest = JSON.parse(content);
      this.logger.debug('Loaded existing manifest.');
    } catch {
      this.logger.debug('No existing cache manifest found, using default empty one.');
      await this.saveManifest();
    }
  }

  private async saveManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));
    this.logger.debug('Manifest saved.');
  }

  async getCachedFile(originalPath: string, sourceHash: string, settings: UsedFormatConfig): Promise<CacheEntry | null> {
    this.logger.debug(`Retrieving cached file for: ${originalPath}`);
    const entry = this.manifest.entries[originalPath];
    if (!entry) {
      this.logger.debug('No cache entry found.');
      return null;
    }

    if (entry.sourceHash !== sourceHash) {
      this.logger.debug('Source hash mismatch.');
      return null;
    }
    if (JSON.stringify(entry.settings) !== JSON.stringify(settings)) {
      this.logger.debug('Settings mismatch.');
      return null;
    }

    try {
      await stat(entry.compressedPath);
      this.logger.debug('Cache hit, file exists.');
      return entry;
    } catch {
      this.logger.debug('Cached file does not exist, removing entry.');
      delete this.manifest.entries[originalPath];
      await this.saveManifest();
      return null;
    }
  }

  async saveToCache(originalPath: string, sourceHash: string, originalLength: number, compressedContent: Buffer, settings: UsedFormatConfig): Promise<void> {
    this.logger.debug(`Saving to cache: ${originalPath}`);
    const ext = originalPath.split('.').pop() || '';
    const cachedFileName = `${sourceHash}.${ext}`;
    const cachedFilePath = path.join(this.cacheDir, cachedFileName);

    // Save compressed content
    await fs.writeFile(cachedFilePath, compressedContent);
    this.logger.debug(`Compressed file saved: ${cachedFilePath}`);

    // Update manifest
    const entry: CacheEntry = {
      sourceHash,
      compressedPath: cachedFilePath,
      timestamp: Date.now(),
      settings,
      size: {
        original: originalLength,
        compressed: compressedContent.length
      }
    };

    this.manifest.entries[originalPath] = entry;
    await this.saveManifest();
    this.logger.debug('Cache entry updated.');
  }

  async invalidateCache(pattern?: string): Promise<void> {
    if (!pattern) {
      this.logger.debug('Invalidating entire cache.');
      this.manifest.entries = {};
    } else {
      this.logger.debug(`Invalidating cache with pattern: ${pattern}`);
      const regex = new RegExp(pattern);
      for (const path in this.manifest.entries) {
        if (regex.test(path)) {
          delete this.manifest.entries[path];
          this.logger.debug(`Cache entry invalidated: ${path}`);
        }
      }
    }
    await this.saveManifest();
    this.logger.debug('Cache invalidation complete.');
  }
} 