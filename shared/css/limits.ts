/** Byte caps for custom CSS. Checked as UTF-8, not JavaScript string length.
 *  STYLE_MAX_BYTES started at 65536. The extra 10240 (BLOCK_CSS_MAX_BYTES) is the
 *  inline block-sheet allowance for sheets such as the match thermometer and the
 *  gift picker. Those sheets are appended only on pages that use the block.
 *  Do not derive the shell cap from STYLE_MAX_BYTES - SITE_CSS_MAX_BYTES -
 *  SECTION_CSS_MAX_BYTES, or the shell can grow into the block allowance.
 *  The original shell cap was 24576 (65536 - 32768 - 8192). Menu A deleted the
 *  boxed hamburger, the narrow mega panel and a duplicate see-through weight
 *  rule, and the eight shell sheets still measured 29751 bytes. The cap is that
 *  measurement: 24576 plus the 5175 byte overrun. STYLE_MAX_BYTES grew by the
 *  same 5175, to 80951. Plugin CSS then reserves another 8192
 *  (PLUGIN_CSS_PAGE_MAX_BYTES). A worst-case page is shell + block sheets +
 *  site CSS + one section + that plugin reserve, and that sum must stay within
 *  STYLE_MAX_BYTES. Do not fold the plugin reserve into the shell cap. */
export const SECTION_CSS_MAX_BYTES = 8192
export const SITE_CSS_MAX_BYTES = 32768
export const SHELL_CSS_MAX_BYTES = 29751
export const BLOCK_CSS_MAX_BYTES = 10240
export const PLUGIN_CSS_PAGE_MAX_BYTES = 8192
export const STYLE_MAX_BYTES = SHELL_CSS_MAX_BYTES + SITE_CSS_MAX_BYTES + SECTION_CSS_MAX_BYTES + BLOCK_CSS_MAX_BYTES + PLUGIN_CSS_PAGE_MAX_BYTES
export const MAX_RULES = 200
export const DATA_URL_MAX_CHARS = 4096

export const SECTION_ID = /^b_[a-z0-9]{4,16}$/
