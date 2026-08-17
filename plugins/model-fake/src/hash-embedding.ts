/**
 * Deterministic embedding via char-code hashing into [-1, 1], L2-normalized.
 * Same text always yields the same vector.
 */
export function hashEmbedding(text: string, dimensions: number): readonly number[] {
  const vector = Array.from({ length: dimensions }, (_, dimension) => {
    let sum = 0;
    for (let index = 0; index < text.length; index += 1) {
      sum += text.charCodeAt(index) * (dimension + 1 + index);
    }
    return Math.sin(sum);
  });

  const normSq = vector.reduce((total, value) => total + value * value, 0);
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}
