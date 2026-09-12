import { AmebaInputError } from "../errors.js";
import { assertCurrentWriteReleaseAvailable } from "../protocol/release-train.js";
import { OPERATIONS, operationById, } from "./operations.js";
import { executeBuffered, runtimeConfig, spawnInteractive, } from "./process.js";
/**
 * Complete compatibility adapter for the mounted Petri command surface.
 *
 * It is deliberately separate from the HTTP SDK. Local config, MCP setup,
 * wallet/RPC behavior, explicit signing, and terminal presentation remain in
 * Petri and are never silently performed by AmebaClient.
 */
/** Current-process adapter generated from the pinned Petri command manifest. */
export class PetriAdapter {
    #config;
    constructor(options = {}) {
        this.#config = runtimeConfig(options);
        for (const operation of OPERATIONS) {
            setNestedOperation(this, operation.method, this.operationFunction(operation));
        }
        freezeNamespaces(this);
    }
    invoke(id, input) {
        const operation = operationById(id);
        if (!operation)
            throw new AmebaInputError(`Unknown Petri operation id: ${id}`);
        return this.execute(operation, input);
    }
    describe(id) {
        if (id === undefined)
            return OPERATIONS;
        const operation = operationById(id);
        if (!operation)
            throw new AmebaInputError(`Unknown Petri operation id: ${id}`);
        return operation;
    }
    operationFunction(operation) {
        const call = (input) => this.execute(operation, input);
        Object.defineProperties(call, {
            id: { value: operation.id, enumerable: true },
            definition: { value: operation, enumerable: true },
        });
        return call;
    }
    execute(operation, input) {
        if (operation.effect === "transaction") {
            assertCurrentWriteReleaseAvailable();
        }
        return operation.output === "interactive"
            ? spawnInteractive(this.#config, operation, input)
            : executeBuffered(this.#config, operation, input);
    }
}
function setNestedOperation(target, path, operation) {
    if (path.length === 0) {
        throw new AmebaInputError("Petri operation method path must not be empty");
    }
    let cursor = target;
    for (const segment of path.slice(0, -1)) {
        const existing = cursor[segment];
        if (existing === undefined) {
            const namespace = {};
            cursor[segment] = namespace;
            cursor = namespace;
        }
        else if (typeof existing === "object" && existing !== null) {
            cursor = existing;
        }
        else {
            throw new AmebaInputError(`Petri operation namespace collides at ${path.join(".")}`);
        }
    }
    const leaf = path[path.length - 1];
    if (!leaf) {
        throw new AmebaInputError("Petri operation method path has an empty leaf");
    }
    if (cursor[leaf] !== undefined) {
        throw new AmebaInputError(`Duplicate Petri operation method: ${path.join(".")}`);
    }
    cursor[leaf] = operation;
}
function freezeNamespaces(target) {
    for (const value of Object.values(target)) {
        if (typeof value === "object" && value !== null) {
            freezeNamespaces(value);
            Object.freeze(value);
        }
    }
}
//# sourceMappingURL=client.js.map