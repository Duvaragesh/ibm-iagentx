/**
 * Wraps a SQL column expression in a CAST to VARCHAR CCSID 1208 (UTF-8).
 * Use for system catalog text columns (e.g. QSYS2.SYSCOLUMNS2.COLUMN_TEXT)
 * that may be stored in EBCDIC CCSID 37 to force UTF-8 transcoding.
 */
export function castUtf8(expr: string, maxLen = 50): string {
  return `CAST(${expr} AS VARCHAR(${maxLen}) CCSID 1208)`;
}
