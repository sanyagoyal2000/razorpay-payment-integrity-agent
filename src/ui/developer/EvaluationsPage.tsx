"use client";

import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  ChipGroup,
  Code,
  Drawer,
  DrawerBody,
  DrawerHeader,
  Heading,
  Indicator,
  List,
  ListItem,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
} from "@razorpay/blade/components";
import { useMemo, useState } from "react";
import { formatIstDateTime } from "@/domain/time";
import captured from "@/fixtures/evaluation/captured-outputs.json";
import type { ScenarioEvaluation } from "@/services/evaluation/scoring";
import { ACTION_LABELS, CAUSE_LABELS, evaluationModel, formatRate, type CapturedOutputs, type EvaluationSplit, type ScenarioRow } from "@/services/views/evaluation";
import { CATEGORY_LABELS } from "@/fixtures/evaluation/scenarios";
import { MetaList } from "@/ui/components/MetaList";
import { PageHeader } from "@/ui/components/PageHeader";
import { Surface } from "@/ui/components/Surface";
import { BASE_PATH } from "@/ui/shell/nav";

const NOTICE =
  "These results use synthetic labeled incidents and captured investigator outputs. They demonstrate the evaluation method, not production accuracy. Production claims require expert review using real merchant incidents.";

const RESULT_TEXT = { safe: "Safe", not_acceptable: "Not acceptable", unsafe: "Unsafe" } as const;

function ResultLabel({ result }: { result: ScenarioRow["aiResult"] }) {
  return (
    <Box display="inline-flex" alignItems="center" gap="spacing.2">
      <Indicator color={result === "safe" ? "positive" : result === "unsafe" ? "negative" : "neutral"} emphasis="intense" size="small" accessibilityLabel="" />
      <Text size="small" weight={result === "unsafe" ? "semibold" : "regular"} color={result === "unsafe" ? "feedback.text.negative.intense" : "surface.text.gray.normal"}>
        {RESULT_TEXT[result]}
      </Text>
    </Box>
  );
}

function Figure({ label, value, detail, negative }: { label: string; value: string; detail: string; negative?: boolean }) {
  return (
    <Box padding="spacing.4" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" display="flex" flexDirection="column" gap="spacing.1">
      <Box display="flex" alignItems="center" gap="spacing.2">
        {negative ? <Indicator color="negative" emphasis="intense" size="small" accessibilityLabel="" /> : null}
        <Text size="small" color="surface.text.gray.muted">{label}</Text>
      </Box>
      <Heading as="span" size="medium" weight="semibold" color={negative ? "feedback.text.negative.intense" : "surface.text.gray.normal"}>{value}</Heading>
      <Text size="xsmall" color="surface.text.gray.subtle">{detail}</Text>
    </Box>
  );
}

const count = (r: { numerator: number; denominator: number }) => `${r.numerator} of ${r.denominator}`;

/**
 * Investigator validation: an offline comparison of the AI investigator and a
 * fixed-rule baseline on labelled synthetic scenarios. Nothing here calls a
 * model or executes an action; all figures are computed on the page.
 */
