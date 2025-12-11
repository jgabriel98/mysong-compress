import type { AstroIntegrationLogger } from 'astro';
import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import gabAstroCompress from '../src/index';
import { getFileSize, setupTestFile } from './helpers';

describe('HTML Minification', () => {
  let tempDir: string;
  const CACHE_DIR = 'compress-html-test';
  
  const TEST_HTML = {
    basic: {
      name: 'test.html',
      content: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
          </head>
          <body>
            <!-- This is a comment that should be removed -->
            <div class="container">
              <h1>Hello World</h1>
              <p>
                This is a test paragraph with
                multiple lines and    extra    spaces.
              </p>
            </div>
          </body>
        </html>
      `
    },
    withInlineAssets: {
      name: 'with-assets.html',
      content: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              .container {
                padding: 20px   20px   20px   20px;
                color: #ffffff;
              }
            </style>
          </head>
          <body>
            <script>
              function test() {
                // This comment should be removed
                var x = "hello";
                console.log(x);
              }
            </script>
          </body>
        </html>
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
    label: 'gab-astro-compress'
  };

  beforeAll(async () => {
    // Create unique temp directory for this test suite
    tempDir = path.join(__dirname, 'fixtures', 'temp-html-' + Date.now());
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

  test('should remove HTML comments', async () => {
    const filePath = await setupTestFile(tempDir, TEST_HTML.basic);
    const originalContent = await fs.readFile(filePath, 'utf-8');
    
    // Initialize compression with default settings
    const compress = gabAstroCompress();
    await runCompression(compress);

    const compressedContent = await fs.readFile(filePath, 'utf-8');
    
    // Verify comments are removed
    expect(compressedContent).not.toContain('<!-- This is a comment that should be removed -->');
    // Verify content is preserved
    expect(compressedContent).toContain('Hello World');
  });

  test('should collapse whitespace while preserving content', async () => {
    const filePath = await setupTestFile(tempDir, TEST_HTML.basic);
    const originalContent = await fs.readFile(filePath, 'utf-8');
    
    const compress = gabAstroCompress();
    await runCompression(compress);

    const compressedContent = await fs.readFile(filePath, 'utf-8');
    
    // Check that multiple spaces are collapsed
    expect(compressedContent).not.toMatch(/\s{2,}/);
    // Verify that text content is unchanged
    expect(compressedContent).toContain('This is a test paragraph with multiple lines and extra spaces');
  });

  test('should minify inline CSS and JavaScript', async () => {
    const filePath = await setupTestFile(tempDir, TEST_HTML.withInlineAssets);
    const originalSize = await getFileSize(filePath);
    
    const compress = gabAstroCompress({
      html: {
        minifyCSS: true,
        minifyJS: true
      }
    });
    
    await runCompression(compress);

    const compressedContent = await fs.readFile(filePath, 'utf-8');
    const compressedSize = await getFileSize(filePath);
    
    // Check that CSS is minified
    expect(compressedContent).toContain('<style>.container{padding:20px 20px 20px 20px;color:#fff}</style></head>');
    // Check that JS is minified and comments are removed
    expect(compressedContent).not.toContain('// This comment should be removed');
    expect(compressedContent).toContain('<script>function test(){console.log("hello")}</script>');
    // Verify overall file size reduction
    expect(compressedSize).toBeLessThan(originalSize);
  });

  test('should handle malformed HTML gracefully', async () => {
    const malformedHTML = {
      name: 'malformed.html',
      content: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Malformed HTML</title>
          </head>
          <body>
            <div>Unclosed div
            <p>Unclosed paragraph
            <!-- Unclosed comment
      `
    };

    const filePath = await setupTestFile(tempDir, malformedHTML);
    
    const compress = gabAstroCompress();
    
    // Should not throw error
    await runCompression(compress);

    // Should still be able to read the file
    const compressedContent = await fs.readFile(filePath, 'utf-8');
    expect(compressedContent).toBeTruthy();
  });
}); 