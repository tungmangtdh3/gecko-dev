//* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-/
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsUrlClassifierDBService_h_
#define nsUrlClassifierDBService_h_

#include <nsISupportsUtils.h>

#include "nsID.h"
#include "nsInterfaceHashtable.h"
#include "nsIObserver.h"
#include "nsUrlClassifierPrefixSet.h"
#include "nsIUrlClassifierHashCompleter.h"
#include "nsIUrlListManager.h"
#include "nsIUrlClassifierDBService.h"
#include "nsIURIClassifier.h"
#include "nsToolkitCompsCID.h"
#include "nsICryptoHMAC.h"
#include "mozilla/Attributes.h"
#include "mozilla/Mutex.h"
#include "mozilla/TimeStamp.h"

#include "Entries.h"
#include "LookupCache.h"

// GCC < 6.1 workaround, see bug 1329593
#if defined(XP_WIN) && defined(__MINGW32__)
#define GCC_MANGLING_WORKAROUND __stdcall
#else
#define GCC_MANGLING_WORKAROUND
#endif

// The hash length for a domain key.
#define DOMAIN_LENGTH 4

// The hash length of a partial hash entry.
#define PARTIAL_LENGTH 4

// The hash length of a complete hash entry.
#define COMPLETE_LENGTH 32

using namespace mozilla::safebrowsing;

class nsUrlClassifierDBServiceWorker;
class nsIThread;
class nsIURI;
class UrlClassifierDBServiceWorkerProxy;
namespace mozilla {
namespace safebrowsing {
class Classifier;
class ProtocolParser;
class TableUpdate;

nsresult
TablesToResponse(const nsACString& tables);

} // namespace safebrowsing
} // namespace mozilla

