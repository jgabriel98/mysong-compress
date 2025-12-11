import type { AstroIntegrationLogger } from 'astro';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { defaultCacheDir } from '../src/defaultConfig';
import gabAstroCompress from '../src/index';
import { setupTestFiles } from './helpers';

describe('Cache System', () => {
  let tempDir: string;

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

  beforeAll(async () => {
    tempDir = path.join(__dirname, 'fixtures', 'temp-cache-' + Date.now());
    await setupTestFiles(tempDir, TEST_FILES);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function runCompression(compress: ReturnType<typeof gabAstroCompress>) {
    await compress.hooks['astro:config:done']?.({
      config: {
        root: new URL(`file://${tempDir}`),
        srcDir: new URL(`file://${tempDir}`),
        outDir: new URL(`file://${tempDir}/dist`),
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
      dir: new URL(`file://${tempDir}`),
      pages: [{ pathname: '/index.html' }],
      routes: [],
      assets: new Map(),
      logger: mockLogger,
    });
  }

  test('should cache compressed files', async () => {
    const cssPath = path.join(tempDir, TEST_FILES.css.name);
    const jsPath = path.join(tempDir, TEST_FILES.js.name);
    
    
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

  test('should invalidate cache when file content changes', async () => {
    const cssPath = path.join(tempDir, TEST_FILES.css.name);
    
    // First compression run
    const compress1 = gabAstroCompress();
    await runCompression(compress1);
    const firstRunStats = await fs.stat(cssPath);

    // Modify file
    await fs.writeFile(cssPath, `
      .container {
        padding: 30px;
        color: #cccccc;
      }
    `);

    // Second compression run
    const compress2 = gabAstroCompress();
    await runCompression(compress2);
    const secondRunStats = await fs.stat(cssPath);

    // File should be modified in second run (different mtime)
    expect(firstRunStats.mtimeMs).not.toBe(secondRunStats.mtimeMs);
  });

  test('should invalidate cache when compression settings change', async () => {
    const jsPath = path.join(tempDir, TEST_FILES.js.name);
    
    const originalContent = await fs.readFile(jsPath);
    // First compression run with default settings
    const compress1 = gabAstroCompress();
    await runCompression(compress1);
    const firstRunStats = await fs.stat(jsPath);

    //restore file
    await fs.writeFile(jsPath, originalContent);

    // Second compression run with different settings
    const compress2 = gabAstroCompress({
      js: {
        compress: true,
        mangle: false  // Different from default
      }
    });
    await runCompression(compress2);
    const secondRunStats = await fs.stat(jsPath);

    // File should be modified in second run (different mtime)
    expect(firstRunStats.mtimeMs).not.toBe(secondRunStats.mtimeMs);
  }); 

  test('should handle cache directory creation', async () => {
    // Delete cache directory if it exists
    const cacheDir = path.join(tempDir, defaultCacheDir);
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {}

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
    // Delete cache directory if it exists
    const cacheDir = path.join(tempDir, defaultCacheDir);
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {}

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
    const customCacheDir = 'custom-cache-dir';

    // Delete custom cache directory if it exists
    const absoluteCustomCacheDir = path.join(tempDir, customCacheDir);
    try {
      await fs.rm(absoluteCustomCacheDir, { recursive: true });
    } catch {}

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
}); 