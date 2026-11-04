/** Split conventional identifiers without losing acronym boundaries. */
function symbolWords(value: string): string[] {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Limited English suffix normalization, not fuzzy or semantic matching.
 * Require at least four stem characters to avoid conflating short names. */
function wordStem(word: string): string {
  let stem = word;
  if (stem.length > 5) {
    if (stem.endsWith('ies')) stem = `${stem.slice(0, -3)}y`;
    else if (stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1);
    stem = stem.replace(/(?:ing|ion|ed)$/, '');
  }
  if (stem.length > 4 && stem.endsWith('e')) stem = stem.slice(0, -1);
  return stem.length >= 4 ? stem : word;
}

export function symbolMatchesObjective(names: string[], terms: string[]): boolean {
  // Preserve the existing substring behavior, including complete symbol names.
  const text = names.join(' ').toLowerCase();
  if (terms.some(term => text.includes(term.toLowerCase()))) return true;
  const stems = new Set(names.flatMap(symbolWords).map(wordStem));
  return terms.flatMap(symbolWords).some(word => stems.has(wordStem(word)));
}
