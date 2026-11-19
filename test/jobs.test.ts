import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAILBOX,
  TESTNET_RPC,
  buildClaim,
  buildJobsQuery,
  mentionsOnlyFoundry,
  outcomeFailure,
  parseJobBytes,
  parseJobsPayload,
  publicClaimError,
  readMailboxJobs,
  usdcLabel,
} from "../src/jobs.ts";

const LIVE = JSON.stringify([
  {
    id: 1,
    buyer: "xrayclient1119.testnet",
    brief: "make gizmos",
    escrow_id: 2,
    status: "posted",
    claimer: null,
    result: null,
    expires_at: "1795098929201079285",
    claim_deadline: "",
    settle_step: "",
    payout: null,
    amount: 1000000,
  },
]);

test("usdc labels drop trailing zeros", () => {
  assert.equal(usdcLabel("1000000"), "1");
  assert.equal(usdcLabel("1500000"), "1.5");
  assert.equal(usdcLabel("0"), "0");
  assert.equal(usdcLabel("000"), "0");
  assert.equal(usdcLabel("100"), "0.0001");
  assert.equal(usdcLabel("100000000"), "100");
  assert.equal(usdcLabel("1000001"), "1.000001");
  assert.equal(usdcLabel("nope"), "");
  assert.equal(usdcLabel("1.5"), "");
});

test("the job query is a testnet call and the bytes become jobs", () => {
  const body = buildJobsQuery(MAILBOX);
  assert.equal(body.method, "query");
  assert.equal(body.params.request_type, "call_function");
  assert.equal(body.params.finality, "final");
  assert.equal(body.params.account_id, MAILBOX);
  assert.equal(body.params.method_name, "get_jobs");
  assert.equal(
    body.params.args_base64,
    Buffer.from(JSON.stringify({ status: null, from: 0, limit: 20 })).toString("base64"),
  );
  assert.throws(() => buildJobsQuery("alice.near"), /testnet/);
  assert.throws(() => buildJobsQuery("f".repeat(64)), /testnet/);

  const bytes = Array.from(new TextEncoder().encode(LIVE));
  const jobs = parseJobBytes(bytes);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.brief, "make gizmos");
  assert.equal(jobs[0]?.buyer, "xrayclient1119.testnet");
  assert.equal(jobs[0]?.status, "posted");
  assert.equal(jobs[0]?.amount, "1000000");
  assert.equal(jobs[0]?.escrow_id, 2);
  assert.equal(usdcLabel(jobs[0]?.amount ?? ""), "1");

  const stringAmount = parseJobBytes(
    Array.from(new TextEncoder().encode(JSON.stringify([{ id: 2, brief: "other work", status: "posted", amount: "1500000", buyer: "bob.testnet", escrow_id: 9 }]))),
  );
  assert.equal(stringAmount[0]?.amount, "1500000");
  assert.equal(usdcLabel(stringAmount[0]?.amount ?? ""), "1.5");
  assert.throws(() => parseJobBytes(Array.from(new TextEncoder().encode("{}"))), /readable/);
});

test("a mailbox read uses only the testnet rpc", async () => {
  const bytes = Array.from(new TextEncoder().encode(LIVE));
  const seen = {
    url: "",
    body: null as { method?: string; params?: { account_id?: string } } | null,
  };
  const jobs = await readMailboxJobs(MAILBOX, async (input, init) => {
    seen.url = String(input);
    seen.body = JSON.parse(String(init?.body)) as { method?: string; params?: { account_id?: string } };
    return new Response(JSON.stringify({ result: { result: bytes } }), { status: 200 });
  });
  assert.equal(seen.url, TESTNET_RPC);
  assert.equal(seen.url, "https://rpc.testnet.near.org");
  assert.equal(seen.body?.method, "query");
  assert.equal(seen.body?.params?.account_id, MAILBOX);
  assert.equal(jobs[0]?.id, 1);
  assert.deepEqual(parseJobsPayload({ result: { result: bytes } }), jobs);

  let calls = 0;
  await assert.rejects(
    () =>
      readMailboxJobs("mail.near", async () => {
        calls += 1;
        throw new Error("fetched");
      }),
    /testnet/,
  );
  assert.equal(calls, 0);
});

test("the claim action is one unpaid call", () => {
  const claim = buildClaim(1);
  assert.equal(claim.receiverId, "xraymail1119.testnet");
  assert.equal(claim.action.type, "FunctionCall");
  assert.equal(claim.action.params.methodName, "claim_job");
  assert.deepEqual(claim.action.params.args, { id: 1 });
  assert.equal(claim.action.params.gas, "30000000000000");
  assert.equal(claim.action.params.deposit, "0");
  assert.throws(() => buildClaim(1.5), /posted/);
});

test("a foundry-only refusal stays public", () => {
  assert.equal(mentionsOnlyFoundry("only the foundry claims"), true);
  assert.equal(mentionsOnlyFoundry("foundry"), true);
  assert.equal(
    publicClaimError(new Error("Smart contract panicked: only the foundry claims")),
    "This account cannot claim that job.",
  );
  assert.equal(
    publicClaimError(new Error(`only the foundry ${"ab".repeat(40)}`)),
    "This account cannot claim that job.",
  );
  assert.equal(publicClaimError(new Error("job is not posted")), "job is not posted");
  assert.equal(publicClaimError(new Error("x".repeat(200))), "The claim was not sent.");
  assert.equal(
    outcomeFailure({
      status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "only the foundry claims" } } } } },
    }),
    JSON.stringify({ ActionError: { kind: { FunctionCallError: { ExecutionError: "only the foundry claims" } } } }),
  );
  assert.equal(outcomeFailure({ status: { SuccessValue: "" } }), null);
});
