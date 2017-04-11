//* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-/
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// We define a macro to cache string preferences which will be used in
// url-classifier:
//
//   SB_STRING_PREF("name", macroName)
//
//   * First argument is the name of the pref.
//   * Second argument is macro name, this will be used as index id of
//   preferences array.
//
//   We define a getter in nsUrlClassifierDBService.h as Get##macroName
//   For example
//   SB_STRING_PREF("urlclassifier.malwareTable", MalwareTables)
//   Getter function: const nsCString GetMalwareTables()

// String preferences
SB_STRING_PREF("urlclassifier.malwareTable", MalwareTables)
SB_STRING_PREF("urlclassifier.phishTable", PhishTables)
SB_STRING_PREF("urlclassifier.trackingTable", TrackingTables)
SB_STRING_PREF("urlclassifier.trackingWhitelistTable", TrackingWhitelistTables)
SB_STRING_PREF("urlclassifier.blockedTable", BlockedTables)
SB_STRING_PREF("urlclassifier.downloadBlockTable", DownloadBlockTables)
SB_STRING_PREF("urlclassifier.downloadAllowTable", DownloadAllowTables)
SB_STRING_PREF("urlclassifier.disallow_completions", DisallowCompletions)

// Bool preferences
//   SB_BOOL_PREF("name", macroName, defaultValue)
//   * First argument is the name of the pref.
//   * Second argument is macro name, this will be used as index id of
//   preferences array.
//   * Third argument is default value
//
// Prefs for implementing nsIURIClassifier to block page loads
// MalwareEnabled TRUE if the nsURIClassifier implementation should check for malware
// uris on document loads.
SB_BOOL_PREF("browser.safebrowsing.malware.enabled", MalwareEnabled, false)
// PhishingEnabled if the nsURIClassifier implementation should check for phishing
// uris on document loads.
SB_BOOL_PREF("browser.safebrowsing.phishing.enabled", PhishingEnabled, false)
// BlockedURIsEnabled if the nsURIClassifier implementation should check for blocked
// uris on document loads.
SB_BOOL_PREF("browser.safebrowsing.blockedURIs.enabled", BlockedURIsEnabled, false)
// TODO: The following pref is to be removed after we
//       roll out full v4 hash completion. See Bug 1331534.
SB_BOOL_PREF("browser.safebrowsing.temporary.take_v4_completion_result", V4CompletionResultEnabled, false)

