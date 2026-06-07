// Test-only shim for the `cloudflare:workers` built-in module, which exists only
// in the Workers runtime. Production code imports the real module; vitest (Node)
// aliases this file in via vitest.config.ts so importing src/* doesn't blow up at
// module load. We only need the DurableObject base class shape — a constructor
// that stores ctx + env on the instance, matching the runtime contract. The
// SettlementDO methods are exercised directly against an in-memory transactional
// store in worker-settle.test.ts; this shim just lets the class be defined.
export class DurableObject<Env = unknown> {
  protected ctx: {
    storage: {
      get<T = unknown>(key: string): Promise<T | undefined>;
      put<T>(key: string, value: T): Promise<void>;
      delete(key: string): Promise<boolean>;
    };
  };
  protected env: Env;
  constructor(ctx: DurableObject["ctx"], env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint {}
export class RpcTarget {}
