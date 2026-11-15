import pytest

from boundedcache import MISSING, BoundedTTLCache


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_size_limit_drops_least_recently_used():
    c = BoundedTTLCache(max_items=3)
    for i in range(3):
        c.set(i, i)
    c.get(0)                    # 0 is now the freshest
    c.set(3, 3)                 # evicts 1
    assert len(c) == 3 and c.get(1) is MISSING and c.get(0) == 0


def test_never_grows_past_limit():
    c = BoundedTTLCache(max_items=50)
    for i in range(10_000):
        c.set(i, i)
    assert len(c) == 50


def test_entries_expire():
    clock = Clock()
    c = BoundedTTLCache(max_items=5, ttl=10, clock=clock)
    c.set('a', 1)
    clock.t += 9.9
    assert c.get('a') == 1
    clock.t += 0.2
    assert c.get('a') is MISSING and len(c) == 0


def test_per_entry_ttl_and_none_value():
    clock = Clock()
    c = BoundedTTLCache(max_items=5, ttl=100, clock=clock)
    c.set('fail', None, ttl=5)
    assert c.get('fail') is None            # a stored None is not "missing"
    clock.t += 6
    assert c.get('fail') is MISSING


def test_default_and_clear_and_pop():
    c = BoundedTTLCache(max_items=2)
    assert c.get('x', None) is None
    c.set('x', 1)
    assert 'x' in c and c.pop('x') == 1 and 'x' not in c
    c.set('y', 2)
    c.clear()
    assert len(c) == 0


def test_invalid_size():
    with pytest.raises(ValueError):
        BoundedTTLCache(max_items=0)
