/**
 * kinds/registry.js — the kind-module registry (Story #5215).
 *
 * Extracted from `kernel.js`, which had grown to carry ~230 lines of purely
 * declarative wiring — eight named-import blocks and eight protocol bindings
 * — around six small resolver functions. The wiring is the part that grows
 * every time the protocol gains a member (`rowIdentity` was the latest), so
 * it lives on its own and `kernel.js` keeps only the surface callers use.
 *
 * `KIND_MODULES` is the single registration point: a kind that is not in
 * this object does not exist as far as `getKindModule` is concerned.
 *
 * @module lib/baselines/kinds/registry
 */

import {
  applyEpsilon as bundleSizeApplyEpsilon,
  compare as bundleSizeCompare,
  kernelVersion as bundleSizeKernelVersion,
  keyField as bundleSizeKeyField,
  mergeRows as bundleSizeMergeRows,
  name as bundleSizeName,
  projectRow as bundleSizeProjectRow,
  rollup as bundleSizeRollup,
  rowIdentity as bundleSizeRowIdentity,
  sortRows as bundleSizeSortRows,
} from './bundle-size.js';
import {
  applyEpsilon as coverageApplyEpsilon,
  compare as coverageCompare,
  kernelVersion as coverageKernelVersion,
  keyField as coverageKeyField,
  mergeRows as coverageMergeRows,
  name as coverageName,
  projectRow as coverageProjectRow,
  rollup as coverageRollup,
  rowIdentity as coverageRowIdentity,
  sortRows as coverageSortRows,
} from './coverage.js';
import {
  applyEpsilon as crapApplyEpsilon,
  assertBaselineCompatible as crapAssertBaselineCompatible,
  compare as crapCompare,
  envelopeExtras as crapEnvelopeExtras,
  kernelVersion as crapKernelVersion,
  keyField as crapKeyField,
  mergeRows as crapMergeRows,
  name as crapName,
  projectRow as crapProjectRow,
  rollup as crapRollup,
  rowIdentity as crapRowIdentity,
  sortRows as crapSortRows,
} from './crap.js';
import {
  applyEpsilon as duplicationApplyEpsilon,
  compare as duplicationCompare,
  kernelVersion as duplicationKernelVersion,
  keyField as duplicationKeyField,
  mergeRows as duplicationMergeRows,
  name as duplicationName,
  projectRow as duplicationProjectRow,
  rollup as duplicationRollup,
  rowIdentity as duplicationRowIdentity,
  sortRows as duplicationSortRows,
} from './duplication.js';
import {
  applyEpsilon as lighthouseApplyEpsilon,
  compare as lighthouseCompare,
  kernelVersion as lighthouseKernelVersion,
  keyField as lighthouseKeyField,
  mergeRows as lighthouseMergeRows,
  name as lighthouseName,
  projectRow as lighthouseProjectRow,
  rollup as lighthouseRollup,
  rowIdentity as lighthouseRowIdentity,
  sortRows as lighthouseSortRows,
} from './lighthouse.js';
import {
  applyEpsilon as lintApplyEpsilon,
  compare as lintCompare,
  kernelVersion as lintKernelVersion,
  keyField as lintKeyField,
  mergeRows as lintMergeRows,
  name as lintName,
  projectRow as lintProjectRow,
  rollup as lintRollup,
  rowIdentity as lintRowIdentity,
  sortRows as lintSortRows,
} from './lint.js';
import {
  applyEpsilon as maintainabilityApplyEpsilon,
  compare as maintainabilityCompare,
  kernelVersion as maintainabilityKernelVersion,
  keyField as maintainabilityKeyField,
  mergeRows as maintainabilityMergeRows,
  name as maintainabilityName,
  projectRow as maintainabilityProjectRow,
  rollup as maintainabilityRollup,
  rowIdentity as maintainabilityRowIdentity,
  sortRows as maintainabilitySortRows,
} from './maintainability.js';
import {
  applyEpsilon as mutationApplyEpsilon,
  assertBaselineCompatible as mutationAssertBaselineCompatible,
  compare as mutationCompare,
  kernelVersion as mutationKernelVersion,
  keyField as mutationKeyField,
  mergeRows as mutationMergeRows,
  name as mutationName,
  projectRow as mutationProjectRow,
  rollup as mutationRollup,
  rowIdentity as mutationRowIdentity,
  sortRows as mutationSortRows,
} from './mutation.js';

/**
 * Assemble the kind-module protocol from named imports.
 *
 * Prefer named imports over `import * as kind` here: knip (and the
 * dead-exports ratchet) cannot see members reached only through
 * `getKindModule(kind).projectRow(...)` after a namespace import, so
 * star-imports of `kinds/*.js` produced systematic false-positive dead
 * exports for the protocol surface (`name`, `keyField`, `kernelVersion`,
 * `projectRow`, `sortRows`, `rollup`, …).
 *
 * @param {object} members
 * @returns {object}
 */
