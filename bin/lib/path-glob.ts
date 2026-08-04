/** Match a repository-relative path against ForgeAI's small glob dialect. */
export function globMatches(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
  const expression = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '\0')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '/(?:.+/)?')
    .replace(/\x01/g, '.*');
  return new RegExp(`^${expression}$`).test(normalizedCandidate);
}
