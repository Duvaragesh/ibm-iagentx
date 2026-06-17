// If the AI passed literal \r\n or \n escape sequences instead of actual newlines,
// normalise them so the file is written with real line breaks.
export function normaliseLineEndings(content: string): string {
  if (!content.includes('\n') && content.includes('\\n')) {
    return content.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
  }
  return content;
}
