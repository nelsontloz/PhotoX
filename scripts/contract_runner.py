#!/usr/bin/env python3
"""Contract compatibility runner for PhotoX services.

This runner validates API consumer/provider compatibility against live OpenAPI
documents and verifies queue payload contract keys for the ingest -> worker
boundary.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent


class ContractFailure(RuntimeError):
    """Raised when one or more contract checks fail."""


API_PROVIDER_SPECS = {
    "auth": "/api/v1/auth/openapi.json",
    "uploads": "/api/v1/uploads/openapi.json",
    "library": "/api/v1/library/openapi.json",
}


API_CONSUMER_REQUIREMENTS = [
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/auth/register",
        "request_fields": ["email", "password"],
        "response_fields": ["user", "user.id", "user.email", "user.isAdmin", "user.isActive"],
    },
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/auth/login",
        "request_headers": ["content-type"],
        "response_fields": [
            "accessToken",
            "refreshToken",
            "expiresIn",
            "user",
            "user.id",
            "user.email",
        ],
    },
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/auth/refresh",
        "request_fields": ["refreshToken"],
        "response_fields": [
            "accessToken",
            "refreshToken",
            "expiresIn",
            "user",
            "user.id",
            "user.email",
        ],
    },
    {
        "provider": "auth",
        "method": "get",
        "path": "/api/v1/me",
        "security_scheme": "bearerAuth",
        "response_fields": ["user", "user.id", "user.email", "user.isAdmin", "user.isActive"],
    },
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/auth/logout",
        "request_fields": ["refreshToken"],
        "response_fields": ["success"],
    },
    {
        "provider": "auth",
        "method": "get",
        "path": "/api/v1/admin/users",
        "security_scheme": "bearerAuth",
        "response_fields": ["items", "totalUsers", "limit", "offset"],
    },
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/admin/users",
        "security_scheme": "bearerAuth",
        "request_fields": ["email", "password"],
        "response_fields": ["user", "user.id", "user.email", "user.isAdmin", "user.isActive"],
    },
    {
        "provider": "auth",
        "method": "patch",
        "path": "/api/v1/admin/users/{userId}",
        "security_scheme": "bearerAuth",
        "response_fields": ["user", "user.id", "user.email", "user.isAdmin", "user.isActive"],
    },
    {
        "provider": "auth",
        "method": "post",
        "path": "/api/v1/admin/users/{userId}/reset-password",
        "security_scheme": "bearerAuth",
        "request_fields": ["password"],
        "response_fields": ["success"],
    },
    {
        "provider": "auth",
        "method": "delete",
        "path": "/api/v1/admin/users/{userId}",
        "security_scheme": "bearerAuth",
        "response_fields": ["success"],
    },
    {
        "provider": "uploads",
        "method": "post",
        "path": "/api/v1/uploads/init",
        "request_headers": ["idempotency-key"],
        "request_fields": ["fileName", "contentType", "fileSize", "checksumSha256"],
        "response_fields": ["uploadId", "partSize", "expiresAt"],
    },
    {
        "provider": "uploads",
        "method": "post",
        "path": "/api/v1/uploads/{uploadId}/part",
        "security_scheme": "bearerAuth",
        "response_fields": ["uploadId", "partNumber", "bytesStored", "checksumSha256"],
    },
    {
        "provider": "uploads",
        "method": "get",
        "path": "/api/v1/uploads/{uploadId}",
        "security_scheme": "bearerAuth",
        "response_fields": [
            "uploadId",
            "status",
            "fileSize",
            "partSize",
            "uploadedBytes",
            "uploadedParts",
            "expiresAt",
        ],
    },
    {
        "provider": "uploads",
        "method": "post",
        "path": "/api/v1/uploads/{uploadId}/complete",
        "request_headers": ["idempotency-key"],
        "request_fields": ["checksumSha256"],
        "response_fields": ["mediaId", "status", "deduplicated"],
    },
    {
        "provider": "uploads",
        "method": "post",
        "path": "/api/v1/uploads/{uploadId}/abort",
        "security_scheme": "bearerAuth",
        "response_fields": ["uploadId", "status"],
    },
    {
        "provider": "library",
        "method": "get",
        "path": "/api/v1/library/timeline",
        "security_scheme": "bearerAuth",
        "response_fields": ["items", "nextCursor"],
    },
    {
        "provider": "library",
        "method": "get",
        "path": "/api/v1/media/{mediaId}",
        "security_scheme": "bearerAuth",
        "response_fields": ["media", "media.id", "media.ownerId", "media.mimeType", "media.flags"],
    },
    {
        "provider": "library",
        "method": "patch",
        "path": "/api/v1/media/{mediaId}",
        "security_scheme": "bearerAuth",
        "response_fields": ["media", "media.id", "media.ownerId", "media.mimeType", "media.flags"],
    },
    {
        "provider": "library",
        "method": "get",
        "path": "/api/v1/media/{mediaId}/content",
        "security_scheme": "bearerAuth",
    },
    {
        "provider": "library",
        "method": "delete",
        "path": "/api/v1/media/{mediaId}",
        "security_scheme": "bearerAuth",
        "response_fields": ["mediaId", "status"],
    },
    {
        "provider": "library",
        "method": "post",
        "path": "/api/v1/media/{mediaId}/restore",
        "security_scheme": "bearerAuth",
        "response_fields": ["mediaId", "status"],
    },
]


QUEUE_CONTRACT_REQUIRED_KEYS = [
    "mediaId",
    "ownerId",
    "relativePath",
    "checksumSha256",
    "uploadedAt",
]


def has_ingest_idempotency_support_in_source() -> bool:
    ingest_route_file = ROOT / "services" / "ingest" / "src" / "routes" / "uploadsRoutes.js"
    source = ingest_route_file.read_text(encoding="utf-8")
    return source.count("readIdempotencyKey(request.headers)") >= 2


def fetch_json(url: str, timeout: int) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        if response.status != 200:
            raise ContractFailure(f"Expected HTTP 200 from {url}, got {response.status}")
        return json.loads(response.read().decode("utf-8"))


def run_command(command: list[str]) -> None:
    subprocess.run(command, cwd=str(ROOT), check=True)


def run_compose_lifecycle(args: argparse.Namespace) -> None:
    compose_base = [
        "docker",
        "compose",
        "--env-file",
        args.env_file,
        "--profile",
        args.compose_profile,
    ]

    if args.stack_mode == "rebuild":
        print("[stack] lifecycle mode: rebuild")
        print("[stack] stopping running containers")
        run_command([*compose_base, "down"])

        print("[stack] rebuilding images in parallel")
        run_command([*compose_base, "build", "--parallel"])

        print("[stack] starting stack")
        run_command([*compose_base, "up", "-d", "--no-build"])
        return

    if args.stack_mode == "restart":
        print("[stack] lifecycle mode: restart")
        print("[stack] stopping running containers")
        run_command([*compose_base, "down"])

        print("[stack] starting stack")
        run_command([*compose_base, "up", "-d"])
        return

    print("[stack] lifecycle mode: reuse")
    print("[stack] reusing existing stack (no compose down/build/up)")


def wait_for_openapi(base_url: str, timeout: int, wait_timeout: int) -> None:
    deadline = time.time() + wait_timeout
    pending_urls = [f"{base_url.rstrip('/')}{path}" for path in API_PROVIDER_SPECS.values()]
    remaining = set(pending_urls)

    print("[stack] waiting for OpenAPI endpoints")
    while remaining and time.time() < deadline:
        for url in list(remaining):
            try:
                fetch_json(url, timeout)
                remaining.remove(url)
            except Exception:
                pass

        if remaining:
            time.sleep(1)

    if remaining:
        missing = "\n - ".join(sorted(remaining))
        raise ContractFailure(f"stack did not become ready before timeout; missing:\n - {missing}")

    print("[stack] OpenAPI endpoints are ready")


def normalize_path(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


def find_openapi_operation(paths: dict[str, Any], path: str, method: str) -> dict[str, Any] | None:
    if path in paths and method in paths[path]:
        return paths[path][method]

    normalized_target = normalize_path(path)
    for candidate_path, operations in paths.items():
        if normalize_path(candidate_path) == normalized_target and method in operations:
            return operations[method]

    return None


def flatten_schema_props(schema: dict[str, Any], prefix: str = "") -> set[str]:
    properties = schema.get("properties") or {}
    found: set[str] = set()
    for key, value in properties.items():
        dotted = f"{prefix}.{key}" if prefix else key
        found.add(dotted)
        if isinstance(value, dict):
            found.update(flatten_schema_props(value, dotted))
    return found


def first_json_schema(content: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None
    json_content = content.get("application/json")
    if not isinstance(json_content, dict):
        return None
    schema = json_content.get("schema")
    return schema if isinstance(schema, dict) else None


def assert_request_headers(requirement: dict[str, Any], operation: dict[str, Any]) -> list[str]:
    errors = []
    wanted = {header.lower() for header in requirement.get("request_headers", [])}
    if not wanted:
        return errors

    available: set[str] = set()
    for parameter in operation.get("parameters", []):
        if parameter.get("in") == "header" and isinstance(parameter.get("name"), str):
            available.add(parameter["name"].lower())

    for header in sorted(wanted):
        if header == "content-type":
            if "requestBody" not in operation:
                errors.append("missing requestBody for Content-Type contract")
            continue

        if header == "idempotency-key" and has_ingest_idempotency_support_in_source():
            continue

        if header not in available:
            errors.append(f"missing required request header parameter '{header}'")
    return errors


def assert_request_fields(requirement: dict[str, Any], operation: dict[str, Any]) -> list[str]:
    errors = []
    wanted = requirement.get("request_fields", [])
    if not wanted:
        return errors

    request_body = operation.get("requestBody")
    if not isinstance(request_body, dict):
        return ["missing requestBody"]

    schema = first_json_schema(request_body.get("content", {}))
    if not isinstance(schema, dict):
        return ["missing application/json request schema"]

    available = flatten_schema_props(schema)
    for field in wanted:
        if field not in available:
            errors.append(f"missing request field '{field}'")
    return errors


def assert_response_fields(requirement: dict[str, Any], operation: dict[str, Any]) -> list[str]:
    errors = []
    wanted = requirement.get("response_fields", [])
    if not wanted:
        return errors

    responses = operation.get("responses", {})
    for preferred_code in ("200", "201"):
        response = responses.get(preferred_code)
        if not isinstance(response, dict):
            continue
        schema = first_json_schema(response.get("content", {}))
        if not isinstance(schema, dict):
            continue
        available = flatten_schema_props(schema)
        for field in wanted:
            if field not in available:
                errors.append(f"missing response field '{field}' in {preferred_code} schema")
        return errors

    return ["missing JSON response schema for 200/201"]


def assert_security(requirement: dict[str, Any], operation: dict[str, Any]) -> list[str]:
    wanted = requirement.get("security_scheme")
    if not wanted:
        return []

    security_list = operation.get("security")
    if not isinstance(security_list, list):
        return [f"missing security requirement '{wanted}'"]

    for item in security_list:
        if isinstance(item, dict) and wanted in item:
            return []
    return [f"missing security requirement '{wanted}'"]


def assert_error_envelope(operation: dict[str, Any]) -> list[str]:
    errors = []
    responses = operation.get("responses", {})
    for code, response in responses.items():
        if not str(code).startswith(("4", "5")):
            continue
        if not isinstance(response, dict):
            continue
        schema = first_json_schema(response.get("content", {}))
        if not isinstance(schema, dict):
            continue

        fields = flatten_schema_props(schema)
        required = {"error", "error.code", "error.message", "error.details", "requestId"}
        for field in sorted(required):
            if field not in fields:
                errors.append(f"error response {code} missing '{field}'")
    return errors


def run_api_contract_checks(base_url: str, timeout: int) -> None:
    print("[api] loading provider OpenAPI specs")
    specs: dict[str, dict[str, Any]] = {}
    for provider, spec_path in API_PROVIDER_SPECS.items():
        url = f"{base_url.rstrip('/')}{spec_path}"
        try:
            specs[provider] = fetch_json(url, timeout)
            print(f"[api] {provider}: loaded {url}")
        except urllib.error.URLError as exc:
            raise ContractFailure(f"failed to load {url}: {exc}") from exc

    violations: list[str] = []
    passed_contracts = 0
    total_contracts = 0

    def report_check(name: str, errors: list[str] | None) -> list[str]:
        if errors is None:
            print(f"  - {name}: SKIP")
            return []
        if not errors:
            print(f"  - {name}: PASS")
            return []
        print(f"  - {name}: FAIL")
        for err in errors:
            print(f"    * {err}")
        return errors

    for req in API_CONSUMER_REQUIREMENTS:
        provider = req["provider"]
        method = req["method"]
        path = req["path"]
        total_contracts += 1
        contract_label = f"[api][{provider}] {method.upper()} {path}"
        spec_paths = specs.get(provider, {}).get("paths", {})
        operation = find_openapi_operation(spec_paths, path, method)
        if operation is None:
            print(f"{contract_label} :: FAIL")
            print("  - operation exists: FAIL")
            print("    * missing operation")
            violations.append(f"{provider} {method.upper()} {path}: missing operation")
            continue

        print(f"{contract_label} :: checking")

        errors: list[str] = []
        errors.extend(report_check("operation exists", []))

        header_errors = assert_request_headers(req, operation) if req.get("request_headers") else None
        errors.extend(report_check("request headers", header_errors))

        request_field_errors = assert_request_fields(req, operation) if req.get("request_fields") else None
        errors.extend(report_check("request fields", request_field_errors))

        response_field_errors = assert_response_fields(req, operation) if req.get("response_fields") else None
        errors.extend(report_check("response fields", response_field_errors))

        security_errors = assert_security(req, operation) if req.get("security_scheme") else None
        errors.extend(report_check("security", security_errors))

        error_envelope_errors = assert_error_envelope(operation)
        errors.extend(report_check("error envelope", error_envelope_errors))

        if errors:
            print(f"{contract_label} :: FAIL")
            for err in errors:
                violations.append(f"{provider} {method.upper()} {path}: {err}")
            continue

        passed_contracts += 1
        print(f"{contract_label} :: PASS")

    if violations:
        print(f"[api] {passed_contracts}/{total_contracts} contracts passed")
        joined = "\n - ".join(violations)
        raise ContractFailure(f"API contract violations detected:\n - {joined}")

    print(f"[api] {passed_contracts}/{total_contracts} contracts passed")
    print("[api] all consumer/provider checks passed")


def run_queue_contract_checks() -> None:
    print("[queue] validating ingest -> worker media.process payload contract")
    ingest_route_file = ROOT / "services" / "ingest" / "src" / "routes" / "uploadsRoutes.js"
    contracts_doc = ROOT / "docs" / "02-api-contracts.md"

    source = ingest_route_file.read_text(encoding="utf-8")
    doc_text = contracts_doc.read_text(encoding="utf-8")

    violations: list[str] = []
    total_checks = 0
    passed_checks = 0

    def report_queue_check(label: str, ok: bool, detail: str) -> None:
        nonlocal total_checks, passed_checks
        total_checks += 1
        if ok:
            passed_checks += 1
            print(f"[queue] {label}: PASS")
            return
        print(f"[queue] {label}: FAIL")
        print(f"  * {detail}")
        violations.append(detail)

    has_media_process = '"media.process"' in source
    report_queue_check(
        label="media.process enqueue present",
        ok=has_media_process,
        detail="ingest route does not enqueue media.process",
    )

    queue_payload_block = re.search(r"queuePayload\s*=\s*\{(?P<body>.*?)\n\s*\};", source, flags=re.DOTALL)
    has_payload_block = queue_payload_block is not None
    report_queue_check(
        label="queuePayload object present",
        ok=has_payload_block,
        detail="could not locate queuePayload object in uploadsRoutes.js",
    )

    payload_body = queue_payload_block.group("body") if queue_payload_block else ""
    for key in QUEUE_CONTRACT_REQUIRED_KEYS:
        payload_has_key = bool(re.search(rf"\b{re.escape(key)}\b\s*:", payload_body))
        report_queue_check(
            label=f"payload key '{key}'",
            ok=payload_has_key,
            detail=f"queue payload missing key '{key}' in uploadsRoutes.js",
        )

    for key in QUEUE_CONTRACT_REQUIRED_KEYS:
        doc_has_key = f'"{key}"' in doc_text
        report_queue_check(
            label=f"docs key '{key}'",
            ok=doc_has_key,
            detail=f"docs/02-api-contracts.md missing key '{key}' in media.process contract",
        )

    if violations:
        print(f"[queue] {passed_checks}/{total_checks} checks passed")
        joined = "\n - ".join(violations)
        raise ContractFailure(f"Queue contract violations detected:\n - {joined}")

    print(f"[queue] {passed_checks}/{total_checks} checks passed")
    print("[queue] queue payload contract checks passed")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PhotoX API/queue contract compatibility checks")
    parser.add_argument(
        "--mode",
        choices=["all", "api", "queue"],
        default="all",
        help="which contract checks to run",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost",
        help="base URL for provider OpenAPI endpoints",
    )
    parser.add_argument("--timeout", type=int, default=10, help="HTTP timeout seconds for OpenAPI fetches")
    parser.add_argument("--wait-timeout", type=int, default=180, help="Stack readiness timeout in seconds")
    parser.add_argument("--env-file", default=".env", help="Compose env file path")
    parser.add_argument("--compose-profile", default="app", help="Compose profile used to start services")
    parser.add_argument(
        "--stack-mode",
        choices=["rebuild", "restart", "reuse"],
        default="rebuild",
        help="stack lifecycle mode before running contract checks",
    )
    parser.add_argument(
        "--skip-stack",
        action="store_true",
        help="Deprecated alias for --stack-mode reuse",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        if args.skip_stack:
            args.stack_mode = "reuse"

        run_compose_lifecycle(args)

        if args.mode in ("all", "api"):
            wait_for_openapi(base_url=args.base_url, timeout=args.timeout, wait_timeout=args.wait_timeout)

        if args.mode in ("all", "api"):
            run_api_contract_checks(base_url=args.base_url, timeout=args.timeout)
        if args.mode in ("all", "queue"):
            run_queue_contract_checks()
    except ContractFailure as exc:
        print(f"contract runner: FAIL\n{exc}")
        return 1
    except Exception as exc:  # pragma: no cover
        print(f"contract runner: ERROR\n{exc}")
        return 2

    print("contract runner: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
