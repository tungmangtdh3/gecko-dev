/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Options passed to MemoryFront's startRecordingAllocations never change.
exports.ALLOCATION_RECORDING_OPTIONS = {
  probability: 1,
  maxLogLength: 1
};

// If TREE_ROW_HEIGHT changes, be sure to change `var(--heap-tree-row-height)`
// in `devtools/client/themes/memory.css`
exports.TREE_ROW_HEIGHT = 14;

/*** Actions ******************************************************************/

const actions = exports.actions = {};

// Fired by UI to request a snapshot from the actor.
actions.TAKE_SNAPSHOT_START = "take-snapshot-start";
actions.TAKE_SNAPSHOT_END = "take-snapshot-end";

// When a heap snapshot is read into memory -- only fired
// once per snapshot.
actions.READ_SNAPSHOT_START = "read-snapshot-start";
actions.READ_SNAPSHOT_END = "read-snapshot-end";

// When a census is being performed on a heap snapshot
actions.TAKE_CENSUS_START = "take-census-start";
actions.TAKE_CENSUS_END = "take-census-end";

// When requesting that the server start/stop recording allocation stacks.
actions.TOGGLE_RECORD_ALLOCATION_STACKS_START = "toggle-record-allocation-stacks-start";
actions.TOGGLE_RECORD_ALLOCATION_STACKS_END = "toggle-record-allocation-stacks-end";

// When a heap snapshot is being saved to a user-specified
// location on disk.
actions.EXPORT_SNAPSHOT_START = "export-snapshot-start";
actions.EXPORT_SNAPSHOT_END = "export-snapshot-end";
actions.EXPORT_SNAPSHOT_ERROR = "export-snapshot-error";

// When a heap snapshot is being read from a user selected file,
// and represents the entire state until the census is available.
actions.IMPORT_SNAPSHOT_START = "import-snapshot-start";
actions.IMPORT_SNAPSHOT_END = "import-snapshot-end";
actions.IMPORT_SNAPSHOT_ERROR = "import-snapshot-error";

// Fired by UI to select a snapshot to view.
actions.SELECT_SNAPSHOT = "select-snapshot";

// Fired to toggle tree inversion on or off.
actions.TOGGLE_INVERTED = "toggle-inverted";

// Fired when a snapshot is selected for diffing.
actions.SELECT_SNAPSHOT_FOR_DIFFING = "select-snapshot-for-diffing";

// Fired when taking a census diff.
actions.TAKE_CENSUS_DIFF_START = "take-census-diff-start";
actions.TAKE_CENSUS_DIFF_END = "take-census-diff-end";
actions.DIFFING_ERROR = "diffing-error";

// Fired to set a new breakdown.
actions.SET_BREAKDOWN = "set-breakdown";

// Fired to change the breakdown that controls the dominator tree labels.
actions.SET_DOMINATOR_TREE_BREAKDOWN = "set-dominator-tree-breakdown";

// Fired when changing between census or dominators view.
actions.CHANGE_VIEW = "change-view";

// Fired when there is an error processing a snapshot or taking a census.
actions.SNAPSHOT_ERROR = "snapshot-error";

// Fired when there is a new filter string set.
actions.SET_FILTER_STRING = "set-filter-string";

// Fired to expand or collapse nodes in census reports.
actions.EXPAND_CENSUS_NODE = "expand-census-node";
actions.EXPAND_DIFFING_CENSUS_NODE = "expand-diffing-census-node";
actions.COLLAPSE_CENSUS_NODE = "collapse-census-node";
actions.COLLAPSE_DIFFING_CENSUS_NODE = "collapse-diffing-census-node";

// Fired when nodes in various trees are focused.
actions.FOCUS_CENSUS_NODE = "focus-census-node";
actions.FOCUS_DIFFING_CENSUS_NODE = "focus-diffing-census-node";
actions.FOCUS_DOMINATOR_TREE_NODE = "focus-dominator-tree-node";

actions.COMPUTE_DOMINATOR_TREE_START = "compute-dominator-tree-start";
actions.COMPUTE_DOMINATOR_TREE_END = "compute-dominator-tree-end";
actions.FETCH_DOMINATOR_TREE_START = "fetch-dominator-tree-start";
actions.FETCH_DOMINATOR_TREE_END = "fetch-dominator-tree-end";
actions.DOMINATOR_TREE_ERROR = "dominator-tree-error";
actions.FETCH_IMMEDIATELY_DOMINATED_START = "fetch-immediately-dominated-start";
actions.FETCH_IMMEDIATELY_DOMINATED_END = "fetch-immediately-dominated-end";
actions.EXPAND_DOMINATOR_TREE_NODE = "expand-dominator-tree-node";
actions.COLLAPSE_DOMINATOR_TREE_NODE = "collapse-dominator-tree-node";

/*** Breakdowns ***************************************************************/

