import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from aurora.config import Settings


ROOT = Path(__file__).resolve().parent.parent


def json_records(output: str) -> list[dict]:
    records = []
    for line in output.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def check_port(port: int) -> None:
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeError(f"Port {port} is already in use. Stop the existing service first.") from None


def wait_http(process, url: str, timeout: float, expected_status: int = 200) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("A service exited during startup. Check its log under .local/logs/.")
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == expected_status:
                    return
        except HTTPError as error:
            if error.code == expected_status:
                return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Startup timed out for {url}. Check .local/logs/.")


class Processes:
    def __init__(self):
        self.children: list[subprocess.Popen] = []
        self.logs = []

    def start(self, command: list[str], log_name: str | None = None, pipe: bool = False):
        output = subprocess.PIPE if pipe else None
        if log_name:
            path = ROOT / ".local" / "logs" / log_name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch(mode=0o600, exist_ok=True)
            output = path.open("w")
            self.logs.append(output)
        child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT if output else None,
                                 start_new_session=True, text=True)
        self.children.append(child)
        return child

    def close(self) -> None:
        for child in reversed(self.children):
            if child.poll() is not None:
                continue
            try:
                os.killpg(child.pid, signal.SIGINT)
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            except ProcessLookupError:
                pass
        for output in self.logs:
            output.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Start Aurora, local ASL, and the managed Chert connector")
    parser.add_argument("--check", action="store_true", help="Validate local settings without starting services")
    args = parser.parse_args()
    os.chdir(ROOT)
    settings = Settings.load()
    if args.check:
        print("Required settings are present. Provider access has not been tested.")
        return 0
    processes = Processes()
    try:
        chert = [str(ROOT / "scripts" / "chert")]
        status = subprocess.run(chert + ["whoami", "--json"], capture_output=True, text=True, check=False)
        if status.returncode not in (0, 3):
            raise RuntimeError("Chert sign-in check failed. Run ./scripts/chert whoami for details.")
        signed_in = any(record.get("signed_in") is True for record in json_records(status.stdout))
        if not signed_in:
            print("Complete Chert's browser verification and hosted demo call, then this launcher continues.", flush=True)
            onboard = processes.start(chert + ["onboard", "--json", "--no-browser", "--plan", "trial", "--stack", "demo"], pipe=True)
            demo_ended = False
            for line in onboard.stdout:
                print(line, end="", flush=True)
                for record in json_records(line):
                    if record.get("code") == "onboarding_done" and record.get("demo_outcome") == "ended":
                        demo_ended = True
            if onboard.wait() != 0 or not demo_ended:
                raise RuntimeError("Chert onboarding did not finish. Run this command again to resume.")
        subprocess.run(chert + ["doctor", "--env-file", ".env.local"], check=True)
        local_asl = settings.asl_endpoint in ("http://127.0.0.1:8090/translate", "http://localhost:8090/translate")
        if local_asl:
            check_port(8090)
            print("Starting local ASL; the first model load can take a few minutes.", flush=True)
            os.environ.setdefault("HF_HOME", str(ROOT / ".local" / "huggingface"))
            os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".local" / "matplotlib"))
            asl = processes.start([sys.executable, "-m", "aurora.letters_server"], "asl.log")
            wait_http(asl, "http://127.0.0.1:8090/translate", 300, expected_status=405)
        check_port(8081)
        print("Registering Aurora with LiveKit…", flush=True)
        agent = processes.start([sys.executable, "-m", "aurora.agent", "start"], "agent.log")
        wait_http(agent, "http://127.0.0.1:8081/", 60)
        print("Connecting Chert. When it reports ready, FaceTime Video the assigned line from your verified iPhone.", flush=True)
        print("Keep this terminal open. Ctrl+C stops everything. Logs: .local/logs/", flush=True)
        connector = processes.start(chert + ["dev", "--env-file", ".env.local", "--agent", settings.agent_name])
        while connector.poll() is None:
            if agent.poll() is not None or (local_asl and asl.poll() is not None):
                raise RuntimeError("An Aurora service stopped. Check .local/logs/.")
            time.sleep(0.5)
        return connector.returncode
    finally:
        processes.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nStopped Aurora and its connector.")
        raise SystemExit(130)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
