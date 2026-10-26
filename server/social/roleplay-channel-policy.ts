export function shouldDeactivateRoleplayChannelAfterMemberRemoval(remainingMemberCount: number): boolean {
  return remainingMemberCount < 2;
}
