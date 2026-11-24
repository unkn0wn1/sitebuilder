/** True only when this process is the public demo. Unset everywhere else, including tests. */
export function demoMode(): boolean {
  return process.env.SITEBUILDER_DEMO_MODE === '1'
}
