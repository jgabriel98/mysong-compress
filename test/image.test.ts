import type { AstroIntegrationLogger } from 'astro';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import gabAstroCompress from '../src/index';
import { getFileSize, setupTestFile } from './helpers';

describe('Image Compression', async () => {
  let tempDir: string;
  const CACHE_DIR = 'compress-image-test';

  // Create test images with more complex data to ensure compression is possible
  const TEST_IMAGES = {
    png: {
      name: 'test.png',
      content: await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      })
      .composite([{
        input: Buffer.from(new Array(1000 * 1000 * 4).fill(128)), // Add noise
        raw: {
          width: 1000,
          height: 1000,
          channels: 4
        },
        blend: 'overlay'
      }])
      .png({ compressionLevel: 1 }) // Start with low compression
      .toBuffer()
    },
    jpeg: {
      name: 'test.jpg',
      content: await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 3,
          background: { r: 0, g: 0, b: 255 }
        }
      })
      .composite([{
        input: Buffer.from(new Array(1000 * 1000 * 3).fill(128)), // Add noise
        raw: {
          width: 1000,
          height: 1000,
          channels: 3
        },
        blend: 'overlay'
      }])
      .jpeg({ quality: 100 }) // Start with high quality
      .toBuffer()
    },
    webp: {
      name: 'test.webp',
      content: await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      })
      .composite([{
        input: Buffer.from(new Array(1000 * 1000 * 4).fill(128)), // Add noise
        raw: {
          width: 1000,
          height: 1000,
          channels: 4
        },
        blend: 'overlay'
      }])
      .webp({ quality: 100, effort: 0 }) // Start with high quality, low effort
      .toBuffer()
    },
    avif: {
      name: 'test.avif',
      content: await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      })
      .composite([{
        input: Buffer.from(new Array(1000 * 1000 * 4).fill(128)), // Add noise
        raw: {
          width: 1000,
          height: 1000,
          channels: 4
        },
        blend: 'overlay'
      }])
      .avif({ quality: 100, effort: 0 })
      .toBuffer()
    },
    heif: {
      name: 'test.heif',
      content: await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      })
      .composite([{
        input: Buffer.from(new Array(1000 * 1000 * 4).fill(128)), // Add noise
        raw: {
          width: 1000,
          height: 1000,
          channels: 4
        },
        blend: 'overlay'
      }])
      .heif({ quality: 100, effort: 0, compression: 'av1' })
      .toBuffer()
    },
    corruptImage: {
      name: 'corrupt.png',
      content: Buffer.from('not a real image')
    }
  };

  // Create mock logger
  const mockLogger: AstroIntegrationLogger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: console.error,
    fork: () => mockLogger,
    label: 'gab-astro-compress',
    options: {
      level: 'info'
    }
  };
  
  beforeAll(async () => {
    // Create unique temp directory for this test suite
    tempDir = path.join(__dirname, 'fixtures', 'temp-image-' + Date.now());
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const mockBuildData = {
    pages: [{ pathname: '/index.html' }],
    routes: [],
    assets: new Map<string, URL[]>(),
  };

  async function runCompression(compress: ReturnType<typeof gabAstroCompress>) {
    // First run config hook
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
          remotePatterns: []
        },
        markdown: {
          syntaxHighlight: 'shiki',
          shikiConfig: { langs: [], theme: 'github-dark', wrap: false },
          remarkPlugins: [],
          rehypePlugins: [],
          remarkRehype: {},
          gfm: true,
          smartypants: true,
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
        site: 'http://localhost:3000',
        style: { postcss: { options: {}, plugins: [] } },
        scopedStyleStrategy: 'attribute'
      },
      logger: mockLogger,
      updateConfig: (config) => config,
    });

    // Then run build hook
    await compress.hooks['astro:build:done']?.({
      ...mockBuildData,
      dir: new URL(`file://${tempDir}`),
      logger: mockLogger,
    });
  }

  test('should compress PNG images', async () => {
    // Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.png);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      png: {
        compressionLevel: 9,
        palette: true
      }
    });
    
    await runCompression(compress);

    const compressedSize = await getFileSize(filePath);
    
    // Verify compression
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify image is still valid
    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe('png');
  });

  test('should compress JPEG images', async () => {// Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.jpeg);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      jpeg: {
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimizeScans: true
      }
    });
    
    await runCompression(compress);

    const compressedSize = await getFileSize(filePath);
    
    // Verify compression
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify image is still valid
    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe('jpeg');
  });

  test('should compress WebP images', async () => {
    // Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.webp);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      webp: {
        effort: 6
      }
    });
    
    await runCompression(compress);

    const compressedSize = await getFileSize(filePath);
    
    // Verify compression
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify image is still valid
    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe('webp');
  });

  test('should compress Avif images', async () => {
    // Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.avif);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      avif: {
        effort: 2
      }
    });
    
    await runCompression(compress);

    const compressedSize = await getFileSize(filePath);
    
    // Verify compression
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify image is still valid
    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe('heif');
    expect(metadata.compression).toBe('av1');
  }, 8000);

  test('should compress Heif images', async () => {
    // Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.heif);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      heif: {
        effort: 2
      }
    });
    
    await runCompression(compress);

    const compressedSize = await getFileSize(filePath);
    
    // Verify compression
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify image is still valid
    const metadata = await sharp(filePath).metadata();
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe('heif');
    expect(metadata.compression).toBe('av1');
  });

  test('should handle corrupt images gracefully', async () => {
    // Set up test files
    const filePath = await setupTestFile(tempDir, TEST_IMAGES.corruptImage);
    const originalContent = await fs.readFile(filePath);
    
    const compress = gabAstroCompress();
    
    // Should not throw error
    await runCompression(compress);

    // Original file should still exist and be unchanged
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    
    const finalContent = await fs.readFile(filePath);
    expect(Buffer.compare(originalContent, finalContent)).toBe(0);
  });
}); 