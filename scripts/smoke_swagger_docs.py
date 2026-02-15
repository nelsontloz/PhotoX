#!/usr/bin/env python3
import os
import subprocess
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SERVICES_ROOT = ROOT / "services"


def check_url(url: str) -> None:
    with urllib.request.urlopen(url, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"Expected 200 from {url}, got {response.status}")


def smoke_test_node_service(folder: str, domain: str, port: int) -> None:
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["SERVICE_NAME"] = f"{folder}-smoke"

    proc = subprocess.Popen(
        ["npm", "start"],
        cwd=str(SERVICES_ROOT / folder),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        time.sleep(2)
        check_url(f"http://127.0.0.1:{port}/health")
        check_url(f"http://127.0.0.1:{port}/api/v1/{domain}/openapi.json")
        check_url(f"http://127.0.0.1:{port}/api/v1/{domain}/docs")
        print(f"{folder}: ok")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


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