const COUNT = { by: "count", count: true, bytes: true };
const INTERNAL_TYPE = { by: "internalType", then: COUNT };
const ALLOCATION_STACK = { by: "allocationStack", then: COUNT, noStack: COUNT };
const OBJECT_CLASS = { by: "objectClass", then: COUNT, other: COUNT };

const breakdowns = exports.breakdowns = {
  coarseType: {
    displayName: "Coarse Type",
    breakdown: {
      by: "coarseType",
      objects: OBJECT_CLASS,
      strings: COUNT,
      scripts: {
        by: "filename",
        then: INTERNAL_TYPE,
        noFilename: INTERNAL_TYPE
      },
      other: INTERNAL_TYPE,
    }
  },

  allocationStack: {
    displayName: "Allocation Stack",
    breakdown: ALLOCATION_STACK,
  },

  objectClass: {
    displayName: "Object Class",
    breakdown: OBJECT_CLASS,
  },

  internalType: {
    displayName: "Internal Type",
    breakdown: INTERNAL_TYPE,
  },
};

const DOMINATOR_TREE_LABEL_COARSE_TYPE = {
  by: "coarseType",
  objects: OBJECT_CLASS,
  scripts: {
    by: "internalType",
    then: {
      by: "filename",
      then: COUNT,
      noFilename: COUNT,
    },
  },
  strings: INTERNAL_TYPE,
  other: INTERNAL_TYPE,
};

const dominatorTreeBreakdowns = exports.dominatorTreeBreakdowns = {
  coarseType: {
    displayName: "Coarse Type",
    breakdown: DOMINATOR_TREE_LABEL_COARSE_TYPE
  },

  allocationStack: {
    displayName: "Allocation Stack",
    breakdown: {
      by: "allocationStack",
      then: DOMINATOR_TREE_LABEL_COARSE_TYPE,
      noStack: DOMINATOR_TREE_LABEL_COARSE_TYPE,
    },
  },

  internalType: {
    displayName: "Internal Type",
    breakdown: INTERNAL_TYPE,
  },
};

/*** View States **************************************************************/

/**
 * The various main views that the tool can be in.
 */
const viewState = exports.viewState = Object.create(null);
viewState.CENSUS = "view-state-census";
viewState.DIFFING = "view-state-diffing";
viewState.DOMINATOR_TREE = "view-state-dominator-tree";

/*** Snapshot States **********************************************************/

const snapshotState = exports.snapshotState = Object.create(null);

/**
 * Various states a snapshot can be in.
 * An FSM describing snapshot states:
 *
 *     SAVING -> SAVED -> READING -> READ     SAVED_CENSUS
 *                       ↗                ↘     ↑  ↓
 *              IMPORTING                   SAVING_CENSUS
 *
 * Any of these states may go to the ERROR state, from which they can never
 * leave (mwah ha ha ha!)
 */
snapshotState.ERROR = "snapshot-state-error";
snapshotState.IMPORTING = "snapshot-state-importing";
snapshotState.SAVING = "snapshot-state-saving";
snapshotState.SAVED = "snapshot-state-saved";
snapshotState.READING = "snapshot-state-reading";
snapshotState.READ = "snapshot-state-read";
snapshotState.SAVING_CENSUS = "snapshot-state-saving-census";
snapshotState.SAVED_CENSUS = "snapshot-state-saved-census";

/*** Diffing States ***********************************************************/

/*
 * Various states the diffing model can be in.
 *
 *     SELECTING --> TAKING_DIFF <---> TOOK_DIFF
 *                       |
 *                       V
 *                     ERROR
 */
const diffingState = exports.diffingState = Object.create(null);

// Selecting the two snapshots to diff.
diffingState.SELECTING = "diffing-state-selecting";

// Currently computing the diff between the two selected snapshots.
diffingState.TAKING_DIFF = "diffing-state-taking-diff";

// Have the diff between the two selected snapshots.
diffingState.TOOK_DIFF = "diffing-state-took-diff";

// An error occurred while computing the diff.
diffingState.ERROR = "diffing-state-error";

/*** Dominator Tree States ****************************************************/

/*
 * Various states the dominator tree model can be in.
 *
 *     COMPUTING -> COMPUTED -> FETCHING -> LOADED <--> INCREMENTAL_FETCHING
 *
 * Any state may lead to the ERROR state, from which it can never leave.
 */
const dominatorTreeState = exports.dominatorTreeState = Object.create(null);
dominatorTreeState.COMPUTING = "dominator-tree-state-computing";
dominatorTreeState.COMPUTED = "dominator-tree-state-computed";
dominatorTreeState.FETCHING = "dominator-tree-state-fetching";
dominatorTreeState.LOADED = "dominator-tree-state-loaded";
dominatorTreeState.INCREMENTAL_FETCHING = "dominator-tree-state-incremental-fetching";
dominatorTreeState.ERROR = "dominator-tree-state-error";
