"use strict";

const URL_REPORTS = "https://example.com/browser/browser/base/content/test/general/ssl_error_reports.sjs?";
const URL_BAD_CHAIN = "https://badchain.include-subdomains.pinning.example.com/";
const URL_NO_CERT = "https://fail-handshake.example.com/";
const URL_BAD_CERT = "https://expired.example.com/";
const URL_BAD_STS_CERT = "https://badchain.include-subdomains.pinning.example.com:443/";
const ROOT = getRootDirectory(gTestPath);
const PREF_REPORT_ENABLED = "security.ssl.errorReporting.enabled";
const PREF_REPORT_AUTOMATIC = "security.ssl.errorReporting.automatic";
const PREF_REPORT_URL = "security.ssl.errorReporting.url";

SimpleTest.requestCompleteLog();

Services.prefs.setIntPref("security.cert_pinning.enforcement_level", 2);

function cleanup() {
  Services.prefs.clearUserPref(PREF_REPORT_ENABLED);
  Services.prefs.clearUserPref(PREF_REPORT_AUTOMATIC);
  Services.prefs.clearUserPref(PREF_REPORT_URL);
}

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("security.cert_pinning.enforcement_level");
  cleanup();
});

add_task(function* test_send_report_neterror() {
  yield testSendReportAutomatically(URL_BAD_CHAIN, "succeed", "neterror");
  yield testSendReportAutomatically(URL_NO_CERT, "nocert", "neterror");
  yield testSendReportFailRetry(URL_NO_CERT, "nocert", "neterror");
  yield testSetAutomatic(URL_NO_CERT, "nocert", "neterror");
});

add_task(function* test_send_report_certerror() {
  yield testSendReportAutomatically(URL_BAD_CERT, "badcert", "certerror");
  yield testSendReportFailRetry(URL_BAD_CERT, "badcert", "certerror");
  yield testSetAutomatic(URL_BAD_CERT, "badcert", "certerror");
});

add_task(function* test_send_disabled() {
  Services.prefs.setBoolPref(PREF_REPORT_ENABLED, false);
  Services.prefs.setBoolPref(PREF_REPORT_AUTOMATIC, true);
  Services.prefs.setCharPref(PREF_REPORT_URL, "https://example.com/invalid");

  // Check with enabled=false but automatic=true.
  yield testSendReportDisabled(URL_NO_CERT, "neterror");
  yield testSendReportDisabled(URL_BAD_CERT, "certerror");

  Services.prefs.setBoolPref(PREF_REPORT_AUTOMATIC, false);

  // Check again with both prefs false.
  yield testSendReportDisabled(URL_NO_CERT, "neterror");
  yield testSendReportDisabled(URL_BAD_CERT, "certerror");
  cleanup();
});

function* testSendReportAutomatically(testURL, suffix, errorURISuffix) {
  Services.prefs.setBoolPref(PREF_REPORT_ENABLED, true);
  Services.prefs.setBoolPref(PREF_REPORT_AUTOMATIC, true);
  Services.prefs.setCharPref(PREF_REPORT_URL, URL_REPORTS + suffix);

  // Add a tab and wait until it's loaded.
  let tab = yield BrowserTestUtils.openNewForegroundTab(gBrowser, "about:blank");
  let browser = tab.linkedBrowser;

  // Load the page and wait for the error report submission.
  let promiseReport = createErrorReportPromise(browser);
  browser.loadURI(testURL);
  yield promiseReport;
  ok(true, "SSL error report submitted successfully");

  // Check that we loaded the right error page.
  yield checkErrorPage(browser, errorURISuffix);

  // Cleanup.
  gBrowser.removeTab(tab);
  cleanup();
};

function* testSendReportFailRetry(testURL, suffix, errorURISuffix) {
  try {
    yield testSendReportAutomatically(testURL, "error", errorURISuffix);
    ok(false, "sending a report should have failed");
  } catch (err) {
    ok(err, "saw a failure notification");
  }

  Services.prefs.setCharPref(PREF_REPORT_URL, URL_REPORTS + suffix);

  let browser = gBrowser.selectedBrowser;
  let promiseReport = createErrorReportPromise(browser);
  let promiseRetry = ContentTask.spawn(browser, null, function* () {
    content.document.getElementById("reportCertificateErrorRetry").click();
  });

  yield Promise.all([promiseReport, promiseRetry]);
  ok(true, "SSL error report submitted successfully");

  // Cleanup.
  gBrowser.removeCurrentTab();
  cleanup();
}

