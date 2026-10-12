import importlib.util
from pathlib import Path
import tempfile
import unittest


class Array(list):
    mask = False


class MockHistogram:
    residuals = {"wR": 12.0, "R": 8.0}
    data = {"Instrument Parameters": [{"Type": ["PXC", "PXC", 0]}]}

    def get_wR(self):
        return 12.0

    def getdata(self, key):
        x = [10 + i * .05 for i in range(120)]
        values = {
            "X": x,
            "Yobs": [100 + i for i in range(120)],
            "Ycalc": [98 + i for i in range(120)],
            "Background": [10] * 120,
            "Residual": [2] * 120,
        }
        return Array(values[key])


class MockPhase:
    def get_cell(self):
        return [5.0, 5.0, 6.0, 90, 90, 90, 150.0]

    def get_cell_and_esd(self):
        return self.get_cell(), [.001, .001, .002, 0, 0, 0, .02]

    def export_CIF(self, path):
        Path(path).write_text("data_refined\n")


class MockProject:
    def __init__(self, newgpx):
        self.hist = MockHistogram()
        self.phase = MockPhase()
        self.steps = []

    def add_powder_histogram(self, pattern, instrument):
        return self.hist

    def add_phase(self, structure, **kwargs):
        return self.phase

    def do_refinements(self, steps):
        self.steps.extend(steps)

    def save(self, path):
        Path(path).write_text("mock only")


class MockGSAS:
    G2Project = MockProject

spec = importlib.util.spec_from_file_location("xrd_runner", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class InputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.pattern = root / "measured.csv"
        self.pattern.write_text("2theta,intensity,sigma\n" + "".join(f"{10+i*.05:.3f},{100+i},{10+i*.01:.3f}\n" for i in range(120)))
        self.structure = root / "candidate.cif"
        self.structure.write_text("data_test\n_atom_site_fract_x 0.0\n")
        self.instrument = root / "calibrated.instprm"
        self.instrument.write_text("#GSAS-II instrument parameter file\nType:PXC;Bank:1\nLam:1.5406\n")
        self.job = {"pattern": str(self.pattern), "structure": str(self.structure), "instrument": str(self.instrument),
                    "confirm_structure_match": True, "confirm_instrument_calibrated": True}

    def test_valid_input(self):
        paths, points, warnings = runner.validate_job(self.job)
        self.assertEqual(len(points), 120)
        self.assertIn("instrument", paths)

    def test_card_only_rejected(self):
        self.structure.write_text("data_fake\n_cell_length_a 4.0\n")
        with self.assertRaisesRegex(runner.InputError, "原子坐标"):
            runner.validate_job(self.job)

    def test_uncalibrated_confirmation_rejected(self):
        self.job["confirm_instrument_calibrated"] = False
        with self.assertRaisesRegex(runner.InputError, "必须确认"):
            runner.validate_job(self.job)

    def test_wrong_radiation_rejected(self):
        self.instrument.write_text("Type:PNT\n")
        with self.assertRaisesRegex(runner.InputError, "Type:PXC"):
            runner.validate_job(self.job)

    def test_executable_instrument_hook_rejected(self):
        self.instrument.write_text("Type:PXC\nCorrectionCode:exec('bad')\n")
        with self.assertRaisesRegex(runner.InputError, "CorrectionCode"):
            runner.validate_job(self.job)

    def test_card_requires_matching_wavelength_and_is_reference_only(self):
        card = Path(self.tmp.name) / "card.csv"
        card.write_text("2theta_deg,relative_intensity\n30,100\n45,20\n")
        self.job["card"] = str(card)
        with self.assertRaisesRegex(runner.InputError, "相同波长"):
            runner.validate_job(self.job)
        self.job["confirm_card_same_wavelength"] = True
        self.assertEqual(runner.parse_card(card), [(30.0, 100.0), (45.0, 20.0)])

    def test_duplicate_angle_rejected(self):
        self.pattern.write_text("\n".join("20 100 10" for _ in range(120)))
        with self.assertRaisesRegex(runner.InputError, "严格递增"):
            runner.validate_job(self.job)

    def test_no_engine_does_not_create_fake_results(self):
        if importlib.util.find_spec("GSASII") or importlib.util.find_spec("G2script"):
            self.skipTest("GSAS-II is installed; missing-engine path not applicable")
        with self.assertRaisesRegex(RuntimeError, "未安装 GSAS-II"):
            runner.run(self.job, Path(self.tmp.name) / "result")
        self.assertFalse((Path(self.tmp.name) / "result" / "result.json").exists())

    def test_engine_orchestration_exports_origin_svg_gpx_and_card(self):
        card = Path(self.tmp.name) / "card.csv"
        card.write_text("2theta_deg,relative_intensity\n12,100\n14,25\n")
        self.job.update({"card": str(card), "confirm_card_same_wavelength": True, "refine_profile": True})
        output = Path(self.tmp.name) / "verified-output"
        result = runner.run(self.job, output, gsas=MockGSAS)
        self.assertEqual(len(result["stages"]), 3)
        for name in ("refinement.gpx", "refined-structure.cif", "origin-curves.csv", "refinement-plot.svg", "card-reference.csv", "result.json"):
            self.assertTrue((output / name).is_file(), name)
        self.assertIn("2theta_deg,Yobs,Ycalc,Background,Yobs_minus_Ycalc", (output / "origin-curves.csv").read_text(encoding="utf-8-sig"))
        self.assertIn("Card ticks", (output / "refinement-plot.svg").read_text())
        self.assertIn("sha256", result["input"]["pattern"])


if __name__ == "__main__":
    unittest.main()
