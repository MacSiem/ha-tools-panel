"""Prevent the retired monolith from loading stale bundled tools again."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "ha-tools-panel.js").read_text(encoding="utf-8")


class RetiredPanelTests(unittest.TestCase):
    def test_entrypoint_is_isolated(self) -> None:
        for forbidden in (
            "TOOL_SCRIPTS",
            "setInterval",
            "Date.now()",
            "document.createElement('script')",
            "document.createElement(\"script\")",
            "cdn.jsdelivr.net",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, SOURCE)

        self.assertIn("legacy all-in-one panel is retired", SOURCE)
        self.assertIn("!customElements.get('ha-tools-panel')", SOURCE)


if __name__ == "__main__":
    unittest.main()