function* testSetAutomatic(testURL, suffix, errorURISuffix) {
  Services.prefs.setBoolPref(PREF_REPORT_ENABLED, true);
  Services.prefs.setBoolPref(PREF_REPORT_AUTOMATIC, false);
  Services.prefs.setCharPref(PREF_REPORT_URL, URL_REPORTS + suffix);

  // Add a tab and wait until it's loaded.
  let tab = yield BrowserTestUtils.openNewForegroundTab(gBrowser, "about:blank");
  let browser = tab.linkedBrowser;

  // Load the page.
  browser.loadURI(testURL);
  yield promiseErrorPageLoaded(browser);

  // Check that we loaded the right error page.
  yield checkErrorPage(browser, errorURISuffix);

  // Click the checkbox, enable automatic error reports.
  let promiseReport = createErrorReportPromise(browser);
  yield ContentTask.spawn(browser, null, function* () {
    content.document.getElementById("automaticallyReportInFuture").click();
  });

  // Wait for the error report submission.
  yield promiseReport;
  ok(true, "SSL error report submitted successfully");

  let isAutomaticReportingEnabled = () =>
    Services.prefs.getBoolPref(PREF_REPORT_AUTOMATIC);

  // Check that the pref was flipped.
  ok(isAutomaticReportingEnabled(), "automatic SSL report submission enabled");

  // Disable automatic error reports.
  yield ContentTask.spawn(browser, null, function* () {
    content.document.getElementById("automaticallyReportInFuture").click();
  });

  // Check that the pref was flipped.
  ok(!isAutomaticReportingEnabled(), "automatic SSL report submission disabled");

  // Cleanup.
  gBrowser.removeTab(tab);
  cleanup();
}

function* testSendReportDisabled(testURL, errorURISuffix) {
  // Add a tab and wait until it's loaded.
  let tab = yield BrowserTestUtils.openNewForegroundTab(gBrowser, "about:blank");
  let browser = tab.linkedBrowser;

  // Load the page.
  browser.loadURI(testURL);
  yield promiseErrorPageLoaded(browser);

  // Check that we loaded the right error page.
  yield checkErrorPage(browser, errorURISuffix);

  // Check that the error reporting section is hidden.
  let hidden = yield ContentTask.spawn(browser, null, function* () {
    let section = content.document.getElementById("certificateErrorReporting");
    return content.getComputedStyle(section).display == "none";
  });
  ok(hidden, "error reporting section should be hidden");

  // Cleanup.
  gBrowser.removeTab(tab);
}

function createErrorReportPromise(browser) {
  return ContentTask.spawn(browser, null, function* () {
    let type = "Browser:SSLErrorReportStatus";
    let active = false;

    yield new Promise((resolve, reject) => {
      addMessageListener(type, function onReportStatus(message) {
        switch (message.data.reportStatus) {
          case "activity":
            active = true;
            break;
          case "complete":
            removeMessageListener(type, onReportStatus);
            if (active) {
              resolve(message.data.reportStatus);
            } else {
              reject("activity should be seen before success");
            }
            break;
          case "error":
            removeMessageListener(type, onReportStatus);
            reject("sending the report failed");
            break;
        }
      });
    });
  });
}

function promiseErrorPageLoaded(browser) {
  return new Promise(resolve => {
    browser.addEventListener("DOMContentLoaded", function onLoad() {
      browser.removeEventListener("DOMContentLoaded", onLoad, false, true);
      resolve();
    }, false, true);
  });
}

function checkErrorPage(browser, suffix) {
  return ContentTask.spawn(browser, null, function* () {
    return content.document.documentURI;
  }).then(uri => {
    ok(uri.startsWith(`about:${suffix}`), "correct error page loaded");
  });
}
