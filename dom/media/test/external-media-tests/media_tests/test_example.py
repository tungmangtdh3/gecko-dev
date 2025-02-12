from harness.testcase import MediaTestCase


class TestSomethingElse(MediaTestCase):
    def setUp(self):
        MediaTestCase.setUp(self)
        self.test_urls = [
            'mozilla.html',
            ]
        self.test_urls = [self.marionette.absolute_url(t)
                          for t in self.test_urls]

    def tearDown(self):
        MediaTestCase.tearDown(self)

    def test_foo(self):
        self.logger.info('foo!')
        with self.marionette.using_context('content'):
            self.marionette.navigate(self.test_urls[0])
