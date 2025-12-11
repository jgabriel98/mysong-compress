import type { AstroIntegration, AstroConfig, AstroIntegrationLogger } from 'astro';
import { createHash } from 'crypto';
import * as csso from 'csso';
import * as fs from 'fs';
import { minify } from 'html-minifier-terser';
import * as path from 'path';
import sharp from 'sharp';
import { optimize } from 'svgo';
import { minify as terserMinify } from 'terser';
import { CompressionCacheManagerImpl } from './CompressionCache.js';
import { defaultCacheDir, defaultConfig } from './defaultConfig.js';
import type { CompressOptions, FormatCompressionOptions, UsedFormatConfig } from './types.js';


export default function GabAstroCompress(options: CompressOptions = {}): AstroIntegration {
    // Merge compression options with defaults
    const compressionConfig = {
        ...defaultConfig,
        ...options,
        png: { ...defaultConfig.png, ...options.png },
        jpeg: { ...defaultConfig.jpeg, ...options.jpeg },
        webp: { ...defaultConfig.webp, ...options.webp },
        avif: { ...defaultConfig.avif, ...options.avif },
        heif: { ...defaultConfig.heif, ...options.heif },
        html: { ...defaultConfig.html, ...options.html },
        js: { ...defaultConfig.js, ...options.js },
        svg: { ...defaultConfig.svg, ...options.svg }
    };

    let astroConfig: AstroConfig;
    let candidates: string[] = [];
    let originalSizeTotal = 0;
    let newSizeTotal = 0;
    let processedFiles = 0;
    let skippedFiles = 0;
    let cacheHits = 0;
    let cacheManager: CompressionCacheManagerImpl;

    async function traverseDirectory(directory: URL, logger: AstroIntegrationLogger) {
        const files = fs.readdirSync(directory.pathname, { withFileTypes: true });
        for (const file of files) {
            if (file.isDirectory()) {
                await traverseDirectory(new URL(path.join(directory.href, file.name)), logger);
            }
            else {
                const filePath = path.join(directory.pathname, file.name);
                logger.debug(filePath);
                candidates.push(filePath);
            }
        }
    }

    function getUsedConfig(filePath: string) {
        const format = filePath.toLowerCase().split('.').pop() as keyof FormatCompressionOptions;
        const config = compressionConfig[format] ?? null;
        return { config, format };
    }

    async function processFile(filePath: string, logger: AstroIntegrationLogger)
        : Promise<
            { processed: true, originalSize: number, newSize: number, reason: string, usedConfig: UsedFormatConfig }
            | { processed: false, originalSize: number, newSize: number, reason: string, usedConfig: UsedFormatConfig | null }
        > {
        logger.debug("Processing " + filePath);

        const originalSize = fs.statSync(filePath).size;
        let newSize = 0;
        let processed = false;
        let reason = '';
        let usedConfig = getUsedConfig(filePath);

        const handleCompressedResult = (compressedContent: string | Buffer) => {
            const contentLength = Buffer.isBuffer(compressedContent) ? compressedContent.length : compressedContent.length;
            if (contentLength < originalSize) {
                fs.writeFileSync(filePath, compressedContent);
                newSize = fs.statSync(filePath).size;
                originalSizeTotal += originalSize;
                newSizeTotal += newSize;
                processed = true;
                return true;
            }
            reason = "compressed size is greater than original size";
            return false;
        };

        const handleError = (error: any, processType: string) => {
            logger.debug(`${processType} error for ${filePath}: ${error}`);
            reason = `${processType.toLowerCase()} failed`;
            return { processed: false, originalSize, newSize: originalSize, reason, usedConfig } as const;
        };

        try {
            if (/\.(jpe?g|png|webp|tiff?|avif|heif)$/i.test(filePath)) {
                let pipeline = sharp(filePath);
                const format = (await pipeline.metadata()).format;
                const compression = (await pipeline.metadata()).compression;
                logger.debug("Format: " + format);

                const formatConfig = {
                    png: () => pipeline.png(compressionConfig.png),
                    jpeg: () => pipeline.jpeg(compressionConfig.jpeg),
                    webp: () => pipeline.webp(compressionConfig.webp),
                    avif: () => pipeline.avif(compressionConfig.avif),
                    heif: () => pipeline.heif({...compressionConfig.heif, compression})
                };

                if (format && format in formatConfig) {
                    pipeline = formatConfig[format as keyof typeof formatConfig]();
                    const compressedFile = await pipeline.toBuffer();
                    handleCompressedResult(compressedFile);
                } else {
                    reason = "unknown format";
                }

            } else if (/\.(html|htm)$/i.test(filePath)) {
                const htmlContent = fs.readFileSync(filePath, 'utf-8');
                const minifiedHtml = await minify(htmlContent, compressionConfig.html);
                handleCompressedResult(minifiedHtml);

            } else if (/\.(js|ts)$/i.test(filePath)) {
                const jsContent = fs.readFileSync(filePath, 'utf-8');
                try {
                    const minifiedJs = await terserMinify(jsContent, compressionConfig.js);
                    if (minifiedJs.code) {
                        handleCompressedResult(minifiedJs.code);
                    } else {
                        reason = "minification produced no output";
                    }
                } catch (terserError) {
                    return handleError(terserError, "JavaScript minification");
                }

            } else if (/\.(svg)$/i.test(filePath)) {
                const svgContent = fs.readFileSync(filePath, 'utf-8');
                try {
                    const optimizedSvg = optimize(svgContent, {
                        path: filePath,
                        ...compressionConfig.svg,
                        multipass: true
                    });

                    if (optimizedSvg.data) {
                        handleCompressedResult(optimizedSvg.data);
                    }
                } catch (svgoError) {
                    return handleError(svgoError, "SVG optimization");
                }

            } else if (/\.(css|scss|sass|less)$/i.test(filePath)) {
                const cssContent = fs.readFileSync(filePath, 'utf-8');
                const result = csso.minify(cssContent, compressionConfig.css);

                if (result.css) {
                    handleCompressedResult(result.css);
                } else {
                    logger.error(`Failed to minify ${filePath}`);
                }
            } else {
                logger.info("skipping " + filePath);
            }

        } catch (error) {
            logger.error(`Failed to process file ${filePath}: ${error}`);
            reason = "file read/write error";
            return { processed: false, originalSize, newSize: originalSize, reason, usedConfig };
        }

        if (processed) {
            logger.info(`Processed ${filePath} - Original size: ${originalSize} bytes, New size: ${newSize} bytes`);
        } else {
            logger.info(`Skipping ${filePath} - ${reason}`);
        }

        return { processed, originalSize, newSize, reason, usedConfig };
    }


    return {
        name: 'gab-astro-compress',
        hooks: {
            'astro:config:done': async ({ config, logger }) => {
                logger.info('gab-astro-compress started');
                astroConfig = config; // Store Astro's config separately

                if (compressionConfig.cache?.enabled) {
                    cacheManager = new CompressionCacheManagerImpl(
                        path.join(config.root.pathname, compressionConfig.cache?.cacheDir || defaultCacheDir),
                        logger
                    );
                    await cacheManager.initialize();
                }

                logger.debug('Compression config:' + JSON.stringify(compressionConfig));
                logger.debug('Astro config:' + JSON.stringify(config));
            },
            'astro:build:done': async ({ assets, dir, logger }) => {
                logger.info('gab-astro-compress build done');
                logger.info(JSON.stringify(assets));
                logger.info(JSON.stringify(dir));

                await traverseDirectory(dir, logger);


                let promises: Promise<any>[] = [];

                for (const candidate of candidates) {
                    if (compressionConfig.cache?.enabled) {
                        const originalContent = fs.readFileSync(candidate);
                        const sourceHash = createHash('sha256').update(originalContent).digest('hex');
                        const usedConfig = getUsedConfig(candidate);
                        const cachedFile = await cacheManager.getCachedFile(candidate, sourceHash, usedConfig);

                        if (cachedFile) {
                            logger.info(`Using cached version for ${candidate}`);
                            const compressedContent = fs.readFileSync(cachedFile.compressedPath);
                            fs.writeFileSync(candidate, compressedContent);
                            originalSizeTotal += cachedFile.size.original;
                            newSizeTotal += cachedFile.size.compressed;
                            cacheHits++;
                            continue;
                        }

                        logger.info(`No cached version found for ${candidate}, processing...`);

                        promises.push(processFile(candidate, logger).then(result => {
                            if (result.processed) {
                                const compressedContent = fs.readFileSync(candidate);
                                promises.push(cacheManager.saveToCache(candidate, sourceHash, originalContent.length, compressedContent, result.usedConfig));
                                processedFiles++;
                            } else {
                                skippedFiles++;
                            }
                        }));
                    } else {
                        promises.push(processFile(candidate, logger).then(result => {
                            if (result.processed) {
                                processedFiles++;
                            } else {
                                skippedFiles++;
                            }
                        }));
                    }
                }

                await Promise.all(promises);

                logger.info(`Original size: ${originalSizeTotal} bytes`);
                logger.info(`Compressed size: ${newSizeTotal} bytes`);
                logger.info(`Compression ratio: ${originalSizeTotal / newSizeTotal}`);
                logger.info(`Processed files: ${processedFiles}`);
                logger.info(`Skipped files: ${skippedFiles}`);
                logger.info(`Cache hits: ${cacheHits}`);
            },
        },
    } as AstroIntegration;
}

