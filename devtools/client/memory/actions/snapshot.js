/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { assert, reportException } = require("devtools/shared/DevToolsUtils");
const {
  censusIsUpToDate,
  getSnapshot,
  breakdownEquals,
  createSnapshot,
  dominatorTreeIsComputed,
} = require("../utils");
const { actions, snapshotState: states, viewState, dominatorTreeState } = require("../constants");
const view = require("./view");
const refresh = require("./refresh");

/**
 * A series of actions are fired from this task to save, read and generate the
 * initial census from a snapshot.
 *
 * @param {MemoryFront}
 * @param {HeapAnalysesClient}
 * @param {Object}
 */
const takeSnapshotAndCensus = exports.takeSnapshotAndCensus = function (front, heapWorker) {
  return function *(dispatch, getState) {
    const id = yield dispatch(takeSnapshot(front));
    if (id === null) {
      return;
    }

    yield dispatch(readSnapshot(heapWorker, id));
    if (getSnapshot(getState(), id).state === states.READ) {
      yield dispatch(takeCensus(heapWorker, id));

      if (getState().view === viewState.DOMINATOR_TREE) {
        yield dispatch(computeAndFetchDominatorTree(heapWorker, id));
      }
    }
  };
};

/**
 * Selects a snapshot and if the snapshot's census is using a different
 * breakdown, take a new census.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {snapshotId} id
 */
const selectSnapshotAndRefresh = exports.selectSnapshotAndRefresh = function (heapWorker, id) {
  return function *(dispatch, getState) {
    if (getState().diffing) {
      dispatch(view.changeView(viewState.CENSUS));
    }

    dispatch(selectSnapshot(id));
    yield dispatch(refresh.refresh(heapWorker));
  };
};

/**
 * Take a snapshot and return its id on success, or null on failure.
 *
 * @param {MemoryFront} front
 * @returns {Number|null}
 */
const takeSnapshot = exports.takeSnapshot = function (front) {
  return function *(dispatch, getState) {
    if (getState().diffing) {
      dispatch(view.changeView(viewState.CENSUS));
    }

    const snapshot = createSnapshot(getState());
    const id = snapshot.id;
    dispatch({ type: actions.TAKE_SNAPSHOT_START, snapshot });
    dispatch(selectSnapshot(id));

    let path;
    try {
      path = yield front.saveHeapSnapshot();
    } catch (error) {
      reportException("takeSnapshot", error);
      dispatch({ type: actions.SNAPSHOT_ERROR, id, error });
      return null;
    }

    dispatch({ type: actions.TAKE_SNAPSHOT_END, id, path });
    return snapshot.id;
  };
};

/**
 * Reads a snapshot into memory; necessary to do before taking
 * a census on the snapshot. May only be called once per snapshot.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {snapshotId} id
 */
const readSnapshot = exports.readSnapshot = function readSnapshot (heapWorker, id) {
  return function *(dispatch, getState) {
    const snapshot = getSnapshot(getState(), id);
    assert([states.SAVED, states.IMPORTING].includes(snapshot.state),
      `Should only read a snapshot once. Found snapshot in state ${snapshot.state}`);

    let creationTime;

    dispatch({ type: actions.READ_SNAPSHOT_START, id });
    try {
      yield heapWorker.readHeapSnapshot(snapshot.path);
      creationTime = yield heapWorker.getCreationTime(snapshot.path);
    } catch (error) {
      reportException("readSnapshot", error);
      dispatch({ type: actions.SNAPSHOT_ERROR, id, error });
      return;
    }

    dispatch({ type: actions.READ_SNAPSHOT_END, id, creationTime });
  };
};

/**
 * @param {HeapAnalysesClient} heapWorker
 * @param {snapshotId} id
 *
 * @see {Snapshot} model defined in devtools/client/memory/models.js
 * @see `devtools/shared/heapsnapshot/HeapAnalysesClient.js`
 * @see `js/src/doc/Debugger/Debugger.Memory.md` for breakdown details
 */
const takeCensus = exports.takeCensus = function (heapWorker, id) {
  return function *(dispatch, getState) {
    const snapshot = getSnapshot(getState(), id);
    assert([states.READ, states.SAVED_CENSUS].includes(snapshot.state),
      `Can only take census of snapshots in READ or SAVED_CENSUS state, found ${snapshot.state}`);

    let report;
    let inverted = getState().inverted;
    let breakdown = getState().breakdown;
    let filter = getState().filter;

    // If breakdown, filter and inversion haven't changed, don't do anything.
    if (censusIsUpToDate(inverted, filter, breakdown, snapshot.census)) {
      return;
    }

    // Keep taking a census if the breakdown changes during. Recheck
    // that the breakdown used for the census is the same as
    // the state's breakdown.
    do {
      inverted = getState().inverted;
      breakdown = getState().breakdown;
      filter = getState().filter;

      dispatch({
        type: actions.TAKE_CENSUS_START,
        id,
        inverted,
        filter,
        breakdown
      });

      let opts = inverted ? { asInvertedTreeNode: true } : { asTreeNode: true };
      opts.filter = filter || null;

      try {
        report = yield heapWorker.takeCensus(snapshot.path, { breakdown }, opts);
      } catch (error) {
        reportException("takeCensus", error);
        dispatch({ type: actions.SNAPSHOT_ERROR, id, error });
        return;
      }
    }
    while (inverted !== getState().inverted ||
           filter !== getState().filter ||
           !breakdownEquals(breakdown, getState().breakdown));

    dispatch({
      type: actions.TAKE_CENSUS_END,
      id,
      breakdown,
      inverted,
      filter,
      report
    });
  };
};

