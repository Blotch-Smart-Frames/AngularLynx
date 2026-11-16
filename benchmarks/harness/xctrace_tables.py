"""Reads tables out of an Instruments trace with `xctrace export`.

xctrace writes each table as rows of typed cells in column order. A value
that repeats is written once with an `id` and then referred to as
`ref="<id>"`, so a cell can't be read without the cells before it. tables()
resolves those and hands back each row as a dict of column mnemonic to
(raw text, formatted text, element).

All the tables come from one export: each run of xctrace loads the whole
trace, which takes longer than reading the tables out of it. In an export of
several tables, xctrace (Xcode 27.2) writes the column header only for the
first, and numbers the ids across all of them, so the other tables' columns
come from KNOWN_COLUMNS, as single-table exports name them.
"""

import subprocess
import xml.etree.ElementTree as ET

KNOWN_COLUMNS = {
    "life-cycle-period": ["start", "group", "lane", "duration", "process", "period", "narrative"],
    "PointsOfInterestEvents": [
        "time", "process", "thread", "subsystem", "name", "message", "emit-location", "backtrace",
    ],
    "activity-monitor-process-live": [
        "start", "process", "responsible-process", "duration", "pid", "uid", "cpu-percent",
        "cpu-total", "thread-count", "mach-port-count", "memory-physical-footprint",
        "memory-real", "memory-real-private", "memory-real-shared", "arch-kind",
        "sudden-termination", "sandbox", "restricted", "idle-wakeups", "app-nap",
        "memory-purgeable", "memory-compressed", "disk-bytes-written", "disk-bytes-read",
        "disk-bytes-written-per-second", "disk-bytes-read-per-second", "preventing-sleep",
    ],
    "device-thermal-state-intervals": [
        "start", "duration", "end", "thermal-state", "track-label", "is-induced", "narrative",
    ],
}

# A cell type only that table has, which names a headerless table.
DISTINCT_CELL = {
    "life-cycle-period": "app-period",
    "PointsOfInterestEvents": "signpost-name",
    "activity-monitor-process-live": "size-in-bytes",
    "device-thermal-state-intervals": "thermal-state",
}


def _run(*args):
    return subprocess.run(
        ["xcrun", "xctrace", "export", *args], check=True, capture_output=True, text=True
    ).stdout


def table_schemas(trace):
    """The schema of each table in run 1, in the TOC's order (table[n])."""
    toc = ET.fromstring(_run("--input", trace, "--toc"))
    return [table.get("schema") for table in toc.findall("run[@number='1']/data/table")]


def tables(trace, *schemas):
    """Each schema's rows, from one export."""
    match = " or ".join(f'@schema="{schema}"' for schema in schemas)
    root = ET.fromstring(
        _run("--input", trace, "--xpath", f'/trace-toc/run[@number="1"]/data/table[{match}]')
    )
    by_id = {}

    def resolve(element):
        ref = element.get("ref")
        if ref is not None:
            return by_id[ref]
        if element.get("id") is not None:
            by_id[element.get("id")] = element
        # Register ids nested inside this cell (a process holds a pid, etc.).
        for child in element:
            resolve(child)
        return element

    result = {schema: [] for schema in schemas}
    remaining = list(schemas)
    for node in root.findall("node"):
        header = node.find("schema")
        if header is not None:
            schema = header.get("name")
            columns = [col.findtext("mnemonic") for col in header.findall("col")]
        else:
            # Named by a cell type only that table has. An empty table can
            # be skipped: its schema keeps no rows.
            first = node.find("row")
            if first is None:
                continue
            tags = {cell.tag for cell in first}
            schema = next(
                (s for s in remaining if DISTINCT_CELL.get(s) in tags), None
            )
            if schema is None:
                continue
            columns = KNOWN_COLUMNS[schema]
        if schema in remaining:
            remaining.remove(schema)
        result[schema] = [
            {
                name: (cell.text, cell.get("fmt"), cell)
                for name, cell in zip(columns, (resolve(cell) for cell in row))
            }
            for row in node.findall("row")
        ]
    return result
