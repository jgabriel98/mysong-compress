import type { CompressOptions } from "./types";

export const defaultCacheDir = 'node_modules/.astro/.gab-astro-compress';

export const defaultConfig: Required<CompressOptions> = {
    cache: {
        enabled: true,
        cacheDir: defaultCacheDir
    },
    png: {
        compressionLevel: 9.0,
        palette: true
    },
    jpeg: {
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimizeScans: true,
    },
    jxl : {
        effort: 9.0,
    },
    webp: {
        effort: 6.0,
    },
    avif: {
        effort: 9.0,
    },
    heif: {
        effort: 9.0,
    },
    tiff: {},
    gif: {
        effort: 6.0,
    },
    html: {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true,
        continueOnParseError: true
    },
    js: {
        compress: true,
        mangle: true,
    },
    svg: {
        multipass: true,
    },
    css: {}
};