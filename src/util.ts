export function truncateDerivation(drv: string): string {
  return drv.replace(/^\/nix\/store\/[a-z0-9]+-/, "").replace(/\.drv$/, "");
}
