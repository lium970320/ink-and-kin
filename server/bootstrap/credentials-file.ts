import { execFileSync } from "node:child_process";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";

/** Apply access controls before placing a password in the newly created file. */
export function writeCredentialsFile(filePath: string, contents: string): void {
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
        $ErrorActionPreference = 'Stop'
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $security = New-Object System.Security.AccessControl.FileSecurity
        $security.SetOwner($identity)
        $security.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
        $security.AddAccessRule($rule)
        Set-Acl -LiteralPath $env:INK_AND_KIN_CREDENTIALS_PATH -AclObject $security
      `], {
        env: { ...process.env, INK_AND_KIN_CREDENTIALS_PATH: filePath },
        windowsHide: true,
        stdio: "pipe",
        timeout: 15_000,
      });
    }
    writeFileSync(descriptor, contents, { encoding: "utf8" });
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(filePath);
    throw error;
  }
  closeSync(descriptor);
}
