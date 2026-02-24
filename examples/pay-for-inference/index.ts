/**
 * Client-side example: pay for AI inference using @x402cloud/client.
 *
 * Wraps fetch so 402 responses are handled automatically —
 * the client signs a payment and retries transparently.
 */
import { wrapFetchWithPayment } from "@x402cloud/client";
import { privateKeyToAccount } from "viem/accounts";

// Create a viem account from a private key
const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");

// Build a ClientSigner from the viem account
const signer = {
  address: account.address,
  signTypedData: (params: Parameters<typeof account.signTypedData>[0]) =>
    account.signTypedData(params),
};

// Wrap fetch with automatic x402 payment handling
const payFetch = wrapFetchWithPayment({ signer });

// Use payFetch exactly like regular fetch — payments happen transparently
async function main() {
  const response = await payFetch("https://infer.x402cloud.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "fast",
      messages: [{ role: "user", content: "What is x402?" }],
    }),
  });

  const data = await response.json();
  console.log(data.choices[0].message.content);
}

main();
