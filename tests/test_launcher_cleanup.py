import os
import select
import signal
import subprocess
import sys

import pytest


SUPERVISOR = """
import signal
import sys
from aurora.run import Processes, handle_shutdown

for sig in (signal.SIGTERM, signal.SIGHUP):
    signal.signal(sig, handle_shutdown)
processes = Processes()
try:
    child = processes.start([sys.executable, '-c',
        'import time; print("ready", flush=True); time.sleep(60)'], pipe=True)
    child.stdout.readline()
    print(child.pid, flush=True)
    signal.pause()
except KeyboardInterrupt:
    pass
finally:
    processes.close()
"""


@pytest.mark.parametrize("stop_signal", [signal.SIGINT, signal.SIGTERM, signal.SIGHUP])
def test_launcher_stops_owned_services_on_exit_signals(stop_signal):
    supervisor = subprocess.Popen([sys.executable, "-c", SUPERVISOR], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
    child_pid = None
    try:
        assert select.select([supervisor.stdout], [], [], 10)[0], "Supervisor failed to start"
        child_pid = int(supervisor.stdout.readline())
        supervisor.send_signal(stop_signal)
        _, error = supervisor.communicate(timeout=10)
        assert supervisor.returncode == 0, error
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)
    finally:
        if supervisor.poll() is None:
            supervisor.kill()
            supervisor.wait()
        if child_pid:
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
