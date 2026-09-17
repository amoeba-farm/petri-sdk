import { PublicKey } from "@solana/web3.js";
import { createCurrentSdkAdapter } from "../protocol/current-adapter.js";
import { prepareG3UserOperation, revalidateG3UserOperation } from "../g3/operations.js";
import { resolveG3UserIntent } from "../g3/resolver.js";
import { MAINNET_PROFILE as p } from "./profile.js";
import { assertMainnetHeliusEndpoint, observeMainnetDeployment } from "./index.js";
import { observeG3Mainnet } from "../g3/runtime.js";
/** Mainnet read composition and G3 preparation; business admission remains host-owned. */
export function createMainnetSdkAdapter(input) {
    const connection = input.connection;
    assertMainnetHeliusEndpoint(connection.rpcEndpoint);
    const current = createCurrentSdkAdapter({ ...input, programId: p.programId, namespace: "ameba-spread-v2",
        cluster: "mainnet-beta", releaseTag: "v0.1.0-rc.44", releaseCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18" });
    return Object.freeze({ ...current, profile: p,
        observeMainnetDeployment: () => observeMainnetDeployment(connection),
        resolveG3UserIntent: async (owner, operation, request, floor = p.deployedSlot) => {
            const observed = await observeG3Mainnet(connection, floor);
            return resolveG3UserIntent(connection, owner, operation, request, observed.observedSlot, "mainnet-beta");
        },
        prepareG3UserOperation: (owner, operation, floor = p.deployedSlot, lookupTable) => prepareG3UserOperation(connection, owner, operation, floor, lookupTable, "mainnet-beta"),
        revalidateG3UserOperation: (plan, signed) => revalidateG3UserOperation(connection, plan, signed),
    });
}
//# sourceMappingURL=adapter.js.map