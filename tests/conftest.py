from __future__ import annotations

from collections.abc import Callable, Generator

import pytest

from tests.harness import TestRun, cleanup_runs, create_test_run


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[object]):
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)


@pytest.fixture
def test_run_factory(request: pytest.FixtureRequest) -> Generator[Callable[[str], TestRun]]:
    runs: list[TestRun] = []

    def create(name: str) -> TestRun:
        run = create_test_run(name)
        runs.append(run)
        return run

    yield create

    call_report = getattr(request.node, "rep_call", None)
    setup_report = getattr(request.node, "rep_setup", None)
    test_failed = bool(
        (call_report is not None and call_report.failed)
        or (setup_report is not None and setup_report.failed)
    )
    cleanup_runs(runs, test_failed=test_failed)
