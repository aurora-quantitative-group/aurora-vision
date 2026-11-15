from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from aurora.hands import HandClassifier


@pytest.mark.parametrize("hands", [[], [[], []], [[SimpleNamespace(x=-0.1, y=0.5)]]])
def test_missing_multiple_or_clipped_hands_do_not_reach_letter_model(hands):
    gate = HandClassifier.__new__(HandClassifier)
    gate.mp = SimpleNamespace(Image=lambda **kwargs: kwargs, ImageFormat=SimpleNamespace(SRGB=0))
    gate.classifier = Mock(return_value=[{"label": "I", "score": 1}])
    gate.detector = SimpleNamespace(detect=lambda frame: SimpleNamespace(hand_landmarks=hands))
    result = gate(Image.new("RGB", (32, 32), "white"))
    assert result[0]["score"] == 0
    gate.classifier.assert_not_called()


def test_one_visible_hand_can_reach_separate_letter_model():
    gate = HandClassifier.__new__(HandClassifier)
    gate.mp = SimpleNamespace(Image=lambda **kwargs: kwargs, ImageFormat=SimpleNamespace(SRGB=0))
    gate.classifier = Mock(return_value=[{"label": "A", "score": 0.96}])
    hand = [SimpleNamespace(x=0.5, y=0.5)]
    gate.detector = SimpleNamespace(detect=lambda frame: SimpleNamespace(hand_landmarks=[hand]))
    assert gate(Image.new("RGB", (32, 32)))[0]["label"] == "A"
    gate.classifier.assert_called_once()
