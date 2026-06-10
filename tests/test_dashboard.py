"""
Stress test suite for cc-manage dashboard.
Tests all API endpoints, concurrent access, data integrity, and security.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib import error, request


HOST = '127.0.0.1'
NODE_EXE = os.environ.get('NODE_EXE', 'node')
DASHBOARD_DIR = Path(__file__).resolve().parent.parent / 'src' / 'cc-manage' / 'dashboard'
SERVER_JS = DASHBOARD_DIR / 'server.js'


class TestFailure(AssertionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TestFailure(message)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((HOST, port)) == 0


def http_request(
    method: str,
    url: str,
    body: Optional[dict] = None,
    timeout: float = 10.0,
) -> Tuple[int, str]:
    headers = {'Content-Type': 'application/json'}
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return int(response.status), response.read().decode('utf-8', errors='replace')
    except error.HTTPError as exc:
        return int(exc.code), exc.read().decode('utf-8', errors='replace')
    except Exception as exc:
        return 0, str(exc)


def start_dashboard(port: int, data_root: str) -> subprocess.Popen:
    env = os.environ.copy()
    env['DASHBOARD_PORT'] = str(port)
    env['CLAUDE_PROFILES_ROOT'] = data_root
    process = subprocess.Popen(
        [NODE_EXE, str(SERVER_JS)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    # Wait for server to start
    for _ in range(50):
        if port_is_open(port):
            return process
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ''
            raise TestFailure(f'Dashboard exited early: {output.strip()}')
        time.sleep(0.1)
    process.terminate()
    raise TestFailure(f'Dashboard did not start on port {port}')


def stop_process(process: subprocess.Popen) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def setup_test_env(tmp_dir: str) -> None:
    """Create minimal test environment files."""
    profiles_dir = os.path.join(tmp_dir, 'profiles')
    os.makedirs(profiles_dir, exist_ok=True)

    # Create a test profile
    profile_content = '''$script:PROFILE_VERSION = 2
$script:PROFILE_NAME = "Test Profile"
$script:PROVIDER = "groq"
$script:MODE = "openai-chat-proxy"
$script:BASE_URL = "http://127.0.0.1:18100"
$script:AUTH_MODE = "api_key"
$script:API_KEY_ID = "CCKEY_GROQ_TEST_ABCD1234"
$script:API_KEY_NAME = "CCKEY_GROQ_TEST_ABCD1234"
$script:DEFAULT_MODEL = "llama-3.3-70b-versatile"
$script:MODELS = @(
    "llama-3.3-70b-versatile",
    "qwen/qwen3-32b"
)
'''
    with open(os.path.join(profiles_dir, 'test-profile.ps1'), 'w') as f:
        f.write(profile_content)

    # Create .env
    with open(os.path.join(tmp_dir, '.env'), 'w') as f:
        f.write('CCKEY_GROQ_TEST_ABCD1234="gsk_test_key_1234567890abcdef"\n')

    # Create .key-map.json
    key_map = [{
        'Profile': 'test-profile',
        'Provider': 'groq',
        'KeyId': 'CCKEY_GROQ_TEST_ABCD1234',
        'SourceKeyName': 'GROQ_API_KEY',
        'Label': 'Test Profile',
        'UpdatedAt': '2026-06-10T12:00:00'
    }]
    with open(os.path.join(tmp_dir, '.key-map.json'), 'w') as f:
        json.dump(key_map, f)


# ── Test Functions ────────────────────────────────────────────────────────────

def test_server_starts() -> None:
    """Test that the dashboard server starts and responds."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/')
            require(status == 200, f'Root returned {status}')
            require('cc-manager' in body.lower() or 'dashboard' in body.lower(), 'Root page missing dashboard content')

            status, body = http_request('GET', f'http://{HOST}:{port}/css/style.css')
            require(status == 200, f'CSS returned {status}')

            status, body = http_request('GET', f'http://{HOST}:{port}/js/app.js')
            require(status == 200, f'JS returned {status}')
        finally:
            stop_process(process)


def test_api_overview() -> None:
    """Test the /api/overview endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/api/overview')
            require(status == 200, f'Overview returned {status}: {body[:200]}')
            data = json.loads(body)
            require('activeProfile' in data, 'Missing activeProfile')
            require('profileCount' in data, 'Missing profileCount')
            require('proxyStatus' in data, 'Missing proxyStatus')
            require(data['profileCount'] >= 1, f'Expected at least 1 profile, got {data["profileCount"]}')
        finally:
            stop_process(process)


def test_api_providers() -> None:
    """Test the /api/providers endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/api/providers')
            require(status == 200, f'Providers returned {status}')
            data = json.loads(body)
            require(len(data['providers']) >= 16, f'Expected at least 16 providers, got {len(data["providers"])}')
            ids = [p['id'] for p in data['providers']]
            require('anthropic' in ids, 'Missing anthropic provider')
            require('gemini' in ids, 'Missing gemini provider')
            require('groq' in ids, 'Missing groq provider')
        finally:
            stop_process(process)


