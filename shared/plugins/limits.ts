// Size caps for a plugin package. The theme sheet does not absorb plugin CSS.

/** Gzip bytes, before inflate. */
export const PLUGIN_ARCHIVE_MAX_BYTES = 1024 * 1024

/** Inflated tar, and the sum of file bytes. Stop inflate at this size. */
export const PLUGIN_UNCOMPRESSED_MAX_BYTES = 2 * 1024 * 1024

export const PLUGIN_MAX_FILES = 32

/** Any one file, before the tighter caps below. */
export const PLUGIN_FILE_MAX_BYTES = 256 * 1024

export const PLUGIN_MANIFEST_MAX_BYTES = 64 * 1024

export const PLUGIN_TEMPLATE_MAX_BYTES = 32 * 1024

export const PLUGIN_CSS_MAX_BYTES = 8 * 1024

/** UTF-8 path length after normalisation. */
export const PLUGIN_PATH_MAX_BYTES = 120

/** Path segments, including the file name. `a/b/c/d.html` is 4. */
export const PLUGIN_MAX_DEPTH = 4

export const PLUGIN_MAX_BLOCKS = 8

export const PLUGIN_DESCRIBE_MAX = 200
