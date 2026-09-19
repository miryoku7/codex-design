#!/usr/bin/env python3
"""Check key-only locale bindings and unmarked UI text in source HTML."""
import json
import re
import sys
from html.parser import HTMLParser

INVARIANT = re.compile(r"^(?:Codex Design|Design Workbench|Astra|HTML|CSS|JSON|PDF|MD|px|%|日本語|English|[A-C]|\d+(?:\s*[×x]\s*\d+)?|On|Off)$")
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
LOCALIZED_ATTRIBUTES = {"title", "placeholder", "aria-label", "content"}


class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.keys = []
        self.errors = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        ignored = "data-i18n-ignore" in attrs
        if ignored and not (attrs["data-i18n-ignore"] or "").strip():
            self.errors.append(f"line {self.getpos()[0]}: data-i18n-ignore requires a reason")
        for attr, value in attributes:
            if attr == "data-i18n" or attr in {f"data-i18n-{name}" for name in LOCALIZED_ATTRIBUTES}:
                self.keys.append(value or "")
        for attr in LOCALIZED_ATTRIBUTES:
            if f"data-i18n-{attr}" in attrs and (attrs.get(attr) or "").strip():
                self.errors.append(f"line {self.getpos()[0]}: duplicated localized {attr}; keep only data-i18n-{attr}")
        for attr in ["title", "placeholder", "aria-label"]:
            value = attrs.get(attr, "") or ""
            if self.translatable(value) and f"data-i18n-{attr}" not in attrs and not ignored:
                self.errors.append(f"line {self.getpos()[0]}: unmarked {attr}: {value}")
        if tag not in VOID:
            self.stack.append((tag, ignored or tag in {"script", "style"}, "data-i18n" in attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                self.stack = self.stack[:i]
                break

    @staticmethod
    def translatable(value):
        text = value.strip()
        return bool(re.search(r"[A-Za-z\u3040-\u30ff\u3400-\u9fff]", text)) and not INVARIANT.fullmatch(text)

    def handle_data(self, data):
        if data.strip() and any(localized for _, _, localized in self.stack):
            self.errors.append(f"line {self.getpos()[0]}: duplicated localized text; keep only data-i18n")
        elif self.translatable(data) and not any(ignored for _, ignored, _ in self.stack):
            self.errors.append(f"line {self.getpos()[0]}: unmarked text: {data.strip()}")


result = []
for path in sys.argv[1:]:
    parser = Scan()
    with open(path, encoding="utf-8") as source:
        parser.feed(source.read())
    result.append({"path": path, "keys": parser.keys, "errors": parser.errors})
print(json.dumps(result, ensure_ascii=False))