def test_api_profiles_crud() -> None:
    """Test profile CRUD operations."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'

            # List
            status, body = http_request('GET', f'{base}/api/profiles')
            require(status == 200, f'List profiles returned {status}')
            data = json.loads(body)
            require(len(data['profiles']) >= 1, 'Expected at least 1 profile')

            # Get single
            status, body = http_request('GET', f'{base}/api/profiles/test-profile')
            require(status == 200, f'Get profile returned {status}')
            prof = json.loads(body)
            require(prof['provider'] == 'groq', f'Expected groq provider, got {prof["provider"]}')

            # Create
            new_profile = {
                'fileName': 'test-new',
                'name': 'Test New',
                'provider': 'gemini',
                'baseUrl': 'http://127.0.0.1:18000',
                'authMode': 'api_key',
                'apiKeyId': 'GEMINI_API_KEY',
                'defaultModel': 'gemini-2.5-flash',
                'models': ['gemini-2.5-flash']
            }
            status, body = http_request('POST', f'{base}/api/profiles', new_profile)
            require(status == 201, f'Create profile returned {status}: {body[:200]}')

            # Verify creation
            status, body = http_request('GET', f'{base}/api/profiles/test-new')
            require(status == 200, f'Get new profile returned {status}')

            # Update
            update = {'name': 'Updated Name', 'defaultModel': 'gemini-3.5-flash'}
            status, body = http_request('PUT', f'{base}/api/profiles/test-new', update)
            require(status == 200, f'Update profile returned {status}')

            # Delete
            status, body = http_request('DELETE', f'{base}/api/profiles/test-new')
            require(status == 200, f'Delete profile returned {status}')

            # Verify deletion
            status, body = http_request('GET', f'{base}/api/profiles/test-new')
            require(status == 404, f'Expected 404 after delete, got {status}')
        finally:
            stop_process(process)


def test_api_keys_crud() -> None:
    """Test API key CRUD operations."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'

            # List keys
            status, body = http_request('GET', f'{base}/api/keys')
            require(status == 200, f'List keys returned {status}')
            data = json.loads(body)
            require(len(data['keys']) >= 1, 'Expected at least 1 key')
            # Verify redaction
            for k in data['keys']:
                require('...' in k['value'] or k['value'] in ('<empty>', '<redacted>'), f'Key not redacted: {k["value"]}')

            # Create key
            status, body = http_request('POST', f'{base}/api/keys', {'name': 'TEST_KEY', 'value': 'test-secret-value'})
            require(status == 201, f'Create key returned {status}')

            # Update key
            status, body = http_request('PUT', f'{base}/api/keys/TEST_KEY', {'value': 'updated-secret'})
            require(status == 200, f'Update key returned {status}')

            # Delete key
            status, body = http_request('DELETE', f'{base}/api/keys/TEST_KEY')
            require(status == 200, f'Delete key returned {status}')
        finally:
            stop_process(process)


def test_api_health() -> None:
    """Test the /api/health endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/api/health')
            require(status == 200, f'Health returned {status}')
            data = json.loads(body)
            require('checks' in data, 'Missing checks')
            require(len(data['checks']) > 0, 'No health checks returned')
            # Node.js check should always pass
            node_check = next((c for c in data['checks'] if c['name'] == 'Node.js'), None)
            require(node_check is not None, 'Missing Node.js check')
            require(node_check['status'] == 'ok', f'Node.js check failed: {node_check["detail"]}')
        finally:
            stop_process(process)


def test_api_doctor() -> None:
    """Test the /api/doctor endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/api/doctor')
            require(status == 200, f'Doctor returned {status}')
            data = json.loads(body)
            require('checks' in data, 'Missing checks')
        finally:
            stop_process(process)


def test_api_theme() -> None:
    """Test the /api/theme endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'
            status, body = http_request('GET', f'{base}/api/theme')
            require(status == 200, f'Get theme returned {status}')
            data = json.loads(body)
            require('theme' in data, 'Missing theme')
        finally:
            stop_process(process)


def test_api_models() -> None:
    """Test the /api/models/:provider endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('GET', f'http://{HOST}:{port}/api/models/groq')
            require(status == 200, f'Models returned {status}')
            data = json.loads(body)
            require('models' in data, 'Missing models')
            require(len(data['models']) > 0, 'No models returned')
        finally:
            stop_process(process)


