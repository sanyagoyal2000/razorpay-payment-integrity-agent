"use client";

import {
  ActionList,
  ActionListItem,
  Alert,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Divider,
  Dropdown,
  DropdownOverlay,
  Radio,
  RadioGroup,
  SelectInput,
  Switch,
  Text,
  TextArea,
  TextInput,
  useToast,
} from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OPERATOR } from "@/fixtures/catalogue";
import { formatINR } from "@/domain/money";
import { draftContract, type CheckedContractDraft } from "@/services/agent";
import { ConfigurationError, contractLogic, contractToForm, EMPTY_CONTRACT_FORM, saveContract, setContractStatus, validateContract, type ContractForm } from "@/services/configuration";
import { PageHeader } from "@/ui/components/PageHeader";
import { NotFound, PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";

const OUTCOMES = ["course_access_granted", "booking_confirmed", "membership_activated", "wallet_credited", "plan_upgraded"] as const;
const MATCHING = [
  { value: "merchant_order_id", label: "Merchant order ID" },
  { value: "razorpay_order_id", label: "Razorpay order ID" },
  { value: "customer_id", label: "Customer ID" },
];
const RECOVERY = [
  { value: "retry_provisioning", label: "Retry provisioning" },
  { value: "replay_webhook", label: "Replay webhook" },
  { value: "escalate", label: "Escalate only" },
];
const REVIEW_TYPES = [
  { value: "duplicate_payment", label: "Duplicate payments" },
  { value: "inventory_conflict", label: "Inventory conflicts" },
  { value: "late_authorization", label: "Late authorisations" },
  { value: "missing_outcome", label: "Missing outcomes" },
  { value: "delayed_processing", label: "Delayed processing" },
];

function Select({ label, value, options, onChange, error }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; error?: string }) {
  return (
    <Dropdown selectionType="single">
      <SelectInput
        label={label}
        value={value}
        onChange={({ values }) => values[0] && onChange(values[0])}
        {...(error ? { validationState: "error" as const, errorText: error } : {})}
      />
      <DropdownOverlay>
        <ActionList>
          {options.map((o) => (
            <ActionListItem key={o.value} title={o.label} value={o.value} />
          ))}
        </ActionList>
      </DropdownOverlay>
    </Dropdown>
  );
}