/**
 * Refresh the selected snapshot's census data, if need be (for example,
 * breakdown configuration changed).
 *
 * @param {HeapAnalysesClient} heapWorker
 */
const refreshSelectedCensus = exports.refreshSelectedCensus = function (heapWorker) {
  return function*(dispatch, getState) {
    let snapshot = getState().snapshots.find(s => s.selected);

    // Intermediate snapshot states will get handled by the task action that is
    // orchestrating them. For example, if the snapshot's state is
    // SAVING_CENSUS, then the takeCensus action will keep taking a census until
    // the inverted property matches the inverted state. If the snapshot is
    // still in the process of being saved or read, the takeSnapshotAndCensus
    // task action will follow through and ensure that a census is taken.
    if (snapshot && snapshot.state === states.SAVED_CENSUS) {
      yield dispatch(takeCensus(heapWorker, snapshot.id));
    }
  };
};

/**
 * Request that the `HeapAnalysesWorker` compute the dominator tree for the
 * snapshot with the given `id`.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {SnapshotId} id
 *
 * @returns {Promise<DominatorTreeId>}
 */
const computeDominatorTree = exports.computeDominatorTree = function (heapWorker, id) {
  return function*(dispatch, getState) {
    const snapshot = getSnapshot(getState(), id);
    assert(!(snapshot.dominatorTree && snapshot.dominatorTree.dominatorTreeId),
           "Should not re-compute dominator trees");

    dispatch({ type: actions.COMPUTE_DOMINATOR_TREE_START, id });

    let dominatorTreeId;
    try {
      dominatorTreeId = yield heapWorker.computeDominatorTree(snapshot.path);
    } catch (error) {
      reportException("actions/snapshot/computeDominatorTree", error);
      dispatch({ type: actions.DOMINATOR_TREE_ERROR, id, error });
      return null;
    }

    dispatch({ type: actions.COMPUTE_DOMINATOR_TREE_END, id, dominatorTreeId });
    return dominatorTreeId;
  };
};

/**
 * Get the partial subtree, starting from the root, of the
 * snapshot-with-the-given-id's dominator tree.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {SnapshotId} id
 *
 * @returns {Promise<DominatorTreeNode>}
 */
const fetchDominatorTree = exports.fetchDominatorTree = function (heapWorker, id) {
  return function*(dispatch, getState) {
    const snapshot = getSnapshot(getState(), id);
    assert(dominatorTreeIsComputed(snapshot),
           "Should have dominator tree model and it should be computed");

    let breakdown;
    let root;
    do {
      breakdown = getState().dominatorTreeBreakdown;
      assert(breakdown, "Should have a breakdown to describe nodes with.");

      dispatch({ type: actions.FETCH_DOMINATOR_TREE_START, id, breakdown });

      try {
        root = yield heapWorker.getDominatorTree({
          dominatorTreeId: snapshot.dominatorTree.dominatorTreeId,
          breakdown,
        });
      } catch (error) {
        reportException("actions/snapshot/fetchDominatorTree", error);
        dispatch({ type: actions.DOMINATOR_TREE_ERROR, id, error });
        return null;
      }
    }
    while (!breakdownEquals(breakdown, getState().dominatorTreeBreakdown));

    dispatch({ type: actions.FETCH_DOMINATOR_TREE_END, id, root });
    return root;
  };
};

/**
 * Fetch the immediately dominated children represented by the placeholder
 * `lazyChildren` from snapshot-with-the-given-id's dominator tree.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {SnapshotId} id
 * @param {DominatorTreeLazyChildren} lazyChildren
 */
const fetchImmediatelyDominated = exports.fetchImmediatelyDominated = function (heapWorker, id, lazyChildren) {
  return function*(dispatch, getState) {
    const snapshot = getSnapshot(getState(), id);
    assert(snapshot.dominatorTree, "Should have dominator tree model");
    assert(snapshot.dominatorTree.state === dominatorTreeState.LOADED ||
           snapshot.dominatorTree.state === dominatorTreeState.INCREMENTAL_FETCHING,
           "Cannot fetch immediately dominated nodes in a dominator tree unless " +
           " the dominator tree has already been computed");

    let breakdown;
    let response;
    do {
      breakdown = getState().dominatorTreeBreakdown;
      assert(breakdown, "Should have a breakdown to describe nodes with.");

      dispatch({ type: actions.FETCH_IMMEDIATELY_DOMINATED_START, id });

      try {
        response = yield heapWorker.getImmediatelyDominated({
          dominatorTreeId: snapshot.dominatorTree.dominatorTreeId,
          breakdown,
          nodeId: lazyChildren.parentNodeId(),
          startIndex: lazyChildren.siblingIndex(),
        });
      } catch (error) {
        reportException("actions/snapshot/fetchImmediatelyDominated", error);
        dispatch({ type: actions.DOMINATOR_TREE_ERROR, id, error });
        return null;
      }
    }
    while (!breakdownEquals(breakdown, getState().dominatorTreeBreakdown));

    dispatch({
      type: actions.FETCH_IMMEDIATELY_DOMINATED_END,
      id,
      path: response.path,
      nodes: response.nodes,
      moreChildrenAvailable: response.moreChildrenAvailable,
    });
  };
};