function bindKindModule(members) {
  return Object.freeze({
    name: members.name,
    keyField: members.keyField,
    // Story #5215: the merge identity, distinct from the `keyField`
    // grouping key above — CRAP groups by file and identifies by method.
    rowIdentity: members.rowIdentity,
    kernelVersion: members.kernelVersion,
    projectRow: members.projectRow,
    sortRows: members.sortRows,
    rollup: members.rollup,
    compare: members.compare,
    applyEpsilon: members.applyEpsilon,
    mergeRows: members.mergeRows,
    // Optional per-kind hooks (Story #4775). `envelopeExtras` contributes
    // envelope-level stamps the shared writer would not otherwise know about;
    // `assertBaselineCompatible` lets a kind refuse a loaded baseline whose
    // scoring semantics predate the running scorer.
    envelopeExtras: members.envelopeExtras,
    assertBaselineCompatible: members.assertBaselineCompatible,
  });
}

/**
 * Registry of every shipped kind module. Keys mirror the per-kind schema
 * filenames so a future "list all kinds" iterator can stay declarative.
 */
export const KIND_MODULES = Object.freeze({
  lint: bindKindModule({
    name: lintName,
    keyField: lintKeyField,
    rowIdentity: lintRowIdentity,
    kernelVersion: lintKernelVersion,
    projectRow: lintProjectRow,
    sortRows: lintSortRows,
    rollup: lintRollup,
    compare: lintCompare,
    applyEpsilon: lintApplyEpsilon,
    mergeRows: lintMergeRows,
  }),
  coverage: bindKindModule({
    name: coverageName,
    keyField: coverageKeyField,
    rowIdentity: coverageRowIdentity,
    kernelVersion: coverageKernelVersion,
    projectRow: coverageProjectRow,
    sortRows: coverageSortRows,
    rollup: coverageRollup,
    compare: coverageCompare,
    applyEpsilon: coverageApplyEpsilon,
    mergeRows: coverageMergeRows,
  }),
  crap: bindKindModule({
    name: crapName,
    keyField: crapKeyField,
    rowIdentity: crapRowIdentity,
    kernelVersion: crapKernelVersion,
    projectRow: crapProjectRow,
    sortRows: crapSortRows,
    rollup: crapRollup,
    compare: crapCompare,
    applyEpsilon: crapApplyEpsilon,
    mergeRows: crapMergeRows,
    envelopeExtras: crapEnvelopeExtras,
    assertBaselineCompatible: crapAssertBaselineCompatible,
  }),
  maintainability: bindKindModule({
    name: maintainabilityName,
    keyField: maintainabilityKeyField,
    rowIdentity: maintainabilityRowIdentity,
    kernelVersion: maintainabilityKernelVersion,
    projectRow: maintainabilityProjectRow,
    sortRows: maintainabilitySortRows,
    rollup: maintainabilityRollup,
    compare: maintainabilityCompare,
    applyEpsilon: maintainabilityApplyEpsilon,
    mergeRows: maintainabilityMergeRows,
  }),
  mutation: bindKindModule({
    name: mutationName,
    keyField: mutationKeyField,
    rowIdentity: mutationRowIdentity,
    kernelVersion: mutationKernelVersion,
    projectRow: mutationProjectRow,
    sortRows: mutationSortRows,
    rollup: mutationRollup,
    compare: mutationCompare,
    applyEpsilon: mutationApplyEpsilon,
    mergeRows: mutationMergeRows,
    assertBaselineCompatible: mutationAssertBaselineCompatible,
  }),
  lighthouse: bindKindModule({
    name: lighthouseName,
    keyField: lighthouseKeyField,
    rowIdentity: lighthouseRowIdentity,
    kernelVersion: lighthouseKernelVersion,
    projectRow: lighthouseProjectRow,
    sortRows: lighthouseSortRows,
    rollup: lighthouseRollup,
    compare: lighthouseCompare,
    applyEpsilon: lighthouseApplyEpsilon,
    mergeRows: lighthouseMergeRows,
  }),
  'bundle-size': bindKindModule({
    name: bundleSizeName,
    keyField: bundleSizeKeyField,
    rowIdentity: bundleSizeRowIdentity,
    kernelVersion: bundleSizeKernelVersion,
    projectRow: bundleSizeProjectRow,
    sortRows: bundleSizeSortRows,
    rollup: bundleSizeRollup,
    compare: bundleSizeCompare,
    applyEpsilon: bundleSizeApplyEpsilon,
    mergeRows: bundleSizeMergeRows,
  }),
  duplication: bindKindModule({
    name: duplicationName,
    keyField: duplicationKeyField,
    rowIdentity: duplicationRowIdentity,
    kernelVersion: duplicationKernelVersion,
    projectRow: duplicationProjectRow,
    sortRows: duplicationSortRows,
    rollup: duplicationRollup,
    compare: duplicationCompare,
    applyEpsilon: duplicationApplyEpsilon,
    mergeRows: duplicationMergeRows,
  }),
});
