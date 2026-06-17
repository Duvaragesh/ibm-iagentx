/**
 * Builds a QSYS IFS-style path for an IBM i object.
 * Format: /QSYS.LIB/[IASP.LIB/]LIBRARY.LIB/OBJECT.TYPE[/MEMBER.MBR]
 */
export function getQSYSObjectPath(
  library: string,
  name: string,
  type: string,
  member?: string,
  iasp?: string
): string {
  const aspPrefix = iasp ? `/${iasp.toUpperCase()}.LIB` : '';
  const memberSuffix = member ? `/${member.toUpperCase()}.MBR` : '';
  return `/QSYS.LIB${aspPrefix}/${library.toUpperCase()}.LIB/${name.toUpperCase()}.${type.toUpperCase()}${memberSuffix}`;
}
