/**
 * Wholesale pricing for the infer service.
 *
 * Cloudflare Workers AI bills per "neuron". The wholesale rate is:
 *
 *   $0.011 / 1,000 neurons = $0.000011 / neuron = 11 micro-USDC / neuron
 *
 * Every public function in this module returns the **wholesale** cost in
 * USDC smallest units (6 decimals) as a decimal string. There is no markup
 * here, no base fee — micropayments stay micro.
 *
 * Callers (meter, models maxPrice) apply the marketplace margin once via
 * `retailPrice` / `applyMargin` from `@x402cloud/protocol`.
 *
 * All arithmetic is BigInt over micro-USDC to avoid float drift. The image
 * model has a fractional neurons-per-generation (172.8), so we keep it
 * scaled by 10 and adjust the divisor.
 */

export type NeuronRate = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/** Wholesale neuron cost in micro-USDC per neuron. $0.000011 = 11 micro-USDC. */
export const MICRO_USDC_PER_NEURON = 11n;

/**
 * Image neurons per generation, scaled by 10 to keep BigInt math exact.
 * The real value is 172.8 neurons per 1024x1024 image at 4 steps.
 */
export const IMAGE_NEURONS_PER_GEN_SCALED_10 = 1728n;

/** Display value for legacy callers / docs. */
export const IMAGE_NEURONS_PER_GEN = 172.8;

/**
 * The worst case a text `maxPrice` is quoted for: 500 input + 2000 output
 * tokens. These are not documentation — they are the assumption the quote is
 * built on, so the service that ENFORCES the assumption (apps/infer caps
 * `max_tokens`) must import the same constants. A quote and a cap that drift
 * apart is the overcharge this whole guard exists to prevent.
 */
export const QUOTE_INPUT_TOKENS = 500;
export const QUOTE_OUTPUT_TOKENS = 2000;

/** The worst case an embedding `maxPrice` is quoted for: BGE-M3's max context. */
export const QUOTE_EMBED_TOKENS = 8192;

/**
 * The smallest amount that can move on-chain: 1 micro-USDC. Work that costs a
 * sub-micro fraction still costs something, and truncating it to zero means the
 * request settles with no transfer at all — free service, not a rounding error.
 */
const MIN_CHARGEABLE_MICRO_USDC = 1n;

/**
 * Truncate a micro-USDC numerator, but never to zero when work was done:
 * non-zero work costs at least 1 micro-USDC.
 */
function chargeableMicros(numerator: bigint, divisor: bigint): string {
  const truncated = numerator / divisor;
  if (truncated === 0n && numerator > 0n) return MIN_CHARGEABLE_MICRO_USDC.toString();
  return truncated.toString();
}

/**
 * Wholesale cost in micro-USDC (decimal string) for a text completion.
 *
 *   wholesaleMicro = (inputTokens × inputPerMillion + outputTokens × outputPerMillion)
 *                    × 11 / 1_000_000
 *
 * Truncates towards zero — sub-micro fractions are absorbed by the marketplace
 * — except that any non-zero amount of work costs at least 1 micro-USDC. A
 * single-token `nano` request used to meter to exactly 0 and settle with no
 * transfer, which is a free request, not a discount.
 */
export function wholesaleTextCost(
  neurons: NeuronRate,
  inputTokens: number,
  outputTokens: number,
): string {
  const inT = BigInt(Math.max(0, Math.floor(inputTokens)));
  const outT = BigInt(Math.max(0, Math.floor(outputTokens)));
  const inN = BigInt(neurons.inputPerMillion);
  const outN = BigInt(neurons.outputPerMillion);
  const numerator = (inT * inN + outT * outN) * MICRO_USDC_PER_NEURON;
  return chargeableMicros(numerator, 1_000_000n);
}

/**
 * Wholesale cost in micro-USDC (decimal string) for a single embedding call.
 * Floors at 1 micro-USDC for the same reason as `wholesaleTextCost`.
 */
export function wholesaleEmbedCost(neurons: NeuronRate, inputTokens: number): string {
  const inT = BigInt(Math.max(0, Math.floor(inputTokens)));
  const inN = BigInt(neurons.inputPerMillion);
  const numerator = inT * inN * MICRO_USDC_PER_NEURON;
  return chargeableMicros(numerator, 1_000_000n);
}

/**
 * Wholesale cost in micro-USDC (decimal string) for a single image generation.
 */
export function wholesaleImageCost(neuronsPerGen: number = IMAGE_NEURONS_PER_GEN): string {
  const scaled = BigInt(Math.max(0, Math.round(neuronsPerGen * 10)));
  const numerator = scaled * MICRO_USDC_PER_NEURON;
  return (numerator / 10n).toString();
}
