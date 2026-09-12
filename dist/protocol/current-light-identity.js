import { PublicKey } from "@solana/web3.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
/** Light's invoking-program CPI authority depends on the selected deployment. */
export const CURRENT_SPREAD_LIGHT_CPI_AUTHORITY = PublicKey.findProgramAddressSync([new TextEncoder().encode("cpi_authority")], new PublicKey(AMOEBA_SPREAD_PROGRAM_ID))[0];
//# sourceMappingURL=current-light-identity.js.map