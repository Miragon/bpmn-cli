# Changelog

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
