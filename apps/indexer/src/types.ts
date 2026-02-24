export type SettlementRecord = {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  network: string;
  scheme: string;
  facilitator: string;
  facilitatorName: string;
  payer: string;
  payee: string;
  amount: string;
  amountUsd: number;
  token: string;
  gasUsed: string;
  gasPrice: string;
};

export type NetworkConfig = {
  name: string;
  chainId: number;
  rpc: string;
  usdc: string;
  startBlock: number;
};

export type RpcBlock = {
  timestamp: string;
  transactions: RpcTransaction[];
};

export type RpcTransaction = {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  gasPrice: string;
};

export type RpcReceipt = {
  status: string;
  gasUsed: string;
  logs: RpcLog[];
};

export type RpcLog = {
  address: string;
  topics: string[];
  data: string;
};
