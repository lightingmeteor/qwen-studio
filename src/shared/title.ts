export function deriveTitle(text: string, max = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '新会话';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
