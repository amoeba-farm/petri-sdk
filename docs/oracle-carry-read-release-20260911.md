# Oracle carry deployment identity

The deployed artifact is from `2dcf2d3b47081825bc0752ecc5a330c09a01b331`.
The native client publication `397bd8403c7803574597a7ff3650a303b92f96c0`
only regenerates client artifacts; its Rust inputs are unchanged.
The 1,385,312-byte ELF and complete payload both hash to
`c0b6cf87f788cac0b88b604a51aa2e20ad8497d784a990d03bde3e8c1ed89afc`.
Finalized deployment slot is 496580643. The pinned observation at 496711266
records EmergencyFrozen epoch 20, not activation.

The original coordinator receipt attests two matching targets in one checkout.
This integration independently compared both retained artifacts, the finalized
payload, every recorded original build input, and immutable source. It does not
claim independent clean checkouts or a new contract test campaign.

The native archive is byte-identical to its publication's Git blobs. The SDK
retains historical reader semantics separately from this deployment and source.
Package write capability is not live permission: every operation still requires
fresh gate and action admission. Applications restoring reads while frozen must
select their read-only composition.

Focused identity/decoder tests and substitution rejection checks pass. The full
SDK test suite is not green; remaining fixture and write-scenario failures are
not a successful trading qualification. No activation, signing, transaction
submission, market preparation, or new contract deployment occurred here.
