"""Run the unchanged upstream driver after applying declared scan geometry.

Only new histogram acquisition metadata is configured; GSAS-II numerical
functions and the upstream skill's refinement/audit gates are unchanged.
"""
import json
import os
from pathlib import Path
import runpy
import sys
from runner import apply_geometry

driver = Path(sys.argv[1]).resolve(strict=True)
metadata_file = os.environ.get("YANXI_INSTRUMENT_METADATA")
if metadata_file:
    metadata = json.loads(Path(metadata_file).read_text(encoding="utf-8"))
    from GSASII import GSASIIscriptable as G2
    original_add = G2.G2Project.add_powder_histogram
    def add_with_geometry(self, *args, **kwargs):
        histogram = original_add(self, *args, **kwargs)
        apply_geometry(histogram, metadata)
        return histogram
    G2.G2Project.add_powder_histogram = add_with_geometry
sys.path.insert(0, str(driver.parent))
sys.argv = [str(driver), *sys.argv[2:]]
runpy.run_path(str(driver), run_name="__main__")
