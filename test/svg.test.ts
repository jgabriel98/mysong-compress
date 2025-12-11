import type { AstroIntegrationLogger } from 'astro';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import gabAstroCompress from '../src/index';
import { getFileSize, setupTestFile } from './helpers';

describe('SVG Compression', () => {
  let tempDir: string;
  const CACHE_DIR = 'compress-svg-test';

  const TEST_SVGS = {
    basic: {
      name: 'basic.svg',
      content: `
        <?xml version="1.0" encoding="UTF-8"?>
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <!-- This comment should be removed -->
          <circle cx="50" cy="50" r="40" 
                  stroke="black" 
                  stroke-width="3" 
                  fill="red"/>
        </svg>
      `
    },
    withPaths: {
      name: 'paths.svg',
      content: `
        <?xml version="1.0" encoding="UTF-8"?>
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <path d="M 10 10 L 90 10 L 90 90 L 10 90 L 10 10" 
                fill="none" 
                stroke="blue" 
                stroke-width="2"/>
          <path d="M 20,20 L 80,20 L 80,80 L 20,80 Z" 
                fill="yellow"/>
        </svg>
      `
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
      dest: {
        write: () => true
      },
      level: 'info'
    }
  };

  beforeAll(async () => {
    tempDir = path.join(__dirname, 'fixtures', 'temp-svg-' + Date.now());
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

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

    // Then run build hook
    await compress.hooks['astro:build:done']?.({
      dir: new URL(`file://${tempDir}`),
      pages: [{ pathname: '/index.html' }],
      routes: [],
      assets: new Map(),
      logger: mockLogger,
    });
  }

  test('should remove comments and format SVG', async () => {
    const filePath = await setupTestFile(tempDir, TEST_SVGS.basic);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      svg: { multipass: true }
    });
    
    await runCompression(compress);

    const compressedContent = await fs.readFile(filePath, 'utf-8');
    const compressedSize = await getFileSize(filePath);
    
    // Verify size reduction
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify comment removal
    expect(compressedContent).not.toContain('<!-- This comment should be removed -->');
    
    // Verify SVG structure is preserved
    expect(compressedContent).toMatch(/<circle[^>]+>/);
    expect(compressedContent).toMatch(/cx="50"/);
    expect(compressedContent).toMatch(/cy="50"/);
  });

  test('should optimize paths', async () => {
    const filePath = await setupTestFile(tempDir, TEST_SVGS.withPaths);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      svg: { multipass: true }
    });
    
    await runCompression(compress);

    const compressedContent = await fs.readFile(filePath, 'utf-8');
    const compressedSize = await getFileSize(filePath);
    
    // Verify size reduction
    expect(compressedSize).toBeLessThan(originalSize);
    
    // Verify path optimization (should convert absolute to relative commands where beneficial)
    expect(compressedContent).toMatch(/<path[^>]+d="[^"]+"/);
    
    // Verify essential attributes are preserved (using hex color codes)
    expect(compressedContent).toMatch(/fill="#ff0"/);  // yellow in hex
    expect(compressedContent).toMatch(/stroke="#00f"/); // blue in hex
  });

  test('should handle malformed SVG gracefully', async () => {
    const malformedSVG = {
      name: 'malformed.svg',
      content: `
        <?xml version="1.0" encoding="UTF-8"?>
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <unclosed-element>
          <invalid-tag>
          <!-- Unclosed comment
      `
    };

    const filePath = await setupTestFile(tempDir, malformedSVG);
    const originalContent = await fs.readFile(filePath, 'utf-8');
    
    const compress = gabAstroCompress();
    
    // Should not throw error
    await runCompression(compress);

    // Original file should still exist and be unchanged
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    
    const finalContent = await fs.readFile(filePath, 'utf-8');
    expect(finalContent).toBe(originalContent);
  });
}); 