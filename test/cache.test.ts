import type { AstroIntegrationLogger } from 'astro';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CompressionCacheManagerImpl } from '../src/CompressionCache';
import { defaultCacheDir, defaultConfig } from '../src/defaultConfig';
import gabAstroCompress from '../src/index';
import { setupTestFile, setupTestFiles } from './helpers';
import { createHash } from 'crypto';
import { ValueOf } from '../src/types';

describe('Cache System', () => {
  let tempDir: string;
  let buildDir: string;

  const TEST_FILES = {
    css: {
      name: 'style.css',
      content: `
        .container {
          padding: 20px   20px   20px   20px;
          color: #ffffff;
          background-color: #000000;
        }
      `
    },
    js: {
      name: 'script.js',
      content: `
        // This comment should be removed
        function test() {
          const x = "hello";
          console.log(x);
        }
      `
    }
  };

  function getHash(testFile: ValueOf<typeof TEST_FILES>) {
    return createHash('sha256').update(testFile.content).digest('hex');
  }

  // Create mock logger
  const mockLogger: AstroIntegrationLogger = {
    info: console.log,
    debug: console.log,
    warn: console.log,
    error: console.error,
    fork: () => mockLogger,
    label: 'gab-astro-compress',
    options: {
      dest: {
        write: () => true
      },
      level: 'info'
    }
  };

  // beforeAll(async () => {
  //   await setupTestFiles(tempDir, TEST_FILES);
  // });

  beforeEach(async () => {
    tempDir = path.join(__dirname, 'fixtures', 'temp-cache-' + Date.now());
    buildDir = path.join(tempDir, 'dist');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function runCompression(compress: ReturnType<typeof gabAstroCompress>) {
    await compress.hooks['astro:config:done']?.({
      config: {
        root: new URL(`file://${tempDir}`),
        srcDir: new URL(`file://${tempDir}`),
        outDir: new URL(`file://${buildDir}`),
        publicDir: new URL(`file://${tempDir}/public`),
        base: '/',
        integrations: [],
        trailingSlash: 'never',
        server: { host: true, port: 3000, open: false },
        redirects: {},
        adapter: undefined,
        image: {
          service: { entrypoint: 'astro/assets/services/sharp', config: {} },
          domains: [],
          remotePatterns: [],
          endpoint: { route: '/image-endpoint', entrypoint: 'astro/assets/endpoint/node' }
        },
        markdown: {
          syntaxHighlight: 'shiki',
          shikiConfig: {
            langs: [],
            theme: 'github-dark',
            wrap: false,
            themes: {},
            langAlias: {},
            transformers: []
          },
          remarkPlugins: [],
          rehypePlugins: [],
          remarkRehype: {},
          gfm: true,
          smartypants: true
        },
        vite: {},
        compressHTML: true,
        build: {
          format: 'directory',
          client: new URL(`file://${tempDir}/dist/client`),
          server: new URL(`file://${tempDir}/dist/server`),
          assets: 'assets',
          serverEntry: 'entry.mjs',
          redirects: true,
          inlineStylesheets: 'auto',
          concurrency: 5
        },
        site: 'http://localhost:3000'
      },
      logger: mockLogger,
      updateConfig: (config) => config,
    });

    await compress.hooks['astro:build:done']?.({
      dir: new URL(`file://${buildDir}`),
      pages: [{ pathname: '/index.html' }],
      routes: [],
      assets: new Map(),
      logger: mockLogger,
    });
  }

  test('should cache compressed files', async () => {
    const cssPath = await setupTestFile(buildDir, TEST_FILES.css);
    const jsPath = await setupTestFile(buildDir, TEST_FILES.js);

    const beforeRunCssStats = await fs.stat(cssPath);
    const beforeRunJsStats = await fs.stat(jsPath);

    // First compression run
    const compress1 = gabAstroCompress();
    await runCompression(compress1);

    const firstRunCssStats = await fs.stat(cssPath);
    const firstRunJsStats = await fs.stat(jsPath);


    expect(firstRunCssStats.mtimeMs).not.toBe(beforeRunCssStats.mtimeMs);
    expect(firstRunJsStats.mtimeMs).not.toBe(beforeRunJsStats.mtimeMs);

    // Second compression run with same files
    const compress2 = gabAstroCompress();
    await runCompression(compress2);

    const secondRunCssStats = await fs.stat(cssPath);
    const secondRunJsStats = await fs.stat(jsPath);

    // Files should not be modified in second run (same mtime)
    expect(firstRunCssStats.mtimeMs).toBe(secondRunCssStats.mtimeMs);
    expect(firstRunJsStats.mtimeMs).toBe(secondRunJsStats.mtimeMs);
  });

  test('should recreate cache when file content changes', async () => {
    const cssPath = await setupTestFile(buildDir, TEST_FILES.css);
    const cacheManager = new CompressionCacheManagerImpl(path.join(tempDir, defaultCacheDir))


    // First compression run
    const compress = gabAstroCompress();
    await runCompression(compress);

    await cacheManager.loadManifest();
    const firstRunCacheEntry = await cacheManager.getCachedFile(cssPath, getHash(TEST_FILES.css), {
      "config": {},
      "format": "css"
    })
    const firstRunContent = await fs.readFile(firstRunCacheEntry!.compressedPath);

    // Modify file
    const newCssFile = {
      name: TEST_FILES.css.name,
      content: `
      .container {
        padding: 30px;
        color: #cccccc;
      }
    `}
    await setupTestFile(buildDir, newCssFile);

    // Second compression run
    await runCompression(compress);
    await cacheManager.loadManifest();
    const secondRunCacheEntry = await cacheManager.getCachedFile(cssPath, getHash(newCssFile), {
      "config": {},
      "format": "css"
    })
    const secondRunContent = await fs.readFile(secondRunCacheEntry!.compressedPath);

    // File should be modified in second run (different mtime)
    expect(firstRunContent).not.toEqual(secondRunContent);
    expect(firstRunCacheEntry?.timestamp).not.toEqual(secondRunCacheEntry?.timestamp);
  });

  test('should invalidate cache when file content changes', async () => {
    const cssPath = await setupTestFile(buildDir, TEST_FILES.css);
    const cacheManager = new CompressionCacheManagerImpl(path.join(tempDir, defaultCacheDir))

    // First compression run
    const compress = gabAstroCompress();
    await runCompression(compress);

    await cacheManager.loadManifest();
    let firstRunCacheEntry = await cacheManager.getCachedFile(cssPath, getHash(TEST_FILES.css), {
      "config": {},
      "format": "css"
    })
    const firstRunContent = await fs.readFile(firstRunCacheEntry!.compressedPath);

    expect(firstRunCacheEntry).not.toBeNull();
    expect(firstRunContent).not.toBeNull();

    // Modify file
    const newCssFile = {
      name: TEST_FILES.css.name,
      content: `
      .container {
        padding: 30px;
        color: #cccccc;
      }
    `}
    await setupTestFile(buildDir, newCssFile);

    // Second compression run
    await runCompression(compress);
    await cacheManager.loadManifest();
    const secondRunCacheEntry = await cacheManager.getCachedFile(cssPath, getHash(newCssFile), {
      "config": {},
      "format": "css"
    })
    const secondRunContent = await fs.readFile(secondRunCacheEntry!.compressedPath);
    const firstRunContentStillExists = existsSync(firstRunCacheEntry!.compressedPath);

    expect(secondRunContent).not.toBeNull();
    // File should be modified in second run
    expect(firstRunCacheEntry).not.toEqual(secondRunCacheEntry);
    expect(firstRunContentStillExists).toBe(false);
  });

  test('should recreate cache when compression settings change', async () => {
    const jsPath = await setupTestFile(buildDir, TEST_FILES.js);
    const cacheManager = new CompressionCacheManagerImpl(path.join(tempDir, defaultCacheDir))
    await cacheManager.initialize();

    // const originalContent = await fs.readFile(jsPath);

    // First compression run with default settings
    const compress1 = gabAstroCompress();
    await runCompression(compress1);

    await cacheManager.loadManifest();
    const firstRunCacheEntry = await cacheManager.getCachedFile(jsPath, getHash(TEST_FILES.js), {
      "config": defaultConfig.js,
      "format": "js"
    })

    expect(firstRunCacheEntry).not.toBeNull();

    // Second compression run with different settings
    await setupTestFile(buildDir, TEST_FILES.js);
    const compress2 = gabAstroCompress({
      js: {
        compress: true,
        mangle: false  // Different from default
      }
    });
    await runCompression(compress2);
    await cacheManager.loadManifest();
    const secondRunCacheEntry = await cacheManager.getCachedFile(jsPath, getHash(TEST_FILES.js), {
      "config": {
        compress: true,
        mangle: false  // Different from default
      },
      "format": "js"
    })

    expect(secondRunCacheEntry).not.toBeNull();
    // File should be modified in second run (different mtime)
    expect(firstRunCacheEntry?.timestamp).not.toBe(secondRunCacheEntry?.timestamp);
  });

  test('should invalidate cache when compression settings change', async () => {
    const jsPath = await setupTestFile(buildDir, TEST_FILES.js);
    const cacheManager = new CompressionCacheManagerImpl(path.join(tempDir, defaultCacheDir))
    await cacheManager.initialize();

    // First compression run with default settings
    const compress1 = gabAstroCompress();
    await runCompression(compress1);

    await cacheManager.loadManifest();
    let firstRunCacheEntry = await cacheManager.getCachedFile(jsPath, getHash(TEST_FILES.js), {
      "config": defaultConfig.js,
      "format": "js"
    })
    let compressedContent = await fs.readFile(firstRunCacheEntry!.compressedPath);

    expect(firstRunCacheEntry).not.toBeNull();
    expect(compressedContent).not.toBeNull();

    // Second compression run with different settings
    await setupTestFile(buildDir, TEST_FILES.js);
    const compress2 = gabAstroCompress({
      js: {
        compress: true,
        mangle: false  // Different from default
      }
    });
    await runCompression(compress2);

    await cacheManager.loadManifest();
    const secondRunCacheEntry = await cacheManager.getCachedFile(jsPath, getHash(TEST_FILES.js), {
      "config": {
        compress: true,
        mangle: false  // Different from default
      },
      "format": "js"
    })
    compressedContent = await fs.readFile(secondRunCacheEntry!.compressedPath);

    firstRunCacheEntry = await cacheManager.getCachedFile(jsPath, getHash(TEST_FILES.js), {
      "config": defaultConfig.js,
      "format": "js"
    })

    expect(compressedContent).not.toBeNull();
    // cache entry should not exist anymore
    expect(firstRunCacheEntry).toBeNull();
    expect(secondRunCacheEntry).not.toBeNull();
  });

  test('should handle cache directory creation', async () => {
    await setupTestFiles(buildDir, TEST_FILES);
    const cacheDir = path.join(tempDir, defaultCacheDir);

    // Run compression
    const compress = gabAstroCompress();
    await runCompression(compress);

    // Cache directory should be created
    const cacheDirExists = await fs.access(cacheDir).then(() => true).catch(() => false);
    expect(cacheDirExists).toBe(true);

    // Cache manifest should exist
    const manifestExists = await fs.access(path.join(cacheDir, 'manifest.json'))
      .then(() => true)
      .catch(() => false);
    expect(manifestExists).toBe(true);
  });

  test('should not create cache directory when cache is disabled', async () => {
    await setupTestFiles(buildDir, TEST_FILES);
    const cacheDir = path.join(tempDir, defaultCacheDir);

    // Run compression with cache disabled
    const compress = gabAstroCompress({
      cache: {
        enabled: false
      }
    });
    await runCompression(compress);

    // Cache directory should not be created
    const cacheDirExists = await fs.access(cacheDir).then(() => true).catch(() => false);
    expect(cacheDirExists).toBe(false);
  });

  test('should use custom cache directory when specified', async () => {
    await setupTestFiles(buildDir, TEST_FILES);
    const customCacheDir = 'custom-cache-dir';

    // Delete custom cache directory if it exists
    const absoluteCustomCacheDir = path.join(tempDir, customCacheDir);
    try {
      await fs.rm(absoluteCustomCacheDir, { recursive: true });
    } catch { }

    // Run compression with custom cache directory
    const compress = gabAstroCompress({
      cache: {
        enabled: true,
        cacheDir: customCacheDir
      }
    });
    await runCompression(compress);

    // Custom cache directory should be created
    const customCacheDirExists = await fs.access(absoluteCustomCacheDir).then(() => true).catch(() => false);
    expect(customCacheDirExists).toBe(true);

    // Custom cache manifest should exist
    const customManifestExists = await fs.access(path.join(absoluteCustomCacheDir, 'manifest.json'))
      .then(() => true)
      .catch(() => false);
    expect(customManifestExists).toBe(true);
  });
}, {
  sequential: true
}); 