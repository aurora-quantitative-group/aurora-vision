from decimal import Decimal

import pytest
from pydantic import ValidationError

from aurora.state import CallState
from aurora.vision import CashReading, Scene


def test_camera_rejects_missing_stale_and_frozen_frames():
    state = CallState(3, 12)
    with pytest.raises(ValueError, match="camera"):
        state.current(now=0)
    state.add_frame(b"a", now=1)
    assert state.current(now=3).jpeg == b"a"
    state.add_frame(b"a", now=5)
    with pytest.raises(ValueError, match="stale or frozen"):
        state.current(now=5)
    state.add_frame(b"b", now=6)
    assert state.current(now=6).jpeg == b"b"
    with pytest.raises(ValueError, match="stale"):
        state.current(now=10)


def test_buffers_and_alert_keys_stay_bounded():
    state = CallState(3, 12)
    for index in range(100):
        state.add_frame(str(index).encode(), now=index)
        state.remember(str(index))
        state.should_alert(str(index), now=index)
    assert len(state.frames) == 24
    assert len(state.events) == 60
    assert len(state.alerts) <= 12
    assert not state.should_alert("99", now=100)
    assert state.should_alert("99", now=112)
    state.clear()
    assert not state.events and not state.frames and not state.alerts


def test_camera_replacement_invalidates_inflight_analysis(monkeypatch):
    monkeypatch.setattr("aurora.state.time.monotonic", lambda: 10)
    state = CallState(3, 12)
    state.add_frame(b"first")
    frame = state.current()
    state.clear_camera()
    state.add_frame(b"second")
    assert not state.is_current(frame)


def test_cash_uses_decimal_totals_and_separates_currencies():
    result = CashReading(clear=True, confidence=0.95, guidance="", bills=[
        {"currency": "USD", "denomination": "0.10", "count": 3},
        {"currency": "EUR", "denomination": "20", "count": 2},
    ])
    assert result.bills[0].denomination == Decimal("0.10")
    assert "USD 0.30" in result.spoken()
    assert "EUR 40" in result.spoken()
    assert "authenticity" in result.spoken()


@pytest.mark.parametrize("clear,confidence", [(False, 1), (True, 0.84)])
def test_uncertain_cash_has_no_fabricated_total(clear, confidence):
    result = CashReading(clear=clear, confidence=confidence, guidance="", bills=[
        {"currency": "USD", "denomination": 100, "count": 1},
    ])
    assert "100" not in result.spoken()
    assert "one flat bill" in result.spoken()


@pytest.mark.parametrize("value", [-1, 0, "NaN", "Infinity"])
def test_cash_rejects_invalid_denominations(value):
    with pytest.raises(ValidationError):
        CashReading(clear=True, confidence=1, guidance="", bills=[
            {"currency": "USD", "denomination": value, "count": 1},
        ])


def test_unusable_scene_cannot_produce_hazards():
    scene = Scene(usable=False, description="blocked", hazards=[{
        "category": "weapon", "location": "left", "severity": "high",
        "confidence": 1, "observation": "A UI icon",
    }])
    assert not scene.hazards
