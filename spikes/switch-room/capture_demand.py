"""Start one half-stream worker on demand and join it before allowing another."""

import threading


class OnDemand:
    def __init__(self, work):
        self.work = work
        self.thread = None
        self.stop = None
        self.failure = None

    def _run(self):
        try:
            self.work(self.stop)
            if not self.stop.is_set():
                self.failure = RuntimeError("half capture ended while still requested")
        except Exception as error:
            self.failure = error

    def update(self, wanted):
        if self.failure is not None:
            raise RuntimeError("half capture failed") from self.failure
        if wanted and self.thread is None:
            self.stop = threading.Event()
            self.thread = threading.Thread(target=self._run)
            self.thread.start()
        elif not wanted:
            self.close()

    def close(self):
        if self.thread is not None:
            self.stop.set()
            # The recorder gets five seconds to exit; leave three extra seconds
            # for its pipe reader and the two-second bridge timeout. A timeout
            # is a failure, never a second worker.
            self.thread.join(timeout=8)
            if self.thread.is_alive():
                raise RuntimeError("half capture did not stop")
            self.thread = None
        if self.failure is not None:
            raise RuntimeError("half capture failed") from self.failure
