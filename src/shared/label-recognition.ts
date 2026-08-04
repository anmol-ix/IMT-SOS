export type LabelRecognitionCandidate = {
  code: string;
  sku: string;
  name: string;
  variantName?: string | null;
};

export type LabelRecognitionMatch = {
  candidate: LabelRecognitionCandidate;
  matchedBy: "sku" | "product-name";
  confidence: number;
};

function normalize(value: string) {
  return value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
}

function normalizeSkuReading(value: string) {
  return normalize(value)
    .replace(/[OQDU]/g, "0")
    .replace(/[IL]/g, "1");
}

function bigrams(value: string) {
  const pairs = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    pairs.add(value.slice(index, index + 2));
  }
  return pairs;
}

function coverage(source: Set<string>, target: string) {
  const targetPairs = bigrams(target);
  if (targetPairs.size === 0) return 0;
  let found = 0;
  for (const pair of targetPairs) {
    if (source.has(pair)) found += 1;
  }
  return found / targetPairs.size;
}

export function matchPrintedLabel(
  recognizedText: string,
  candidates: LabelRecognitionCandidate[],
): LabelRecognitionMatch | null {
  const normalizedSource = normalize(recognizedText);
  const normalizedSkuSource = normalizeSkuReading(recognizedText);
  const source = bigrams(normalizedSource);
  const skuSource = bigrams(normalizedSkuSource);
  if (source.size === 0) return null;

  const ranked = candidates
    .map((candidate) => {
      const normalizedSku = normalizeSkuReading(candidate.sku);
      const exactSku = normalizedSku.length >= 6
        && normalizedSkuSource.includes(normalizedSku);
      const skuScore = exactSku ? 1 : coverage(skuSource, normalizedSku);
      const productLabel = [candidate.name, candidate.variantName]
        .filter(Boolean)
        .join(" ");
      const nameScore = coverage(source, normalize(productLabel));
      const matchedBy = skuScore >= nameScore ? "sku" as const : "product-name" as const;
      return {
        candidate,
        exactSku,
        matchedBy,
        confidence: Math.max(skuScore, nameScore),
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best || best.confidence < 0.78) return null;
  if (best.exactSku) return best;

  const runnerUp = ranked[1];
  if (runnerUp && best.confidence - runnerUp.confidence < 0.12) return null;
  return best;
}
