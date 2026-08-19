/* eslint-disable @typescript-eslint/unbound-method -- Vitest mocks are intentionally extracted for assertions. */
import { describe, expect, it, vi } from "vitest";
import type { AccessConfig } from "../../../src/lib/access-config.js";
import type { AccessApi } from "../../../src/cli/access-policy/cf.js";
import {
  discoverAccess,
  executeAccessApply,
  executeAccessRemove,
  planAccessApply,
  planAccessRemove,
  validateAccessConfig
} from "../../../src/cli/access-policy/reconcile.js";

const config: AccessConfig = {
  policies: [
    {
      name: "staff",
      decision: "allow",
      include: [{ email_domain: { domain: "example.com" } }],
      exclude: [{ email: { email: "blocked@example.com" } }],
      require: [{ country: { country_code: "US" } }],
      sessionDuration: "24h"
    }
  ],
  applications: [
    {
      name: "app",
      domain: "app.example.com",
      destinations: [{ type: "public", uri: "app.example.com/*" }],
      sessionDuration: "12h",
      policies: [{ name: "staff", precedence: 1 }]
    }
  ]
};

function api(policies: unknown[] = [], applications: unknown[] = []): AccessApi {
  return {
    listPolicies: vi.fn().mockReturnValue(policies),
    listApplications: vi.fn().mockReturnValue(applications),
    createPolicy: vi.fn().mockReturnValue({ id: "new-policy", name: "staff" }),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    createApplication: vi.fn(),
    updateApplication: vi.fn(),
    deleteApplication: vi.fn()
  };
}

const remotePolicy = {
  id: "policy-id",
  name: "staff",
  decision: "allow",
  include: config.policies[0].include,
  exclude: config.policies[0].exclude,
  require: config.policies[0].require,
  session_duration: "24h",
  app_count: 1
};
const remoteApp = {
  id: "app-id",
  name: "app",
  domain: "app.example.com",
  type: "self_hosted",
  destinations: config.applications[0].destinations,
  session_duration: "12h",
  policies: [{ id: "policy-id", precedence: 1, reusable: true }]
};

describe("Access config validation", () => {
  it("accepts complete and minimal valid configurations", () => {
    expect(() => validateAccessConfig(config)).not.toThrow();
    expect(() =>
      validateAccessConfig({
        policies: [{ name: "p", decision: "bypass", include: [{}] }],
        applications: [{ name: "a", domain: "x", policies: [] }]
      })
    ).not.toThrow();
  });

  it.each([
    null,
    {},
    { policies: [], applications: null },
    { policies: [null], applications: [] },
    { policies: [{ name: " ", decision: "allow", include: [{}] }], applications: [] },
    { policies: [{ name: "p", decision: "bad", include: [{}] }], applications: [] },
    { policies: [{ name: "p", decision: "allow", include: [] }], applications: [] },
    { policies: [{ name: "p", decision: "allow", include: [null] }], applications: [] },
    {
      policies: [{ name: "p", decision: "allow", include: [{}], exclude: null }],
      applications: []
    },
    { policies: [{ name: "p", decision: "allow", include: [{}], require: [1] }], applications: [] },
    {
      policies: [{ name: "p", decision: "allow", include: [{}], sessionDuration: "" }],
      applications: []
    },
    {
      policies: [
        { name: "p", decision: "allow", include: [{}] },
        { name: "p", decision: "deny", include: [{}] }
      ],
      applications: []
    },
    { policies: [], applications: [null] },
    { policies: [], applications: [{ name: "", domain: "x", policies: [] }] },
    { policies: [], applications: [{ name: "a", domain: "", policies: [] }] },
    { policies: [], applications: [{ name: "a", domain: "x", policies: null }] },
    { policies: [], applications: [{ name: "a", domain: "x", policies: [], sessionDuration: "" }] },
    { policies: [], applications: [{ name: "a", domain: "x", policies: [], destinations: null }] },
    {
      policies: [],
      applications: [
        { name: "a", domain: "x", policies: [], destinations: [{ type: "private", uri: "x" }] }
      ]
    },
    {
      policies: [],
      applications: [
        { name: "a", domain: "x", policies: [], destinations: [{ type: "public", uri: "" }] }
      ]
    },
    {
      policies: [{ name: "p", decision: "allow", include: [{}] }],
      applications: [{ name: "a", domain: "x", policies: [null] }]
    },
    {
      policies: [{ name: "p", decision: "allow", include: [{}] }],
      applications: [{ name: "a", domain: "x", policies: [{ name: "missing", precedence: 1 }] }]
    },
    {
      policies: [{ name: "p", decision: "allow", include: [{}] }],
      applications: [{ name: "a", domain: "x", policies: [{ name: "p", precedence: 0 }] }]
    },
    {
      policies: [{ name: "p", decision: "allow", include: [{}] }],
      applications: [{ name: "a", domain: "x", policies: [{ name: "p", precedence: 1.5 }] }]
    },
    {
      policies: [{ name: "p", decision: "allow", include: [{}] }],
      applications: [
        {
          name: "a",
          domain: "x",
          policies: [
            { name: "p", precedence: 1 },
            { name: "p", precedence: 1 }
          ]
        }
      ]
    },
    {
      policies: [],
      applications: [
        { name: "a", domain: "x", policies: [] },
        { name: "a", domain: "y", policies: [] }
      ]
    }
  ])("rejects invalid configuration %#", (value) => {
    expect(() => validateAccessConfig(value)).toThrow();
  });
});

