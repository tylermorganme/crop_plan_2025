#!/usr/bin/env python3
"""
VBA Extractor - Extract VBA code from Office files

Usage:
    python extract_vba.py <office-file> [output-file]

Examples:
    python extract_vba.py workbook.xlsm
    python extract_vba.py workbook.xlsm vba_code.txt
    python extract_vba.py document.docm macros.txt

Requirements:
    pip install oletools
"""

import sys
import subprocess
from pathlib import Path


def extract_vba(input_file: str, output_file: str = None) -> bool:
    """
    Extract VBA code from an Office file using oletools.

    Args:
        input_file: Path to the Office file (.xlsm, .docm, etc.)
        output_file: Optional output file path. If not provided, prints to stdout.

    Returns:
        True if extraction succeeded, False otherwise.
    """
    input_path = Path(input_file)

    if not input_path.exists():
        print(f"Error: File not found: {input_file}", file=sys.stderr)
        return False

    # Build the olevba command
    cmd = [sys.executable, "-m", "oletools.olevba", str(input_path), "-c"]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )

        output = result.stdout

        if output_file:
            output_path = Path(output_file)
            output_path.write_text(output, encoding='utf-8')
            print(f"VBA code extracted to: {output_file}")
        else:
            print(output)

        return True

    except FileNotFoundError:
        print("Error: oletools not installed. Run: pip install oletools", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Error extracting VBA: {e}", file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    success = extract_vba(input_file, output_file)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