def test_api_settings_repair() -> None:
    """Test the /api/settings/repair endpoint."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, body = http_request('POST', f'http://{HOST}:{port}/api/settings/repair')
            require(status == 200, f'Settings repair returned {status}')
            data = json.loads(body)
            require('message' in data, 'Missing message')
        finally:
            stop_process(process)


def test_concurrent_requests() -> None:
    """Stress test: send 50 concurrent requests."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'
            results = []
            errors = []

            def make_request(path):
                try:
                    status, body = http_request('GET', f'{base}{path}', timeout=5)
                    results.append((path, status))
                except Exception as e:
                    errors.append((path, str(e)))

            paths = ['/api/overview', '/api/providers', '/api/profiles', '/api/keys', '/api/health']
            threads = []
            for _ in range(10):
                for path in paths:
                    t = threading.Thread(target=make_request, args=(path,))
                    threads.append(t)

            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)

            require(len(errors) == 0, f'Concurrent request errors: {errors}')
            require(len(results) == 50, f'Expected 50 results, got {len(results)}')
            for path, status in results:
                require(status == 200, f'{path} returned {status} under load')
        finally:
            stop_process(process)


def test_data_integrity_under_load() -> None:
    """Stress test: rapid create/edit/delete cycles."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'
            for i in range(10):
                profile = {
                    'fileName': f'stress-{i}',
                    'name': f'Stress Test {i}',
                    'provider': 'groq',
                    'baseUrl': 'https://api.groq.com/openai/v1',
                    'apiKeyId': 'CCKEY_GROQ_TEST_ABCD1234',
                    'defaultModel': 'llama-3.3-70b-versatile',
                    'models': ['llama-3.3-70b-versatile']
                }
                status, _ = http_request('POST', f'{base}/api/profiles', profile)
                require(status == 201, f'Create stress-{i} returned {status}')

                update = {'name': f'Updated Stress {i}'}
                status, _ = http_request('PUT', f'{base}/api/profiles/stress-{i}', update)
                require(status == 200, f'Update stress-{i} returned {status}')

                status, _ = http_request('DELETE', f'{base}/api/profiles/stress-{i}')
                require(status == 200, f'Delete stress-{i} returned {status}')

            # Verify clean state
            status, body = http_request('GET', f'{base}/api/profiles')
            data = json.loads(body)
            stress_profiles = [p for p in data['profiles'] if p['fileName'].startswith('stress-')]
            require(len(stress_profiles) == 0, f'Leftover stress profiles: {len(stress_profiles)}')
        finally:
            stop_process(process)


def test_security_path_traversal() -> None:
    """Security test: path traversal attempts."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'
            # Attempt path traversal
            status, _ = http_request('GET', f'{base}/api/profiles/../../../etc/passwd')
            require(status in (400, 404, 500), f'Path traversal returned unexpected {status}')

            # Attempt invalid JSON
            req = request.Request(
                f'{base}/api/profiles',
                data=b'not-json',
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            try:
                with request.urlopen(req, timeout=5) as resp:
                    pass
            except error.HTTPError as exc:
                require(exc.code == 500, f'Invalid JSON returned {exc.code}')
        finally:
            stop_process(process)


def test_response_times() -> None:
    """Performance test: measure response times."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            base = f'http://{HOST}:{port}'
            endpoints = ['/api/overview', '/api/providers', '/api/profiles', '/api/keys', '/api/health']
            for endpoint in endpoints:
                start = time.time()
                status, _ = http_request('GET', f'{base}{endpoint}')
                elapsed = time.time() - start
                require(status == 200, f'{endpoint} returned {status}')
                require(elapsed < 2.0, f'{endpoint} took {elapsed:.2f}s (too slow)')
        finally:
            stop_process(process)


def test_404_handling() -> None:
    """Test that unknown routes return proper 404."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp_dir:
        setup_test_env(tmp_dir)
        process = start_dashboard(port, tmp_dir)
        try:
            status, _ = http_request('GET', f'http://{HOST}:{port}/api/nonexistent')
            require(status == 404, f'Unknown API route returned {status}')
        finally:
            stop_process(process)


def main() -> int:
    tests = [
        ('server starts', test_server_starts),
        ('API overview', test_api_overview),
        ('API providers', test_api_providers),
        ('API profiles CRUD', test_api_profiles_crud),
        ('API keys CRUD', test_api_keys_crud),
        ('API health', test_api_health),
        ('API doctor', test_api_doctor),
        ('API theme', test_api_theme),
        ('API models', test_api_models),
        ('API settings repair', test_api_settings_repair),
        ('concurrent requests', test_concurrent_requests),
        ('data integrity under load', test_data_integrity_under_load),
        ('security path traversal', test_security_path_traversal),
        ('response times', test_response_times),
        ('404 handling', test_404_handling),
    ]

    passed = 0
    failed = 0
    for name, test_func in tests:
        print(f'Testing {name}...')
        try:
            test_func()
            print(f'  [OK] {name}')
            passed += 1
        except TestFailure as e:
            print(f'  [FAIL] {name}: {e}')
            failed += 1
        except Exception as e:
            print(f'  [ERROR] {name}: {e}')
            failed += 1

    print(f'\nResults: {passed} passed, {failed} failed out of {len(tests)} tests')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
