# AI Build Log: Payment Integrity

## Project context

**Challenge:** Razorpay Track 2, Recover and Grow with AI  
**Product:** Payment Integrity, a concept Agent Studio agent  
**Core problem:** A payment can succeed but the customer may still not receive what they paid for. Payment Integrity finds this mismatch, investigates the cause, recommends a safe recovery, asks for approval when needed, and checks whether the outcome was delivered.

This is a reconstructed decision log based on my conversations and repository. It is not a complete chat transcript.

## AI tools and models I used

| Tool or model | How I used it |
|---|---|
| ChatGPT and OpenAI Codex | Research, idea generation, competitor comparison, product criticism, prototype review, and documentation. |
| Claude | A second opinion on the shortlist, positioning, missing permissions, sizing, and trust risks. |
| Claude Code | The main implementation partner for the application, fixtures, tests, and repository documentation. |
| Claude Opus 5 through the local Claude CLI | The prototype's structured investigation path and the captured outputs used in offline evaluation. |
| AI-assisted web research | Finding public Razorpay pages, videos, competitor material, and regulatory announcements. Important claims were checked against identified sources. |

I used different models for exploration, criticism, implementation, and review. I compared their responses and made the final product and scope decisions.

## My workflow

My process was usually:

1. Ask a broad question in ChatGPT or Claude.
2. Challenge the answer for originality, overlap, missing data, or unsafe assumptions.
3. Verify important claims against public sources.
4. Turn the useful conclusion into a constrained Claude Code prompt.
5. Review the result in the running product.
6. Ask another model to criticise the work.
7. Keep, change, or reject the suggestion myself.
8. Run tests and update the documentation.

Claude Code received repository instructions, a product specification, non-goals, safety boundaries, acceptance criteria, and verification commands. The in-product investigator had to return structured output and cite supplied evidence. It had no direct authority to execute an action.

## 1. Researching Razorpay before choosing an idea

I first used AI to understand what Razorpay already offers. I did not want to build another generic chatbot or duplicate an announced product.

The research covered Agent Studio, the Agentic Experience Platform, Agentic Dashboard, onboarding and integration, and agents around disputes, subscriptions, cart recovery, RTO, settlements, cash flow, collections, and payouts. I also reviewed core products such as Payments, Orders, webhooks, capture, refunds, Subscriptions, Optimizer, Route, settlements, and RazorpayX.

For comparison, I looked at Stripe, Adyen, Shopify, GoKwik, Cashfree, Juspay, Chargebee, Recurly, and Klaviyo. This showed that smart retries, cart recovery, RTO prediction, routing, churn, and offer optimisation were already crowded spaces.

The key gap was not another payment retry tool. It was the gap between a successful payment and the outcome the merchant promised.

### What I learned from Razorpay's public AI videos

I reviewed Razorpay's public Agentic Dashboard and RAY demonstrations, plus the AIM Network conversation with Razorpay CPO Khilan Haria. I treated them as product direction, not as an internal specification.

My observations were:

- RAY is embedded in the merchant's working environment instead of being a separate generic chatbot.
- The experience starts with merchant intent, then gives a concise answer before showing supporting detail.
- Razorpay's direction favours specialist agents with bounded context and actions.
- Reading context and having authority to act are different. This influenced the split between connected systems, read scope, write scope, policy, and approval.
- RAY shows lightweight progress without exposing chain-of-thought. Payment Integrity therefore shows observable stages such as gathering evidence, comparing cases, checking service state, validating citations, and preparing a recommendation.
- The product should answer what needs attention, not make the merchant interpret a collection of widgets.

These findings changed the Overview into a proactive briefing. It now states the incident, affected value and customers, likely cause, service status, and recoverable cases.

### UI analysis and Razorpay Blade

I compared the interface with public RAY and Agentic Dashboard screens. This led to a black global navigation bar, a bright active tab with a Razorpay blue indicator, muted inactive tabs, compact operational layouts, and short decision-focused copy. Razorpay blue is used for actions. Mint and green are used selectively for RAY-assisted content instead of becoming the whole product palette.

I added leading navigation icons, used the Razorpay wordmark carefully, and removed the “Live” badge. The prototype has no environment switch, and the badge could make a simulated Marrow incident look real.

The first build prompt proposed a general React component stack. I changed the implementation to Razorpay Blade so the product would behave like a plausible Razorpay extension instead of only copying its colours. Blade influenced spacing, typography, navigation, tables, badges, controls, dialogs, drawers, responsive behaviour, Indian amount formatting, and accessibility.

The project was aligned to the React and styled-components versions supported by the installed Blade release. I tested focus, keyboard use, accessible names, and screen-reader structure. A narrow local patch was documented for table and checkbox semantics that caused accessibility failures.

