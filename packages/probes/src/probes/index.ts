import { rpcAlive } from "./rpc.js";
import { usdcContract } from "./usdc.js";
import { permit2Contract } from "./permit2.js";
import { facilitatorHealth } from "./facilitator.js";
import { inferHealth, inferModels } from "./infer.js";
import { paymentFlow } from "./payment-flow.js";
import { gasEstimate } from "./gas.js";

export const allProbes = [
  rpcAlive,
  usdcContract,
  permit2Contract,
  facilitatorHealth,
  inferHealth,
  inferModels,
  paymentFlow,
  gasEstimate,
];

export {
  rpcAlive,
  usdcContract,
  permit2Contract,
  facilitatorHealth,
  inferHealth,
  inferModels,
  paymentFlow,
  gasEstimate,
};
