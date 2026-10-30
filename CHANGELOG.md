# Changelog

## [0.9.0](https://github.com/Miragon/bpmn-cli/compare/v0.8.0...v0.9.0) (2026-10-30)


### ⚠ BREAKING CHANGES

* always rename flow ids that name their source and target, drop the keep-flow-ids mode ([#127](https://github.com/Miragon/bpmn-cli/issues/127))
* files without a .bpmnlintrc get element-id-naming's default ids even where their existing ids look different; idConventionsFromLint needs the naming namespace of @miragon/bpmnlint-plugin-rules 0.19 or later; MutationResult.conventions and the conventionsLines export are removed.
* the bpmn-auto-layout engine is removed, together with the `engine` option and the `--engine` flag. Full redraws always use the built-in clean engine.
* mutationWarnings, opWarnings, renderAround, renderContext, renderMetrics, decisionLinkOf, scopeView, assertLossless, kindsSectionJson, runFormatOps, viewDoc and renderShown are no longer exported from @miragon/bpmn-cli, and layoutDocToFile no longer from @miragon/bpmn-cli/node. None of them was documented in docs/library.md.
* use c7, c8 and none as the only platform value and drop the unused in-memory store ([#110](https://github.com/Miragon/bpmn-cli/issues/110))
* the exported TypeScript names change without aliases (Op, AddOp, ... FormatOp, isFormatOp, FormatOps -> EditCommand, AddElement, ... DiagramCommand). A diagram command can no longer name an element a later command of the same batch adds (E_NOT_FOUND), and mixed batches such as add, place, add draw in their order, so their coordinates differ.

### Features

* **kinds:** support complex gateways in plain BPMN ([#74](https://github.com/Miragon/bpmn-cli/issues/74)) ([#91](https://github.com/Miragon/bpmn-cli/issues/91)) ([d535609](https://github.com/Miragon/bpmn-cli/commit/d535609efca08648767ed538f0185156d806b986))
* **kinds:** support groups with members tied by category value ([#73](https://github.com/Miragon/bpmn-cli/issues/73)) ([#92](https://github.com/Miragon/bpmn-cli/issues/92)) ([de47b90](https://github.com/Miragon/bpmn-cli/commit/de47b90781bc081ec489bf9edd74431e3b01164f))


### Bug Fixes

* **flows:** keep conditions off flows out of parallel and event-based gateways ([#94](https://github.com/Miragon/bpmn-cli/issues/94)) ([5b7e7a6](https://github.com/Miragon/bpmn-cli/commit/5b7e7a6cc9a3fb5e50eb891ce2aaffa64f340d01))
* **flows:** refuse sequence flows out of link throw and into link catch events ([#95](https://github.com/Miragon/bpmn-cli/issues/95)) ([8bc7e52](https://github.com/Miragon/bpmn-cli/commit/8bc7e52d117bcee3738c7ad24100400c51d22750))
* keep a single incoming flow on targets of an event-based gateway ([#132](https://github.com/Miragon/bpmn-cli/issues/132)) ([59a5fff](https://github.com/Miragon/bpmn-cli/commit/59a5fffaedee7de1797220f65fdafcb7aea652af)), closes [#78](https://github.com/Miragon/bpmn-cli/issues/78)
* keep an empty process when the last pool is removed so the file stays editable ([#134](https://github.com/Miragon/bpmn-cli/issues/134)) ([fb6f0d9](https://github.com/Miragon/bpmn-cli/commit/fb6f0d97d62532b2ba3738199b40367ca9a4e7e7))
* keep lane membership in step with the drawn lanes when adding and removing lanes ([#133](https://github.com/Miragon/bpmn-cli/issues/133)) ([208146e](https://github.com/Miragon/bpmn-cli/commit/208146e19566068d0380980759467c62716d1751))
* make room only for what follows an inserted node and keep the rest of a hand-made drawing in place ([#119](https://github.com/Miragon/bpmn-cli/issues/119)) ([a6b8447](https://github.com/Miragon/bpmn-cli/commit/a6b8447c840f6af0297e1b4f36aa4b6f6de3218a))
* **plugin:** serve the plugin from the release branch, moved only after npm publish ([#125](https://github.com/Miragon/bpmn-cli/issues/125)) ([1668579](https://github.com/Miragon/bpmn-cli/commit/1668579ac0bc21d86ec68787b31f816a65deb8d2))
* stop counting crossings with a text annotation's line as a layout problem ([#139](https://github.com/Miragon/bpmn-cli/issues/139)) ([5c80757](https://github.com/Miragon/bpmn-cli/commit/5c807576f0e9693a943ff38bf9f24043c2ff796d))
* stop re-scanning waiting edges per routing line in incremental routing ([#122](https://github.com/Miragon/bpmn-cli/issues/122)) ([aecf52b](https://github.com/Miragon/bpmn-cli/commit/aecf52b6234e2838dbc9810a85723da1d86a1ce4))
* **validate:** refuse boundary events on event sub-processes ([#84](https://github.com/Miragon/bpmn-cli/issues/84)) ([9e68e25](https://github.com/Miragon/bpmn-cli/commit/9e68e25d66d7ae31a63064b42ff0abd1c1c496d2))


### Code Refactoring

* always rename flow ids that name their source and target, drop the keep-flow-ids mode ([#127](https://github.com/Miragon/bpmn-cli/issues/127)) ([8739607](https://github.com/Miragon/bpmn-cli/commit/87396076bca7b54cd509e31ce2392ca1909fe0d5))
* arrange src as a hexagon of domain, application and adapters ([#103](https://github.com/Miragon/bpmn-cli/issues/103)) ([c9b4b39](https://github.com/Miragon/bpmn-cli/commit/c9b4b39cd30a303149f3fb236a55f055fbe00f4e))
* drop the learned id style, new ids follow element-id-naming ([#118](https://github.com/Miragon/bpmn-cli/issues/118)) ([b998c7d](https://github.com/Miragon/bpmn-cli/commit/b998c7d5bdc688079648cc675cd63da5a2f125e1))
* make the codebase smaller and gate on duplication and test-only code ([#112](https://github.com/Miragon/bpmn-cli/issues/112)) ([247e1e1](https://github.com/Miragon/bpmn-cli/commit/247e1e1e7e5ddc8a006e05bd2c06d7ccc1cea3e8))
* move linting out of the domain and merge duplicated domain concepts ([#116](https://github.com/Miragon/bpmn-cli/issues/116)) ([ef1945f](https://github.com/Miragon/bpmn-cli/commit/ef1945f15bdf940e3ba8ee99aa245c2be43f8ccc))
* use c7, c8 and none as the only platform value and drop the unused in-memory store ([#110](https://github.com/Miragon/bpmn-cli/issues/110)) ([6ebce59](https://github.com/Miragon/bpmn-cli/commit/6ebce59943e7489a1e5a65908cd1c4fc34b2fc12))

## [0.8.0](https://github.com/Miragon/bpmn-cli/compare/v0.7.0...v0.8.0) (2026-10-21)


### Features

* **layout:** joins entered from below, straight rises, labels off sub-process titles ([#72](https://github.com/Miragon/bpmn-cli/issues/72)) ([d6cf58f](https://github.com/Miragon/bpmn-cli/commit/d6cf58fd25ce2d24f70deb5b0079ad5f8b3432f5))

## [0.7.0](https://github.com/Miragon/bpmn-cli/compare/v0.6.0...v0.7.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* the CLI option --profile is gone from the mutating commands and from validate (now an unknown option, E_USAGE). The library options `profile` and `contentRepo`, the `profile` field of the validate result and CheckResult, `profiles` in `bpmn kinds --json`, the exports designFindings, designValidator, undeclaredPrefixes, DESIGN_VALIDATOR, resolveProfile, profileValidators, modelsFolderOf, PROFILE_CHOICES, CONTENT_CONFIG_FILE (and their types), the node exports findContentRepo, contentModelIds, contentRepoOf, resolveFileProfile and the E_DESIGN_* / W_DESIGN_* codes are removed. In a design-iq content repository run `npx @miragon/design-iq-validator --root .` after edits; a library host passes its own check through `validators`. See docs/migrating.md ("Changes from 0.6").

### Features

* a result says when BPMN_KEEP_FLOW_IDS kept the flow ids ([#54](https://github.com/Miragon/bpmn-cli/issues/54)) ([9458ed9](https://github.com/Miragon/bpmn-cli/commit/9458ed90ec828b6b001c7d5e84b7ae50b199c993))
* keep flow ids on request with --keep-flow-ids and BPMN_KEEP_FLOW_IDS, and name the stale ones ([#32](https://github.com/Miragon/bpmn-cli/issues/32)) ([#38](https://github.com/Miragon/bpmn-cli/issues/38)) ([fd3fe07](https://github.com/Miragon/bpmn-cli/commit/fd3fe07ed6181ab582752fa75ec3690cc72e075d))
* new ids follow the id conventions of the .bpmnlintrc's element-id-naming ([#34](https://github.com/Miragon/bpmn-cli/issues/34)) ([#45](https://github.com/Miragon/bpmn-cli/issues/45)) ([98fa834](https://github.com/Miragon/bpmn-cli/commit/98fa8347c0ab066ab77ab576a1d6c3b4537d7e5d))
* outAs names the flow an add creates out of the new node ([#57](https://github.com/Miragon/bpmn-cli/issues/57)) ([6f185fe](https://github.com/Miragon/bpmn-cli/commit/6f185fee6a4b46b89e739eecf75b66c03f5e1fe7))
* remove the design profile, bpmn-cli's copy of design-iq's save gate ([#35](https://github.com/Miragon/bpmn-cli/issues/35)) ([#41](https://github.com/Miragon/bpmn-cli/issues/41)) ([3d777fe](https://github.com/Miragon/bpmn-cli/commit/3d777fe38ba369b79807eeba0816fd410df5b7d3))
* run the project's .bpmnlintrc in validate and in every write ([#33](https://github.com/Miragon/bpmn-cli/issues/33)) ([#39](https://github.com/Miragon/bpmn-cli/issues/39)) ([a7a1d34](https://github.com/Miragon/bpmn-cli/commit/a7a1d3447bc1ea1b3fb623fb180e4f74da051910))


### Bug Fixes

* a file's flow form stays put, and flows follow under every prefix it uses ([#59](https://github.com/Miragon/bpmn-cli/issues/59)) ([40840ec](https://github.com/Miragon/bpmn-cli/commit/40840ec676714bef866a5cbf055527ba9f9d792d))
* a full redraw draws a group around the elements it held ([#51](https://github.com/Miragon/bpmn-cli/issues/51)) ([74c3b50](https://github.com/Miragon/bpmn-cli/commit/74c3b503741320b29e79823ce955d3b10d50a563))
* a write's bpmnlint line counts the findings it leaves out ([#49](https://github.com/Miragon/bpmn-cli/issues/49)) ([406d657](https://github.com/Miragon/bpmn-cli/commit/406d657be5984e09a02487a60ee5850537cea33b))
* aliases follow a retype, typed splits check their branches ([#48](https://github.com/Miragon/bpmn-cli/issues/48)) ([c7b2dde](https://github.com/Miragon/bpmn-cli/commit/c7b2ddec0fd51442119ee2986226e0ad857021a2))
* bpmnlint picks up later installs and follows linked directories ([#50](https://github.com/Miragon/bpmn-cli/issues/50)) ([b453891](https://github.com/Miragon/bpmn-cli/commit/b453891abd37d79c3ae03d739d707988e3a6f6b6))
* bump @miragon/bpmnlint-plugin-rules to 0.12.1 ([#55](https://github.com/Miragon/bpmn-cli/issues/55)) ([4cfda9d](https://github.com/Miragon/bpmn-cli/commit/4cfda9decb83002f4ccf8c29ab321892eb659efc))
* decision links keep the file's spelling with platform none ([#52](https://github.com/Miragon/bpmn-cli/issues/52)) ([02260d4](https://github.com/Miragon/bpmn-cli/commit/02260d43e567ff675b5b2efb5481133504c52c96))
* drop stale edges of re-ended flows and reroute detached lines ([#60](https://github.com/Miragon/bpmn-cli/issues/60)) ([2b29396](https://github.com/Miragon/bpmn-cli/commit/2b293969bd18002ace061b43485a07dffa6456c8))
* every DI id stays within 64 characters and follows set id= ([#58](https://github.com/Miragon/bpmn-cli/issues/58)) ([f492f7c](https://github.com/Miragon/bpmn-cli/commit/f492f7c20bcefb841efd273534534460c56b624b))
* flows follow every end change and the report names the right flow ([#46](https://github.com/Miragon/bpmn-cli/issues/46)) ([b39be73](https://github.com/Miragon/bpmn-cli/commit/b39be73b98c8e521e68b7207a51c0583815bd9be))
* follow-ups of the declared id conventions ([#64](https://github.com/Miragon/bpmn-cli/issues/64)) ([79893e9](https://github.com/Miragon/bpmn-cli/commit/79893e94acc5e7fbabfcf34376c4cab255293cf7))
* generated ids use the whole 64 characters and lose whole words when cut ([#31](https://github.com/Miragon/bpmn-cli/issues/31)) ([#37](https://github.com/Miragon/bpmn-cli/issues/37)) ([20a7990](https://github.com/Miragon/bpmn-cli/commit/20a7990c2845d27dd47d1b54ce9c3a38452f7219))
* new ids keep a letter word before a collision number, and cuts no longer end on a filler word ([#56](https://github.com/Miragon/bpmn-cli/issues/56)) ([ef14c4d](https://github.com/Miragon/bpmn-cli/commit/ef14c4d4edd280ac64d6df79a601dda93f82ce50))
* refuse a move anchored on its own nodes, make a move in place a no-op, and name what a bridge took ([#47](https://github.com/Miragon/bpmn-cli/issues/47)) ([a65bad9](https://github.com/Miragon/bpmn-cli/commit/a65bad94dd207d02d93c54d4eba90ebb4a49c894))
* the E_VALIDATION advice reads the refusal, not bpmn validate ([#53](https://github.com/Miragon/bpmn-cli/issues/53)) ([c8b18bc](https://github.com/Miragon/bpmn-cli/commit/c8b18bcb065cfc0ca79da35732ecfcf3fac87157))

## [0.6.0](https://github.com/Miragon/bpmn-cli/compare/v0.5.0...v0.6.0) (2026-10-12)


### Features

* a batch edits a hand-drawn model like single commands, place --side, E_NO_ROOM with a command ([#18](https://github.com/Miragon/bpmn-cli/issues/18), part 1) ([#22](https://github.com/Miragon/bpmn-cli/issues/22)) ([726d53e](https://github.com/Miragon/bpmn-cli/commit/726d53ea0f84aa1072fd958129d780b011d87dd0))
* new branches and boundary paths in a hand-made drawing avoid crossing lines, with a local repair ([#18](https://github.com/Miragon/bpmn-cli/issues/18), part 2) ([#24](https://github.com/Miragon/bpmn-cli/issues/24)) ([5d92db2](https://github.com/Miragon/bpmn-cli/commit/5d92db2c652bbcffdbb972d9a1c7bbcb79233a2c))

## [0.5.0](https://github.com/Miragon/bpmn-cli/compare/v0.4.0...v0.5.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* runProfile(doc) and validateDoc(doc, { platform }) throw E_PROFILE_NOT_LOADED on a Camunda 7 / 8 document unless its rules were loaded: call `await loadProfiles()` (or loadProfile('c7' | 'c8')) once before them. applyToXml, newXml, layoutXml, validateXml, mutateDoc, checkDoc and the file helpers load the rules themselves.
* runProfile(doc) and validateDoc(doc, { platform }) throw E_PROFILE_NOT_LOADED on a Camunda 7 / 8 document unless its rules were loaded: call `await loadProfiles()` (or loadProfile('c7' | 'c8')) once before them. applyToXml, newXml, layoutXml, validateXml, mutateDoc, checkDoc and the file helpers load the rules themselves.

### Features

* bpmn render — SVG/PNG for agents with crops, halos and numbered layout problems ([#12](https://github.com/Miragon/bpmn-cli/issues/12)) ([#15](https://github.com/Miragon/bpmn-cli/issues/15)) ([bc28c5c](https://github.com/Miragon/bpmn-cli/commit/bc28c5c61396a6e2e406a4c6f3f6f59c23fa0d44))
* load the Camunda 7 / 8 profile rules on demand ([#13](https://github.com/Miragon/bpmn-cli/issues/13)) ([#14](https://github.com/Miragon/bpmn-cli/issues/14)) ([ac56dc3](https://github.com/Miragon/bpmn-cli/commit/ac56dc3a4ba732ca933c3ffa0304eae226269bf0))

## [0.4.0](https://github.com/Miragon/bpmn-cli/compare/v0.3.0...v0.4.0) (2026-10-10)


### ⚠ BREAKING CHANGES

* generated ids are no longer hashes or running numbers (Flow_1cat8ax / Flow_12 become Flow_OrderReceivedToCheckInvoice), and a flow whose id named its old ends is renamed after its new ends.

### Features

* agent ergonomics (views, speaking ids, batch aliases, layout) and a Camunda 8 profile ([#7](https://github.com/Miragon/bpmn-cli/issues/7)) ([81172a4](https://github.com/Miragon/bpmn-cli/commit/81172a4b123b69248fa70ee9ecc1195867324c0e))
* land the plugin ([#8](https://github.com/Miragon/bpmn-cli/issues/8)) and the step 3 follow-ups ([#9](https://github.com/Miragon/bpmn-cli/issues/9)) on main ([#11](https://github.com/Miragon/bpmn-cli/issues/11)) ([4f1b37f](https://github.com/Miragon/bpmn-cli/commit/4f1b37f56f3e5653ec6757d7b6e0689b33db10aa))

## [0.3.0](https://github.com/Miragon/bpmn-cli/compare/v0.2.0...v0.3.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* mutateFile/checkFile/loadDoc moved to @miragon/bpmn-cli/node (Doc.load is readDoc there) and mutateDoc no longer writes files; layoutXml now means 'bpmn layout' on a string; generated ids follow the file's style (bpmn-cli's own style hashes new flow ids instead of Flow_<n>); a write keeps the file's element order and no longer repairs XSD element-order errors as a side effect.

### Features

* design-iq readiness — isomorphic core API, roundtrip fidelity, file conventions, validators ([#5](https://github.com/Miragon/bpmn-cli/issues/5)) ([7009518](https://github.com/Miragon/bpmn-cli/commit/7009518b32dbdc310d5b14adc031a94dc72f467d))

## [0.2.0](https://github.com/Miragon/bpmn-cli/compare/v0.1.1...v0.2.0) (2026-10-09)


### Features

* Camunda 7 support — nested keys, extension containers, validate profile ([#2](https://github.com/Miragon/bpmn-cli/issues/2)) ([b847405](https://github.com/Miragon/bpmn-cli/commit/b8474052b9c600d8e66d6f06e64e136bedc8b13c))


### Bug Fixes

* Camunda 7 follow-ups — profile precision, nested selectors, safer hints ([#4](https://github.com/Miragon/bpmn-cli/issues/4)) ([d782969](https://github.com/Miragon/bpmn-cli/commit/d7829692241c94bd243a81f6d0cefbde2da6b737))

## [0.1.1](https://github.com/Miragon/bpmn-cli/compare/v0.1.0...v0.1.1) (2026-10-09)


### Bug Fixes

* use a normalized bin path so npm publish keeps the bpmn command without warnings ([53555d4](https://github.com/Miragon/bpmn-cli/commit/53555d410d3a2a8d9a658a5b9f490c62945a98ef))
