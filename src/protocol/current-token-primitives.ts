/**
 * Internal web3.js-v1 token boundary for current-protocol server modules.
 *
 * Every classic and Light token primitive comes from the published Spread
 * facade. No Kit type or external token SDK leaks into the SDK surface.
 */
import {
  CLASSIC_SPL_MINT_SIZE,
  CLASSIC_SPL_TOKEN_ACCOUNT_SIZE,
  decodeClassicMintAccount,
  decodeClassicTokenAccount,
  deriveClassicAssociatedTokenAddress,
  deriveLightAssociatedTokenAddress,
  readAuthenticatedLightAta,
} from "@amoeba/spread-release-tools/token-primitives";
import { Buffer } from "buffer";

export const ACCOUNT_SIZE = CLASSIC_SPL_TOKEN_ACCOUNT_SIZE;
export const MINT_SIZE = CLASSIC_SPL_MINT_SIZE;
export const AccountLayout = Object.freeze({ span: CLASSIC_SPL_TOKEN_ACCOUNT_SIZE });
export const MintLayout = Object.freeze({ span: CLASSIC_SPL_MINT_SIZE });
export const unpackAccount = decodeClassicTokenAccount;
export function unpackMint(...args: Parameters<typeof decodeClassicMintAccount>) {
  const decoded = decodeClassicMintAccount(...args);
  return Object.freeze({
    ...decoded,
    tlvData: Buffer.from(args[1].data.subarray(CLASSIC_SPL_MINT_SIZE)),
  });
}
export const getAssociatedTokenAddressSync = deriveClassicAssociatedTokenAddress;
export const getAssociatedTokenAddressInterface = deriveLightAssociatedTokenAddress;
export const getCurrentLightAtaInterface = readAuthenticatedLightAta;
