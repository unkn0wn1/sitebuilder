/** Byte caps for custom CSS. Checked as UTF-8, not JavaScript string length.
 *  STYLE_MAX_BYTES was 65536. The extra 10240 (BLOCK_CSS_MAX_BYTES) is the inline
 *  block-sheet allowance for sheets such as the match thermometer (and, later, the
 *  gift picker). Those sheets are appended only on pages that use the block.
 *  This is not a shell increase. Do not derive the shell cap from
 *  STYLE_MAX_BYTES - SITE_CSS_MAX_BYTES - SECTION_CSS_MAX_BYTES, or the shell
 *  can grow into the block allowance. The shell cap stays SHELL_CSS_MAX_BYTES
 *  (24576), which is the original 65536 - 32768 - 8192. A worst-case page is
 *  shell + block sheets + site CSS + one section, and that sum must stay within
 *  STYLE_MAX_BYTES. */
export const SECTION_CSS_MAX_BYTES = 8192
export const SITE_CSS_MAX_BYTES = 32768
export const SHELL_CSS_MAX_BYTES = 24576
export const BLOCK_CSS_MAX_BYTES = 10240
export const STYLE_MAX_BYTES = 75776
export const MAX_RULES = 200
export const DATA_URL_MAX_CHARS = 4096

export const SECTION_ID = /^b_[a-z0-9]{4,16}$/