## 2. Generating and filtering ideas

AI helped generate 17 opportunities. Each was compared on signal, AI necessity, merchant action, control, measurable outcome, overlap with Razorpay, and prototype feasibility.

1. COD-to-Prepaid Converter
2. Payment Offer Optimizer
3. Repeat Purchase Agent
4. One-time-to-Subscription Converter
5. Checkout Drop-off Diagnoser
6. Discount Leakage Detector
7. Soft-Decline Recovery
8. Refund and Return-Abuse Agent
9. Downtime Revenue Guard
10. B2B Receivables Prioritizer
11. Settlement and Fee Auditor
12. Pre-dispute Chargeback Prevention
13. Working-Capital Timing Agent
14. Festive Readiness Copilot
15. Customer Win-back Agent
16. Support-to-Revenue Agent for “payment deducted, order not placed”
17. Custom Recovery Playbook Builder

The initial shortlist was COD-to-prepaid, soft-decline recovery, and checkout drop-off diagnosis. They were measurable but also obvious and close to existing products.

I used multiple models as critics instead of accepting the first shortlist. The main ideas I rejected were:

| Idea | Why I did not select it |
|---|---|
| COD-to-prepaid | Strong India use case, but likely to be common and close to existing RTO and COD products. Measuring incentive uplift without margin loss would also require careful experimentation. |
| Soft-decline recovery | Too close to smart retries, payment routing, and existing recovery capabilities. |
| Checkout drop-off fixer | Useful, but dependent on detailed funnel and routing controls. It could easily become another analytics dashboard. |
| Fraud false-positive recovery | Needs real fraud labels and issuer outcomes to be credible. Synthetic results would be weak. |
| Festive readiness | Better as a feature or checklist than a standalone product. |
| Working-capital timing | Risked looking like a way to sell Razorpay Capital rather than solve the merchant's main problem. |
| General reconciliation | Already close to public Agentic Dashboard examples. |
| Generic support chatbot | Explains information but does not make or execute a better decision. |

The support-to-revenue idea was then reframed proactively:

> Detect when payment succeeded but the intended outcome is missing, investigate why, and recommend the safest action before the customer complains.

That became Payment Integrity.

## 3. One AI output I rejected and changed

An early AI response suggested using a customer holdout group to measure recovered revenue. That can work for marketing experiments, but it was wrong here. It would mean knowingly leaving some paying customers without the access they purchased just to measure lift.

I rejected that recommendation and replaced it with:

1. An offline holdout of labelled synthetic incidents for comparing AI with fixed rules. No customer is denied recovery.
2. Direct outcomes such as verified access restoration, associated payment value, recovery time, customer contact, refunds, and reversals.

I also changed an early suggestion about learning. The first version proposed offering automation when merchants approved 95% of recommendations without edits. Approval does not prove that the action worked. The final version uses verified Outcome Receipts, failed executions, and wrong-action history. One wrong or reversed action can keep recovery review-first even when most recommendations were approved.

## 4. Validating and narrowing the concept

Razorpay already provides payment, order, capture, refund, and webhook primitives. It also retries webhooks and supports payment verification. Payment Integrity does not replace these capabilities. It connects them to a merchant-defined outcome and investigates what the mismatch means.

The positioning became:

> Razorpay knows whether money moved. Merchant systems know whether value was delivered. Payment Integrity protects the gap between the two.

AI criticism also exposed the biggest feasibility gap. Razorpay cannot automatically know whether a learner received access. This led to two tiers:

- **Tier 0, payment integrity:** Razorpay-side signals such as webhook failures, late authorisation, duplicate attempts, capture state, and unresolved flows. It can say the merchant may not have processed a payment.
- **Tier 1, outcome integrity:** the merchant connects a read-only status source. The product can verify that the promised outcome is missing and investigate merchant-side evidence.

Tier 0 is the adoption wedge that can earn enough trust for Tier 1 access.

### UPI MDR as a new business factor

After the idea was selected, the UPI pricing environment changed. In September 2026, the Ministry of Finance announced a Merchant Discount Rate framework for selected UPI P2M transactions. NPCI's revised pricing was reported to take effect on 15 October 2026.

Eligible P2M transactions above ₹2,000 attract a 0.4% MDR, capped at ₹300. P2P transactions, P2M transactions up to ₹2,000, and qualifying small merchants remain exempt. Separate treatment applies to some essential and thin-margin categories.

This makes Payment Integrity more relevant for merchants selling products above ₹2,000. A paid but unfulfilled transaction can create a customer problem and a margin problem. The product could use confirmed settlement data to show payment value and processing-cost exposure, or include payment rail and applicable pricing when prioritising cases.

