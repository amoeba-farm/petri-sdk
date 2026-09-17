import { PublicKey } from "@solana/web3.js";
import { createCurrentSdkAdapter, type CreateCurrentSdkAdapterInput } from "../protocol/current-adapter.js";
import { prepareG3UserOperation, revalidateG3UserOperation, type G3OperationInput, type G3OperationPlan } from "../g3/operations.js";
import { resolveG3UserIntent, type G3ResolvedIntent } from "../g3/resolver.js";
import type { G3UserOperation } from "../g3/operations.js";
import { MAINNET_PROFILE as p } from "./profile.js";
import { assertMainnetHeliusEndpoint, observeMainnetDeployment } from "./index.js";
import { observeG3Mainnet } from "../g3/runtime.js";

/** Mainnet read composition and G3 preparation; business admission remains host-owned. */
export function createMainnetSdkAdapter(input: Omit<CreateCurrentSdkAdapterInput, "programId" | "namespace" | "cluster" | "releaseTag" | "releaseCommit">) {
  const connection = input.connection;
  assertMainnetHeliusEndpoint(connection.rpcEndpoint);
  const current = createCurrentSdkAdapter({ ...input, programId: p.programId, namespace: "ameba-spread-v2",
    cluster: "mainnet-beta", releaseTag: "v0.1.0-rc.44", releaseCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18" });
  return Object.freeze({ ...current, profile: p,
    observeMainnetDeployment: () => observeMainnetDeployment(connection),
    resolveG3UserIntent: async (owner: string, operation: G3UserOperation, request: unknown, floor: number = p.deployedSlot): Promise<G3ResolvedIntent> => {
      const observed = await observeG3Mainnet(connection, floor);
      return resolveG3UserIntent(connection, owner, operation, request, observed.observedSlot, "mainnet-beta");
    },
    prepareG3UserOperation: (owner: PublicKey, operation: G3OperationInput, floor: number = p.deployedSlot, lookupTable?: PublicKey) =>
      prepareG3UserOperation(connection, owner, operation, floor, lookupTable, "mainnet-beta"),
    revalidateG3UserOperation: (plan: G3OperationPlan, signed: string) => revalidateG3UserOperation(connection, plan, signed),
  });
}
