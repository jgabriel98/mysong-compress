import type { CompressOptions as CssoCompressOptions, MinifyOptions as CssoMinifyOptions } from "csso";
import type { Options as HtmlMinifierOptions } from "html-minifier-terser";
import type { AvifOptions, HeifOptions, JpegOptions, PngOptions, TiffOptions, WebpOptions, GifOptions, JxlOptions } from "sharp";
import type { Config as SvgoConfig } from "svgo";
import type { MinifyOptions } from "terser";

export interface FormatCompressionOptions {
  png?: PngOptions
  jpeg?: JpegOptions;
  jxl?: JxlOptions;
  webp?: WebpOptions;
  avif?: AvifOptions;
  heif?: HeifOptions;
  gif?: GifOptions;
  tiff?: TiffOptions;
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

export type UsedFormatConfig = {
  config: ValueOf<FormatCompressionOptions>;
  format: string;
} | null;

export type ValueOf<T> = T[keyof T]

export type SetValueType<T> = T extends Set<infer U> ? U : never;