// This is a proxy class that just creates a background thread and delagates
// calls to the background thread.
class nsUrlClassifierDBService final : public nsIUrlClassifierDBService,
                                       public nsIURIClassifier,
                                       public nsIObserver
{
public:
  // This is thread safe. It throws an exception if the thread is busy.
  nsUrlClassifierDBService();

  nsresult Init();

  static nsUrlClassifierDBService* GetInstance(nsresult *result);

  NS_DECLARE_STATIC_IID_ACCESSOR(NS_URLCLASSIFIERDBSERVICE_CID)

  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIURLCLASSIFIERDBSERVICE
  NS_DECL_NSIURICLASSIFIER
  NS_DECL_NSIOBSERVER

  bool GetCompleter(const nsACString& tableName,
                      nsIUrlClassifierHashCompleter** completer);
  nsresult CacheCompletions(mozilla::safebrowsing::CacheResultArray *results);
  nsresult CacheMisses(mozilla::safebrowsing::PrefixArray *results);

  static nsIThread* BackgroundThread();

  static bool ShutdownHasStarted();

  // Enum array index of  string preference which is defined in
  // SafeBrowsingPrefs.h
  enum SBStringPreferences
  {
#define SB_STRING_PREF(name, macroName) eString##macroName,
#define SB_BOOL_PREF(name, macroName, defaultValue)
#include "SafeBrowsingPrefs.h"
#undef SB_STRING_PREF
#undef SB_BOOL_PREF
  eStringPrefCount
  };

  typedef struct {
    const char*         name;
    nsCString           value;
    SBStringPreferences id;
  } StringPreference;

  // Store preferences in arrays
  StringPreference mStringPreferences[eStringPrefCount] = {
#define SB_STRING_PREF(name, macroName)                               \
  { name,                                                             \
    NS_LITERAL_CSTRING(""),                                           \
    eString##macroName                                                \
  },
#define SB_BOOL_PREF(name, macroName, defaultValue)
#include "SafeBrowsingPrefs.h"
#undef SB_STRING_PREF
#undef SB_BOOL_PREF
  };

  enum SBBoolPreferences
  {
#define SB_STRING_PREF(name, macroName)
#define SB_BOOL_PREF(name, macroName, defaultValue)      eBool##macroName,
#include "SafeBrowsingPrefs.h"
#undef SB_BOOL_PREF
#undef SB_STRING_PREF
  eBoolPrefCount
  };

  typedef struct {
    const char*         name;
    bool                value;
    bool                defaultValue;
    SBBoolPreferences   id;
  } BoolPreference;

  // Store preferences in arrays
  BoolPreference mBoolPreferences[eBoolPrefCount] = {
#define SB_BOOL_PREF(name, macroName, defaultValue)                     \
    { name,                                                             \
      defaultValue,                                                     \
      defaultValue,                                                     \
      eBool##macroName                                                  \
    },
#define SB_STRING_PREF(name, macroName)
#include "SafeBrowsingPrefs.h"
#undef SB_STRING_PREF
#undef SB_BOOL_PREF
  };

  // Define getter function of preferences
#define SB_STRING_PREF(name, macroName)                                \
  const nsCString Get##macroName()                                     \
  {                                                                    \
    return mStringPreferences[eString##macroName].value;               \
  }

#define SB_BOOL_PREF(name, macroName, defaultValue)                    \
  bool Get##macroName()                                                \
  {                                                                    \
    return mBoolPreferences[eBool##macroName].value;                   \
  }
#include "SafeBrowsingPrefs.h"
#undef SB_STRING_PREF
#undef SB_BOOL_PREF

  BoolPreference* GetBoolPreferences() { return mBoolPreferences; }
  StringPreference* GetStringPreferences() { return mStringPreferences; }

private:

  // No subclassing
  ~nsUrlClassifierDBService();

  // Disallow copy constructor
  nsUrlClassifierDBService(nsUrlClassifierDBService&);

  nsresult LookupURI(nsIPrincipal* aPrincipal,
                     const nsACString& tables,
                     nsIUrlClassifierCallback* c,
                     bool forceCheck, bool *didCheck);

  // Close db connection and join the background thread if it exists.
  nsresult Shutdown();

  // Check if the key is on a known-clean host.
  nsresult CheckClean(const nsACString &lookupKey,
                      bool *clean);

  // Cache table from prefs
  nsresult ReadTablesFromPrefs();

  void AppendTables(const nsCString& aTables, nsCString &outTables);

  RefPtr<nsUrlClassifierDBServiceWorker> mWorker;
  RefPtr<UrlClassifierDBServiceWorkerProxy> mWorkerProxy;

  nsInterfaceHashtable<nsCStringHashKey, nsIUrlClassifierHashCompleter> mCompleters;

  // TRUE if a BeginUpdate() has been called without an accompanying
  // CancelUpdate()/FinishUpdate().  This is used to prevent competing
  // updates, not to determine whether an update is still being
  // processed.
  bool mInUpdate;

  // The list of tables that can use the default hash completer object.
  nsTArray<nsCString> mGethashTables;

  // The list of tables that should never be hash completed.
  nsTArray<nsCString> mDisallowCompletionsTables;

  // Comma-separated list of tables to use in lookups.
  nsCString mTrackingProtectionTables;
  nsCString mBaseTables;

  // Thread that we do the updates on.
  static nsIThread* gDbBackgroundThread;
  static void StringPrefChanged(const char* aPrefName, void* aClosure);
  static void BoolPrefChanged(const char* aPrefName, void* aClosure);

};

class nsUrlClassifierDBServiceWorker final : public nsIUrlClassifierDBService
{
public:
  nsUrlClassifierDBServiceWorker();

  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIURLCLASSIFIERDBSERVICE

  nsresult Init(uint32_t aGethashNoise, nsCOMPtr<nsIFile> aCacheDir);

  // Queue a lookup for the worker to perform, called in the main thread.
  // tables is a comma-separated list of tables to query
  nsresult QueueLookup(const nsACString& lookupKey,
                       const nsACString& tables,
                       nsIUrlClassifierLookupCallback* callback);

  // Handle any queued-up lookups.  We call this function during long-running
  // update operations to prevent lookups from blocking for too long.
  nsresult HandlePendingLookups();

  // Perform a blocking classifier lookup for a given url. Can be called on
  // either the main thread or the worker thread.
  nsresult DoLocalLookup(const nsACString& spec,
                         const nsACString& tables,
                         LookupResultArray* results);

  // Open the DB connection
  nsresult GCC_MANGLING_WORKAROUND OpenDb();

  // Provide a way to forcibly close the db connection.
  nsresult GCC_MANGLING_WORKAROUND CloseDb();

  nsresult CacheCompletions(CacheResultArray * aEntries);
  nsresult CacheMisses(PrefixArray * aEntries);

  // Used to probe the state of the worker thread. When the update begins,
  // mUpdateObserver will be set. When the update finished, mUpdateObserver
  // will be nulled out in NotifyUpdateObserver.
  bool IsBusyUpdating() const { return !!mUpdateObserver; }

  // Delegate Classifier to disable async update. If there is an
  // ongoing update on the update thread, we will be blocked until
  // the background update is done and callback is fired.
  // Should be called on the worker thread.
  void FlushAndDisableAsyncUpdate();

private:
  // No subclassing
  ~nsUrlClassifierDBServiceWorker();

  // Disallow copy constructor
  nsUrlClassifierDBServiceWorker(nsUrlClassifierDBServiceWorker&);

  nsresult NotifyUpdateObserver(nsresult aUpdateStatus);

  // Reset the in-progress update stream
  void ResetStream();

  // Reset the in-progress update
  void ResetUpdate();

  // Perform a classifier lookup for a given url.
  nsresult DoLookup(const nsACString& spec,
                    const nsACString& tables,
                    nsIUrlClassifierLookupCallback* c);

  nsresult AddNoise(const Prefix aPrefix,
                    const nsCString tableName,
                    uint32_t aCount,
                    LookupResultArray& results);

  // Can only be used on the background thread
  nsCOMPtr<nsICryptoHash> mCryptoHash;

  nsAutoPtr<mozilla::safebrowsing::Classifier> mClassifier;
  // The class that actually parses the update chunks.
  nsAutoPtr<ProtocolParser> mProtocolParser;

  // Directory where to store the SB databases.
  nsCOMPtr<nsIFile> mCacheDir;

  // XXX: maybe an array of autoptrs.  Or maybe a class specifically
  // storing a series of updates.
  nsTArray<mozilla::safebrowsing::TableUpdate*> mTableUpdates;

  uint32_t mUpdateWaitSec;

  // Entries that cannot be completed. We expect them to die at
  // the next update
  PrefixArray mMissCache;

  // Stores the last results that triggered a table update.
  CacheResultArray mLastResults;

  nsresult mUpdateStatus;
  nsTArray<nsCString> mUpdateTables;

  nsCOMPtr<nsIUrlClassifierUpdateObserver> mUpdateObserver;
  bool mInStream;

  // The number of noise entries to add to the set of lookup results.
  uint32_t mGethashNoise;

  // Pending lookups are stored in a queue for processing.  The queue
  // is protected by mPendingLookupLock.
  mozilla::Mutex mPendingLookupLock;

  class PendingLookup {
  public:
    mozilla::TimeStamp mStartTime;
    nsCString mKey;
    nsCString mTables;
    nsCOMPtr<nsIUrlClassifierLookupCallback> mCallback;
  };

  // list of pending lookups
  nsTArray<PendingLookup> mPendingLookups;

#ifdef MOZ_SAFEBROWSING_DUMP_FAILED_UPDATES
  // The raw update response for debugging.
  nsCString mRawTableUpdates;
#endif
};

NS_DEFINE_STATIC_IID_ACCESSOR(nsUrlClassifierDBService, NS_URLCLASSIFIERDBSERVICE_CID)

#endif // nsUrlClassifierDBService_h_
