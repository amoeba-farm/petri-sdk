# Four-hour Mainnet binding qualification

This update changes only the production deployment profile, literal identity
types, generated browser/profile outputs, and dated observation. Historical
protocol builders and their dependency graph are unchanged.

Verified: TypeScript build and consumer types; five focused Mainnet tests with
the finalized ProgramData fixture (including browser reconstruction); eleven
G3 tests, with two local-validator tests skipped. The live read-only observer
matched the exact four-hour artifact at slot 447573774 and Active epoch 3.

The full historical JavaScript suite is not green: failures include retired
governed-release fixtures, old account layouts, and a JSON import-attribute
failure. The package checker also rejects the approximately 20.075 MB archive
against its retained 16.900 MB bound; the prior consumer archive was already
20.073 MB. These checks were not weakened or represented as passing. This is
bounded Mainnet identity qualification, not full SDK or trading qualification.

Public native source rebuilding matched deployed bytes. Docker/hosted
verification and Photon proof operations are not claimed.