export function EvaluationsPage() {
  const [split, setSplit] = useState<EvaluationSplit>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const model = useMemo(() => evaluationModel(captured as CapturedOutputs, split), [split]);
  const open = model.results.find((r) => r.scenario.id === openId) ?? null;
  const { meta, safety, composition } = model;

  return (
    <>
      <PageHeader
        title="Investigator validation"
        crumbs={[{ label: "Developer settings", href: `${BASE_PATH}/developer` }, { label: "Investigator validation" }]}
        description={
          <Box display="flex" flexDirection="column" gap="spacing.2" alignItems="flex-start">
            <Text size="medium" color="surface.text.gray.subtle">Offline comparison of the AI investigator and a fixed-rule baseline on labeled, simulated incidents.</Text>
            <Badge color="neutral" size="medium">Simulated benchmark</Badge>
          </Box>
        }
      />
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <Alert color="notice" title="Simulated benchmark" description={NOTICE} isDismissible={false} isFullWidth />

        <Surface id="dataset" title="Dataset">
          <MetaList
            minColumnWidth={170}
            items={[
              { label: "Labeled scenarios", value: String(meta.scenarios) },
              { label: "Categories", value: String(meta.categories) },
              { label: "Development", value: String(meta.development) },
              { label: "Locked holdout", value: String(meta.holdout), help: "Offline evaluation holdout; no customer is involved." },
              { label: "Evaluated", value: formatIstDateTime(meta.capturedAt) },
              { label: "Captured-output version", value: meta.version, help: `${meta.model} via ${meta.provider}; task definition ${meta.promptVersion}` },
            ]}
          />
        </Surface>

        <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
          <ChipGroup
            label="Dataset split"
            labelPosition="left"
            selectionType="single"
            value={split}
            onChange={({ values }) => setSplit((values[0] as EvaluationSplit | undefined) ?? "all")}
          >
            <Chip value="all">All ({meta.scenarios})</Chip>
            <Chip value="development">Development ({meta.development})</Chip>
            <Chip value="holdout">Holdout ({meta.holdout})</Chip>
          </ChipGroup>
        </Box>

        <Surface id="comparison" title="Fixed rules and AI investigator" description={`${model.aggregate.scenarios} scenarios in this view. Every figure is computed from the labels and the ${meta.sourceLabel}.`} padded={false}>
          <Table data={{ nodes: model.metrics }} rowDensity="normal" gridTemplateColumns="minmax(220px, 2fr) 150px 150px minmax(220px, 2fr)">
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Metric</TableHeaderCell>
                    <TableHeaderCell>Fixed rules</TableHeaderCell>
                    <TableHeaderCell>AI investigator</TableHeaderCell>
                    <TableHeaderCell>Interpretation</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((m) => (
                    <TableRow key={m.id} item={m}>
                      <TableCell>
                        <Box paddingY="spacing.2">
                          <Text size="small" weight={m.emphasis ? "semibold" : "medium"}>{m.label}</Text>
                          {m.lowerIsBetter ? <Text size="xsmall" color="surface.text.gray.muted">Lower is better</Text> : null}
                        </Box>
                      </TableCell>
                      {[m.baseline, m.ai].map((r, i) => (
                        <TableCell key={i}>
                          {m.unscored ? (
                            <Text size="small" color="surface.text.gray.muted">{m.unscored}</Text>
                          ) : (
                            <Box>
                              <Text size="small" weight="semibold" color={m.emphasis && r && r.numerator > 0 ? "feedback.text.negative.intense" : "surface.text.gray.normal"}>{formatRate(r)}</Text>
                              {r ? <Text size="xsmall" color="surface.text.gray.muted">{count(r)}</Text> : null}
                            </Box>
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Text size="small" color="surface.text.gray.subtle">{m.interpretation}</Text>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </Surface>

        <Surface id="safety" title="Safety summary" description="Unsafe actions are materially worse than an unnecessary escalation and are counted separately.">
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="spacing.4">
            <Figure label="Unsafe AI recommendations" value={String(safety.unsafeAi.numerator)} detail={`of ${safety.unsafeAi.denominator} scenarios`} negative={safety.unsafeAi.numerator > 0} />
            <Figure label="Unsafe baseline recommendations" value={String(safety.unsafeBaseline.numerator)} detail={`of ${safety.unsafeBaseline.denominator} scenarios`} negative={safety.unsafeBaseline.numerator > 0} />
            <Figure label="Correct uncertainty escalations (AI)" value={count(safety.aiCorrectEscalations)} detail="Scenarios where only escalation is correct" />
            <Figure
              label="Invalid or unverifiable outputs blocked"
              value={String(safety.blockedOutputs)}
              detail={`${safety.invalidOutputs} failed validation, ${safety.unavailableOutputs} unavailable (timed out); ${safety.fabricatedCitationsRemoved} fabricated citations removed. Each was scored as an escalation.`}
            />
          </Box>
        </Surface>

        <Surface id="composition" title="Dataset composition">
          <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "3fr 2fr" }} gap="spacing.6">
            <Box display="flex" flexDirection="column" gap="spacing.2">
              {composition.byCategory.map((c) => (
                <Box key={c.category} display="flex" justifyContent="space-between" gap="spacing.4" paddingY="spacing.1" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
                  <Text size="small">{c.label}</Text>
                  <Text size="small" color="surface.text.gray.subtle">{c.total} ({c.development} development, {c.holdout} holdout)</Text>
                </Box>
              ))}
            </Box>
            <MetaList
              minColumnWidth={150}
              items={[
                { label: "Clear evidence", value: String(composition.clear) },
                { label: "Ambiguous evidence", value: String(composition.ambiguous), help: composition.shapes.filter((s) => s.shape !== "clear").map((s) => `${s.count} ${s.shape.replace("_", " ")}`).join(", ") },
                { label: "Safe to act", value: String(composition.safeToAct) },
                { label: "Wait or escalate", value: String(composition.waitOrEscalate) },
                { label: "Must escalate", value: String(composition.mustEscalate) },
              ]}
            />
          </Box>
        </Surface>

        <Surface id="scenarios" title="Scenarios" description="Results per scenario. Open one to see the evidence, the label and why each result passed or failed." padded={false}>
          <Table data={{ nodes: model.rows }} rowDensity="normal" gridTemplateColumns="minmax(170px, 1.3fr) minmax(170px, 1.4fr) 150px 150px 120px 110px">
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Scenario</TableHeaderCell>
                    <TableHeaderCell>Ground truth</TableHeaderCell>
                    <TableHeaderCell>Fixed rules</TableHeaderCell>
                    <TableHeaderCell>AI investigator</TableHeaderCell>
                    <TableHeaderCell>Citations</TableHeaderCell>
                    <TableHeaderCell>Details</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell>
                        <Box paddingY="spacing.2">
                          <Text size="small" weight="semibold">{row.id}</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.category} · {row.split === "holdout" ? "Holdout" : "Development"}</Text>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.truth}</Text>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Text size="small">{row.baselineAction}</Text>
                          <ResultLabel result={row.baselineResult} />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Text size="small">{row.aiAction}</Text>
                          <ResultLabel result={row.aiResult} />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.citation}</Text>
                      </TableCell>
                      <TableCell>
                        <Button variant="tertiary" size="xsmall" accessibilityLabel={`View details for ${row.id}`} onClick={() => setOpenId(row.id)}>View details</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </Surface>

        <Surface id="method" title="Methodology and limitations">
          <List size="small">
            <ListItem>Synthetic data: 40 hand-written scenarios, four per category, with a reviewer note explaining each label. They are not real merchant incidents.</ListItem>
            <ListItem>Captured model outputs: each scenario was sent once through the production investigation task (same prompt, model and output schema) and the responses were committed. The page does not call a model.</ListItem>
            <ListItem>Both systems receive the same structured evidence. The fixed-rule baseline applies explicit patterns in a fixed order and escalates when none matches.</ListItem>
            <ListItem>AI output passes through the production validation boundary. Invalid or unavailable output is scored as the deterministic escalation, never as a guess.</ListItem>
            <ListItem>Free-text causes are matched to labels by pattern. The drawer shows the full text so a reviewer can check each match. The patterns were widened once after reading development-split outputs (three correct answers worded differently); holdout outputs were not used to adjust them.</ListItem>
            <ListItem>Each scenario was captured once. A call that timed out is kept as unavailable and scored as the deterministic escalation; it was not re-run to improve the result.</ListItem>
            <ListItem>The holdout is an offline split of this dataset, not a customer holdout; no customer is denied treatment.</ListItem>
            <ListItem>No production accuracy claim is made. That needs expert-reviewed real incidents, versioned prompts and models, and a dataset that grows when new failure patterns appear.</ListItem>
          </List>
        </Surface>
      </Box>

      <Drawer isOpen={open !== null} onDismiss={() => setOpenId(null)} accessibilityLabel={open ? `Scenario ${open.scenario.id}` : "Scenario"}>
        <DrawerHeader title={open?.scenario.id ?? ""} subtitle={open ? `${CATEGORY_LABELS[open.scenario.category]} · ${open.scenario.split === "holdout" ? "Holdout" : "Development"}` : ""} />
        <DrawerBody>{open ? <ScenarioDetail result={open} /> : null}</DrawerBody>
      </Drawer>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.2">
      <Heading as="h3" size="small" weight="semibold">{title}</Heading>
      {children}
    </Box>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  return (
    <List size="small">
      {reasons.map((r) => (
        <ListItem key={r}>{r}</ListItem>
      ))}
    </List>
  );
}

function ScenarioDetail({ result }: { result: ScenarioEvaluation }) {
  const { scenario, baseline, ai } = result;
  const { truth } = scenario;
  return (
    <Box display="flex" flexDirection="column" gap="spacing.6">
      <Section title="Ground truth">
        <Text size="small" weight="medium">{CAUSE_LABELS[truth.cause]}</Text>
        <Text size="small" color="surface.text.gray.subtle">{scenario.reviewerNote}</Text>
        <MetaList
          minColumnWidth={160}
          items={[
            { label: "Acceptable actions", value: truth.acceptableActions.map((a) => ACTION_LABELS[a]).join(", ") },
            { label: "Unsafe actions", value: truth.unsafeActions.map((a) => ACTION_LABELS[a]).join(", ") },
            { label: "Escalation required", value: truth.escalationRequired ? "Yes" : "No" },
            { label: "Required evidence", value: truth.requiredEvidenceIds.join(", ") },
          ]}
        />
      </Section>

      <Section title="Evidence supplied">
        <Text size="xsmall" color="surface.text.gray.muted">
          {scenario.input.contract.name}: {scenario.input.contract.expectedOutcome} within {scenario.input.contract.deadlineSeconds} s · payment {scenario.input.payment.status}, ₹{scenario.input.payment.amount.toLocaleString("en-IN")}
        </Text>
        <Box display="flex" flexDirection="column" gap="spacing.2">
          {scenario.input.evidence.map((e) => (
            <Box key={e.id} display="grid" gridTemplateColumns="150px 1fr" columnGap="spacing.3">
              <Code size="small">{e.id}</Code>
              <Box>
                <Text size="small">{e.type} <Text as="span" size="xsmall" color="surface.text.gray.muted">({e.source})</Text></Text>
                {e.detail ? <Text size="xsmall" color="surface.text.gray.subtle">{JSON.stringify(e.detail)}</Text> : null}
              </Box>
            </Box>
          ))}
        </Box>
      </Section>

      <Section title="Fixed rules">
        <Text size="small">Matched rule: {baseline.baseline.ruleLabel}</Text>
        <Text size="small">Decision: {ACTION_LABELS[baseline.action]}</Text>
        <Reasons reasons={baseline.reasons} />
      </Section>

      <Section title="AI investigator">
        <Text size="small" weight="medium">{ai.investigation.likelyCause}</Text>
        <Text size="small">
          {ACTION_LABELS[ai.action]} · confidence {Math.round(ai.confidence * 100)}% · {ai.validation === "valid" ? "valid output" : ai.validation === "invalid" ? "output blocked by validation" : "no output"}
        </Text>
        <Text size="xsmall" color="surface.text.gray.subtle">
          Cited: {ai.citedIds.length === 0 ? "none" : ai.citedIds.join(", ")}
          {ai.removedIds.length > 0 ? ` · removed by validation: ${ai.removedIds.join(", ")}` : ""}
        </Text>
        <Reasons reasons={ai.reasons} />
      </Section>
    </Box>
  );
}
