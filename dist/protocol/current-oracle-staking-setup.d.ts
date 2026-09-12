import { PublicKey, TransactionInstruction } from "@solana/web3.js";
export declare function currentOracleActivationSetup(programId: PublicKey, owner: PublicKey): readonly TransactionInstruction[];
export declare function currentOracleActivationSetupManifests(programId: PublicKey, owner: PublicKey): Readonly<{
    programId: string;
    dataBase64: string;
    accounts: {
        pubkey: string;
        isSigner: boolean;
        isWritable: boolean;
    }[];
    decodedParams: {
        instructionName: string;
        tag: number;
    };
}>[];
//# sourceMappingURL=current-oracle-staking-setup.d.ts.map