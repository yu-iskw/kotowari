/**
 * Deterministic embedding via char-code hashing into [-1, 1], L2-normalized.
 * Same text always yields the same vector.
 */
export function hashEmbedding(text: string, dimensions: number): readonly number[] {
  const vector = new Array<number>(dimensions);
  for (let d = 0; d < dimensions; d++) {
    let sum = 0;
    for (let i = 0; i < text.length; i++) {
      sum += text.charCodeAt(i) * (d + 1 + i);
    }
    vector[d] = Math.sin(sum);
  }

  let normSq = 0;
  for (const value of vector) {
    normSq += value * value;
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}
