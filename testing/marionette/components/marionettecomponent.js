/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {Constructor: CC, interfaces: Ci, utils: Cu} = Components;

const MARIONETTE_CONTRACTID = "@mozilla.org/marionette;1";
const MARIONETTE_CID = Components.ID("{786a1369-dca5-4adc-8486-33d23c88010a}");

const DEFAULT_PORT = 2828;
const ENABLED_PREF = "marionette.defaultPrefs.enabled";
const PORT_PREF = "marionette.defaultPrefs.port";
const FORCELOCAL_PREF = "marionette.force-local";
const LOG_PREF = "marionette.logging";

const ServerSocket = CC("@mozilla.org/network/server-socket;1",
    "nsIServerSocket",
    "initSpecialConnection");

Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Log.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function MarionetteComponent() {
  this.loaded_ = false;
  this.observerService = Services.obs;
  this.logger = this.setupLogger_(this.determineLoggingLevel_());
}

MarionetteComponent.prototype = {
  classDescription: "Marionette component",
  classID: MARIONETTE_CID,
  contractID: MARIONETTE_CONTRACTID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler, Ci.nsIObserver]),
  _xpcom_categories: [
    {category: "command-line-handler", entry: "b-marionette"},
    {category: "profile-after-change", service: true}
  ],
  enabled: false,
  finalUiStartup: false,
  server: null,
};

MarionetteComponent.prototype.setupLogger_ = function(level) {
  let log = Log.repository.getLogger("Marionette");
  log.level = level;
  log.addAppender(new Log.DumpAppender());
  return log;
};

MarionetteComponent.prototype.determineLoggingLevel_ = function() {
  let level = Log.Level.Info;
#ifdef DEBUG
  level = Log.Level.Trace;
#endif

  // marionette.logging pref can override default
  // with an entry from the Log.Level enum
  if (Preferences.has(LOG_PREF)) {
    let p = Preferences.get(LOG_PREF);

    switch (typeof p) {
      // Gecko >= 46
      case "string":
        let s = p.toLowerCase();
        s = s.charAt(0).toUpperCase() + s.slice(1);
        level = Log.Level[s];
        break;

      // Gecko <= 45
      case "boolean":
        if (p) {
          level = Log.Level.Trace;
        }
        break;
    }
  }

  return level;
};

MarionetteComponent.prototype.onSocketAccepted = function(
    socket, transport) {
  this.logger.info("onSocketAccepted for Marionette dummy socket");
};

MarionetteComponent.prototype.onStopListening = function(socket, status) {
  this.logger.info(`onStopListening for Marionette dummy socket, code ${status}`);
  socket.close();
};

/** Check cmdLine argument for {@code --marionette}. */
MarionetteComponent.prototype.handle = function(cmdLine) {
  // if the CLI is there then lets do work otherwise nothing to see
  if (cmdLine.handleFlag("marionette", false)) {
    this.enabled = true;
    this.logger.debug("Marionette enabled via command-line flag");
    this.init();
  }
};

MarionetteComponent.prototype.observe = function(subj, topic, data) {
  switch (topic) {
    case "profile-after-change":
      // Using final-ui-startup as the xpcom category doesn't seem to work,
      // so we wait for that by adding an observer here.
      this.observerService.addObserver(this, "final-ui-startup", false);
#ifdef ENABLE_MARIONETTE
      try {
        this.enabled = Services.prefs.getBoolPref(ENABLED_PREF);
      } catch(e) {}
      if (this.enabled) {
        this.logger.debug("Marionette enabled via build flag and pref");

        // We want to suppress the modal dialog that's shown
        // when starting up in safe-mode to enable testing.
        if (Services.appinfo.inSafeMode) {
          this.observerService.addObserver(this, "domwindowopened", false);
        }
      }
#endif
      break;

    case "final-ui-startup":
      this.finalUiStartup = true;
      this.observerService.removeObserver(this, topic);
      this.observerService.addObserver(this, "xpcom-shutdown", false);
      this.init();
      break;

    case "domwindowopened":
      this.observerService.removeObserver(this, topic);
      this.suppressSafeModeDialog_(subj);
      break;

    case "xpcom-shutdown":
      this.observerService.removeObserver(this, "xpcom-shutdown");
      this.uninit();
      break;
  }
};

MarionetteComponent.prototype.suppressSafeModeDialog_ = function(win) {
  // Wait for the modal dialog to finish loading.
  win.addEventListener("load", function onload() {
    win.removeEventListener("load", onload);

    if (win.document.getElementById("safeModeDialog")) {
      // Accept the dialog to start in safe-mode
      win.setTimeout(() => {
        win.document.documentElement.getButton("accept").click();
      });
    }
  });
};

MarionetteComponent.prototype.init = function() {
  if (this.loaded_ || !this.enabled || !this.finalUiStartup) {
    return;
  }

  this.loaded_ = true;

  let forceLocal = Services.appinfo.name == "B2G" ? false : true;
  try {
    forceLocal = Services.prefs.getBoolPref(FORCELOCAL_PREF);
  } catch (e) {}
  Services.prefs.setBoolPref(FORCELOCAL_PREF, forceLocal);

  if (!forceLocal) {
    // See bug 800138.  Because the first socket that opens with
    // force-local=false fails, we open a dummy socket that will fail.
    // keepWhenOffline=true so that it still work when offline (local).
    // This allows the following attempt by Marionette to open a socket
    // to succeed.
    let insaneSacrificialGoat =
        new ServerSocket(666, Ci.nsIServerSocket.KeepWhenOffline, 4);
    insaneSacrificialGoat.asyncListen(this);
  }

  let port = DEFAULT_PORT;
  try {
    port = Services.prefs.getIntPref(PORT_PREF);
  } catch (e) {}

  let s;
  try {
    Cu.import("chrome://marionette/content/server.js");
    s = new MarionetteServer(port, forceLocal);
    s.start();
    this.logger.info(`Listening on port ${s.port}`);
  } catch (e) {
    this.logger.error(`Error on starting server: ${e}`);
    dump(e.toString() + "\n" + e.stack + "\n");
  } finally {
    if (s) {
      this.server = s;
    }
  }
};

MarionetteComponent.prototype.uninit = function() {
  if (!this.loaded_) {
    return;
  }
  this.server.stop();
  this.loaded_ = false;
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([MarionetteComponent]);
