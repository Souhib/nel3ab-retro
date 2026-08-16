"""Writes the OpenAPI document the front end generates its client from.

FastAPI already knows every route, status and model, so the schema is a
by-product of the code rather than a document somebody keeps in step with it
(ADR D6). Dumping it to a file, rather than pointing the generator at a running
server, means the front end builds without this service being up, and a change
to a response model shows up as a diff in the repository.
"""

import json
from pathlib import Path

from nel3ab_control.app import create_app

DESTINATION = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    schema = create_app().openapi()
    DESTINATION.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
