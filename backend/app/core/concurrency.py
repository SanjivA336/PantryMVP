from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

# Every database call here is a network round trip (Render -> Supabase), so
# the biggest latency lever is not making independent ones wait for each other.
# This is one small shared pool for exactly that. It is shared (rather than a
# fresh pool per request) because get_service_client() keeps one client per
# thread: reusing the same few threads reuses their warm connections instead of
# opening new ones every time.
_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="burrow-io")


def run_parallel(*calls: Callable[[], Any]) -> list[Any]:
    """Run independent zero-argument callables at the same time and return
    their results in the order given. If any raises, that exception is raised
    here (the first one, in the order given) once all of them have finished.

    Only call this from a request's own thread, never from inside a callable
    that is itself being run by run_parallel: a pooled task that waits on more
    pooled tasks can deadlock the pool once enough requests are in flight at
    the same time.
    """
    futures = [_pool.submit(call) for call in calls]
    return [future.result() for future in futures]
