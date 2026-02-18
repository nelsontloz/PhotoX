#!/usr/bin/env python3
import os
import subprocess
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SERVICES_ROOT = ROOT / "services"


def parse_env_file(file_path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    if not file_path.exists():
        return parsed

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        parsed[key] = value

    return parsed


def load_project_env() -> dict[str, str]:
    return parse_env_file(ROOT / ".env") or parse_env_file(ROOT / ".env.example")


def check_url(url: str) -> None:
    with urllib.request.urlopen(url, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"Expected 200 from {url}, got {response.status}")


def wait_for_url(url: str, timeout_seconds: int = 30, interval_seconds: float = 0.5) -> None:
    deadline = time.time() + timeout_seconds
    last_error = None

    while time.time() < deadline:
        try:
            check_url(url)
            return
        except Exception as err:  # noqa: BLE001
            last_error = err
            time.sleep(interval_seconds)

    raise RuntimeError(f"Timed out waiting for {url}: {last_error}")


def stop_process(proc: subprocess.Popen) -> tuple[str, str]:
    if proc.poll() is None:
        proc.terminate()

    try:
        stdout, stderr = proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate(timeout=5)

    return stdout, stderr


def smoke_test_node_service(folder: str, domain: str, port: int) -> None:
    env = os.environ.copy()
    env.update(load_project_env())
    env["PORT"] = str(port)
    env["SERVICE_NAME"] = f"{folder}-smoke"

    proc = subprocess.Popen(
        ["npm", "start"],
        cwd=str(SERVICES_ROOT / folder),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        wait_for_url(f"http://127.0.0.1:{port}/health")
        wait_for_url(f"http://127.0.0.1:{port}/api/v1/{domain}/openapi.json")
        wait_for_url(f"http://127.0.0.1:{port}/api/v1/{domain}/docs")
        print(f"{folder}: ok")
    except Exception as err:  # noqa: BLE001
        stdout, stderr = stop_process(proc)
        stdout_tail = "\n".join(stdout.strip().splitlines()[-20:])
        stderr_tail = "\n".join(stderr.strip().splitlines()[-20:])
        raise RuntimeError(
            "\n".join(
                [
                    f"{folder}: smoke test failed",
                    f"cause: {err}",
                    f"stdout tail:\n{stdout_tail or '<empty>'}",
                    f"stderr tail:\n{stderr_tail or '<empty>'}",
                ]
            )
        ) from err
    finally:
        stop_process(proc)


def smoke_test_ml_config() -> None:
    ml_file = SERVICES_ROOT / "ml" / "app.py"
    source = ml_file.read_text(encoding="utf-8")
    required_fragments = [
        'docs_url="/api/v1/ml/docs"',
        'openapi_url="/api/v1/ml/openapi.json"',
    ]
    for fragment in required_fragments:
        if fragment not in source:
            raise RuntimeError(f"ml-service missing required config fragment: {fragment}")
    print("ml: config ok")


def main() -> None:
    node_services = [
        ("auth", "auth", 4201),
        ("ingest", "uploads", 4202),
        ("library", "library", 4203),
        ("album-sharing", "albums", 4204),
        ("search", "search", 4205),
        ("worker", "worker", 4206),
    ]

    for folder, domain, port in node_services:
        smoke_test_node_service(folder, domain, port)

    smoke_test_ml_config()
    print("swagger smoke checks: pass")


if __name__ == "__main__":
    main()
