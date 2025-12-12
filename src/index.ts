import type { AstroConfig, AstroIntegration, AstroIntegrationLogger } from 'astro';
import chalk from 'chalk';
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
import { traverseDirectory } from './helpers.js';
import type { CompressOptions, FormatCompressionOptions, UsedFormatConfig } from './types.js';

const enum KnowFailReason {
    BiggerSize = "compressed size is greater than original size",
    UnknowMediaFormat = "unknown media format",
    NoOutput = "compression produced no output",
    Skipped = "Skipped"
}

type Result = { processed: true } | { processed: false; reason: KnowFailReason | string };


// type ConfigAliasMap<T extends string[]> = { [key in keyof FormatCompressionOptions]: T};
const configAliases = {
    js: new Set(['mjs', 'cjs'] as const),
    jpeg: new Set(['jpg'] as const),
    tiff: new Set(['tif'] as const),
} as const;

function getAliasForExtension(extension: string) {
    for (const key in configAliases) {
        const aliases = configAliases[key as keyof typeof configAliases] as Set<string>;
        if (aliases.has(extension)) {
            return key as keyof typeof configAliases;
        }
    }
}

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
    } as const;

    let astroConfig: AstroConfig;
    let originalSizeTotal = 0;
    let newSizeTotal = 0;
    let processedFiles = 0;
    let skippedFiles = 0;
    let cacheHits = 0;
    let cacheManager: CompressionCacheManagerImpl;

    function getUsedConfig(filePath: string) {
        const fileExtension = filePath.toLowerCase().split('.').pop() ?? '';
        const configKey = fileExtension in compressionConfig
            ? fileExtension as keyof FormatCompressionOptions
            : getAliasForExtension(fileExtension)

        if (!configKey) return null;

        const config = compressionConfig[configKey as keyof FormatCompressionOptions];
        return { config, format: configKey };
    }

    async function processFile(filePath: string, logger: AstroIntegrationLogger)
        : Promise<
            { processed: true, originalSize: number, newSize: number, usedConfig: UsedFormatConfig }
            | { processed: false, originalSize: number, newSize: number, reason: string, usedConfig: UsedFormatConfig }
        > {
        logger.debug("Processing " + filePath);

        const originalSize = fs.statSync(filePath).size;
        let newSize = 0;
        let processingResult: Result;
        let usedConfig = getUsedConfig(filePath);

        const handleCompressedResult = (compressedContent: string | Buffer): Result => {
            const contentLength = Buffer.isBuffer(compressedContent) ? compressedContent.length : compressedContent.length;
            if (contentLength < originalSize) {
                fs.writeFileSync(filePath, compressedContent);
                newSize = fs.statSync(filePath).size;
                originalSizeTotal += originalSize;
                newSizeTotal += newSize;
                return { processed: true };
            }
            return { processed: false, reason: KnowFailReason.BiggerSize };
        };

        const handleError = (error: any, processType: string) => {
            logger.debug(`${processType} error for ${filePath}: ${error}`);
            const reason = `${processType.toLowerCase()} failed`;
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
                    heif: () => pipeline.heif({ ...compressionConfig.heif, compression })
                } as const;

                if (format && format in formatConfig) {
                    pipeline = formatConfig[format as keyof typeof formatConfig]();
                    const compressedFile = await pipeline.toBuffer();
                    processingResult = handleCompressedResult(compressedFile);
                } else {
                    processingResult = { processed: false, reason: KnowFailReason.UnknowMediaFormat };
                }

            } else if (/\.(html|htm)$/i.test(filePath)) {
                const htmlContent = fs.readFileSync(filePath, 'utf-8');
                const minifiedHtml = await minify(htmlContent, compressionConfig.html);
                processingResult = handleCompressedResult(minifiedHtml);

            } else if (/\.(js|mjs)$/i.test(filePath)) {
                const jsContent = fs.readFileSync(filePath, 'utf-8');
                try {
                    const minifiedJs = await terserMinify(jsContent, compressionConfig.js);
                    if (minifiedJs.code) {
                        processingResult = handleCompressedResult(minifiedJs.code);
                    } else {
                        processingResult = { processed: false, reason: KnowFailReason.NoOutput };
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
                        processingResult = handleCompressedResult(optimizedSvg.data);
                    } else {
                        logger.error(`Failed to optimize ${filePath}`);
                        processingResult = { processed: false, reason: KnowFailReason.NoOutput };
                    }
                } catch (svgoError) {
                    return handleError(svgoError, "SVG optimization");
                }

            } else if (/\.(css|scss|sass|less)$/i.test(filePath)) {
                const cssContent = fs.readFileSync(filePath, 'utf-8');
                const minifyed = csso.minify(cssContent, compressionConfig.css);

                if (minifyed.css) {
                    processingResult = handleCompressedResult(minifyed.css);
                } else {
                    logger.error(`Failed to minify ${filePath}`);
                    processingResult = { processed: false, reason: KnowFailReason.NoOutput };
                }
            } else {
                processingResult = { processed: false, reason: KnowFailReason.Skipped };
            }

        } catch (error) {
            logger.error(`Failed to process file ${filePath}: ${error}`);
            processingResult = { processed: false, reason: String(error) };
        }

        return { ...processingResult, originalSize, newSize, usedConfig };
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
                const candidates = await traverseDirectory(dir);
                let promises: Promise<any>[] = [];

                for (const candidate of candidates) {
                    const candidatePrettyPath = candidate.replace(dir.pathname, '');

                    if (compressionConfig.cache?.enabled) {
                        const originalContent = fs.readFileSync(candidate);
                        const sourceOriginalHash = createHash('sha256').update(originalContent).digest('hex');
                        const usedConfig = getUsedConfig(candidate);
                        const cachedFile = await cacheManager.getCachedFile(candidate, sourceOriginalHash, usedConfig);

                        if (cachedFile) {
                            logger.info(chalk.green(`Cached hit for ${candidatePrettyPath}`));
                            const compressedContent = fs.readFileSync(cachedFile.compressedPath);
                            fs.writeFileSync(candidate, compressedContent);
                            originalSizeTotal += cachedFile.size.original;
                            newSizeTotal += cachedFile.size.compressed;
                            cacheHits++;
                            continue;
                        }


                        promises.push(processFile(candidate, logger).then(result => {
                            if (result.processed) {
                                logger.info(chalk.blue(`Processed ${candidatePrettyPath}`) + chalk.gray(`- Original size: ${result.originalSize} bytes, New size: ${result.newSize} bytes`))
                                const compressedContent = fs.readFileSync(candidate);
                                promises.push(cacheManager.saveToCache(candidate, sourceOriginalHash, originalContent.length, compressedContent, result.usedConfig));
                                processedFiles++;
                            } else if (result.reason === KnowFailReason.BiggerSize) {
                                logger.warn(`${candidatePrettyPath} did not reduce in size. Saving original file to cache.` + chalk.gray(` - size: ${result.originalSize} bytes`));
                                const compressedContent = fs.readFileSync(candidate);
                                promises.push(cacheManager.saveToCache(candidate, sourceOriginalHash, originalContent.length, compressedContent, result.usedConfig));
                                processedFiles++;
                            }
                            else {
                                skippedFiles++;
                            }

                        }));
                    } else {
                        promises.push(processFile(candidate, logger).then(result => {
                            if (result.processed) {
                                logger.info(`Processed ${candidatePrettyPath} - Original size: ${result.originalSize} bytes, New size: ${result.newSize} bytes`)
                                processedFiles++;
                            } else {
                                skippedFiles++;
                            }
                        }));
                    }
                }

                await Promise.all(promises);

                if (compressionConfig.cache?.enabled) {
                    cacheManager.saveManifest();
                }

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