/**
 * Compute and then fetch the dominator tree of the snapshot with the given
 * `id`.
 *
 * @param {HeapAnalysesClient} heapWorker
 * @param {SnapshotId} id
 *
 * @returns {Promise<DominatorTreeNode>}
 */
const computeAndFetchDominatorTree = exports.computeAndFetchDominatorTree = function (heapWorker, id) {
  return function*(dispatch, getState) {
    const dominatorTreeId = yield dispatch(computeDominatorTree(heapWorker, id));
    if (dominatorTreeId === null) {
      return null;
    }

    const root = yield dispatch(fetchDominatorTree(heapWorker, id));
    if (!root) {
      return null;
    }

    return root;
  };
};

/**
 * Update the currently selected snapshot's dominator tree.
 *
 * @param {HeapAnalysesClient} heapWorker
 */
const refreshSelectedDominatorTree = exports.refreshSelectedDominatorTree = function (heapWorker) {
  return function*(dispatch, getState) {
    let snapshot = getState().snapshots.find(s => s.selected);
    if (!snapshot) {
      return;
    }

    if (snapshot.dominatorTree &&
        !(snapshot.dominatorTree.state === dominatorTreeState.COMPUTED ||
          snapshot.dominatorTree.state === dominatorTreeState.LOADED ||
          snapshot.dominatorTree.state === dominatorTreeState.INCREMENTAL_FETCHING)) {
      return;
    }

    switch (snapshot.state) {
      case states.READ:
      case states.SAVING_CENSUS:
      case states.SAVED_CENSUS:
        if (snapshot.dominatorTree) {
          yield dispatch(fetchDominatorTree(heapWorker, snapshot.id));
        } else {
          yield dispatch(computeAndFetchDominatorTree(heapWorker, snapshot.id));
        }
        return;

      default:
        // If there was an error, we can't continue. If we are still saving or
        // reading the snapshot, then takeSnapshotAndCensus will finish the job
        // for us.
        return;
    }
  };
};

/**
 * Select the snapshot with the given id.
 *
 * @param {snapshotId} id
 * @see {Snapshot} model defined in devtools/client/memory/models.js
 */
const selectSnapshot = exports.selectSnapshot = function (id) {
  return {
    type: actions.SELECT_SNAPSHOT,
    id
  };
};

/**
 * Expand the given node in the snapshot's census report.
 *
 * @param {CensusTreeNode} node
 */
const expandCensusNode = exports.expandCensusNode = function (id, node) {
  return {
    type: actions.EXPAND_CENSUS_NODE,
    id,
    node,
  };
};

/**
 * Collapse the given node in the snapshot's census report.
 *
 * @param {CensusTreeNode} node
 */
const collapseCensusNode = exports.collapseCensusNode = function (id, node) {
  return {
    type: actions.COLLAPSE_CENSUS_NODE,
    id,
    node,
  };
};

/**
 * Focus the given node in the snapshot's census's report.
 *
 * @param {SnapshotId} id
 * @param {DominatorTreeNode} node
 */
const focusCensusNode = exports.focusCensusNode = function (id, node) {
  return {
    type: actions.FOCUS_CENSUS_NODE,
    id,
    node,
  };
};

/**
 * Expand the given node in the snapshot's dominator tree.
 *
 * @param {DominatorTreeTreeNode} node
 */
const expandDominatorTreeNode = exports.expandDominatorTreeNode = function (id, node) {
  return {
    type: actions.EXPAND_DOMINATOR_TREE_NODE,
    id,
    node,
  };
};

/**
 * Collapse the given node in the snapshot's dominator tree.
 *
 * @param {DominatorTreeTreeNode} node
 */
const collapseDominatorTreeNode = exports.collapseDominatorTreeNode = function (id, node) {
  return {
    type: actions.COLLAPSE_DOMINATOR_TREE_NODE,
    id,
    node,
  };
};

/**
 * Focus the given node in the snapshot's dominator tree.
 *
 * @param {SnapshotId} id
 * @param {DominatorTreeNode} node
 */
const focusDominatorTreeNode = exports.focusDominatorTreeNode = function (id, node) {
  return {
    type: actions.FOCUS_DOMINATOR_TREE_NODE,
    id,
    node,
  };
};
