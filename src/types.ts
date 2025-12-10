import type { CompressOptions as CssoCompressOptions, MinifyOptions as CssoMinifyOptions } from "csso";
import type { Options as HtmlMinifierOptions } from "html-minifier-terser";
import type { AvifOptions, HeifOptions, JpegOptions, PngOptions, WebpOptions } from "sharp";
import type { Config as SvgoConfig } from "svgo";
import type { MinifyOptions } from "terser";

export interface FormatCompressionOptions {
  png?: PngOptions
  jpeg?: JpegOptions;
  webp?: WebpOptions;
  avif?: AvifOptions;
  heif?: HeifOptions;
  html?: HtmlMinifierOptions;
  js?: MinifyOptions;
  svg?: SvgoConfig;
  css?: CssoMinifyOptions | CssoCompressOptions;
}
export interface CompressOptions extends FormatCompressionOptions {
  cache?: {
    enabled: boolean;
    cacheDir?: string;
  }
}

export interface UsedFormatConfig {
  config: ValueOf<FormatCompressionOptions> | null;
  format: string;
}

export type ValueOf<T> = T[keyof T]