I would not call Payment Integrity an RBI or NPCI compliance product. The framework does not require an outcome-integrity agent. I would also not claim “MDR saved” without real settlement and refund-fee data. Cost can inform prioritisation, but it must never override safety.

Sources: [Ministry of Finance announcement](https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=2310586&lang=1&reg=3) and [effective-date reporting based on NPCI's announcement](https://indianexpress.com/article/business/upi-payments-over-rs-2000-to-merchants-will-attract-0-4-fee-10879274/).

## 5. Why the product needs AI

The boundary is:

> **Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.**

A fixed rule can detect a captured payment whose Outcome Contract deadline passed without an Outcome Receipt. It cannot reliably determine whether the webhook is late, an order exists under another ID, the customer paid twice, the merchant deliberately holds the order, inventory changed, or a deployment caused a shared incident.

The AI investigator reconstructs events across systems, compares affected cases, weighs competing causes, distinguishes delay from failure, cites supporting evidence, recommends an action, and escalates when evidence is insufficient.

The model never executes. Its output is schema-validated, and unknown citations are removed. Invalid or unavailable output becomes an escalation. Deterministic policy checks current payment state, permissions, inventory, limits, confidence, service health, data freshness, idempotency, and approval before execution.

## 6. Building the product with Claude Code

The prototype focuses on instant digital fulfilment because the expected outcome is clear. It uses Marrow as a recognizable Razorpay education customer, but every incident, learner, system, and deployment is simulated. The product does not use Marrow's logo or claim knowledge of its real technology.

The main incident contains 43 paid learners and ₹1,82,457 in associated payment value. Thirty-eight cases are eligible for access restoration. Five are held for individual review. Other scenarios include normal delay, late authorisation, duplicates, and an inventory conflict where the agent refuses to act.

The initial Claude Code prompt defined the user, architecture, incident, data model, screens, safety boundary, offline fallback, and non-goals. I required one complete workflow, seeded data, structured model output, refusal states, and deterministic policy. I excluded fraud scoring, routing, discounts, physical delivery, and generic chat.

Further reviews changed the product by:

- Splitting the incident into Decision, Investigation, and Evidence & history.
- Turning the Overview into a direct answer about what needs attention.
- Separating diagnosis confidence, action eligibility, and automation thresholds.
- Adding connected-system permissions and per-action authority.
- Showing observable investigation stages without chain-of-thought.
- Adding Outcome Contracts and Outcome Receipts.
- Adding policy rechecks, idempotency, approval, kill switch, and audit history.
- Adding stale-data, model-unavailable, verification-failure, and paused-service states.
- Keeping explanations needed only for judging outside the main product workflow.

AI generated and edited code, fixtures, tests, and documentation. I reviewed behaviour, wording, hierarchy, claims, and scope.

## 7. Testing AI against fixed rules

The offline evaluation contains 40 labelled synthetic scenarios across ten categories. Thirty-two are development cases and eight are locked holdout cases. AI and a fixed-rule baseline receive the same evidence. Scoring checks root cause, acceptable action, unsafe action, evidence validity, and correct escalation.

| Metric | Rules: development | AI: development | Rules: holdout | AI: holdout |
|---|---:|---:|---:|---:|
| Unsafe-action rate | 3/32 | 1/32 | 1/8 | 1/8 |
| Safe recommendation rate | 22/32 | 30/32 | 6/8 | 6/8 |
| Correct top root cause | 15/32 | 32/32 | 3/8 | 6/8 |
| Correct escalation with insufficient evidence | 2/8 | 8/8 | 1/2 | 1/2 |
| Cases needing manual log inspection | 13/28 | 3/28 | 5/7 | 1/7 |

The holdout supports an early claim that AI diagnosed these synthetic incidents better than rules, 6/8 versus 3/8. It does not show that AI is safer. Both achieved 6/8 safe recommendations, and both had one unsafe holdout action. Safety therefore comes from validation, policy, permissions, approval, idempotency, and verification.

The current outcome history also keeps recovery review-first. Forty-nine of 50 simulated executions were verified, but one was later reversed as a wrong action.

The directly observable business metrics are verified fulfilment recoveries, associated payment value, recovery time, percentage resolved before customer contact, and incorrect or reversed recoveries. Avoided refunds, disputes, support contacts, retained revenue, and MDR saved remain estimates until real merchant data supports them.

## 8. What AI did and what I decided

| Activity | AI contribution | My decision or work |
|---|---|---|
| Research | Summarised Razorpay and competitor products. | Chose which claims to verify and which gaps mattered. |
| Ideation | Generated and structured 17 opportunities. | Rejected obvious, overlapping, or data-infeasible ideas. |
| Criticism | Challenged feasibility, permissions, safety, and measurement. | Decided which criticism changed the product. |
| Product definition | Helped structure signals, actions, controls, and metrics. | Chose the wedge, boundaries, and non-goals. |
| Implementation | Generated code, fixtures, tests, and documentation. | Reviewed the product, corrected scope and wording, and prioritised changes. |
| Evaluation | Helped create scenarios and scoring logic. | Required a fair rules baseline, locked holdout, and honest limitations. |
| Design review | Compared the prototype with public Razorpay patterns. | Removed demo-like clutter and approved the final hierarchy. |

AI let me explore more options, run more criticism, build a deeper prototype, and test more failure states. It did not choose the final product for me.

## 9. Representative prompts

I often began with short or vague questions, reviewed the response, and then wrote a precise Claude Code prompt. These examples keep my original wording.

| Stage | Prompt | What changed |
|---|---|---|
| Exploration | “Help me with ideas for track two. give me detailed breakdown of current razorpay features and suggest atleast 15 ideas and problems that i can solve” | Produced the first landscape and idea set. |
| Originality | “wont everybody choose the same idea” | Made differentiation part of selection. |
| Model comparison | “this is what claude is saying” | Started an adversarial multi-model review. |
| Validation | “verify this idea and validate if it is not being already done. also check can i make it more impactful for business” | Forced comparison with existing products and competitors. |
| AI necessity | “Why AI is necessary and what it does better than a fixed rule. from which point is this getting validated?” | Led to the offline evaluation. |
| Product quality | “so forget the demo time. i need a prompt to build a good enough product... you focus on the product and quality” | Shifted from a demo flow to complete product behaviour. |
| Product realism | “would a product explain so much to a user?” | Moved judging explanations out of the main interface. |
| Design | “razorpay logo is not there and if you look at ray ai it has more colours and is using green a lot” | Corrected the Razorpay and RAY visual hierarchy. |
| Navigation | “i need to kind of make it same by adding an icon as well and the keeping the tab that is not selected muted” | Added icons, active blue state, and muted inactive tabs. |
| Merchant | “it does not feel like learnloop is the client name” followed by “use marrow” | Changed the merchant while adding a simulation disclaimer. |
| Misleading UI | “should i remove live , what is the point” | Removed a production-status badge with no function. |

A later structured Claude Code instruction was:

> Build a Razorpay Agent Studio concept that detects when payment succeeded but learning access is missing, investigates the cause, recommends the safest recovery, requires approval, executes through deterministic policy, and confirms an Outcome Receipt. Use seeded simulated data and an offline fallback. Include one refusal case and one delayed-but-normal case. Do not let the model execute actions directly.

## 10. Limitations, risks, and verification

### Known limitations

- All Marrow incidents, systems, learners, and outcomes are simulated.
- The prototype has no live Razorpay or merchant integration.
- The evaluation is small and synthetic. It cannot establish production accuracy.
- The same model family may have influenced scenario writing and investigation.
- Development scoring patterns were adjusted after seeing development wording.
- One holdout AI recommendation was unsafe.
- Merchant interviews are still needed to validate frequency, workflow, time spent, and willingness to connect outcome data.
- Revenue retained, refunds avoided, support saved, time saved, and MDR saved are unvalidated estimates.
- Public Razorpay videos informed the design but are not internal product requirements.

### Main risks

- Wrong record matching or duplicate fulfilment.
- Acting after inventory or entitlement state changed.
- Stale merchant data or unavailable verification.
- Unsupported model causes, actions, confidence, or citations.
- Excessive permissions or premature automation.
- A simulated incident using a real company name being mistaken for fact.

### Verification steps

- Checked material product and regulatory claims against identified public sources.
- Used seeded fixtures and reproducible scenarios.
- Validated model output against a schema and checked every citation.
- Converted unusable output into escalation.
- Re-ran policy immediately before consequential actions.
- Required an Outcome Receipt before marking success.
- Compared AI with fixed rules on development and holdout sets.
- Tested refusal, insufficient evidence, duplicates, stale data, inventory conflicts, wrong actions, and model failure.
- Ran tests, type checking, linting, build, accessibility checks, and manual reviews.

This log contains no API keys, credentials, private customer data, proprietary Razorpay information, or real Marrow operational data.

## Final product judgment

The project does not try to solve every payment failure. Its first use case is instant digital fulfilment, where the expected outcome can be defined and verified.

The final concept is:

> **Payment Integrity investigates the gap between successful payment and missing customer outcome, prepares the safest recovery decision, and verifies that the merchant delivered what was purchased.**
