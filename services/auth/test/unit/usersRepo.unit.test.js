const { buildUsersRepo } = require("../../src/repos/usersRepo");

function buildPoolWithClient(client) {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn()
  };
}

describe("usersRepo.createUserForRegistration", () => {
  it("runs all transaction queries on the connected client", async () => {
    const insertedRow = {
      id: "user-1",
      email: "user@example.com",
      password_hash: "hash",
      is_admin: true,
      is_active: true
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [insertedRow] })
        .mockResolvedValueOnce({}),
      release: vi.fn()
    };
    const pool = buildPoolWithClient(client);
    const repo = buildUsersRepo(pool);

    const result = await repo.createUserForRegistration({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "hash"
    });

    expect(result).toEqual(insertedRow);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_xact_lock($1)", [947311]);
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO users"),
      ["user-1", "user@example.com", "hash"]
    );
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when insert fails", async () => {
    const insertError = new Error("insert failed");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(insertError)
        .mockResolvedValueOnce({}),
      release: vi.fn()
    };
    const pool = buildPoolWithClient(client);
    const repo = buildUsersRepo(pool);

    await expect(
      repo.createUserForRegistration({
        id: "user-1",
        email: "user@example.com",
        passwordHash: "hash"
      })
    ).rejects.toThrow("insert failed");

    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_xact_lock($1)", [947311]);
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO users"),
      ["user-1", "user@example.com", "hash"]
    );
    expect(client.query).toHaveBeenNthCalledWith(4, "ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
