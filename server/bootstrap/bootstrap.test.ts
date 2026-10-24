import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "node:child_process";

const getAllUserIds = vi.fn();
const createUser = vi.fn();
const hashPassword = vi.fn();

vi.mock("../db", () => ({
  getAllUserIds: (...a: unknown[]) => getAllUserIds(...(a as [])),
  createUser: (...a: unknown[]) => createUser(...(a as [])),
}));

vi.mock("../_core/password", () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...(a as [])),
}));

import { bootstrapAdminAccount, generatePassword, resolveDataRoot } from "./bootstrap";
import { ENV } from "../_core/env";

let dataRoot: string;
let originalDataRoot: string | undefined;
let originalBootstrap: string | undefined;

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-bootstrap-"));
  originalDataRoot = ENV.dataRoot;
  originalBootstrap = ENV.bootstrapAdmin;
  ENV.dataRoot = dataRoot;
  ENV.bootstrapAdmin = "auto";

  getAllUserIds.mockReset();
  createUser.mockReset();
  hashPassword.mockReset();
  getAllUserIds.mockResolvedValue([]);
  createUser.mockResolvedValue(1);
  hashPassword.mockImplementation(async (password: string) => `hashed:${password}`);
});

afterEach(() => {
  ENV.dataRoot = originalDataRoot ?? "";
  ENV.bootstrapAdmin = (originalBootstrap ?? "auto") as "auto" | "manual";
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("generatePassword", () => {
  it("produces a password of the requested length", () => {
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("avoids characters that are easy to misread", () => {
    const password = generatePassword(64);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it("produces a different password each time", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generatePassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });
});

describe("resolveDataRoot", () => {
  it("uses the configured data root", () => {
    expect(resolveDataRoot()).toBe(path.resolve(dataRoot));
  });
});

describe("bootstrapAdminAccount", () => {
  it("creates an administrator on an empty instance", async () => {
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(true);
    expect(result.username).toBe("admin");
    expect(result.password).toBeTruthy();
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0][0].username).toBe("admin");
  });

  it("writes the credentials to a file only the owner can read (acceptance 0-I)", async () => {
    const result = await bootstrapAdminAccount();

    const credentialsPath = path.join(dataRoot, "first-run-credentials.txt");
    expect(fs.existsSync(credentialsPath)).toBe(true);

    if (process.platform === "win32") {
      const permissions = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
        $ErrorActionPreference = 'Stop'
        $acl = Get-Acl -LiteralPath $env:INK_AND_KIN_CREDENTIALS_PATH
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        @{ protected = $acl.AreAccessRulesProtected;
           ownerMatches = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value;
           ruleCount = $rules.Count;
           otherAllowed = @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ne $sid.Value }).Count;
           inherited = @($rules | Where-Object { $_.IsInherited }).Count
        } | ConvertTo-Json -Compress
      `], { env: { ...process.env, INK_AND_KIN_CREDENTIALS_PATH: credentialsPath }, encoding: "utf8", windowsHide: true }).trim());
      expect(permissions).toMatchObject({ protected: true, ownerMatches: true, ruleCount: 1, otherAllowed: 0, inherited: 0 });
    } else {
      expect(fs.statSync(credentialsPath).mode & 0o777).toBe(0o600);
    }

    const contents = fs.readFileSync(credentialsPath, "utf-8");
    expect(contents).toContain("admin");
    expect(contents).toContain(result.password!);
  });

  it("does not create a second account when one already exists", async () => {
    getAllUserIds.mockResolvedValue([1]);
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataRoot, "first-run-credentials.txt"))).toBe(false);
  });

  it("does not recreate the account on a second start", async () => {
    const first = await bootstrapAdminAccount();
    expect(first.created).toBe(true);

    // The second start sees the account it just created.
    getAllUserIds.mockResolvedValue([1]);
    const second = await bootstrapAdminAccount();

    expect(second.created).toBe(false);
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the operator asks to register manually", async () => {
    ENV.bootstrapAdmin = "manual";
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("never throws when the database is unreachable", async () => {
    getAllUserIds.mockRejectedValue(new Error("connection refused"));
    const result = await bootstrapAdminAccount();

    expect(result.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing credentials file or create an inaccessible account", async () => {
    const file = path.join(dataRoot, "first-run-credentials.txt");
    fs.writeFileSync(file, "existing credentials");
    expect((await bootstrapAdminAccount()).created).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("existing credentials");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("removes new credentials if account creation fails", async () => {
    createUser.mockRejectedValueOnce(new Error("write failed"));
    expect((await bootstrapAdminAccount()).created).toBe(false);
    expect(fs.existsSync(path.join(dataRoot, "first-run-credentials.txt"))).toBe(false);
  });

  it("does not print the generated password in application logs", async () => {
    const logger = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await bootstrapAdminAccount();
      expect(result.created).toBe(true);
      expect(logger.mock.calls.flat().join("\n")).not.toContain(result.password!);
    } finally { logger.mockRestore(); }
  });
});
