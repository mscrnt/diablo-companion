// Print what the OCR snapper makes of each argument (or of stdin lines).
import { loadStaticData } from "../../src/lib/names";
import { snapLine } from "../../src/lib/ocrfix";
await loadStaticData();
for (const l of process.argv.slice(2)) console.log(JSON.stringify(l), "→", JSON.stringify(snapLine(l)));
