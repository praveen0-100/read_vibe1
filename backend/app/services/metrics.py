"""Process metrics in the Prometheus text exposition format (no client library needed).

Labels are the route *template* (`/api/documents/{document_id}`), never the raw URL, so cardinality stays bounded.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict

BUCKETS = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
_lock = threading.Lock()
_started = time.time()
_requests: dict[tuple[str, str, str], int] = defaultdict(int)        # (method, route, status class)
_buckets: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0] * (len(BUCKETS) + 1))
_sums: dict[tuple[str, str], float] = defaultdict(float)
_counters: dict[str, int] = defaultdict(int)


def observe(method: str, route: str, status: int, seconds: float) -> None:
    with _lock:
        _requests[(method, route, f"{status // 100}xx")] += 1
        key = (method, route)
        row = _buckets[key]
        for i, edge in enumerate(BUCKETS):
            if seconds <= edge:
                row[i] += 1
        row[-1] += 1  # +Inf = total count
        _sums[key] += seconds


def incr(name: str, by: int = 1) -> None:
    with _lock:
        _counters[name] += by


def reset() -> None:
    with _lock:
        _requests.clear(); _buckets.clear(); _sums.clear(); _counters.clear()


def render(gauges: dict[str, float] | None = None, labelled: dict[str, dict[str, float]] | None = None) -> str:
    esc = lambda v: str(v).replace("\\", "\\\\").replace('"', '\\"')  # noqa: E731
    out = ["# HELP readvibe_up 1 while the API process is running", "# TYPE readvibe_up gauge", "readvibe_up 1",
           "# TYPE readvibe_uptime_seconds gauge", f"readvibe_uptime_seconds {time.time() - _started:.0f}",
           "# HELP readvibe_http_requests_total HTTP requests by route and status class", "# TYPE readvibe_http_requests_total counter"]
    with _lock:
        for (m, r, s), n in sorted(_requests.items()):
            out.append(f'readvibe_http_requests_total{{method="{m}",route="{esc(r)}",status="{s}"}} {n}')
        out += ["# HELP readvibe_http_request_duration_seconds Request latency", "# TYPE readvibe_http_request_duration_seconds histogram"]
        for (m, r), row in sorted(_buckets.items()):
            lbl = f'method="{m}",route="{esc(r)}"'
            for edge, n in zip(BUCKETS, row):
                out.append(f'readvibe_http_request_duration_seconds_bucket{{{lbl},le="{edge}"}} {n}')
            out.append(f'readvibe_http_request_duration_seconds_bucket{{{lbl},le="+Inf"}} {row[-1]}')
            out.append(f"readvibe_http_request_duration_seconds_sum{{{lbl}}} {_sums[(m, r)]:.6f}")
            out.append(f"readvibe_http_request_duration_seconds_count{{{lbl}}} {row[-1]}")
        for name, n in sorted(_counters.items()):
            out += [f"# TYPE readvibe_{name}_total counter", f"readvibe_{name}_total {n}"]
    for name, v in (gauges or {}).items():
        out += [f"# TYPE readvibe_{name} gauge", f"readvibe_{name} {v}"]
    for name, series in (labelled or {}).items():
        out.append(f"# TYPE readvibe_{name} gauge")
        out += [f'readvibe_{name}{{state="{esc(k)}"}} {v}' for k, v in sorted(series.items())]
    return "\n".join(out) + "\n"
