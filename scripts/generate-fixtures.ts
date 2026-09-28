import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildDataset } from "../src/fixtures/build";

const dataset = buildDataset();
const target = path.resolve(__dirname, "../src/fixtures/dataset.json");
writeFileSync(target, `${JSON.stringify(dataset)}\n`);
console.log(`Wrote ${target}: ${dataset.cases.length} cases, ${dataset.payments.length} payments, ${dataset.auditEvents.length} audit events`);