export function ContractEditorPage({ contractId }: { contractId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const state = useModel((services) => ({
    contract: contractId ? services.repos.config.contract(contractId) ?? null : null,
    products: services.repos.config.contracts().flatMap((c) => c.productScope).map((id) => services.repos.payments.product(id)!).filter(Boolean),
    services: [...new Set(services.repos.config.contracts().map((c) => c.fulfilmentService))],
    globalMax: services.repos.config.globalControls().maxAutomaticValue,
  }), [contractId]);
  const [form, setForm] = useState<ContractForm>(EMPTY_CONTRACT_FORM);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<CheckedContractDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const existing = state.status === "ready" ? state.model.contract : null;
  useEffect(() => {
    if (existing && loadedFor !== existing.id) {
      setForm(contractToForm(existing));
      setLoadedFor(existing.id);
    }
  }, [existing, loadedFor]);

  const productName = useMemo(() => {
    const products = state.status === "ready" ? state.model.products : [];
    return (id: string) => products.find((p) => p.id === id)?.name ?? id;
  }, [state]);

  const crumbs = [{ label: "Outcome Contracts", href: `${BASE_PATH}/contracts` }, { label: contractId ? existing?.name ?? contractId : "New contract" }];
  const title = contractId ? existing?.name ?? "Outcome Contract" : "New Outcome Contract";
  if (state.status === "loading") return <><PageHeader title={title} crumbs={crumbs} /><PageSkeleton rows={2} /></>;
  if (state.status === "error") return <><PageHeader title={title} crumbs={crumbs} /><PageError message={state.message} /></>;
  if (contractId && !existing) {
    return (
      <>
        <PageHeader title="Contract not found" crumbs={crumbs} />
        <NotFound title={`No contract ${contractId}`} description="It may have been renamed. All contracts are listed on the Outcome Contracts page." action={<Button variant="secondary" onClick={() => router.push(`${BASE_PATH}/contracts`)}>View contracts</Button>} />
      </>
    );
  }

  const { services } = state;
  const { products, globalMax } = state.model;
  const set = <K extends keyof ContractForm>(key: K, value: ContractForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key: keyof ContractForm) => (errors[key] ? { validationState: "error" as const, errorText: errors[key] } : {});

  const draft = async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const result = await draftContract(services, description);
      const { assumptions: _assumptions, corrections: _corrections, ...fields } = result;
      void _assumptions;
      void _corrections;
      setForm((f) => ({ ...f, ...fields, status: f.status }));
      setDraftNote(result);
      setErrors({});
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "The draft could not be prepared.");
    } finally {
      setDrafting(false);
    }
  };

  const save = () => {
    try {
      const saved = saveContract(services.repos, form, OPERATOR.name, new Date().toISOString(), existing?.id);
      toast.show({ color: "positive", content: `${saved.name} saved.` });
      router.push(`${BASE_PATH}/contracts`);
    } catch (error) {
      if (error instanceof ConfigurationError) setErrors(error.fieldErrors);
    }
  };
  const liveErrors = validateContract(services.repos, form, existing?.id);

  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbs}
        description={existing ? existing.paymentType : "Describe what a successful payment must produce. The agent can draft the fields for you to review."}
        actions={
          existing && existing.status !== "draft" ? (
            <Button
              variant="secondary"
              onClick={() => {
                const next = existing.status === "active" ? "paused" : "active";
                setContractStatus(services.repos, existing.id, next, OPERATOR.name, new Date().toISOString());
                set("status", next);
                toast.show({ color: "positive", content: `${existing.name} ${next === "paused" ? "paused" : "resumed"}.` });
              }}
            >
              {existing.status === "active" ? "Pause contract" : "Resume contract"}
            </Button>
          ) : undefined
        }
      />
      <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "minmax(0, 3fr) minmax(0, 2fr)" }} gap="spacing.6" alignItems="start">
        <Box display="flex" flexDirection="column" gap="spacing.6">
          {!existing ? (
            <Surface title="Describe the outcome" description="In your own words: what the customer should get, how fast, and anything that needs a person.">
              <TextArea
                label="Description"
                value={description}
                onChange={({ value }) => setDescription(value ?? "")}
                numberOfLines={3}
                placeholder="e.g. Workshop seats must be confirmed within 3 minutes. Recover automatically for bookings under ₹2,000; always check the seat still exists."
              />
              <Box display="flex" justifyContent="flex-end" marginTop="spacing.3">
                <Button variant="secondary" onClick={draft} isLoading={drafting} isDisabled={drafting || description.trim().length < 10}>
                  Draft fields
                </Button>
              </Box>
              {draftError ? <Text size="small" color="feedback.text.negative.intense" marginTop="spacing.3">{draftError}</Text> : null}
              {draftNote ? (
                <Box marginTop="spacing.4">
                  <Alert
                    color="information"
                    title="Drafted by Payment Integrity Agent. Review every field before saving."
                    description={[...draftNote.assumptions, ...draftNote.corrections].join(" ") || "No assumptions were needed."}
                    isDismissible={false}
                    isFullWidth
                  />
                </Box>
              ) : null}
            </Surface>
          ) : null}

          <Surface title="Contract">
            <Box display="flex" flexDirection="column" gap="spacing.5">
              <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "1fr 1fr" }} gap="spacing.5">
                <TextInput label="Contract name" value={form.name} onChange={({ value }) => set("name", value ?? "")} {...err("name")} />
                <TextInput label="Payment or product scope" value={form.paymentType} onChange={({ value }) => set("paymentType", value ?? "")} helpText="How your team refers to these payments" {...err("paymentType")} />
              </Box>
              <CheckboxGroup
                label="Products covered"
                value={form.productScope}
                onChange={({ values }) => set("productScope", values)}
                {...(errors["productScope"] ? { validationState: "error" as const, errorText: errors["productScope"] } : {})}
              >
                {products.map((p) => (
                  <Checkbox key={p.id} value={p.id}>{`${p.name} (${formatINR(p.price)})`}</Checkbox>
                ))}
              </CheckboxGroup>
              <Divider />
              <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "1fr 1fr" }} gap="spacing.5">
                <Select label="Expected outcome" value={form.expectedOutcome} options={OUTCOMES.map((o) => ({ value: o, label: o }))} onChange={(v) => set("expectedOutcome", v as ContractForm["expectedOutcome"])} />
                <Select label="Matching identifier" value={form.matchingKey} options={MATCHING} onChange={(v) => set("matchingKey", v as ContractForm["matchingKey"])} />
                <TextInput
                  label="Outcome deadline (seconds)"
                  type="number"
                  value={String(form.deadlineSeconds)}
                  onChange={({ value }) => set("deadlineSeconds", Number(value ?? 0))}
                  helpText="How long after capture to wait before opening a case"
                  {...err("deadlineSeconds")}
                />
                <Select label="Fulfilment service" value={form.fulfilmentService} options={state.model.services.map((s) => ({ value: s, label: s }))} onChange={(v) => set("fulfilmentService", v)} {...(errors["fulfilmentService"] ? { error: errors["fulfilmentService"] } : {})} />
              </Box>
              <TextInput label="Verification method" value={form.verificationMethod} onChange={({ value }) => set("verificationMethod", value ?? "")} helpText="The event that proves the outcome happened" {...err("verificationMethod")} />
              <Divider />
              <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "1fr 1fr 1fr" }} gap="spacing.5">
                <Select label="Safe recovery action" value={form.safeRecoveryAction} options={RECOVERY} onChange={(v) => set("safeRecoveryAction", v as ContractForm["safeRecoveryAction"])} />
                <TextInput
                  label="Maximum automatic value (₹)"
                  type="number"
                  value={String(form.maxAutomaticValue)}
                  onChange={({ value }) => set("maxAutomaticValue", Number(value ?? 0))}
                  helpText={`Global maximum ${formatINR(globalMax)}`}
                  {...err("maxAutomaticValue")}
                />
                <TextInput
                  label="Confidence requirement (%)"
                  type="number"
                  value={String(Math.round(form.minimumConfidence * 100))}
                  onChange={({ value }) => set("minimumConfidence", Number(value ?? 0) / 100)}
                  {...err("minimumConfidence")}
                />
              </Box>
              <CheckboxGroup label="Always require review for" value={form.alwaysReviewCaseTypes} onChange={({ values }) => set("alwaysReviewCaseTypes", values as ContractForm["alwaysReviewCaseTypes"])}>
                {REVIEW_TYPES.map((t) => (
                  <Checkbox key={t.value} value={t.value}>{t.label}</Checkbox>
                ))}
              </CheckboxGroup>
              <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
                <Box>
                  <Text size="small" weight="semibold">Check inventory before fulfilment</Text>
                  <Text size="xsmall" color={errors["requiresInventoryCheck"] ? "feedback.text.negative.intense" : "surface.text.gray.muted"}>
                    {errors["requiresInventoryCheck"] ?? "Blocks fulfilment if the purchased seat or stock changed after payment."}
                  </Text>
                </Box>
                <Switch accessibilityLabel="Check inventory before fulfilment" isChecked={form.requiresInventoryCheck} onChange={({ isChecked }) => set("requiresInventoryCheck", isChecked)} />
              </Box>
              <Divider />
              <TextArea
                label="Customer notification template"
                value={form.customerNotificationTemplate}
                onChange={({ value }) => set("customerNotificationTemplate", value ?? "")}
                helpText="{product} is replaced with the product name. Messages still need your approval before sending."
                {...err("customerNotificationTemplate")}
              />
              <RadioGroup label="State" value={form.status} onChange={({ value }) => set("status", value as ContractForm["status"])} orientation="horizontal">
                <Radio value="active">Active</Radio>
                <Radio value="paused">Paused</Radio>
                <Radio value="draft">Draft</Radio>
              </RadioGroup>
            </Box>
          </Surface>
        </Box>

        <Box position="sticky" top="spacing.4">
          <Surface title="What this contract will do" description="Updates as you edit.">
            <Box display="flex" flexDirection="column" gap="spacing.3">
              {contractLogic(form, productName, globalMax).map((line) => (
                <Text key={line} size="small">{line}</Text>
              ))}
            </Box>
            {Object.keys(liveErrors).length > 0 ? (
              <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.4">
                {Object.keys(liveErrors).length} {Object.keys(liveErrors).length === 1 ? "field needs" : "fields need"} attention before saving.
              </Text>
            ) : null}
            <Divider marginY="spacing.5" />
            <Box display="flex" justifyContent="flex-end" gap="spacing.3">
              <Button variant="secondary" onClick={() => router.push(`${BASE_PATH}/contracts`)}>Cancel</Button>
              <Button variant="primary" onClick={save}>{existing ? "Save changes" : "Create contract"}</Button>
            </Box>
          </Surface>
        </Box>
      </Box>
    </>
  );
}
