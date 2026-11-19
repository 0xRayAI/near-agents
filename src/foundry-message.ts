export function foundryMessage(input: {
  name: string;
  account: string;
  foundry: string;
  job: string;
}): string {
  return [
    "Register this foundry",
    `Name: ${input.name.trim()}`,
    `Account: ${input.account.trim()}`,
    `Foundry: ${input.foundry.trim()}`,
    `Job: ${input.job.trim()}`,
  ].join("\n");
}
