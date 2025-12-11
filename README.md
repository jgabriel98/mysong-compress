# AstroCompress

A powerful compression integration for static assets in Astro. This package automatically optimizes and compresses various file types including images, HTML, JavaScript, CSS, and SVG files during the build process.

This integraton is inspired by [astro-compress](https://github.com/withastro/astro-compress) and I would like to thank Nikola Hristov for his excellent work. In my Astro project with hundreds of images, I found that the build time was too long. Because I had difficulty understanding the high level of abstraction in the original package, I decided to create my own solution. For small projects with few images, the original package is faster, but for larger projects with many images, this package is faster.

## Features

- 🖼️ Image optimization (PNG, JPEG, WebP, AVIF, HEIF)
- 📄 HTML minification
- 🔧 JavaScript minification
- 🎨 CSS minification
- 📐 SVG optimization
- 💾 Caching system for faster builds
- ⚙️ Highly configurable compression settings

## Installation 

```bash
npm install gab-astro-compress
```

## Usage

Add the integration to your `astro.config.mjs`:

```js
import astroCompress from 'gab-astro-compress';

import { defineConfig } from 'astro';

export default defineConfig({
  integrations: [
    astroCompress({
      // optional configuration
    })
  ]
});
```

> **Note:** gab-astro-compress hooks into the Astro `astro:build:done` hook. It is called when the static assets are finished. Add gab-astro-compress as the last integration for best results. This way it can also optimize the output of other integrations.
	
## Configuration

You can customize the compression settings for different file types.

* The compression for `png`, `jpeg`, `webp`, `avif`, `heif` is handled by [sharp](https://sharp.pixelplumbing.com/api-output#png). The gab-astro-compress integration wraps the corresponding sharp options, so that you have full control over the compression process.
* The compression for `html` is handled by [html-minifier-terser](https://github.com/terser/html-minifier-terser?tab=readme-ov-file#options-quick-reference). The gab-astro-compress integration wraps the corresponding html-minifier-terser options, so that you have full control over the compression process.
* The compression for `js` is handled by [terser](https://terser.org/docs/api-reference#minify-options). The gab-astro-compress integration wraps the corresponding terser options, so that you have full control over the compression process.
* The compression for `svg` is handled by [svgo](https://github.com/svg/svgo?tab=readme-ov-file#configuration). 
* The compression for `css` is handled by [csso](https://github.com/css/csso). 

The astro-compress integration wraps the corresponding tool options, so that you have full control over the compression process.

Below you can find the default configuration for each file type. The effort parameter is set to max for all image formats. As we are using a cache this will provide the best compression at reasonable build times. You can override the default settings in your configuration for faster builds.

```ts
export const defaultConfig: CompressionOptions = {
    png: {
        compressionLevel: 9.0,
        palette: true
    },
    jpeg: {
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimizeScans: true
    },
    webp: {
        effort: 6.0
    },
    avif: {
        effort: 9.0,
        lossless: true
    },
    heif: {
        effort: 9.0,
        lossless: true
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
        mangle: true
    },
    svg: {
        multipass: true,
    },
    css: {}
};
```


## Default Configuration

If no configuration is provided, the integration will use optimal default settings for each file type. You can override specific options while keeping the defaults for others.

## Caching

The integration includes a caching system that stores compressed versions of files to speed up subsequent builds. Here's how it works:

- **Cache Storage**: Compressed files are stored in a cache directory within the project's `node_modules/.astro/.cache/compress` folder.
- **Cache Manifest**: A manifest file (`manifest.json`) keeps track of cached files, their original hashes, compression settings, and timestamps.
- **Cache Retrieval**: Before compressing a file, the system checks if a cached version exists with the same original hash and settings. If found, the cached version is used.
- **Cache Invalidation**: The cache is automatically invalidated when:
  - Source files change (detected via hash comparison).
  - Compression settings change (detected via settings comparison).
  - **TODO**: Cache version changes (indicating a new version of the integration).

## File Types Supported

- Images: `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.heif`
- HTML: `.html`, `.htm`
- JavaScript: `.js`
- Stylesheets: `.css`
- Vector Graphics: `.svg`

## License

MIT

## Acknowledgments

This is a fork of [mysong-compress](https://github.com/mysongstudio/mysong-compress), thanks for the original creator [@mysongstudio](https://github.com/mysongstudio) !

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Issues

If you find a bug or want to request a new feature, please open an issue on GitHub.