describe("Access reconciliation", () => {
  it("discovers strict remote resources", () => {
    expect(discoverAccess(api([remotePolicy], [remoteApp]))).toEqual({
      policies: [remotePolicy],
      applications: [remoteApp]
    });
    expect(() => discoverAccess(api([{}]))).toThrow(/policy/);
    expect(() => discoverAccess(api([{ id: "x", name: "p", app_count: -1 }]))).toThrow(/policy/);
    for (const invalid of [
      { id: "x", name: "p", decision: 1 },
      { id: "x", name: "p", include: null },
      { id: "x", name: "p", session_duration: 1 }
    ])
      expect(() => discoverAccess(api([invalid]))).toThrow(/policy/);
    expect(() => discoverAccess(api([], [{}]))).toThrow(/application/);
    expect(() => discoverAccess(api([], [{ id: "x", name: "a", policies: null }]))).toThrow(
      /application/
    );
    for (const invalid of [
      { id: "x", name: "a", domain: 1 },
      { id: "x", name: "a", destinations: null },
      { id: "x", name: "a", destinations: [null] },
      { id: "x", name: "a", policies: [null] },
      { id: "x", name: "a", policies: [{ id: "", precedence: 1 }] },
      { id: "x", name: "a", policies: [{ id: "p" }] },
      { id: "x", name: "a", policies: [{ id: "p", precedence: 0 }] }
    ])
      expect(() => discoverAccess(api([], [invalid]))).toThrow(/application/);
    expect(() => discoverAccess(api([remotePolicy, { ...remotePolicy, id: "two" }]))).toThrow(
      /duplicate/
    );
    expect(() => discoverAccess(api([], [remoteApp, { ...remoteApp, id: "two" }]))).toThrow(
      /duplicate/
    );
  });

  it("plans no-change exactly and detects every managed update", () => {
    expect(
      planAccessApply(config, { policies: [remotePolicy], applications: [remoteApp] }).map(
        ({ action }) => action
      )
    ).toEqual(["no-change", "no-change"]);
    const changedPolicy = {
      ...remotePolicy,
      decision: "deny",
      include: [],
      exclude: [],
      require: [],
      session_duration: undefined
    };
    const changedApp = {
      ...remoteApp,
      domain: "old",
      type: "bookmark",
      destinations: [],
      session_duration: undefined,
      policies: []
    };
    expect(
      planAccessApply(config, { policies: [changedPolicy], applications: [changedApp] }).map(
        ({ action }) => action
      )
    ).toEqual(["update", "update"]);
    expect(
      planAccessApply(config, { policies: [], applications: [] }).map(({ action }) => action)
    ).toEqual(["create", "create"]);
  });

  it("handles omitted optional desired and remote fields", () => {
    const minimal: AccessConfig = {
      policies: [{ name: "p", decision: "bypass", include: [{}] }],
      applications: [{ name: "a", domain: "x", policies: [{ name: "p", precedence: 1 }] }]
    };
    expect(
      planAccessApply(minimal, {
        policies: [{ id: "p", name: "p", decision: "bypass", include: [{}] }],
        applications: [
          {
            id: "a",
            name: "a",
            domain: "x",
            type: "self_hosted",
            policies: [{ id: "p", precedence: 1 }]
          }
        ]
      }).every(({ action }) => action === "no-change")
    ).toBe(true);
    expect(
      planAccessApply(minimal, {
        policies: [{ id: "p", name: "p", decision: "bypass" }],
        applications: [{ id: "a", name: "a", domain: "x", type: "self_hosted" }]
      }).every(({ action }) => action === "update")
    ).toBe(true);
  });

  it("canonicalizes application policy links by precedence", () => {
    const multiPolicy: AccessConfig = {
      policies: [
        { name: "first", decision: "allow", include: [{}] },
        { name: "second", decision: "allow", include: [{}] }
      ],
      applications: [
        {
          name: "app",
          domain: "app.example.com",
          policies: [
            { name: "second", precedence: 2 },
            { name: "first", precedence: 1 }
          ]
        }
      ]
    };
    const snapshot = {
      policies: [
        { id: "first-id", name: "first", decision: "allow", include: [{}] },
        { id: "second-id", name: "second", decision: "allow", include: [{}] }
      ],
      applications: [
        {
          id: "app-id",
          name: "app",
          domain: "app.example.com",
          type: "self_hosted",
          policies: [
            { id: "first-id", precedence: 1 },
            { id: "second-id", precedence: 2 }
          ]
        }
      ]
    };
    expect(
      planAccessApply(multiPolicy, snapshot).every(({ action }) => action === "no-change")
    ).toBe(true);
  });

  it("executes policy creates before application creates using returned IDs", () => {
    const client = api();
    vi.mocked(client.createPolicy).mockReturnValue({ result: { id: "created", name: "staff" } });
    const snapshot = { policies: [], applications: [] };
    const changes = planAccessApply(config, snapshot);
    executeAccessApply(config, snapshot, changes, client);
    expect(client.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({ policies: [{ id: "created", precedence: 1 }] })
    );
    expect(vi.mocked(client.createPolicy).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.createApplication).mock.invocationCallOrder[0]
    );
  });

  it("executes updates and skips no-change operations", () => {
    const client = api([remotePolicy], [remoteApp]);
    const changed = {
      policies: [{ ...remotePolicy, decision: "deny" }],
      applications: [{ ...remoteApp, domain: "old" }]
    };
    executeAccessApply(config, changed, planAccessApply(config, changed), client);
    expect(client.updatePolicy).toHaveBeenCalledWith("policy-id", expect.anything());
    expect(client.updateApplication).toHaveBeenCalledWith("app-id", expect.anything());
    const clean = api();
    executeAccessApply(
      config,
      { policies: [remotePolicy], applications: [remoteApp] },
      planAccessApply(config, { policies: [remotePolicy], applications: [remoteApp] }),
      clean
    );
    expect(clean.updatePolicy).not.toHaveBeenCalled();
  });

  it("accepts data-wrapped policy creation and rejects malformed creation", () => {
    const client = api();
    vi.mocked(client.createPolicy).mockReturnValue({ data: { id: "created", name: "staff" } });
    executeAccessApply(
      config,
      { policies: [], applications: [] },
      planAccessApply(config, { policies: [], applications: [] }),
      client
    );
    vi.mocked(client.createPolicy).mockReturnValue({ bad: true });
    expect(() =>
      executeAccessApply(
        config,
        { policies: [], applications: [] },
        planAccessApply(config, { policies: [], applications: [] }),
        client
      )
    ).toThrow(/invalid/);
  });

  it("fails if an application policy was not resolved during execution", () => {
    const changes = [
      { action: "no-change" as const, kind: "policy" as const, name: "staff" },
      { action: "create" as const, kind: "application" as const, name: "app" }
    ];
    expect(() =>
      executeAccessApply(config, { policies: [], applications: [] }, changes, api())
    ).toThrow(/not resolved/);
  });

  it("plans bounded application-first removal including absent no-change", () => {
    const changes = planAccessRemove(config, {
      policies: [remotePolicy],
      applications: [remoteApp]
    });
    expect(changes).toEqual([
      { action: "delete", kind: "application", name: "app" },
      { action: "delete", kind: "policy", name: "staff" }
    ]);
    expect(
      planAccessRemove(config, { policies: [], applications: [] }).every(
        ({ action }) => action === "no-change"
      )
    ).toBe(true);
    const client = api();
    executeAccessRemove({ policies: [remotePolicy], applications: [remoteApp] }, changes, client);
    expect(vi.mocked(client.deleteApplication).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.deletePolicy).mock.invocationCallOrder[0]
    );
  });

  it("fails closed before removal for unmanaged or unverified policy links", () => {
    const unmanaged = { ...remoteApp, id: "other", name: "other" };
    expect(() =>
      planAccessRemove(config, { policies: [remotePolicy], applications: [remoteApp, unmanaged] })
    ).toThrow(/unmanaged/);
    expect(() =>
      planAccessRemove(config, {
        policies: [{ ...remotePolicy, app_count: 2 }],
        applications: [remoteApp]
      })
    ).toThrow(/unverified/);
    expect(() =>
      planAccessRemove(config, {
        policies: [{ ...remotePolicy, app_count: 0 }],
        applications: [remoteApp]
      })
    ).toThrow(/unverified/);
    expect(() =>
      planAccessRemove(config, {
        policies: [{ ...remotePolicy, app_count: 1 }],
        applications: [{ id: "app-id", name: "app" }]
      })
    ).toThrow(/unverified/);
    expect(() =>
      planAccessRemove(config, { policies: [{ id: "policy-id", name: "staff" }], applications: [] })
    ).toThrow(/verifiable/);
  });

  it("skips no-change entries during removal execution", () => {
    const client = api();
    executeAccessRemove(
      { policies: [], applications: [] },
      [
        { action: "no-change", kind: "application", name: "app" },
        { action: "no-change", kind: "policy", name: "staff" }
      ],
      client
    );
    expect(client.deleteApplication).not.toHaveBeenCalled();
    expect(client.deletePolicy).not.toHaveBeenCalled();
  });
});
