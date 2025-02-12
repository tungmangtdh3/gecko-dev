# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from time import clock, sleep

from marionette_driver import By, expected, Wait

from media_tests.utils import verbose_until


# Adapted from
# https://github.com/gavinsharp/aboutmedia/blob/master/chrome/content/aboutmedia.xhtml
debug_script = """
var mainWindow = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
    .getInterface(Components.interfaces.nsIWebNavigation)
    .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
    .rootTreeItem
    .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
    .getInterface(Components.interfaces.nsIDOMWindow);
var tabbrowser = mainWindow.gBrowser;
for (var i=0; i < tabbrowser.browsers.length; ++i) {
  var b = tabbrowser.getBrowserAtIndex(i);
  var media = b.contentDocumentAsCPOW.getElementsByTagName('video');
  for (var j=0; j < media.length; ++j) {
     var ms = media[j].mozMediaSourceObject;
     if (ms) {
       debugLines = ms.mozDebugReaderData.split(\"\\n\");
       return debugLines;
     }
  }
}"""


class VideoPuppeteer(object):
    """
    Wrapper to control and introspect HTML5 video elements.

    A note about properties like current_time and duration:
    These describe whatever stream is playing when the property is called.
    It is possible that many different streams are dynamically spliced
    together, so the video stream that is currently playing might be the main
    video or it might be something else, like an ad, for example.

    Inputs:
        marionette - The marionette instance this runs in.
        url - the URL of the page containing the video element.
        video_selector - the selector of the element that we want to
            watch. This is set by default to 'video', which is what most
            sites use, but others should work.
        interval - The polling interval that is used to check progress.
        set_duration - When set to >0, the polling and checking will stop
            at the number of seconds specified. Otherwise, this will stop
            at the end of the video.
        stall_wait_time - The amount of time to wait to see if a stall has
            cleared. If 0, do not check for stalls.
        timeout - The amount of time to wait until the video starts.
    """
    def __init__(self, marionette, url, video_selector='video', interval=1,
                 set_duration=0, stall_wait_time=0, timeout=60):
        self.marionette = marionette
        self.test_url = url
        self.interval = interval
        self.stall_wait_time = stall_wait_time
        self.timeout = timeout
        self._set_duration = set_duration
        self.video = None
        self.expected_duration = 0
        self._start_time = 0
        self._start_wall_time = 0
        wait = Wait(self.marionette, timeout=self.timeout)
        with self.marionette.using_context('content'):
            self.marionette.navigate(self.test_url)
            self.marionette.execute_script("""
                log('URL: {0}');""".format(self.test_url))
            verbose_until(wait, self,
                          expected.element_present(By.TAG_NAME, 'video'))
            videos_found = self.marionette.find_elements(By.CSS_SELECTOR,
                                                         video_selector)
            if len(videos_found) > 1:
                self.marionette.log(type(self).__name__ + ': multiple video '
                                                          'elements found. '
                                                          'Using first.')
            if len(videos_found) <= 0:
                self.marionette.log(type(self).__name__ + ': no video '
                                                          'elements found.')
                return
            self.video = videos_found[0]
            self.marionette.execute_script("log('video element obtained');")
            # To get an accurate expected_duration, playback must have started
            wait = Wait(self, timeout=self.timeout)
            verbose_until(wait, self, lambda v: v.current_time > 0,
                          "Check if video current_time > 0")
            self._start_time = self.current_time
            self._start_wall_time = clock()
            self.update_expected_duration()

    def update_expected_duration(self):
        """
        Update the duration of the target video at self.test_url (in seconds).

        expected_duration represents the following: how long do we expect
        playback to last before we consider the video to be 'complete'?
        If we only want to play the first n seconds of the video,
        expected_duration is set to n.
        """
        # self.duration is the duration of whatever is playing right now.
        # In this case, we assume the video element always shows the same
        # stream throughout playback (i.e. the are no ads spliced into the main
        # video, for example), so self.duration is the duration of the main
        # video.
        video_duration = self.duration
        set_duration = self._set_duration
        # In case video starts at t > 0, adjust target time partial playback
        if self._set_duration and self._start_time:
            set_duration += self._start_time
        if 0 < set_duration < video_duration:
            self.expected_duration = set_duration
        else:
            self.expected_duration = video_duration

    def get_debug_lines(self):
        with self.marionette.using_context('chrome'):
            debug_lines = self.marionette.execute_script(debug_script)
        return debug_lines

    def play(self):
        self.execute_video_script('arguments[0].wrappedJSObject.play();')

    def pause(self):
        self.execute_video_script('arguments[0].wrappedJSObject.pause();')

    @property
    def duration(self):
        """
        Return duration in seconds of whatever stream is playing right now.
        """
        return self.execute_video_script('return arguments[0].'
                                         'wrappedJSObject.duration;') or 0

    @property
    def current_time(self):
        """
        Return current time of whatever stream is playing right now.
        """
        return self.execute_video_script(
            'return arguments[0].wrappedJSObject.currentTime;') or 0

    @property
    def remaining_time(self):
        # Note that self.current_time could temporarily refer to a
        # spliced-in ad
        return self.expected_duration - self.current_time

    @property
    def video_src(self):
        with self.marionette.using_context('content'):
            return self.video.get_attribute('src')

    @property
    def total_frames(self):
        return self.execute_video_script("""
            return arguments[0].getVideoPlaybackQuality()["totalVideoFrames"];
            """)

    @property
    def dropped_frames(self):
        return self.execute_video_script("""return
            arguments[0].getVideoPlaybackQuality()["droppedVideoFrames"];
            """) or 0

    @property
    def corrupted_frames(self):
        return self.execute_video_script("""return
            arguments[0].getVideoPlaybackQuality()["corruptedVideoFrames"];
            """) or 0

    @property
    def video_url(self):
        return self.execute_video_script('return arguments[0].baseURI;')

    @property
    def lag(self):
        # Note that self.current_time could temporarily refer to a
        # spliced-in ad
        elapsed_current_time = self.current_time - self._start_time
        elapsed_wall_time = clock() - self._start_wall_time
        return elapsed_wall_time - elapsed_current_time

    def measure_progress(self):
        initial = self.current_time
        sleep(1)
        return self.current_time - initial

    def execute_video_script(self, script):
        """ Execute JS script in 'content' context with access to video element.
        :param script: script to be executed
        `arguments[0]` in script refers to video element.
        :return: value returned by script
        """
        with self.marionette.using_context('content'):
            return self.marionette.execute_script(script,
                                                  script_args=[self.video])

    def __str__(self):
        messages = ['%s - test url: %s: {' % (type(self).__name__,
                                              self.test_url)]
        if self.video:
            messages += [
                '\t(video)',
                '\tcurrent_time: {0},'.format(self.current_time),
                '\tduration: {0},'.format(self.duration),
                '\texpected_duration: {0},'.format(self.expected_duration),
                '\tlag: {0},'.format(self.lag),
                '\turl: {0}'.format(self.video_url),
                '\tsrc: {0}'.format(self.video_src),
                '\tframes total: {0}'.format(self.total_frames),
                '\t - dropped: {0}'.format(self.dropped_frames),
                '\t - corrupted: {0}'.format(self.corrupted_frames)
            ]
        else:
            messages += ['\tvideo: None']
        messages.append('}')
        return '\n'.join(messages)


class VideoException(Exception):
    pass


def playback_started(video):
    try:
        return video.current_time > video._start_time
    except Exception as e:
        print ('Got exception %s' % e)
        return False


def playback_done(video):
    # If we are near the end and there is still a video element, then
    # we are essentially done. If this happens to be last time we are polled
    # before the video ends, we won't get another chance.
    remaining_time = video.remaining_time
    if abs(remaining_time) < video.interval:
        return True

    # Check to see if the video has stalled. Accumulate the amount of lag
    # since the video started, and if it is too high, then raise.
    if video.stall_wait_time and (video.lag > video.stall_wait_time):
        raise VideoException('Video %s stalled.\n%s' % (video.video_url,
                                                        video))

    # We are cruising, so we are not done.
    return False
